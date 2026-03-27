import { Request, Response } from 'express';
import pino from 'pino';
import { bitrixAuthService } from './bitrix.auth.service';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export async function connectBitrixOAuth(req: Request, res: Response): Promise<void> {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const url = bitrixAuthService.getAuthorizeUrl(state);
    res.redirect(url);
  } catch (error: any) {
    logger.error({ message: error?.message }, '[BitrixAuthController] Connect failed');
    res.status(500).json({ ok: false, error: 'Bitrix OAuth connect failed' });
  }
}

export async function handleBitrixOAuthCallback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : '';

  if (!code) {
    res.status(400).json({ ok: false, error: 'Missing code query param' });
    return;
  }

  try {
    const token = await bitrixAuthService.exchangeCode(code);

    res.status(200).json({
      ok: true,
      domain: token.domain,
      expiresAt: token.expiresAt.toISOString(),
    });
  } catch (error: any) {
    logger.error({ message: error?.message }, '[BitrixAuthController] Callback failed');
    res.status(500).json({ ok: false, error: 'Bitrix OAuth callback failed' });
  }
}
