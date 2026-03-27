export function jidNormalizedUser(input: string | null | undefined): string {
  if (!input) return '';

  let jid = String(input).trim();
  if (!jid) return '';

  // Baileys may include device/agent suffix like 12345:12@s.whatsapp.net.
  const atIndex = jid.indexOf('@');
  if (atIndex === -1) {
    // If no domain is present, treat as user and append default WA domain.
    const bare = jid.split(':')[0];
    return bare ? `${bare}@s.whatsapp.net` : '';
  }

  const user = jid.slice(0, atIndex).split(':')[0];
  const domain = jid.slice(atIndex + 1);
  if (!user || !domain) return '';

  return `${user}@${domain}`;
}

export function isJidGroup(jid: string | null | undefined): boolean {
  const normalized = jidNormalizedUser(jid || '');
  return normalized.endsWith('@g.us');
}

export function isJidBroadcast(jid: string | null | undefined): boolean {
  const normalized = jidNormalizedUser(jid || '');
  return normalized.endsWith('@broadcast');
}
