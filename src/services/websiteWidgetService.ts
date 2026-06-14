import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { Chat, Prisma } from '@prisma/client';
import prisma from '../config/prisma';

const MAX_TICKET_CREATE_ATTEMPTS = 5;

export type WebsiteVisitorDetails = {
  name?: string;
  email?: string;
  phone?: string;
};

export function generateWebsiteWidgetPublicKey(): string {
  return `wgt_${randomBytes(18).toString('base64url')}`;
}

export function generateWebsiteSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashWebsiteSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function websiteSessionTokenMatches(token: string, expectedHash: string): boolean {
  const actualHash = hashWebsiteSessionToken(token);
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

export async function createWebsiteVisitorSession(
  widget: { id: number; organizationId: number; name: string },
  details: WebsiteVisitorDetails
) {
  const visitorName = cleanOptionalText(details.name, 160);
  const visitorEmail = cleanOptionalText(details.email, 320);
  const visitorPhone = cleanOptionalText(details.phone, 64);

  for (let attempt = 1; attempt <= MAX_TICKET_CREATE_ATTEMPTS; attempt += 1) {
    const sessionId = randomUUID();
    const token = generateWebsiteSessionToken();
    const tokenHash = hashWebsiteSessionToken(token);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const lastTicket = await tx.chat.findFirst({
          where: {
            organizationId: widget.organizationId,
            ticketNumber: { not: null },
          },
          orderBy: { ticketNumber: 'desc' },
          select: { ticketNumber: true },
        });
        const ticketNumber = (lastTicket?.ticketNumber || 0) + 1;
        const displayName = visitorName || visitorEmail || visitorPhone || 'Посетитель сайта';

        const chat = await tx.chat.create({
          data: {
            organizationId: widget.organizationId,
            channel: 'website',
            websiteWidgetId: widget.id,
            remoteJid: `website:${sessionId}`,
            name: displayName,
            ticketNumber,
            status: 'new',
            priority: 'urgent',
            lastMessageAt: new Date(),
          },
        });

        const session = await tx.websiteVisitorSession.create({
          data: {
            id: sessionId,
            websiteWidgetId: widget.id,
            chatId: chat.id,
            tokenHash,
            visitorName,
            visitorEmail,
            visitorPhone,
          },
        });

        await tx.ticketHistory.create({
          data: {
            chatId: chat.id,
            changeType: 'ticket_created',
            newValue: String(ticketNumber),
            description: `Создан тикет #${ticketNumber} через виджет сайта`,
          },
        });

        if (visitorName || visitorEmail || visitorPhone) {
          await tx.organizationClient.create({
            data: {
              organizationId: widget.organizationId,
              name: displayName,
              email: visitorEmail,
              phone: visitorPhone,
              source: 'website',
              chats: { connect: { id: chat.id } },
            },
          });
        }

        return { chat, session };
      });

      return { ...result, token };
    } catch (error: any) {
      if (error?.code === 'P2002' && attempt < MAX_TICKET_CREATE_ATTEMPTS) continue;
      throw error;
    }
  }

  throw new Error('Не удалось создать сессию виджета');
}

export async function authenticateWebsiteVisitorSession(
  publicKey: string,
  sessionId: string,
  token: string
) {
  const session = await prisma.websiteVisitorSession.findFirst({
    where: {
      id: sessionId,
      websiteWidget: {
        publicKey,
        status: 'active',
      },
    },
    include: {
      websiteWidget: true,
      chat: true,
    },
  });

  if (!session || !websiteSessionTokenMatches(token, session.tokenHash)) return null;
  return session;
}

export async function reopenWebsiteChatIfNeeded(
  tx: Prisma.TransactionClient,
  chat: Chat
): Promise<Chat> {
  if (chat.status !== 'closed' && chat.status !== 'resolved') return chat;

  const lastTicket = await tx.chat.findFirst({
    where: {
      organizationId: chat.organizationId,
      ticketNumber: { not: null },
    },
    orderBy: { ticketNumber: 'desc' },
    select: { ticketNumber: true },
  });
  const ticketNumber = (lastTicket?.ticketNumber || 0) + 1;

  const updatedChat = await tx.chat.update({
    where: { id: chat.id },
    data: {
      ticketNumber,
      status: 'new',
      priority: 'urgent',
      assignedUserId: null,
      assignedAt: null,
      closedAt: null,
      resolvedAt: null,
      lastMessageAt: new Date(),
    },
  });

  await tx.ticketHistory.create({
    data: {
      chatId: chat.id,
      changeType: 'ticket_reopened',
      oldValue: chat.ticketNumber ? String(chat.ticketNumber) : null,
      newValue: String(ticketNumber),
      description: `Чат переоткрыт через виджет сайта: новый тикет #${ticketNumber}`,
    },
  });

  return updatedChat;
}
