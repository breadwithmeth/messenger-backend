import { Router } from 'express';
import path from 'path';
import { handleBitrixOutgoing } from '../modules/bitrix/bitrix.outgoing.controller';
import { handleBitrixImconnector } from '../modules/bitrix/bitrix.webhook.controller';
import {
	connectBitrixOAuth,
	handleBitrixOAuthCallback,
} from '../modules/bitrix/bitrix.auth.controller';

const router = Router();

router.get('/', (_req, res) => {
	res.sendFile(path.resolve(process.cwd(), 'public', 'bitrix-settings.html'));
});

router.get('/connect', connectBitrixOAuth);
router.get('/oauth/callback', handleBitrixOAuthCallback);

// Bitrix → Chat outgoing webhook
router.post('/outgoing', handleBitrixOutgoing);
router.post('/imconnector', handleBitrixImconnector);

export default router;
