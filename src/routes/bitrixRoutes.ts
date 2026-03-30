import express, { Request, Router } from 'express';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { prisma } from '../config/authStorage';
import { handleBitrixOutgoing } from '../modules/bitrix/bitrix.outgoing.controller';
import { handleBitrixImconnector } from '../modules/bitrix/bitrix.webhook.controller';
import { bitrixAuthService } from '../modules/bitrix/bitrix.auth.service';
import {
	connectBitrixOAuth,
	handleBitrixOAuthCallback,
} from '../modules/bitrix/bitrix.auth.controller';

const router = Router();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Bitrix install probes are often sent as application/x-www-form-urlencoded.
router.use(express.urlencoded({ extended: true }));

function readRequestField(req: Request, key: string): string | null {
	const fromQuery = req.query?.[key];
	const fromBody = (req.body as Record<string, unknown> | undefined)?.[key];
	const value = fromQuery ?? fromBody;
	if (Array.isArray(value)) {
		return value.length ? String(value[0]) : null;
	}
	if (value === undefined || value === null || String(value).trim() === '') {
		return null;
	}
	return String(value);
}

function getInstallProbeMeta(req: Request) {
	return {
		method: req.method,
		path: req.originalUrl,
		domain: readRequestField(req, 'DOMAIN'),
		appSid: readRequestField(req, 'APP_SID') ? 'present' : 'missing',
		protocol: readRequestField(req, 'PROTOCOL'),
		lang: readRequestField(req, 'LANG'),
		authId: readRequestField(req, 'AUTH_ID') ? 'present' : 'missing',
		refreshId: readRequestField(req, 'REFRESH_ID') ? 'present' : 'missing',
		status: readRequestField(req, 'status'),
		placement: readRequestField(req, 'PLACEMENT'),
	};
}

function buildInstallRedirectQuery(req: Request): string {
	const params = new URLSearchParams();
	const keys = [
		'DOMAIN',
		'PROTOCOL',
		'LANG',
		'APP_SID',
		'AUTH_ID',
		'AUTH_EXPIRES',
		'REFRESH_ID',
		'member_id',
		'status',
		'PLACEMENT',
		'PLACEMENT_OPTIONS',
	];

	for (const key of keys) {
		const value = readRequestField(req, key);
		if (value) {
			params.set(key, value);
		}
	}

	return params.toString();
}

// Bitrix may probe the base URL with both GET (for the settings page)
// and POST (during installation handshake that sends DOMAIN/APP_SID params).
router.get('/', (req, res) => {
	logger.info(getInstallProbeMeta(req), '[BitrixRoutes] Install/settings GET probe received');
	const settingsPath = path.resolve(process.cwd(), 'public', 'bitrix-settings.html');

	if (fs.existsSync(settingsPath)) {
		res.sendFile(settingsPath);
		return;
	}

	logger.error({ settingsPath }, '[BitrixRoutes] bitrix-settings.html is missing, returning fallback page');
	res
		.status(200)
		.type('html')
		.send(
			'<!doctype html><html><head><meta charset="utf-8"><title>Bitrix Setup</title></head><body><h1>Bitrix setup page is missing in container</h1><p>Expected file: /app/public/bitrix-settings.html</p><p>Rebuild image after copying public assets.</p></body></html>',
		);
});

router.post('/', async (req, res) => {
	const meta = getInstallProbeMeta(req);
	logger.info(meta, '[BitrixRoutes] Install POST probe received');

	if (meta.authId === 'present' && meta.refreshId === 'present') {
		try {
			await bitrixAuthService.saveInstallToken({
				domain: readRequestField(req, 'DOMAIN'),
				authId: readRequestField(req, 'AUTH_ID'),
				refreshId: readRequestField(req, 'REFRESH_ID'),
				authExpires: readRequestField(req, 'AUTH_EXPIRES'),
			});
		} catch (error: any) {
			logger.error(
				{ message: error?.message, domain: meta.domain },
				'[BitrixRoutes] Failed to persist install token',
			);
		}
	}

	// In Bitrix iframe/browser POST during install, redirect to GET so UI is visible.
	if (req.accepts('html')) {
		const query = buildInstallRedirectQuery(req);
		const target = query ? `/integrations/bitrix/?${query}` : '/integrations/bitrix/';
		res.redirect(302, target);
		return;
	}

	// Respond 200 so Bitrix sees the connector as reachable.
	res.status(200).json({
		ok: true,
		path: req.originalUrl,
		installProbe: {
			domain: meta.domain,
			appSid: meta.appSid,
			protocol: meta.protocol,
			lang: meta.lang,
		},
	});
});

router.get('/connect', connectBitrixOAuth);
router.get('/oauth/callback', handleBitrixOAuthCallback);

// Dev helper for quick test setup from Bitrix settings page.
router.post('/dev/organizations', async (req, res) => {
	try {
		const rawName = String(req.body?.name || '').trim();
		const name = rawName || `Bitrix Test Org ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;

		const organization = await prisma.organization.create({
			data: { name },
			select: { id: true, name: true, createdAt: true },
		});

		res.status(201).json({ ok: true, organization });
	} catch (error: any) {
		logger.error({ message: error?.message }, '[BitrixRoutes] Failed to create test organization');
		res.status(500).json({ ok: false, error: 'Failed to create test organization' });
	}
});

// Bitrix → Chat outgoing webhook
router.post('/outgoing', handleBitrixOutgoing);
router.post('/imconnector', handleBitrixImconnector);

export default router;
