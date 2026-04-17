import { Request, Response } from 'express';
import pino from 'pino';
import { bitrixConnectorService } from './bitrix.connector.service';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const WINDOW_MS = 10_000;
const LIMIT = 50;
const tokenBuckets = new Map<string, number[]>();

function readBitrixToken(req: Request): { value: string; source: string } {
  const fromHeader = req.headers['x-bitrix-token'];
  if (typeof fromHeader === 'string' && fromHeader.trim()) {
    return { value: fromHeader.trim(), source: 'header:x-bitrix-token' };
  }

  const body = (req.body || {}) as Record<string, any>;
  const fromAuthObject = body?.auth?.application_token;
  if (typeof fromAuthObject === 'string' && fromAuthObject.trim()) {
    return { value: fromAuthObject.trim(), source: 'body:auth.application_token' };
  }

  const fromAuthFlat = body?.['auth[application_token]'];
  if (typeof fromAuthFlat === 'string' && fromAuthFlat.trim()) {
    return { value: fromAuthFlat.trim(), source: 'body:auth[application_token]' };
  }

  const fromQuery = req.query?.application_token;
  if (typeof fromQuery === 'string' && fromQuery.trim()) {
    return { value: fromQuery.trim(), source: 'query:application_token' };
  }

  return { value: '', source: 'none' };
}

export async function handleBitrixImconnector(req: Request, res: Response) {
  const tokenInfo = readBitrixToken(req);
  const token = tokenInfo.value;
  const allowedTokens = [process.env.BITRIX_TOKEN, process.env.BITRIX_APP_TOKEN]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  res.status(200).json({ ok: true });

  logger.info({ body: req.body, tokenSource: tokenInfo.source }, '[BitrixImconnector] Webhook received');

  if (!allowedTokens.length || !allowedTokens.includes(token)) {
    logger.warn({ tokenSource: tokenInfo.source, allowedTokenCount: allowedTokens.length }, '[BitrixImconnector] Invalid token');
    return;
  }

  const key = token;
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
