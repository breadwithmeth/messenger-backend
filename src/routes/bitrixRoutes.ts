import { Router } from 'express';
import path from 'path';
import pino from 'pino';
import { handleBitrixOutgoing } from '../modules/bitrix/bitrix.outgoing.controller';
import { handleBitrixImconnector } from '../modules/bitrix/bitrix.webhook.controller';
import {
	connectBitrixOAuth,
	handleBitrixOAuthCallback,
} from '../modules/bitrix/bitrix.auth.controller';

const router = Router();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function getInstallProbeMeta(req: { query: Record<string, unknown>; originalUrl: string; method: string }) {
	return {
		method: req.method,
		path: req.originalUrl,
		domain: req.query.DOMAIN || null,
		appSid: req.query.APP_SID ? 'present' : 'missing',
		protocol: req.query.PROTOCOL || null,
		lang: req.query.LANG || null,
	};
}

// Bitrix may probe the base URL with both GET (for the settings page)
// and POST (during installation handshake that sends DOMAIN/APP_SID params).
router.get('/', (req, res) => {
	logger.info(getInstallProbeMeta(req), '[BitrixRoutes] Install/settings GET probe received');
	res.sendFile(path.resolve(process.cwd(), 'public', 'bitrix-settings.html'));
});

router.post('/', (req, res) => {
	const meta = getInstallProbeMeta(req);
	logger.info(meta, '[BitrixRoutes] Install POST probe received');

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

// Bitrix → Chat outgoing webhook
router.post('/outgoing', handleBitrixOutgoing);
router.post('/imconnector', handleBitrixImconnector);

export default router;
