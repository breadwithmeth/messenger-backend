import { Request, Response } from 'express';
import pino from 'pino';
import { bitrixOutgoingService } from './bitrix.outgoing.service';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const WINDOW_MS = 10_000;
const LIMIT = 20;
const tokenBuckets = new Map<string, number[]>();

export async function handleBitrixOutgoing(req: Request, res: Response) {
  const token = req.headers['x-bitrix-token'];
  const expected = process.env.BITRIX_TOKEN || '';

  logger.info({ body: req.body }, '[BitrixOutgoing] Webhook received');

  // Always respond 200 per requirements
  res.status(200).json({ ok: true });

  if (!expected || token !== expected) {
    logger.warn('[BitrixOutgoing] Invalid token');
    return;
  }

  // simple rate limiter per token
  const key = String(token);
  const now = Date.now();
  const history = (tokenBuckets.get(key) || []).filter((ts) => now - ts < WINDOW_MS);
  if (history.length >= LIMIT) {
    logger.warn('[BitrixOutgoing] Rate limit exceeded');
    tokenBuckets.set(key, history);
    return;
  }
  history.push(now);
  tokenBuckets.set(key, history);

  try {
    await bitrixOutgoingService.processWebhook(req.body);
  } catch (error: any) {
    logger.error({ message: error?.message }, '[BitrixOutgoing] Processing error');
  }
}
