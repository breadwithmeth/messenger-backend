// src/services/socketService.ts

import { Server, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import pino from 'pino';
import { authenticateToken } from '../auth/tokenAuth';
import prisma from '../config/prisma';

const logger = pino({ level: process.env.APP_LOG_LEVEL || 'silent' });

let io: Server | null = null;

interface SocketData {
  userId: number;
  organizationId: number;
  userEmail?: string;
  isHr?: boolean;
}

interface AuthPayload {
  userId: number;
  organizationId: number;
  email?: string;
  isHr?: boolean;
}

async function resolveChatRequiresHr(chatId: number | undefined, data?: any): Promise<boolean> {
  if (typeof data?.isHr === 'boolean') return data.isHr;

  const messageId = typeof data?.id === 'number' ? data.id : typeof data?.messageId === 'number' ? data.messageId : null;
  if (messageId) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { isHr: true },
    });
    if (message?.isHr === true) return true;
  }

  if (!chatId) return false;

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { isHr: true },
  });

  return chat?.isHr === true;
}

function emitToVisibleSockets(room: string, event: string, data: any, requiresHr: boolean) {
  if (!io) return;

  const socketIds = io.sockets.adapter.rooms.get(room);
  if (!socketIds) return;

  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    const socketData = socket.data as SocketData;
    if (!requiresHr || socketData.isHr === true) {
      socket.emit(event, data);
    }
  }
}

function emitChatScopedEvent(organizationId: number, event: string, data: any, chatId?: number) {
  void (async () => {
    try {
      const requiresHr = await resolveChatRequiresHr(chatId, data);
      emitToVisibleSockets(`org_${organizationId}`, event, data, requiresHr);
      if (chatId) {
        emitToVisibleSockets(`chat_${chatId}`, event, data, requiresHr);
      }
    } catch (error: any) {
      logger.error(`[Socket.IO] Ошибка отправки события ${event}:`, error.message);
    }
  })();
}

async function socketCanAccessChat(socket: Socket, chatId: number): Promise<boolean> {
  const socketData = socket.data as SocketData;
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      organizationId: socketData.organizationId,
    },
    select: {
      isHr: true,
    },
  });

  return Boolean(chat) && (!chat?.isHr || socketData.isHr === true);
}

/**
 * Инициализация Socket.IO сервера
 */
export function initializeSocketIO(httpServer: HTTPServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: '*', // В продакшн замените на конкретный домен
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Middleware для аутентификации
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        logger.warn(`[Socket.IO] Попытка подключения без токена`);
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = await authenticateToken(token) as AuthPayload;

      // Сохраняем данные пользователя в socket
      socket.data.userId = decoded.userId;
      socket.data.organizationId = decoded.organizationId;
      socket.data.userEmail = decoded.email;
      socket.data.isHr = decoded.isHr === true;

      logger.info(`[Socket.IO] Пользователь аутентифицирован: ${decoded.email || 'unknown'} (ID: ${decoded.userId}, Org: ${decoded.organizationId})`);
      next();
    } catch (error: any) {
      logger.error(`[Socket.IO] Ошибка аутентификации:`, error.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // Обработка подключений
  io.on('connection', (socket: Socket) => {
    const { userId, organizationId, userEmail } = socket.data as SocketData;

    logger.info(`[Socket.IO] ✅ Клиент подключен: ${userEmail} (Socket ID: ${socket.id})`);

    // Подписываем пользователя на комнату его организации
    const orgRoom = `org_${organizationId}`;
    socket.join(orgRoom);
    logger.info(`[Socket.IO] Пользователь ${userEmail} подписан на комнату: ${orgRoom}`);

    // Опционально: подписываем на персональную комнату
    const userRoom = `user_${userId}`;
    socket.join(userRoom);
    logger.info(`[Socket.IO] Пользователь ${userEmail} подписан на персональную комнату: ${userRoom}`);

    // Отправляем подтверждение подключения
    socket.emit('connected', {
      message: 'Successfully connected to real-time updates',
      userId,
      organizationId,
      timestamp: new Date().toISOString(),
    });

    // Обработка запроса на подписку на конкретный чат
    socket.on('subscribe:chat', async (chatId: number) => {
      if (!(await socketCanAccessChat(socket, Number(chatId)))) {
        socket.emit('error', { error: 'Chat not found' });
        return;
      }

      const chatRoom = `chat_${chatId}`;
      socket.join(chatRoom);
      logger.info(`[Socket.IO] Пользователь ${userEmail} подписан на чат: ${chatRoom}`);
      socket.emit('subscribed:chat', { chatId });
    });

    // Обработка отписки от чата
    socket.on('unsubscribe:chat', (chatId: number) => {
      const chatRoom = `chat_${chatId}`;
      socket.leave(chatRoom);
      logger.info(`[Socket.IO] Пользователь ${userEmail} отписан от чата: ${chatRoom}`);
      socket.emit('unsubscribed:chat', { chatId });
    });

    // Обработка события "пользователь печатает"
    socket.on('typing:start', async (data: { chatId: number }) => {
      if (!(await socketCanAccessChat(socket, Number(data.chatId)))) return;

      const chatRoom = `chat_${data.chatId}`;
      socket.to(chatRoom).emit('typing:start', {
        chatId: data.chatId,
        userId,
        userEmail,
        timestamp: new Date().toISOString(),
      });
      logger.debug(`[Socket.IO] Пользователь ${userEmail} печатает в чате ${data.chatId}`);
    });

    // Обработка события "пользователь прекратил печатать"
    socket.on('typing:stop', async (data: { chatId: number }) => {
      if (!(await socketCanAccessChat(socket, Number(data.chatId)))) return;

      const chatRoom = `chat_${data.chatId}`;
      socket.to(chatRoom).emit('typing:stop', {
        chatId: data.chatId,
        userId,
        timestamp: new Date().toISOString(),
      });
      logger.debug(`[Socket.IO] Пользователь ${userEmail} прекратил печатать в чате ${data.chatId}`);
    });

    // Обработка отключения
    socket.on('disconnect', (reason) => {
      logger.info(`[Socket.IO] ❌ Клиент отключен: ${userEmail} (Socket ID: ${socket.id}, Причина: ${reason})`);
    });

    // Обработка ошибок
    socket.on('error', (error) => {
      logger.error(`[Socket.IO] Ошибка в socket ${socket.id}:`, error);
    });
  });

  logger.info('[Socket.IO] ✅ Socket.IO сервер инициализирован');
  return io;
}

/**
 * Получить экземпляр Socket.IO сервера
 */
export function getSocketIO(): Server {
  if (!io) {
    throw new Error('Socket.IO не инициализирован. Вызовите initializeSocketIO() сначала.');
  }
  return io;
}

// ==============================================
// ФУНКЦИИ ДЛЯ ОТПРАВКИ СОБЫТИЙ
// ==============================================

/**
 * Отправить уведомление о новом чате
 */
export function notifyNewChat(organizationId: number, chatData: any) {
  try {
    getSocketIO();
    const eventData = {
      ...chatData,
      timestamp: new Date().toISOString(),
    };
    emitChatScopedEvent(organizationId, 'chat:new', eventData, chatData.id);
    
    logger.info(`[Socket.IO] 📢 Отправлено событие chat:new, chatId: ${chatData.id}`);
  } catch (error: any) {
    logger.error('[Socket.IO] Ошибка отправки события chat:new:', error.message);
  }
}

/**
 * Отправить уведомление о новом сообщении
 */
export function notifyNewMessage(organizationId: number, messageData: any) {
  try {
    getSocketIO();
    
    const eventData = {
      ...messageData,
      timestamp: messageData.timestamp || new Date().toISOString(),
    };
    
    emitChatScopedEvent(organizationId, 'message:new', eventData, messageData.chatId);
    
    logger.info(`[Socket.IO] 📢 Отправлено событие message:new, chatId: ${messageData.chatId}, messageId: ${messageData.id}`);
  } catch (error: any) {
    logger.error('[Socket.IO] Ошибка отправки события message:new:', error.message);
  }
}

/**
 * Отправить уведомление об обновлении чата
 */
export function notifyChatsUpdated(organizationId: number, chatData: any) {
  try {
    getSocketIO();
    
    const eventData = {
      ...chatData,
      timestamp: new Date().toISOString(),
    };
    
    emitChatScopedEvent(organizationId, 'chat:updated', eventData, chatData.id);
    
    logger.info(`[Socket.IO] 📢 Отправлено событие chat:updated, chatId: ${chatData.id}`);
  } catch (error: any) {
    logger.error('[Socket.IO] Ошибка отправки события chat:updated:', error.message);
  }
}

/**
 * Отправить уведомление о прочтении сообщений
 */
export function notifyMessagesRead(organizationId: number, chatId: number, readByUserId?: number) {
  try {
    getSocketIO();
    
    const eventData = {
      chatId,
      readByUserId,
      timestamp: new Date().toISOString(),
    };
    
    emitChatScopedEvent(organizationId, 'messages:read', eventData, chatId);
    
    logger.info(`[Socket.IO] 📢 Отправлено событие messages:read, chatId: ${chatId}`);
  } catch (error: any) {
    logger.error('[Socket.IO] Ошибка отправки события messages:read:', error.message);
  }
}

/**
 * Отправить уведомление об изменении статуса сообщения
 */
export function notifyMessageStatus(organizationId: number, messageId: number, status: string, chatId: number) {
  try {
    getSocketIO();
    
    const eventData = {
      messageId,
      chatId,
      status,
      timestamp: new Date().toISOString(),
    };
    
    emitChatScopedEvent(organizationId, 'message:status', eventData, chatId);
    
    logger.info(`[Socket.IO] 📢 Отправлено событие message:status, messageId: ${messageId}, status: ${status}`);
  } catch (error: any) {
    logger.error('[Socket.IO] Ошибка отправки события message:status:', error.message);
  }
}

/**
 * Отправить уведомление об удалении чата
 */
export function notifyChatDeleted(organizationId: number, chatId: number) {
  try {
    getSocketIO();
    
    const eventData = {
      chatId,
      timestamp: new Date().toISOString(),
    };
    
    emitChatScopedEvent(organizationId, 'chat:deleted', eventData, chatId);
    
    logger.info(`[Socket.IO] 📢 Отправлено событие chat:deleted, chatId: ${chatId}`);
  } catch (error: any) {
    logger.error('[Socket.IO] Ошибка отправки события chat:deleted:', error.message);
  }
}

/**
 * Отправить персональное уведомление пользователю
 */
export function notifyUser(userId: number, event: string, data: any) {
  try {
    const io = getSocketIO();
    const userRoom = `user_${userId}`;
    
    io.to(userRoom).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
    
    logger.info(`[Socket.IO] 📢 Отправлено персональное событие ${event} пользователю ${userId}`);
  } catch (error: any) {
    logger.error(`[Socket.IO] Ошибка отправки персонального события ${event}:`, error.message);
  }
}

/**
 * Отправить broadcast всем подключенным клиентам организации
 */
export function broadcastToOrganization(organizationId: number, event: string, data: any) {
  try {
    const io = getSocketIO();
    const orgRoom = `org_${organizationId}`;
    
    io.to(orgRoom).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
    
    logger.info(`[Socket.IO] 📢 Отправлен broadcast ${event} в организацию ${organizationId}`);
  } catch (error: any) {
    logger.error(`[Socket.IO] Ошибка broadcast ${event}:`, error.message);
  }
}
