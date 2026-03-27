import { NextFunction, Request, Response } from 'express';
import pino from 'pino';
import { bitrixAuthService } from './bitrix.auth.service';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export async function ensureBitrixAccessToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = await bitrixAuthService.getValidAccessToken();
    res.locals.bitrixAccessToken = token;
    next();
  } catch (error: any) {
    logger.error({ message: error?.message }, '[BitrixAuthMiddleware] Token validation failed');
    res.status(503).json({ ok: false, error: 'Bitrix OAuth token unavailable' });
  }
}
