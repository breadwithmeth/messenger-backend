import makeWASocket, {
  DisconnectReason,
  WAMessage,
  WAMessageKey,
  WASocket,
  initAuthCreds,
  BufferJSON,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { toDataURL } from 'qrcode';
import {
  getBaileysAuthState,
  removeBaileysAuthState,
  setBaileysAuthState,
} from '../services/baileysAuthStateService';
import { getSocketIO, notifyNewMessage } from '../services/socketService';
import { prisma } from './authStorage';

const logger = pino({ level: process.env.APP_LOG_LEVEL || 'silent' });

interface MediaInfo {
  mediaUrl?: string;
  filename?: string;
  size?: number;
}

interface SessionEntry {
  sock: WASocket;
  organizationId: number;
  organizationPhoneId: number;
  phoneJid: string;
}

const sessions = new Map<number, SessionEntry>();
const manualDisconnects = new Set<number>();

const emitSocketEvent = (event: string, payload: Record<string, unknown>) => {
  try {
    getSocketIO().emit(event, payload);
  } catch {
    // Socket.IO may not be initialized yet.
  }
};

const authKey = (type: string, id: string) => `${type}:${id}`;

async function getBaileysAuth(organizationId: number, phoneJid: string) {
  const credsStorageKey = authKey('creds', 'creds');
  const storedCreds = await getBaileysAuthState(organizationId, phoneJid, credsStorageKey);

  const creds = storedCreds?.value
    ? JSON.parse(Buffer.from(storedCreds.value).toString('utf-8'))
    : initAuthCreds();

  const keys = {
    get: async (type: string, ids: string[]) => {
      const data: Record<string, unknown> = {};

      await Promise.all(
        ids.map(async (id) => {
          const stored = await getBaileysAuthState(
            organizationId,
            phoneJid,
            authKey(type, id),
          );

          if (!stored?.value) {
            return;
          }

          data[id] = JSON.parse(Buffer.from(stored.value).toString('utf-8'));
        }),
      );

      return data as any;
    },
    set: async (data: Record<string, Record<string, unknown>>) => {
      const writes: Promise<unknown>[] = [];

      for (const type of Object.keys(data)) {
        for (const id of Object.keys(data[type])) {
          const value = data[type][id];
          const key = authKey(type, id);

          if (value) {
            writes.push(
              setBaileysAuthState(
                organizationId,
                phoneJid,
                key,
                Buffer.from(JSON.stringify(value, BufferJSON.replacer), 'utf-8'),
              ),
            );
          } else {
            writes.push(removeBaileysAuthState(organizationId, phoneJid, key));
          }
        }
      }

      await Promise.all(writes);
    },
  };

  const saveCreds = async () => {
    await setBaileysAuthState(
      organizationId,
      phoneJid,
      credsStorageKey,
      Buffer.from(JSON.stringify(creds, BufferJSON.replacer), 'utf-8'),
    );
  };

  return {
    state: { creds, keys } as any,
    saveCreds,
  };
}

async function clearBaileysCreds(organizationId: number, phoneJid: string) {
  await removeBaileysAuthState(organizationId, phoneJid, authKey('creds', 'creds'));
}

export async function startBaileys(
  organizationId: number,
  organizationPhoneId: number,
  phoneJid: string,
): Promise<WASocket> {
  const existing = sessions.get(organizationPhoneId);
  if (existing) {
    return existing.sock;
  }

  const { state, saveCreds } = await getBaileysAuth(organizationId, phoneJid);
  const sock = makeWASocket({ auth: state as any, logger });

  sessions.set(organizationPhoneId, {
    sock,
    organizationId,
    organizationPhoneId,
    phoneJid,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      try {
        const qrCode = await toDataURL(qr);
        await prisma.organizationPhone.update({
          where: { id: organizationPhoneId },
          data: { status: 'pending', qrCode },
        });
        emitSocketEvent('qr-code', { organizationPhoneId, phoneJid, qrCode });
      } catch (error) {
        logger.warn(`[Baileys] QR save failed for ${organizationPhoneId}: ${String(error)}`);
      }
    }

    if (connection === 'open') {
      await prisma.organizationPhone.update({
        where: { id: organizationPhoneId },
        data: { status: 'connected', qrCode: null, lastConnectedAt: new Date() },
      });
      emitSocketEvent('session-connected', { organizationPhoneId, phoneJid });
      return;
    }

    if (connection !== 'close') {
      return;
    }

    const code = Number((lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode);
    const manuallyClosed = manualDisconnects.has(organizationPhoneId);
    const shouldReconnect = !manuallyClosed && code !== DisconnectReason.loggedOut;

    sessions.delete(organizationPhoneId);
    manualDisconnects.delete(organizationPhoneId);

    if (shouldReconnect) {
      logger.warn(`[Baileys] reconnecting orgPhone=${organizationPhoneId}, reason=${code}`);
      await startBaileys(organizationId, organizationPhoneId, phoneJid);
      return;
    }

    await prisma.organizationPhone.update({
      where: { id: organizationPhoneId },
      data: {
        status: code === DisconnectReason.loggedOut ? 'logged_out' : 'disconnected',
        qrCode: null,
      },
    });

    if (code === DisconnectReason.loggedOut) {
      await clearBaileysCreds(organizationId, phoneJid);
    }

    emitSocketEvent('session-disconnected', {
      organizationPhoneId,
      phoneJid,
      reason: manuallyClosed ? 'manual' : code,
    });
  });

  return sock;
}

export const initBaileys = async (db: PrismaClient) => {
  const phones = await db.organizationPhone.findMany({
    where: { connectionType: 'baileys', status: { in: ['connected', 'loading', 'pending'] } },
    select: { id: true, organizationId: true, phoneJid: true },
  });

  for (const phone of phones) {
    await startBaileys(phone.organizationId, phone.id, phone.phoneJid);
  }
};

export const getBaileysSock = (organizationPhoneId: number): WASocket | null => {
  return sessions.get(organizationPhoneId)?.sock || null;
};

export const markManualDisconnect = (organizationPhoneId: number, _reason?: string) => {
  manualDisconnects.add(organizationPhoneId);
};

export const removeBaileysSession = async (
  organizationPhoneId: number,
  phoneJid: string,
) => {
  const current = sessions.get(organizationPhoneId);
  if (!current) {
    return;
  }

  manualDisconnects.add(organizationPhoneId);
  await current.sock.logout();
  sessions.delete(organizationPhoneId);
  await clearBaileysCreds(current.organizationId, phoneJid);
};

export const getBaileysSession = (organizationPhoneId: number) => {
  return sessions.get(organizationPhoneId) || null;
};

export const sendUnreadMessages = async (
  organizationPhoneId: number,
  messages: WAMessage[],
) => {
  const current = sessions.get(organizationPhoneId);
  if (!current) {
    return;
  }

  for (const message of messages) {
    const remoteJid = message.key.remoteJid;
    const text = message.message?.conversation;

    if (!remoteJid || !text) {
      continue;
    }

    await current.sock.sendMessage(remoteJid, { text });
  }
};

export const sendReadReceipt = async (
  organizationPhoneId: number,
  key: WAMessageKey,
) => {
  const current = sessions.get(organizationPhoneId);
  if (!current) {
    return;
  }

  await current.sock.readMessages([key]);
};

export const getContactNumber = (message: WAMessage) => {
  const jid = message.key.remoteJid;
  if (!jid || !jid.includes('@')) {
    return null;
  }

  return jid.split('@')[0] || null;
};

export async function ensureChat(
  organizationId: number,
  organizationPhoneId: number,
  receivingPhoneJid: string,
  remoteJid: string,
  name?: string,
  options?: { reopenClosedTicket?: boolean },
): Promise<number> {
  const normalizedRemoteJid = jidNormalizedUser(remoteJid);
  if (!normalizedRemoteJid) {
    throw new Error(`Invalid remoteJid: ${remoteJid}`);
  }

  let chat = await prisma.chat.findFirst({
    where: {
      organizationId,
      channel: 'whatsapp',
      remoteJid: normalizedRemoteJid,
    },
  });

  if (!chat) {
    chat = await prisma.chat.create({
      data: {
        organizationId,
        organizationPhoneId,
        channel: 'whatsapp',
        receivingPhoneJid,
        remoteJid: normalizedRemoteJid,
        name,
        status: 'new',
        unreadCount: 0,
        lastMessageAt: new Date(),
      },
    });
    return chat.id;
  }

  if (name && !chat.name) {
    await prisma.chat.update({
      where: { id: chat.id },
      data: { name },
    });
  }

  if (options?.reopenClosedTicket !== false && (chat.status === 'closed' || chat.status === 'resolved')) {
    await prisma.chat.update({
      where: { id: chat.id },
      data: { status: 'open', resolvedAt: null, closedAt: null },
    });
  }

  return chat.id;
}

export async function sendMessage(
  sock: WASocket,
  jid: string,
  content: any,
  organizationId: number,
  organizationPhoneId: number,
  senderJid: string,
  userId?: number,
  mediaInfo?: MediaInfo,
) {
  if (!sock?.user) {
    throw new Error('Baileys socket is not connected or user is not defined.');
  }

  const sentMessage = await sock.sendMessage(jid, content as any);
  if (!sentMessage) {
    return sentMessage;
  }

  const remoteJid = jidNormalizedUser(jid) || jid;
  const myJid = jidNormalizedUser(sock.user.id || senderJid) || senderJid;

  const chatId = await ensureChat(
    organizationId,
    organizationPhoneId,
    myJid,
    remoteJid,
  );

  let type = 'text';
  let textContent = '';
  let mimeType: string | undefined;

  if ((content as any).text) {
    type = 'text';
    textContent = String((content as any).text);
  } else if ((content as any).image) {
    type = 'image';
    textContent = (content as any).caption || '';
    mimeType = 'image/jpeg';
  } else if ((content as any).video) {
    type = 'video';
    textContent = (content as any).caption || '';
    mimeType = 'video/mp4';
  } else if ((content as any).document) {
    type = 'document';
    textContent = (content as any).caption || '';
    mimeType = 'application/octet-stream';
  } else if ((content as any).audio) {
    type = 'audio';
    mimeType = (content as any).mimetype || 'audio/mp4';
  } else if ((content as any).sticker) {
    type = 'sticker';
    mimeType = 'image/webp';
  } else {
    textContent = JSON.stringify(content);
  }

  const saved = await prisma.message.create({
    data: {
      chatId,
      organizationId,
      organizationPhoneId,
      channel: 'whatsapp',
      receivingPhoneJid: myJid,
      remoteJid,
      whatsappMessageId: sentMessage.key.id || `_out_${Date.now()}`,
      senderJid: myJid,
      fromMe: true,
      content: textContent,
      type,
      mediaUrl: mediaInfo?.mediaUrl,
      filename: mediaInfo?.filename,
      size: mediaInfo?.size,
      mimeType,
      timestamp: new Date(),
      status: 'sent',
      senderUserId: typeof userId === 'number' ? userId : undefined,
      isReadByOperator: true,
    },
  });

  try {
    notifyNewMessage(organizationId, {
      id: saved.id,
      chatId,
      content: saved.content,
      type: saved.type,
      mediaUrl: saved.mediaUrl,
      filename: saved.filename,
      fromMe: true,
      status: saved.status,
      senderJid: saved.senderJid,
      channel: 'whatsapp',
      timestamp: saved.timestamp,
    });
  } catch {
    // Socket notification is best effort.
  }

  return sentMessage;
}
