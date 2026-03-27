import { Router } from 'express';
import { handleBitrixOutgoing } from '../modules/bitrix/bitrix.outgoing.controller';
import { handleBitrixImconnector } from '../modules/bitrix/bitrix.webhook.controller';
import {
	connectBitrixOAuth,
	handleBitrixOAuthCallback,
} from '../modules/bitrix/bitrix.auth.controller';

const router = Router();

router.get('/connect', connectBitrixOAuth);
router.get('/oauth/callback', handleBitrixOAuthCallback);

// Bitrix → Chat outgoing webhook
router.post('/outgoing', handleBitrixOutgoing);
router.post('/imconnector', handleBitrixImconnector);

export default router;
