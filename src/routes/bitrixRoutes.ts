import { Router } from 'express';
import path from 'path';
import { handleBitrixOutgoing } from '../modules/bitrix/bitrix.outgoing.controller';
import { handleBitrixImconnector } from '../modules/bitrix/bitrix.webhook.controller';
import {
	connectBitrixOAuth,
	handleBitrixOAuthCallback,
} from '../modules/bitrix/bitrix.auth.controller';

const router = Router();

// Bitrix may probe the base URL with both GET (for the settings page)
// and POST (during installation handshake that sends DOMAIN/APP_SID params).
router.get('/', (_req, res) => {
	res.sendFile(path.resolve(process.cwd(), 'public', 'bitrix-settings.html'));
});

router.post('/', (req, res) => {
	// Respond 200 so Bitrix sees the connector as reachable. Echo minimal context for debugging.
	res.status(200).json({ ok: true, path: req.originalUrl });
});

router.get('/connect', connectBitrixOAuth);
router.get('/oauth/callback', handleBitrixOAuthCallback);

// Bitrix → Chat outgoing webhook
router.post('/outgoing', handleBitrixOutgoing);
router.post('/imconnector', handleBitrixImconnector);

export default router;
