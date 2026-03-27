// src/middlewares/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import { syncEmployeeFromClaims } from '../integrations/workforce/workforceIntegration';
import { authenticateToken } from '../auth/tokenAuth';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const AUTH_DEBUG_RESPONSE = process.env.AUTH_DEBUG_RESPONSE === 'true' || process.env.NODE_ENV !== 'production';

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    organizationId: number;
    role?: string;
    keycloakRoles?: string[];
    // Optional Keycloak-ish claims (if token contains them)
    keycloakId?: string;
    email?: string;
    username?: string;
  };
}

function getTokenDebugInfo(token: string) {
  try {
    const decoded = jwt.decode(token) as Record<string, unknown> | null;
    if (!decoded) {
      return { decodeError: 'Cannot decode JWT payload' };
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = typeof decoded.exp === 'number' ? decoded.exp : undefined;

    return {
      iss: decoded.iss,
      aud: decoded.aud,
      azp: decoded.azp,
      sub: decoded.sub,
      typ: decoded.typ,
      jti: decoded.jti,
      exp,
      iat: decoded.iat,
      now,
      expired: typeof exp === 'number' ? exp <= now : undefined,
      secondsLeft: typeof exp === 'number' ? exp - now : undefined,
    };
  } catch (error: any) {
    return { decodeError: error?.message || 'JWT decode exception' };
  }
}

function looksLikeJwt(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function extractTokenFromJsonLike(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const accessToken = parsed?.access_token;
    if (typeof accessToken === 'string' && looksLikeJwt(accessToken)) return accessToken;

    const idToken = parsed?.id_token;
    if (typeof idToken === 'string' && looksLikeJwt(idToken)) return idToken;

    return null;
  } catch {
    return null;
  }
}

function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;

  if (typeof authHeader === 'string' && authHeader.trim()) {
    const trimmed = authHeader.trim();

    if (/^Bearer\s+/i.test(trimmed)) {
      const bearerValue = trimmed.replace(/^Bearer\s+/i, '').trim();
      if (looksLikeJwt(bearerValue)) return bearerValue;

      const fromJson = extractTokenFromJsonLike(bearerValue);
      if (fromJson) return fromJson;
    }

    if (looksLikeJwt(trimmed)) return trimmed;

    const fromJson = extractTokenFromJsonLike(trimmed);
    if (fromJson) return fromJson;
  }

  const xAccessToken = req.headers['x-access-token'];
  if (typeof xAccessToken === 'string' && looksLikeJwt(xAccessToken.trim())) {
    return xAccessToken.trim();
  }

  const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : null;
  if (queryToken && looksLikeJwt(queryToken.trim())) {
    return queryToken.trim();
  }

  return null;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractAuthToken(req);
  if (!token) {
    const authHeader = req.headers.authorization;
    logger.warn({
      path: req.originalUrl,
      method: req.method,
      hasAuthorizationHeader: Boolean(authHeader),
      authorizationPrefix: authHeader?.split(' ')[0],
      authorizationLength: typeof authHeader === 'string' ? authHeader.length : undefined,
      hasXAccessToken: Boolean(req.headers['x-access-token']),
      hasQueryAccessToken: typeof req.query.access_token === 'string',
    }, '[authMiddleware] Missing or invalid Authorization header');
    return res.status(401).json(
      AUTH_DEBUG_RESPONSE
        ? {
            error: 'Нет токена',
            debug: {
              path: req.originalUrl,
              method: req.method,
              hasAuthorizationHeader: Boolean(authHeader),
              authorizationPrefix: authHeader?.split(' ')[0],
              hasXAccessToken: Boolean(req.headers['x-access-token']),
              hasQueryAccessToken: typeof req.query.access_token === 'string',
            },
          }
        : { error: 'Нет токена' }
    );
  }

  authenticateToken(token)
    .then((principal) => {
      req.user = {
        userId: principal.userId,
        organizationId: principal.organizationId,
        role: principal.role,
        keycloakRoles: principal.keycloakRoles,
        keycloakId: principal.keycloakId,
        email: principal.email,
        username: principal.username,
      };

      res.locals.userId = principal.userId;
      res.locals.organizationId = principal.organizationId;

      if (principal.source === 'keycloak-jwt') {
        const requestIdHeader = req.headers['x-request-id'];
        const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
        void syncEmployeeFromClaims({
          claims: {
            keycloakId: principal.keycloakId,
            sub: principal.keycloakId,
            email: principal.email,
            preferred_username: principal.username,
          },
          ip: req.ip,
          requestId,
        });
      }

      next();
    })
    .catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const tokenDebug = getTokenDebugInfo(token);
      logger.error({
        path: req.originalUrl,
        method: req.method,
        ip: req.ip,
        errorMessage,
        tokenDebug,
      }, '[authMiddleware] Token authentication failed');
      res.status(401).json(
        AUTH_DEBUG_RESPONSE
          ? {
              error: 'Неверный токен',
              debug: {
                path: req.originalUrl,
                method: req.method,
                errorMessage,
                tokenDebug,
              },
            }
          : { error: 'Неверный токен' }
      );
    });
}
