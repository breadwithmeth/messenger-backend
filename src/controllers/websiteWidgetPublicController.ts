import { Request, Response } from 'express';
import prisma from '../config/prisma';
import {
  createWebsiteVisitorSession,
  normalizeWebsiteVisitorProfile,
  reopenWebsiteChatIfNeeded,
  updateWebsiteVisitorProfile,
} from '../services/websiteWidgetService';
import {
  notifyNewChat,
  notifyNewMessage,
  notifyChatsUpdated,
  notifyWebsiteVisitor,
} from '../services/socketService';

const MAX_MESSAGE_LENGTH = 5000;

export async function getWidgetConfig(_req: Request, res: Response) {
  const widget = res.locals.websiteWidget;

  res.json({
    widget: {
      name: widget.name,
      welcomeMessage: widget.welcomeMessage,
      primaryColor: widget.primaryColor,
    },
  });
}

export async function createSession(req: Request, res: Response) {
  try {
    const widget = res.locals.websiteWidget;
    const { name, email, phone } = req.body || {};
    const result = await createWebsiteVisitorSession(widget, { name, email, phone });

    notifyNewChat(widget.organizationId, {
      id: result.chat.id,
      name: result.chat.name,
      channel: 'website',
      websiteWidgetId: widget.id,
      ticketNumber: result.chat.ticketNumber,
      status: result.chat.status,
      priority: result.chat.priority,
      unreadCount: result.chat.unreadCount,
      lastMessageAt: result.chat.lastMessageAt,
    });

    res.status(201).json({
      session: {
        id: result.session.id,
        token: result.token,
      },
    });
  } catch {
    res.status(500).json({ error: 'Не удалось открыть чат' });
  }
}

export async function updateSessionProfile(req: Request, res: Response) {
  try {
    const session = res.locals.websiteSession;
    const profile = normalizeWebsiteVisitorProfile(req.body);
    const result = await updateWebsiteVisitorProfile(session, profile);

    notifyChatsUpdated(result.chat.organizationId, {
      ...result.chat,
      websiteSession: {
        id: result.session.id,
        visitorName: result.session.visitorName,
        visitorEmail: result.session.visitorEmail,
        visitorPhone: result.session.visitorPhone,
      },
    });

    res.json({
      profile: {
        name: result.session.visitorName,
        email: result.session.visitorEmail,
        phone: result.session.visitorPhone,
      },
    });
  } catch (error: any) {
    const isValidationError = error instanceof Error && (
      error.message.includes('должен') ||
      error.message.includes('Передайте') ||
      error.message.includes('Тело запроса')
    );

    res.status(isValidationError ? 400 : 500).json({
      error: isValidationError ? error.message : 'Не удалось обновить данные посетителя',
    });
  }
}

export async function listSessionMessages(req: Request, res: Response) {
  try {
    const session = res.locals.websiteSession;
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '100'), 10) || 100, 1), 200);
    const afterIdValue = typeof req.query.afterId === 'string' ? req.query.afterId : undefined;
    const afterId = afterIdValue ? Number.parseInt(afterIdValue, 10) : null;
    const afterValue = typeof req.query.after === 'string' ? req.query.after : undefined;
    const after = afterValue ? new Date(afterValue) : null;

    if (afterIdValue && (!Number.isInteger(afterId) || Number(afterId) < 0)) {
      return res.status(400).json({ error: 'Некорректный параметр afterId' });
    }
    if (after && Number.isNaN(after.getTime())) {
      return res.status(400).json({ error: 'Некорректный параметр after' });
    }

    const select = {
      id: true,
      content: true,
      type: true,
      mediaUrl: true,
      filename: true,
      fromMe: true,
      timestamp: true,
      status: true,
      senderUser: {
        select: {
          name: true,
        },
      },
    } as const;

    let messages;
    if (afterId !== null) {
      messages = await prisma.message.findMany({
        where: { chatId: session.chatId, id: { gt: afterId } },
        select,
        orderBy: { id: 'asc' },
        take: limit,
      });
    } else if (after) {
      messages = await prisma.message.findMany({
        where: { chatId: session.chatId, timestamp: { gt: after } },
        select,
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
        take: limit,
      });
    } else {
      messages = (await prisma.message.findMany({
        where: { chatId: session.chatId },
        select,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: limit,
      })).reverse();
    }

    await prisma.websiteVisitorSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    res.json({ messages });
  } catch {
    res.status(500).json({ error: 'Не удалось получить сообщения' });
  }
}

export async function sendSessionMessage(req: Request, res: Response) {
  try {
    const session = res.locals.websiteSession;
    const rawContent = req.body?.content;

    if (typeof rawContent !== 'string' || !rawContent.trim()) {
      return res.status(400).json({ error: 'content обязателен' });
    }

    const content = rawContent.trim();
    if (content.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Сообщение не должно превышать ${MAX_MESSAGE_LENGTH} символов` });
    }

    const result = await prisma.$transaction(async (tx) => {
      const currentChat = await tx.chat.findUniqueOrThrow({ where: { id: session.chatId } });
      const chat = await reopenWebsiteChatIfNeeded(tx, currentChat);
      const message = await tx.message.create({
        data: {
          organizationId: chat.organizationId,
          channel: 'website',
          chatId: chat.id,
          fromMe: false,
          content,
          type: 'text',
          timestamp: new Date(),
          status: 'delivered',
          isHr: chat.isHr,
        },
      });

      await tx.chat.update({
        where: { id: chat.id },
        data: {
          lastMessageAt: message.timestamp,
          unreadCount: { increment: 1 },
        },
      });
      await tx.websiteVisitorSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });

      return { chat, message };
    });

    const event = {
      id: result.message.id,
      chatId: result.message.chatId,
      content: result.message.content,
      type: result.message.type,
      fromMe: false,
      timestamp: result.message.timestamp,
      status: result.message.status,
      channel: 'website',
      hasResponsible: Boolean(result.chat.assignedUserId),
    };
    notifyNewMessage(result.chat.organizationId, event);
    const visitorEvent = {
      id: result.message.id,
      content: result.message.content,
      type: result.message.type,
      fromMe: false,
      timestamp: result.message.timestamp,
      status: result.message.status,
    };
    notifyWebsiteVisitor(session.id, 'message:new', visitorEvent);

    res.status(201).json({ message: visitorEvent });
  } catch {
    res.status(500).json({ error: 'Не удалось отправить сообщение' });
  }
}
