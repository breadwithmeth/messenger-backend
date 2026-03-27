import { Request, Response } from 'express';
import pino from 'pino';
import { bitrixConnectorService } from './bitrix.connector.service';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const WINDOW_MS = 10_000;
const LIMIT = 50;
const tokenBuckets = new Map<string, number[]>();

export async function handleBitrixImconnector(req: Request, res: Response) {
  const token = req.headers['x-bitrix-token'];
  const expected = process.env.BITRIX_TOKEN || '';

  res.status(200).json({ ok: true });

  logger.info({ body: req.body }, '[BitrixImconnector] Webhook received');

  if (!expected || token !== expected) {
    logger.warn('[BitrixImconnector] Invalid token');
    return;
  }

  const key = String(token);
  const now = Date.now();
  const history = (tokenBuckets.get(key) || []).filter((ts) => now - ts < WINDOW_MS);
  if (history.length >= LIMIT) {
    logger.warn('[BitrixImconnector] Rate limit exceeded');
    tokenBuckets.set(key, history);
    return;
  }
  history.push(now);
  tokenBuckets.set(key, history);

  try {
    await bitrixConnectorService.handleIncomingFromBitrix(req.body);
  } catch (error: any) {
    logger.error({ message: error?.message }, '[BitrixImconnector] Processing error');
  }
}
