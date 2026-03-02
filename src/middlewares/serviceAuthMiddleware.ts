import { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function getIssuer(): string {
  const base = process.env.KEYCLOAK_BASE_URL;
  const realm = process.env.KEYCLOAK_REALM;
  if (!base || !realm) {
    throw new Error('KEYCLOAK_BASE_URL or KEYCLOAK_REALM is not configured');
  }
  return `${normalizeBaseUrl(base)}/realms/${realm}`;
}

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (jwksCache) return jwksCache;
  const issuer = getIssuer();
  jwksCache = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
  return jwksCache;
}

function extractRoles(payload: JWTPayload): string[] {
  const roles = new Set<string>();
  const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
  if (realmAccess?.roles && Array.isArray(realmAccess.roles)) {
    for (const r of realmAccess.roles) {
      if (typeof r === 'string' && r.trim()) roles.add(r.trim());
    }
  }

  const resourceAccess = payload.resource_access as Record<string, { roles?: unknown }> | undefined;
  if (resourceAccess) {
    for (const entry of Object.values(resourceAccess)) {
      if (entry?.roles && Array.isArray(entry.roles)) {
        for (const r of entry.roles) {
          if (typeof r === 'string' && r.trim()) roles.add(r.trim());
        }
      }
    }
  }
  return Array.from(roles);
}

export async function serviceAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = auth.slice(7).trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const issuer = getIssuer();
    const audience = process.env.KEYCLOAK_API_AUDIENCE;

    const { payload } = await jwtVerify(token, getJwks(), {
      issuer,
      audience: audience || undefined,
    });

    const roles = extractRoles(payload);
    if (!roles.includes('employee-service-access')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    (req as any).serviceToken = token;
    res.locals.serviceToken = token;
    res.locals.serviceRoles = roles;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
