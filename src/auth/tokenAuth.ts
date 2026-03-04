import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';
import prisma from '../config/prisma';
import { normalizeAppRole } from './roleUtils';

export type AuthSource = 'keycloak-jwt';

export interface AuthenticatedPrincipal {
  userId: number;
  organizationId: number;
  email?: string;
  username?: string;
  role?: string;
  keycloakRoles?: string[];
  keycloakId?: string;
  source: AuthSource;
  claims?: Record<string, unknown>;
}

let cachedIssuer: string | null = null;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function getStringClaim(payload: JWTPayload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizeForEmailLocalPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function extractKeycloakRoles(payload: JWTPayload): string[] {
  const roles = new Set<string>();

  const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
  for (const role of toStringArray(realmAccess?.roles)) roles.add(role);

  const resourceAccess = payload.resource_access as Record<string, { roles?: unknown }> | undefined;
  const preferredClients = [
    process.env.KEYCLOAK_API_AUDIENCE,
    process.env.KEYCLOAK_ROLE_CLIENT,
    getStringClaim(payload, 'azp'),
  ].filter((value): value is string => Boolean(value));

  for (const clientId of preferredClients) {
    for (const role of toStringArray(resourceAccess?.[clientId]?.roles)) roles.add(role);
  }

  return Array.from(roles);
}

function mapAppRoleFromKeycloakRoles(keycloakRoles: string[]): string | undefined {
  for (const role of keycloakRoles) {
    const mapped = normalizeAppRole(role);
    if (mapped === 'admin') return mapped;
  }

  for (const role of keycloakRoles) {
    const mapped = normalizeAppRole(role);
    if (mapped === 'manager') return mapped;
  }

  for (const role of keycloakRoles) {
    const mapped = normalizeAppRole(role);
    if (mapped === 'employee') return mapped;
  }

  return normalizeAppRole(process.env.KEYCLOAK_DEFAULT_ROLE || undefined);
}

function getKeycloakIssuer(): string | null {
  if (process.env.KEYCLOAK_ISSUER) return normalizeBaseUrl(process.env.KEYCLOAK_ISSUER);

  const base = process.env.KEYCLOAK_BASE_URL;
  const realm = process.env.KEYCLOAK_REALM;
  if (!base || !realm) return null;

  return `${normalizeBaseUrl(base)}/realms/${realm}`;
}

function getIssuerFromToken(token: string): string | null {
  const decoded = jwt.decode(token) as JWTPayload | null;
  if (!decoded || typeof decoded.iss !== 'string') return null;
  return normalizeBaseUrl(decoded.iss);
}

function isTrustedKeycloakIssuer(issuer: string): boolean {
  const normalizedIssuer = normalizeBaseUrl(issuer);

  const realm = process.env.KEYCLOAK_REALM;
  if (realm && !normalizedIssuer.includes(`/realms/${realm}`)) {
    return false;
  }

  const base = process.env.KEYCLOAK_BASE_URL;
  if (!base) return true;

  try {
    const baseUrl = new URL(normalizeBaseUrl(base));
    const issuerUrl = new URL(normalizedIssuer);
    return baseUrl.host === issuerUrl.host;
  } catch {
    return false;
  }
}

function getOrCreateJwks(issuer: string) {
  if (cachedIssuer === issuer && cachedJwks) return cachedJwks;

  const jwksUrl = new URL(`${issuer}/protocol/openid-connect/certs`);
  cachedJwks = createRemoteJWKSet(jwksUrl);
  cachedIssuer = issuer;
  return cachedJwks;
}

async function resolveOrganizationIdFromClaims(payload: JWTPayload): Promise<number> {
  const fromClaims =
    toNumber(payload.organizationId) ??
    toNumber(payload.organization_id) ??
    toNumber(payload.org_id);

  if (fromClaims) {
    const org = await prisma.organization.findUnique({ where: { id: fromClaims }, select: { id: true } });
    if (org) return org.id;
  }

  const fromEnv = toNumber(process.env.DEFAULT_ORGANIZATION_ID);
  if (fromEnv) {
    const org = await prisma.organization.findUnique({ where: { id: fromEnv }, select: { id: true } });
    if (org) return org.id;
  }

  const firstOrg = await prisma.organization.findFirst({ select: { id: true } });
  if (firstOrg) return firstOrg.id;

  const createdOrg = await prisma.organization.create({
    data: {
      name: process.env.DEFAULT_ORGANIZATION_NAME || 'Default Organization',
    },
    select: { id: true },
  });

  return createdOrg.id;
}

async function resolveOrCreateUserFromKeycloak(payload: JWTPayload): Promise<AuthenticatedPrincipal> {
  const keycloakSub = getStringClaim(payload, 'sub');
  const keycloakRoles = extractKeycloakRoles(payload);
  const keycloakRole = mapAppRoleFromKeycloakRoles(keycloakRoles);
  const preferredUsername = getStringClaim(payload, 'preferred_username') ?? getStringClaim(payload, 'username');
  const rawEmail = getStringClaim(payload, 'email');

  const email = rawEmail
    ? rawEmail.toLowerCase()
    : keycloakSub
      ? `${sanitizeForEmailLocalPart(keycloakSub)}@keycloak.local`
      : preferredUsername
        ? `${sanitizeForEmailLocalPart(preferredUsername)}@keycloak.local`
        : '';

  if (!email) {
    throw new Error('Keycloak token does not contain sub/email/username claims required for user resolution');
  }

  const displayName = getStringClaim(payload, 'name') || preferredUsername || email;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, organizationId: true, email: true, name: true, role: true },
  });

  if (existing) {
    if (keycloakRole && normalizeAppRole(existing.role) !== keycloakRole) {
      await prisma.user.update({ where: { id: existing.id }, data: { role: keycloakRole } });
    }

    return {
      userId: existing.id,
      organizationId: existing.organizationId,
      email: existing.email,
      username: preferredUsername || existing.name || undefined,
      role: keycloakRole ?? normalizeAppRole(existing.role),
      keycloakRoles,
      keycloakId: keycloakSub,
      source: 'keycloak-jwt',
      claims: payload as unknown as Record<string, unknown>,
    };
  }

  const organizationId = await resolveOrganizationIdFromClaims(payload);
  const role = keycloakRole || normalizeAppRole(process.env.KEYCLOAK_DEFAULT_ROLE || undefined) || 'employee';
  const passwordHash = await bcrypt.hash(randomUUID(), 10);

  try {
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: displayName,
        role,
        organizationId,
      },
      select: { id: true, organizationId: true, email: true },
    });

    return {
      userId: created.id,
      organizationId: created.organizationId,
      email: created.email,
      username: preferredUsername || displayName,
      role,
      keycloakRoles,
      keycloakId: keycloakSub,
      source: 'keycloak-jwt',
      claims: payload as unknown as Record<string, unknown>,
    };
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const fallback = await prisma.user.findUnique({
        where: { email },
        select: { id: true, organizationId: true, email: true, name: true, role: true },
      });
      if (fallback) {
        return {
          userId: fallback.id,
          organizationId: fallback.organizationId,
          email: fallback.email,
          username: preferredUsername || fallback.name || undefined,
          role: keycloakRole ?? normalizeAppRole(fallback.role),
          keycloakRoles,
          keycloakId: keycloakSub,
          source: 'keycloak-jwt',
          claims: payload as unknown as Record<string, unknown>,
        };
      }
    }
    throw error;
  }
}

async function verifyKeycloakJwt(token: string): Promise<AuthenticatedPrincipal | null> {
  const configuredIssuer = getKeycloakIssuer();
  const tokenIssuer = getIssuerFromToken(token);

  const issuerCandidates = Array.from(
    new Set([tokenIssuer, configuredIssuer].filter((value): value is string => Boolean(value)))
  ).filter(isTrustedKeycloakIssuer);

  if (!issuerCandidates.length) return null;

  const audience = process.env.KEYCLOAK_API_AUDIENCE;
  const errors: string[] = [];

  for (const issuer of issuerCandidates) {
    try {
      const jwks = getOrCreateJwks(issuer);
      const verifyOptions: { issuer: string; audience?: string } = {
        issuer,
      };
      if (audience) verifyOptions.audience = audience;

      const { payload } = await jwtVerify(token, jwks, verifyOptions);
      return resolveOrCreateUserFromKeycloak(payload);
    } catch (error: any) {
      errors.push(`${issuer}: ${error?.message || 'verification failed'}`);
    }
  }

  throw new Error(`Keycloak token verification failed. ${errors.join(' | ')}`);
}

export async function authenticateToken(token: string): Promise<AuthenticatedPrincipal> {
  const keycloak = await verifyKeycloakJwt(token);
  if (keycloak) return keycloak;

  throw new Error('Invalid token');
}
