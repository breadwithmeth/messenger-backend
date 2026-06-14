import { NextFunction, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticateWebsiteVisitorSession } from '../services/websiteWidgetService';

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitEntries = new Map<string, RateLimitEntry>();

function extractBearerToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function loadWebsiteWidget(req: Request, res: Response, next: NextFunction) {
  try {
    const widget = await prisma.websiteWidget.findUnique({
      where: { publicKey: req.params.publicKey },
    });

    if (!widget || widget.status !== 'active') {
      return res.status(404).json({ error: 'Виджет не найден или отключён' });
    }

    res.locals.websiteWidget = widget;
    next();
  } catch (error) {
    next(error);
  }
}

export function websiteWidgetCors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

export function websiteWidgetRateLimit(options: {
  scope: string;
  max: number;
  windowMs: number;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (rateLimitEntries.size > 10_000) {
      for (const [entryKey, entry] of rateLimitEntries) {
        if (entry.resetAt <= now) rateLimitEntries.delete(entryKey);
      }
    }
    const publicKey = req.params.publicKey || 'unknown';
    const sessionId = req.params.sessionId || '';
    const key = `${options.scope}:${publicKey}:${sessionId}:${req.ip}`;
    const current = rateLimitEntries.get(key);

    if (!current || current.resetAt <= now) {
      rateLimitEntries.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (current.count >= options.max) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
      res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
      return;
    }

    current.count += 1;
    next();
  };
}

export async function authenticateWebsiteSession(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Требуется токен сессии виджета' });

    const session = await authenticateWebsiteVisitorSession(
      req.params.publicKey,
      req.params.sessionId,
      token
    );

    if (!session) return res.status(401).json({ error: 'Недействительная сессия виджета' });

    res.locals.websiteSession = session;
    next();
  } catch (error) {
    next(error);
  }
}
