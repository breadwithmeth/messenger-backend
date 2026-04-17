import { Request, Response } from 'express';
import pino from 'pino';
import { bitrixAuthService } from './bitrix.auth.service';
import { BitrixHttpClient } from './bitrix.http.client';

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

    const autoEnsureEnabled = String(process.env.BITRIX_AUTO_ENSURE_CONNECTORS || 'true').toLowerCase() !== 'false';
    if (autoEnsureEnabled) {
      try {
        await autoEnsureBitrixOpenlineConnectors(req);
      } catch (autoEnsureError: any) {
        logger.warn({ message: autoEnsureError?.message }, '[BitrixAuthController] Auto connector ensure after OAuth callback failed');
      }
    }

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

function resolveEventHandlerUrl(req: Request): string {
  const fromBody = String((req.body as any)?.handler || '').trim();
  if (fromBody) {
    return fromBody;
  }

  const fromQuery = typeof req.query.handler === 'string' ? req.query.handler.trim() : '';
  if (fromQuery) {
    return fromQuery;
  }

  const configured = String(process.env.BITRIX_EVENT_HANDLER_URL || '').trim();
  if (configured) {
    return configured;
  }

  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || '';
  if (!host) {
    throw new Error('Cannot resolve handler URL: host is missing');
  }

  return `${proto}://${host}/integrations/bitrix/imconnector`;
}

function parseEvents(req: Request): string[] {
  const bodyEvents = (req.body as any)?.events;
  if (Array.isArray(bodyEvents) && bodyEvents.length > 0) {
    return bodyEvents.map((e) => String(e || '').trim()).filter(Boolean);
  }

  const rawEvent =
    (req.body as any)?.event ||
    (typeof req.query.event === 'string' ? req.query.event : '') ||
    'ONIMCONNECTORMESSAGEADD';

  return [String(rawEvent).trim()].filter(Boolean);
}

function getBitrixClient(): BitrixHttpClient {
  const domain = bitrixAuthService.getDomain();
  return new BitrixHttpClient(domain);
}

function parseOptionalBindParams(req: Request): Record<string, unknown> {
  const body = (req.body || {}) as Record<string, unknown>;
  const optionalParams: Record<string, unknown> = {};

  const authType = body.auth_type;
  if (authType !== undefined && authType !== null && String(authType).trim() !== '') {
    optionalParams.auth_type = Number(authType);
  }

  const eventType = body.event_type;
  if (typeof eventType === 'string' && eventType.trim()) {
    optionalParams.event_type = eventType.trim();
  }

  const authConnector = body.auth_connector;
  if (typeof authConnector === 'string' && authConnector.trim()) {
    optionalParams.auth_connector = authConnector.trim();
  }

  if (body.options !== undefined) {
    optionalParams.options = body.options;
  }

  return optionalParams;
}

function resolveConnectorPlacementUrl(req: Request): string {
  const fromBody = String((req.body as any)?.placementHandler || '').trim();
  if (fromBody) {
    return fromBody;
  }

  const fromQuery = typeof req.query.placementHandler === 'string' ? req.query.placementHandler.trim() : '';
  if (fromQuery) {
    return fromQuery;
  }

  const configured = String(process.env.BITRIX_CONNECTOR_PLACEMENT_HANDLER || '').trim();
  if (configured) {
    return configured;
  }

  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || '';
  if (!host) {
    throw new Error('Cannot resolve connector placement URL: host is missing');
  }

  return `${proto}://${host}/integrations/bitrix/`;
}

function normalizeConnectorId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getLineIdForChannel(channel: string, req: Request): string {
  const body = (req.body || {}) as Record<string, any>;
  const lineMap = (body.lineMap || {}) as Record<string, unknown>;
  const normalizedChannel = channel.trim().toLowerCase();

  const fromBody = String(lineMap[normalizedChannel] || '').trim();
  if (fromBody) {
    return fromBody;
  }

  if (normalizedChannel === 'telegram') {
    return String(process.env.BITRIX_TELEGRAM_LINE_ID || '').trim();
  }

  if (normalizedChannel === 'whatsapp') {
    return String(process.env.BITRIX_WHATSAPP_LINE_ID || process.env.BITRIX_LINE_ID || '').trim();
  }

  return '';
}

function connectorIcon(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 70 70"><rect width="70" height="70" rx="16" fill="${color}"/><circle cx="35" cy="35" r="16" fill="#ffffff"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function parseConnectorTargets(req: Request): Array<{ id: string; name: string; channel: string; lineId?: string }> {
  const body = (req.body || {}) as Record<string, any>;

  const explicit = Array.isArray(body.connectors) ? body.connectors : null;
  if (explicit && explicit.length > 0) {
    return explicit
      .map((item: any) => {
        const id = normalizeConnectorId(String(item?.id || ''));
        const name = String(item?.name || id || '').trim();
        const channel = String(item?.channel || id.split('-')[0] || '').trim().toLowerCase();
        const lineId = String(item?.lineId || getLineIdForChannel(channel, req) || '').trim();
        return id ? { id, name: name || id, channel, lineId: lineId || undefined } : null;
      })
      .filter(Boolean) as Array<{ id: string; name: string; channel: string; lineId?: string }>;
  }

  const fromBodyChannels = Array.isArray(body.channels)
    ? body.channels.map((x: unknown) => String(x || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const fromEnvChannels = String(process.env.BITRIX_CONNECTOR_CHANNELS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const channels = Array.from(new Set([...(fromBodyChannels.length ? fromBodyChannels : []), ...fromEnvChannels]));
  const effectiveChannels = channels.length ? channels : ['whatsapp', 'telegram'];

  const suffix = normalizeConnectorId(String(body.suffix || 'db')) || 'db';

  return effectiveChannels
    .map((channel) => normalizeConnectorId(`${channel}-${suffix}`))
    .filter(Boolean)
    .map((id) => {
      const channel = id.split('-')[0];
      const lineId = getLineIdForChannel(channel, req);
      return { id, name: id, channel, lineId: lineId || undefined };
    });
}

function extractConnectorIds(rawResult: any): string[] {
  const result = rawResult?.result;
  const items = Array.isArray(result)
    ? result
    : result && typeof result === 'object'
      ? Object.values(result)
      : [];

  return items
    .map((item: any) => String(item?.ID || item?.id || item?.CODE || item?.code || item?.CONNECTOR || item?.connector || '').trim().toLowerCase())
    .filter(Boolean);
}

export async function autoEnsureBitrixOpenlineConnectors(req: Request): Promise<{
  checked: string[];
  existed: string[];
  created: string[];
  failed: Array<{ id: string; error: string; details?: any }>;
  placementHandler: string;
}> {
  const client = getBitrixClient();
  const placementHandler = resolveConnectorPlacementUrl(req);
  const targets = parseConnectorTargets(req);

  if (!targets.length) {
    return { checked: [], existed: [], created: [], failed: [], placementHandler };
  }

  const listed = await client.post<any>('imconnector.list', {});
  const existingIds = new Set(extractConnectorIds(listed));

  const created: string[] = [];
  const existed: string[] = [];
  const failed: Array<{ id: string; error: string; details?: any }> = [];

  for (const target of targets) {
    if (existingIds.has(target.id.toLowerCase())) {
      existed.push(target.id);
    } else {
      try {
        await client.post('imconnector.register', {
          ID: target.id,
          NAME: target.name,
          PLACEMENT_HANDLER: placementHandler,
          ICON: {
            DATA_IMAGE: connectorIcon('#2dbf6e'),
            COLOR: '#2dbf6e',
            SIZE: '100%',
            POSITION: 'center',
          },
          ICON_DISABLED: {
            DATA_IMAGE: connectorIcon('#9aa5b1'),
            COLOR: '#9aa5b1',
            SIZE: '100%',
            POSITION: 'center',
          },
        });
        created.push(target.id);
      } catch (error: any) {
        failed.push({
          id: target.id,
          error: error?.message || 'register failed',
          details: error?.response?.data,
        });
        continue;
      }
    }

    if (target.lineId) {
      try {
        await client.post('imconnector.activate', {
          CONNECTOR: target.id,
          LINE: Number(target.lineId) || target.lineId,
          ACTIVE: '1',
        });
      } catch (activationError: any) {
        failed.push({
          id: `${target.id}:activate`,
          error: activationError?.message || 'activate failed',
          details: activationError?.response?.data,
        });
      }
    }
  }

  return {
    checked: targets.map((t) => t.id),
    existed,
    created,
    failed,
    placementHandler,
  };
}

export async function bindBitrixEvents(req: Request, res: Response): Promise<void> {
  try {
    const domain = bitrixAuthService.getDomain();
    const client = getBitrixClient();
    const handler = resolveEventHandlerUrl(req);
    const events = parseEvents(req);
    const optionalParams = parseOptionalBindParams(req);

    if (!events.length) {
      res.status(400).json({ ok: false, error: 'No events provided' });
      return;
    }

    const results = [] as Array<{ event: string; result: unknown }>;
    for (const event of events) {
      const result = await client.post('event.bind', {
        event,
        handler,
        ...optionalParams,
      });
      results.push({ event, result });
    }

    logger.info({ domain, handler, events }, '[BitrixAuthController] event.bind completed');

    res.status(200).json({
      ok: true,
      domain,
      handler,
      events,
      results,
    });
  } catch (error: any) {
    logger.error(
      {
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
      },
      '[BitrixAuthController] event.bind failed',
    );
    res.status(500).json({
      ok: false,
      error: error?.message || 'Bitrix event.bind failed',
      details: error?.response?.data || null,
    });
  }
}

export async function getBitrixEventsCatalog(_req: Request, res: Response): Promise<void> {
  try {
    const domain = bitrixAuthService.getDomain();
    const client = getBitrixClient();
    const result = await client.post('events', {});

    res.status(200).json({ ok: true, domain, result });
  } catch (error: any) {
    logger.error({ message: error?.message, status: error?.response?.status, data: error?.response?.data }, '[BitrixAuthController] events failed');
    res.status(500).json({ ok: false, error: error?.message || 'Bitrix events failed', details: error?.response?.data || null });
  }
}

export async function getBitrixEventBindings(_req: Request, res: Response): Promise<void> {
  try {
    const domain = bitrixAuthService.getDomain();
    const client = getBitrixClient();
    const result = await client.post('event.get', {});

    res.status(200).json({ ok: true, domain, result });
  } catch (error: any) {
    logger.error({ message: error?.message, status: error?.response?.status, data: error?.response?.data }, '[BitrixAuthController] event.get failed');
    res.status(500).json({ ok: false, error: error?.message || 'Bitrix event.get failed', details: error?.response?.data || null });
  }
}

export async function unbindBitrixEvent(req: Request, res: Response): Promise<void> {
  try {
    const event = String((req.body as any)?.event || '').trim();
    const handler = String((req.body as any)?.handler || '').trim();

    if (!event || !handler) {
      res.status(400).json({ ok: false, error: 'Both event and handler are required' });
      return;
    }

    const domain = bitrixAuthService.getDomain();
    const client = getBitrixClient();
    const result = await client.post('event.unbind', { event, handler });

    res.status(200).json({ ok: true, domain, event, handler, result });
  } catch (error: any) {
    logger.error({ message: error?.message, status: error?.response?.status, data: error?.response?.data }, '[BitrixAuthController] event.unbind failed');
    res.status(500).json({ ok: false, error: error?.message || 'Bitrix event.unbind failed', details: error?.response?.data || null });
  }
}

export async function ensureBitrixOpenlineConnectors(req: Request, res: Response): Promise<void> {
  try {
    const domain = bitrixAuthService.getDomain();
    const result = await autoEnsureBitrixOpenlineConnectors(req);

    logger.info(
      { domain, placementHandler: result.placementHandler, created: result.created, existed: result.existed, failed: result.failed },
      '[BitrixAuthController] Connector ensure completed',
    );

    res.status(200).json({
      ok: result.failed.length === 0,
      domain,
      placementHandler: result.placementHandler,
      checked: result.checked,
      existed: result.existed,
      created: result.created,
      failed: result.failed,
    });
  } catch (error: any) {
    logger.error(
      { message: error?.message, status: error?.response?.status, data: error?.response?.data },
      '[BitrixAuthController] Connector ensure failed',
    );
    res.status(500).json({ ok: false, error: error?.message || 'Bitrix connector ensure failed', details: error?.response?.data || null });
  }
}
