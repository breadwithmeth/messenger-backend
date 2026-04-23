// src/config/baileys.ts

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
  AuthenticationState,
  initAuthCreds,
  AnyMessageContent,
  WAMessage,
  makeCacheableSignalKeyStore,
  SignalDataTypeMap,
  SignalDataSet,
  AuthenticationCreds,
  BufferJSON,
  jidNormalizedUser,
  isJidGroup,
  isJidBroadcast,
  ConnectionState,
  downloadContentFromMessage, // <--- ДОБАВИТЬ
  MediaType, // <--- ДОБАВИТЬ
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { createAuthDBAdapter, prisma, StoredDataType } from './authStorage';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { Buffer } from 'buffer';
import * as fs from 'fs/promises'; // Для работы с файловой системой (удаление папок)
import path from 'path'; // Для работы с путями файлов
import { notifyNewChat, notifyNewMessage, notifyChatsUpdated } from '../services/socketService'; // Socket.IO

const logger = pino({ level: 'info' });

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Таймауты по умолчанию можно переопределить через env,
// чтобы избежать падений на медленных/нестабильных сетях (Timed Out в Baileys query).
const BAILEYS_CONNECT_TIMEOUT_MS = envInt('BAILEYS_CONNECT_TIMEOUT_MS', 60_000);
const BAILEYS_DEFAULT_QUERY_TIMEOUT_MS = envInt('BAILEYS_DEFAULT_QUERY_TIMEOUT_MS', 60_000);
const BAILEYS_KEEP_ALIVE_INTERVAL_MS = envInt('BAILEYS_KEEP_ALIVE_INTERVAL_MS', 25_000);
const BAILEYS_QR_WAIT_TIMEOUT_MS = envInt('BAILEYS_QR_WAIT_TIMEOUT_MS', 20_000);

function getDisconnectInfo(lastDisconnect: ConnectionState['lastDisconnect']) {
  const error = lastDisconnect?.error as Boom | Error | undefined;
  const boomStatusCode = (error as Boom | undefined)?.output?.statusCode;
  const message = error instanceof Error ? error.message : undefined;

  return {
    statusCode: boomStatusCode,
    message,
    stack: error instanceof Error ? error.stack : undefined,
  };
}

function safeAsyncListener<T extends any[]>(
  eventName: string,
  handler: (...args: T) => Promise<void> | void
) {
  return (...args: T) => {
    Promise.resolve(handler(...args)).catch((err) => {
      logger.error({ err }, `[Baileys] Unhandled error in listener: ${eventName}`);
    });
  };
}

// Глобальная Map для хранения активных экземпляров WASocket по organizationPhoneId
const socks = new Map<number, WASocket>(); 

// Map для отслеживания ошибок Bad MAC по organizationPhoneId
const badMacErrorCount = new Map<number, number>();
const MAX_BAD_MAC_ERRORS = 3; // Максимум ошибок перед сбросом сессии

// Map для отслеживания ошибок Bad Decrypt по organizationPhoneId
const badDecryptErrorCount = new Map<number, number>();
const MAX_BAD_DECRYPT_ERRORS = 5; // Максимум ошибок перед сбросом сессии (больше чем MAC, т.к. менее критично)

// Интерфейс для кастомного хранилища сигналов
interface CustomSignalStorage {
  get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T]; }>;
  set(data: SignalDataSet): Promise<void>;
  del(keys: string[]): Promise<void>;
}

// --- НОВАЯ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ---
/**
 * Скачивает медиа из сообщения и сохраняет его в хранилище (R2/S3/Local).
 * @param messageContent Содержимое сообщения (например, imageMessage).
 * @param type Тип медиа ('image', 'video', 'audio', 'document').
 * @param originalFilename Имя файла (для документов).
 * @returns URL к сохраненному файлу.
 */
async function downloadAndSaveMedia(
  messageContent: any,
  type: MediaType,
  originalFilename?: string
): Promise<string | undefined> {
  try {
    const stream = await downloadContentFromMessage(messageContent, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const extension = path.extname(originalFilename || '') || `.${messageContent.mimetype?.split('/')[1] || 'bin'}`;
    const mimetype = messageContent.mimetype || 'application/octet-stream';
    const filename = originalFilename || `file-${Date.now()}${extension}`;

    // Используем универсальный storage service
    const { saveMedia } = await import('../services/storageService');
    const mediaUrl = await saveMedia(buffer, filename, mimetype);

    // logger.info(`✅ Медиафайл сохранен: ${mediaUrl}`);
    return mediaUrl;
  } catch (error) {
    logger.error('❌ Ошибка при скачивании или сохранении медиа:', error);
    return undefined;
  }
}

/**
 * Корректно закрывает сессию Baileys и очищает ресурсы.
 * @param organizationPhoneId ID телефона организации
 * @param phoneJid JID номера телефона
 * @param reason Причина закрытия
 */
async function closeSession(
  organizationPhoneId: number,
  phoneJid: string,
  reason: string
): Promise<void> {
  const key = phoneJid.split('@')[0].split(':')[0];
  // logger.warn(`🚪 Закрытие сессии для ${phoneJid}. Причина: ${reason}`);
  
  try {
    // Получаем сокет
    const sock = socks.get(organizationPhoneId);
    
    if (sock) {
      // Пытаемся корректно закрыть WebSocket соединение
      try {
        if ((sock.ws as any).readyState === 1) { // OPEN
          await sock.end(new Error(reason));
          // logger.info(`✅ WebSocket соединение закрыто для ${phoneJid}`);
        } else {
          // logger.info(`ℹ️ WebSocket уже закрыт (state: ${(sock.ws as any).readyState})`);
        }
      } catch (wsError) {
        // logger.error(`⚠️ Ошибка при закрытии WebSocket:`, wsError);
        // Продолжаем даже если WebSocket не закрылся корректно
      }
      
      // Удаляем сокет из Map
      socks.delete(organizationPhoneId);
      // logger.info(`✅ Сокет удален из Map для organizationPhoneId: ${organizationPhoneId}`);
    } else {
      // logger.info(`ℹ️ Сокет не найден в Map для organizationPhoneId: ${organizationPhoneId}`);
    }
    
    // Очищаем счетчик ошибок
    badMacErrorCount.delete(organizationPhoneId);
    
  } catch (error) {
    // logger.error(`❌ Ошибка при закрытии сессии для ${phoneJid}:`, error);
    // Принудительно удаляем из Map даже при ошибке
    socks.delete(organizationPhoneId);
    badMacErrorCount.delete(organizationPhoneId);
  }
}

/**
 * Обработчик ошибок Bad Decrypt из app state sync.
 * Очищает поврежденные данные синхронизации app state.
 * @param organizationId ID организации
 * @param organizationPhoneId ID телефона организации
 * @param phoneJid JID номера телефона
 * @returns true если данные были очищены, false если достигнут лимит ошибок и сессия закрыта
 */
async function handleBadDecryptError(
  organizationId: number,
  organizationPhoneId: number,
  phoneJid: string
): Promise<boolean> {
  const key = phoneJid.split('@')[0].split(':')[0];
  
  // Увеличиваем счетчик ошибок
  const currentCount = badDecryptErrorCount.get(organizationPhoneId) || 0;
  badDecryptErrorCount.set(organizationPhoneId, currentCount + 1);
  
  // logger.warn(`⚠️ Bad Decrypt error #${currentCount + 1} для ${phoneJid}`);
  
  if (currentCount + 1 >= MAX_BAD_DECRYPT_ERRORS) {
    // logger.error(`❌ Достигнут лимит Bad Decrypt ошибок (${MAX_BAD_DECRYPT_ERRORS}) для ${phoneJid}. Полный выход из сессии.`);
    
    try {
      // 1. Корректно закрываем сессию
      await closeSession(
        organizationPhoneId,
        phoneJid,
        `Bad Decrypt error limit reached (${MAX_BAD_DECRYPT_ERRORS} errors)`
      );
      
      // 2. Удаляем ВСЕ данные авторизации из БД
      const deletedCount = await prisma.baileysAuth.deleteMany({
        where: {
          organizationId: organizationId,
          phoneJid: key,
        }
      });
      // logger.info(`🗑️ Удалено ${deletedCount.count} записей авторизации для ${key}`);
      
      // 3. Обновляем статус телефона на 'logged_out'
      await prisma.organizationPhone.update({
        where: { id: organizationPhoneId },
        data: { 
          status: 'logged_out',
          qrCode: null,
          lastConnectedAt: new Date(),
        },
      });
      // logger.info(`📱 Статус телефона ${key} обновлен на 'logged_out'`);
      
      // logger.info(`✅ Сессия для ${phoneJid} полностью завершена из-за повторяющихся Bad Decrypt ошибок. Требуется повторное QR-сканирование.`);
      return false;
    } catch (e) {
      logger.error(`❌ Ошибка при полном выходе из сессии:`, e);
      // Даже при ошибке пытаемся закрыть сокет
      await closeSession(organizationPhoneId, phoneJid, 'Error during Bad Decrypt cleanup');
      return false;
    }
  }
  
  // Очищаем только поврежденные ключи app state (без полного выхода)
  try {
    const deletedCount = await prisma.baileysAuth.deleteMany({
      where: {
        organizationId: organizationId,
        phoneJid: key,
        key: {
          startsWith: 'app-state-sync-'
        }
      }
    });
    
    // logger.info(`✅ Удалено ${deletedCount.count} поврежденных ключей app state для ${key}. Соединение продолжит работу.`);
    return true;
  } catch (e) {
    logger.error(`❌ Ошибка при удалении поврежденных данных app state:`, e);
    return false;
  }
}

/**
 * Обработчик ошибок Bad MAC из libsignal.
 * Очищает поврежденные сессии Signal Protocol для указанного номера.
 * @param organizationId ID организации
 * @param organizationPhoneId ID телефона организации
 * @param phoneJid JID номера телефона
 * @returns true если сессия была очищена, false если достигнут лимит ошибок и сессия закрыта
 */
async function handleBadMacError(
  organizationId: number,
  organizationPhoneId: number,
  phoneJid: string
): Promise<boolean> {
  const key = phoneJid.split('@')[0].split(':')[0];
  
  // Увеличиваем счетчик ошибок
  const currentCount = badMacErrorCount.get(organizationPhoneId) || 0;
  badMacErrorCount.set(organizationPhoneId, currentCount + 1);
  
  // logger.warn(`⚠️ Bad MAC error #${currentCount + 1} для ${phoneJid}`);
  
  if (currentCount + 1 >= MAX_BAD_MAC_ERRORS) {
    // logger.error(`❌ Достигнут лимит Bad MAC ошибок (${MAX_BAD_MAC_ERRORS}) для ${phoneJid}. Полный выход из сессии.`);
    
    try {
      // 1. Корректно закрываем сессию
      await closeSession(
        organizationPhoneId,
        phoneJid,
        `Bad MAC error limit reached (${MAX_BAD_MAC_ERRORS} errors)`
      );
      
      // 2. Удаляем ВСЕ данные авторизации из БД
      const deletedCount = await prisma.baileysAuth.deleteMany({
        where: {
          organizationId: organizationId,
          phoneJid: key,
        }
      });
      // logger.info(`🗑️ Удалено ${deletedCount.count} записей авторизации для ${key}`);
      
      // 3. Обновляем статус телефона на 'logged_out'
      await prisma.organizationPhone.update({
        where: { id: organizationPhoneId },
        data: { 
          status: 'logged_out',
          qrCode: null,
          lastConnectedAt: new Date(),
        },
      });
      // logger.info(`📱 Статус телефона ${key} обновлен на 'logged_out'`);
      
      // logger.info(`✅ Сессия для ${phoneJid} полностью завершена. Требуется повторное QR-сканирование.`);
      return false;
    } catch (e) {
      logger.error(`❌ Ошибка при полном выходе из сессии:`, e);
      // Даже при ошибке пытаемся закрыть сокет
      await closeSession(organizationPhoneId, phoneJid, 'Error during session cleanup');
      return false;
    }
  }
  
  // Очищаем только поврежденные ключи сессий (без полного выхода)
  try {
    const deletedCount = await prisma.baileysAuth.deleteMany({
      where: {
        organizationId: organizationId,
        phoneJid: key,
        OR: [
          { key: { startsWith: 'session-' } },
          { key: { startsWith: 'pre-key-' } },
          { key: { startsWith: 'sender-key-' } }
        ]
      }
    });
    
    // logger.info(`✅ Удалено ${deletedCount.count} поврежденных ключей сессий для ${key}. Попытка восстановления...`);
    return true;
  } catch (e) {
    logger.error(`❌ Ошибка при удалении поврежденных сессий:`, e);
    return false;
  }
}

/**
 * Вспомогательная функция для поиска или создания записи чата в БД.
 * Используется для получения chatId для Message.
 * @param organizationId ID организации
 * @param organizationPhoneId ID телефона организации, через который идет этот чат
 * @param receivingPhoneJid Ваш номер телефона (JID), который участвует в чате
 * @param remoteJid Идентификатор JID удаленного собеседника
 * @param name Необязательное имя чата
 * @returns ID чата из вашей БД.
 */
export async function ensureChat(
  organizationId: number,
  organizationPhoneId: number,
  receivingPhoneJid: string,
  remoteJid: string,
  name?: string,
  options?: { reopenClosedTicket?: boolean }
): Promise<number> {
  try {
    const shouldReopenClosedTicket = options?.reopenClosedTicket ?? true;
    const normalizedRemoteJid = jidNormalizedUser(remoteJid);

    let myJidNormalized: string | undefined;
    const candidates: Array<string | undefined> = [
      receivingPhoneJid,
      socks.get(organizationPhoneId)?.user?.id,
    ];

    try {
      const orgPhone = await prisma.organizationPhone.findUnique({
        where: { id: organizationPhoneId },
        select: { phoneJid: true },
      });
      if (orgPhone?.phoneJid) {
        candidates.push(orgPhone.phoneJid);
      }
    } catch (e) {
      logger.warn(`[ensureChat] Не удалось получить OrganizationPhone(${organizationPhoneId}) для нормализации JID: ${String(e)}`);
    }

    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'string' && candidate.trim()) {
        const normalized = jidNormalizedUser(candidate);
        if (normalized) {
          myJidNormalized = normalized;
          break;
        }
      }
    }

    if (!myJidNormalized) {
      logger.warn(`[ensureChat] receivingPhoneJid не удалось нормализовать. Поступившее значение: "${receivingPhoneJid}". Будет использовано пустое значение, что может привести к дублям.`);
      myJidNormalized = '' as any;
    }

    let chat = myJidNormalized
      ? await prisma.chat.findFirst({
          where: {
            organizationId,
            channel: 'whatsapp',
            receivingPhoneJid: myJidNormalized,
            remoteJid: normalizedRemoteJid,
          },
        })
      : null;

    // fallback: ищем по remoteJid независимо от receivingPhoneJid, чтобы не плодить дубликаты
    if (!chat) {
      chat = await prisma.chat.findFirst({
        where: {
          organizationId,
          channel: 'whatsapp',
          remoteJid: normalizedRemoteJid,
        },
      });
      if (chat && myJidNormalized && chat.receivingPhoneJid !== myJidNormalized) {
        chat = await prisma.chat.update({
          where: { id: chat.id },
          data: { receivingPhoneJid: myJidNormalized, organizationPhoneId },
        });
      }
    }

    if (!chat) {
      const emptyChat = await prisma.chat.findFirst({
        where: {
          organizationId,
          remoteJid: normalizedRemoteJid,
          receivingPhoneJid: '',
        },
      });

      if (emptyChat && myJidNormalized) {
        chat = await prisma.chat.update({
          where: { id: emptyChat.id },
          data: {
            receivingPhoneJid: myJidNormalized,
            organizationPhoneId,
            lastMessageAt: new Date(),
          },
        });
      }
    }

    if (!chat) {
      try {
        const lastTicket = await prisma.chat.findFirst({
          where: {
            organizationId,
            ticketNumber: { not: null },
          },
          orderBy: { ticketNumber: 'desc' },
          select: { ticketNumber: true },
        });

        const nextTicketNumber = (lastTicket?.ticketNumber || 0) + 1;

        chat = await prisma.chat.create({
          data: {
            organizationId,
            receivingPhoneJid: myJidNormalized,
            remoteJid: normalizedRemoteJid,
            organizationPhoneId,
            name: name || normalizedRemoteJid.split('@')[0],
            isGroup: isJidGroup(normalizedRemoteJid),
            lastMessageAt: new Date(),
            ticketNumber: nextTicketNumber,
            status: 'new',
            priority: 'normal',
          },
        });

        await prisma.ticketHistory.create({
          data: {
            chatId: chat.id,
            changeType: 'ticket_created',
            newValue: String(nextTicketNumber),
            description: `Создан тикет #${nextTicketNumber}`,
          },
        });

        try {
          notifyNewChat(organizationId, {
            id: chat.id,
            remoteJid: chat.remoteJid,
            name: chat.name,
            channel: 'whatsapp',
            ticketNumber: chat.ticketNumber,
            status: chat.status,
            priority: chat.priority,
            lastMessageAt: chat.lastMessageAt,
            unreadCount: 0,
          });
        } catch (socketError) {
          logger.error('[Socket.IO] Ошибка отправки уведомления о новом чате:', socketError);
        }
      } catch (e: any) {
        if (e?.code === 'P2002') {
          // Уникальное ограничение на (organizationId, channel, remoteJid)
          const existing = await prisma.chat.findFirst({
            where: {
              organizationId,
              channel: 'whatsapp',
              remoteJid: normalizedRemoteJid,
            },
          });
          if (existing) {
            chat = existing;
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    } else {
      const updateData: any = { lastMessageAt: new Date(), organizationPhoneId };
      if (name && typeof name === 'string' && name.trim() && name !== chat.name) {
        updateData.name = name.trim();
      }

      if (shouldReopenClosedTicket && (chat.status === 'closed' || chat.status === 'resolved')) {
        const lastTicket = await prisma.chat.findFirst({
          where: {
            organizationId,
            ticketNumber: { not: null },
          },
          orderBy: { ticketNumber: 'desc' },
          select: { ticketNumber: true },
        });

        const nextTicketNumber = (lastTicket?.ticketNumber || 0) + 1;
        const previousTicketNumber = chat.ticketNumber;

        updateData.ticketNumber = nextTicketNumber;
        updateData.status = 'new';
        updateData.priority = 'normal';
        updateData.assignedUserId = null;
        updateData.closedAt = null;
        updateData.resolvedAt = null;

        await prisma.chat.update({
          where: { id: chat.id },
          data: updateData,
        });

        await prisma.ticketHistory.create({
          data: {
            chatId: chat.id,
            changeType: 'ticket_reopened',
            oldValue: previousTicketNumber ? String(previousTicketNumber) : null,
            newValue: String(nextTicketNumber),
            description: `Чат переоткрыт: новый тикет #${nextTicketNumber}${previousTicketNumber ? ` (был #${previousTicketNumber})` : ''}`,
          },
        });
      } else {
        await prisma.chat.update({
          where: { id: chat.id },
          data: updateData,
        });
      }
    }

    return chat.id;
  } catch (error: any) {
    logger.error(`❌ Ошибка в ensureChat для JID ${remoteJid} (Ваш номер: ${receivingPhoneJid}, Phone ID: ${organizationPhoneId}):`, error);
    if (error.stack) {
      logger.error('Stack trace:', error.stack);
    }
    if (error.code && error.meta) {
      logger.error(`Prisma Error Code: ${error.code}, Meta:`, JSON.stringify(error.meta, null, 2));
    }
    throw error;
  }
}

/**
 * Хук для управления состоянием аутентификации Baileys с использованием базы данных.
 * Загружает, сохраняет и управляет учетными данными и ключами сигналов.
 * @param organizationId ID организации.
 * @param phoneJid JID номера телефона.
 * @returns Объект с `state` (для makeWASocket) и `saveCreds` (для обработчика 'creds.update').
 */
export async function useDBAuthState(organizationId: number, phoneJid: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; }> {
  // Извлекаем только номер из полного JID для использования в качестве ключа
  const key = phoneJid.split('@')[0].split(':')[0];
  const authDB = createAuthDBAdapter(organizationId, key);

  // 1. Загрузка и инициализация creds
  let creds: AuthenticationCreds;
  const storedCredsData = await authDB.get('creds');
  if (storedCredsData && storedCredsData.type === 'base64_json') {
    try {
      const decodedCredsJsonString = Buffer.from(storedCredsData.value, 'base64').toString('utf8');
      const parsedCreds = JSON.parse(decodedCredsJsonString, BufferJSON.reviver) as AuthenticationCreds;
      // Проверка на полноту данных
      if (parsedCreds.noiseKey && parsedCreds.signedIdentityKey && parsedCreds.registered !== undefined) {
        creds = parsedCreds;
        logger.info({ organizationId, phoneJid, authKey: key }, '[BaileysAuth] creds загружены из БД');
      } else {
        logger.warn({ organizationId, phoneJid, authKey: key }, '[BaileysAuth] creds неполные, инициализируем новые');
        creds = initAuthCreds();
      }
    } catch (e) {
      logger.error({ err: e, organizationId, phoneJid, authKey: key }, '[BaileysAuth] ошибка парсинга creds, инициализируем новые');
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
    logger.info({ organizationId, phoneJid, authKey: key }, '[BaileysAuth] creds не найдены, инициализируем новые');
  }

  // 2. Создание хранилища ключей (SignalStore)
  const keys = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
      const data: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids.filter(Boolean)) {
        const dbKey = `${type}-${id}`;
        const storedData = await authDB.get(dbKey);
        if (storedData) {
          try {
            if (storedData.type === 'base64_json') {
              const decoded = Buffer.from(storedData.value, 'base64').toString('utf8');
              data[id] = JSON.parse(decoded, BufferJSON.reviver);
            } else if (storedData.type === 'buffer') {
               data[id] = Buffer.from(storedData.value, 'base64') as any;
            }
          } catch (e) {
            logger.warn(`Ошибка при получении/парсинге ключа ${dbKey}:`, e);
            delete data[id]; // Удаляем невалидные данные
          }
        }
      }
      return data;
    },
    async set(data: SignalDataSet): Promise<void> {
      const tasks: Promise<void>[] = [];
      for (const key in data) {
        const type = key as keyof SignalDataTypeMap;
        const typeData = data[type];
        if (typeData) {
          for (const id in typeData) {
            const value = (typeData as any)[id];
            const dbKey = `${type}-${id}`;
            if (value) {
              let valueToStore: string;
              let dataType: StoredDataType;
              if (value instanceof Buffer) {
                valueToStore = value.toString('base64');
                dataType = 'buffer';
              } else {
                valueToStore = Buffer.from(JSON.stringify(value, BufferJSON.replacer), 'utf8').toString('base64');
                dataType = 'base64_json';
              }
              tasks.push(authDB.set(dbKey, valueToStore, dataType));
            } else {
              tasks.push(authDB.delete(dbKey));
            }
          }
        }
      }
      await Promise.all(tasks);
    }
  };

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(keys, logger),
    },
    saveCreds: async () => {
      logger.info({ organizationId, phoneJid, authKey: key }, '[BaileysAuth] сохраняем обновленные creds');
      const base64Creds = Buffer.from(JSON.stringify(creds, BufferJSON.replacer), 'utf8').toString('base64');
      await authDB.set('creds', base64Creds, 'base64_json');
    },
  };
}

/**
 * Запускает или перезапускает Baileys сессию для указанного телефона организации.
 * @param organizationId ID организации.
 * @param organizationPhoneId ID телефона организации в вашей БД.
 * @param phoneJid JID номера телефона WhatsApp (например, '77051234567@s.whatsapp.net').
 * @returns Экземпляр WASocket.
 */
export async function startBaileys(organizationId: number, organizationPhoneId: number, phoneJid: string): Promise<WASocket> {
  const { state, saveCreds } = await useDBAuthState(organizationId, phoneJid);

  // Получаем последнюю версию WhatsApp Web API
  const { version } = await fetchLatestBaileysVersion();
  logger.info({ organizationId, organizationPhoneId, phoneJid, version: version.join('.'), connectTimeoutMs: BAILEYS_CONNECT_TIMEOUT_MS, queryTimeoutMs: BAILEYS_DEFAULT_QUERY_TIMEOUT_MS, qrWaitTimeoutMs: BAILEYS_QR_WAIT_TIMEOUT_MS }, '[Baileys] запускаем сессию');

  // Создаем новый экземпляр Baileys WASocket
  const currentSock = makeWASocket({ 
    version,
    auth: state, // Используем состояние из useDBAuthState
    browser: ['Ubuntu', 'Chrome', '22.04.4'], // Устанавливаем информацию о браузере
    logger: logger, // Используем ваш pino logger
    connectTimeoutMs: BAILEYS_CONNECT_TIMEOUT_MS,
    defaultQueryTimeoutMs: BAILEYS_DEFAULT_QUERY_TIMEOUT_MS,
    keepAliveIntervalMs: BAILEYS_KEEP_ALIVE_INTERVAL_MS,
    // ИСПРАВЛЕНИЕ: Отключаем автоматическую синхронизацию app state для предотвращения ошибок дешифрования
    syncFullHistory: false, // Отключаем полную синхронизацию истории
    shouldSyncHistoryMessage: () => false, // Отключаем синхронизацию сообщений
    // Функция для получения сообщений из кэша или БД (для Baileys)
    getMessage: async (key) => {
        logger.debug(`Попытка получить сообщение из getMessage: ${key.id} от ${key.remoteJid}`);
        const msg = await prisma.message.findFirst({
            where: {
              channel: 'whatsapp',
              whatsappMessageId: key.id || '',
            },
            select: {
                content: true,
                type: true,
                remoteJid: true,
                senderJid: true,
                fromMe: true,
                timestamp: true,
                mediaUrl: true,
                mimeType: true,
                filename: true,
                size: true
            }
        });
        if (msg) {
            if (msg.type === 'text') {
                return { conversation: msg.content };
            } else if (msg.type === 'image' && msg.mediaUrl) {
                return { imageMessage: { caption: msg.content || '', mimetype: msg.mimeType || 'image/jpeg' } };
            }
            return { conversation: msg.content || 'Сообщение найдено в БД, но тип не поддержан для getMessage.' };
        }
        return { conversation: 'Сообщение не найдено в кэше или БД' };
    }
  });

  // !!! КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: Добавляем созданный сокет в socks Map !!!
  socks.set(organizationPhoneId, currentSock);

  let qrResolved = false;
  const qrWatchdog = setTimeout(() => {
    if (qrResolved) return;

    logger.warn({ organizationId, organizationPhoneId, phoneJid, timeoutMs: BAILEYS_QR_WAIT_TIMEOUT_MS }, '[Baileys] QR не был получен вовремя, переводим сессию в disconnected');

    socks.delete(organizationPhoneId);

    void prisma.organizationPhone.update({
      where: { id: organizationPhoneId },
      data: { status: 'disconnected', qrCode: null },
    }).catch((err) => {
      logger.error({ err }, `[Baileys] Не удалось обновить статус после таймаута QR для ${phoneJid}`);
    });

    void closeSession(organizationPhoneId, phoneJid, 'QR wait timeout').catch((err) => {
      logger.error({ err }, `[Baileys] Не удалось закрыть зависшую сессию после таймаута QR для ${phoneJid}`);
    });
  }, BAILEYS_QR_WAIT_TIMEOUT_MS);

  // Обработчик событий обновления соединения
  currentSock.ev.on('connection.update', safeAsyncListener('connection.update(main)', async (update: Partial<ConnectionState>) => { 
    const { connection, lastDisconnect, qr } = update;

    logger.info({
      organizationId,
      organizationPhoneId,
      phoneJid,
      connection: connection || 'unknown',
      hasQr: Boolean(qr),
      ...getDisconnectInfo(lastDisconnect),
    }, '[Baileys] connection.update');

    // Если получен QR-код
    if (qr) {
      qrResolved = true;
      clearTimeout(qrWatchdog);

      logger.info({ organizationId, organizationPhoneId, phoneJid, qrLength: qr.length }, '[Baileys] получен QR-код');
      // Сохраняем QR-код в БД и обновляем статус
      await prisma.organizationPhone.update({
        where: { id: organizationPhoneId },
        data: { qrCode: qr, status: 'pending' },
      });

      logger.info({ organizationId, organizationPhoneId, phoneJid }, '[Baileys] QR сохранен в БД, статус pending');

      // Выводим QR-код в терминал
      console.log(`\n======================================================`);
      console.log(`       QR-КОД ДЛЯ НОМЕРА: ${phoneJid}           `);
      console.log(`======================================================`);
      qrcode.generate(qr, { small: true });
      console.log(`======================================================`);
      console.log(`  Отсканируйте QR-код с помощью WhatsApp на вашем телефоне.`);
      console.log(`  (WhatsApp -> Настройки -> Связанные устройства -> Привязка устройства)`);
      console.log(`======================================================\n`);
    } else {
      // logger.info(`[ConnectionUpdate] No QR code in this update for ${phoneJid}.`);
    }

    // Если соединение закрыто
    if (connection === 'close') {
      qrResolved = true;
      clearTimeout(qrWatchdog);

      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.warn({ organizationId, organizationPhoneId, phoneJid, shouldReconnect, ...getDisconnectInfo(lastDisconnect) }, '[Baileys] соединение закрыто');
      
      // Удаляем сокет из Map перед попыткой переподключения или завершением
      socks.delete(organizationPhoneId);

      if (shouldReconnect) {
        await prisma.organizationPhone.update({
          where: { id: organizationPhoneId },
          data: { status: 'disconnected', qrCode: null },
        }).catch(() => undefined);

        logger.info({ organizationId, organizationPhoneId, phoneJid }, '[Baileys] статус обновлен на disconnected перед переподключением');

        // Задержка перед попыткой переподключения
        await new Promise(resolve => setTimeout(resolve, 3000));
        logger.info({ organizationId, organizationPhoneId, phoneJid }, '[Baileys] повторная попытка подключения');
        // Рекурсивно вызываем startBaileys для создания новой сессии
        void startBaileys(organizationId, organizationPhoneId, phoneJid).catch((err) => {
          logger.error({ err }, `[Connection] Ошибка при переподключении Baileys для ${phoneJid}`);
        });
      } else {
          // --- ИСПРАВЛЕНО: Используем только номер для ключа, как в useDBAuthState ---
          const key = phoneJid.split('@')[0].split(':')[0];

          // Очищаем данные сессии из БД по правильному ключу
          await prisma.baileysAuth.deleteMany({
            where: {
              organizationId: organizationId,
              phoneJid: key, // Используем только номер
            }
          });
          logger.warn({ organizationId, organizationPhoneId, phoneJid, authKey: key }, '[Baileys] logged_out, auth-данные удалены из БД');

          // Обновляем статус в БД на 'logged_out' и очищаем QR-код
          await prisma.organizationPhone.update({
              where: { id: organizationPhoneId },
              data: { status: 'logged_out', lastConnectedAt: new Date(), qrCode: null }, 
          });

          logger.warn({ organizationId, organizationPhoneId, phoneJid }, '[Baileys] статус обновлен на logged_out');
      }
    } else if (connection === 'open') {
      qrResolved = true;
      clearTimeout(qrWatchdog);

      logger.info({ organizationId, organizationPhoneId, phoneJid, currentUserId: currentSock?.user?.id }, '[Baileys] соединение открыто');
      
      // Очищаем счетчики ошибок при успешном подключении
      badMacErrorCount.delete(organizationPhoneId);
      badDecryptErrorCount.delete(organizationPhoneId);
      // logger.info(`🔄 Счетчики ошибок сброшены для organizationPhoneId: ${organizationPhoneId}`);
      
      // Обновляем статус в БД на 'connected', сохраняем фактический JID и очищаем QR-код
      const actualPhoneJid = currentSock?.user?.id || phoneJid;
      
      // Проверяем, не используется ли этот phoneJid другим телефоном
      const existingPhone = await prisma.organizationPhone.findFirst({
        where: {
          phoneJid: actualPhoneJid,
          id: { not: organizationPhoneId }
        }
      });
      
      if (existingPhone) {
        logger.warn({ organizationId, organizationPhoneId, phoneJid, actualPhoneJid, existingPhoneId: existingPhone.id }, '[Baileys] фактический JID уже используется другим телефоном, обновляем только статус');
        await prisma.organizationPhone.update({
          where: { id: organizationPhoneId },
          data: { status: 'connected', lastConnectedAt: new Date(), qrCode: null }
        });
      } else {
        await prisma.organizationPhone.update({
          where: { id: organizationPhoneId },
          data: { status: 'connected', phoneJid: actualPhoneJid, lastConnectedAt: new Date(), qrCode: null }
        });
      }

      logger.info({ organizationId, organizationPhoneId, phoneJid, actualPhoneJid }, '[Baileys] статус обновлен на connected');
    }
  }));

  // Обработчик обновления учетных данных
  currentSock.ev.on('creds.update', safeAsyncListener('creds.update', async () => {
    logger.info({ organizationId, organizationPhoneId, phoneJid }, '[Baileys] получено событие creds.update');
    await saveCreds();
  }));

  // ИСПРАВЛЕНИЕ: Добавляем обработчик ошибок синхронизации app state и сессий
  currentSock.ev.on('connection.update', safeAsyncListener('connection.update(recovery)', async (update) => {
    // Перехватываем ошибки синхронизации app state
    if (update.lastDisconnect?.error) {
      const error = update.lastDisconnect.error as any;
      logger.warn({ organizationId, organizationPhoneId, phoneJid, errorName: error?.name, errorMessage: error?.message }, '[Baileys] connection.update(recovery) получил ошибку');
      
      // Проверяем на ошибки дешифрования в app state
      if (error?.message?.includes('bad decrypt') || 
          error?.message?.includes('error:1C800064') ||
          error?.name === 'critical_unblock_low') {
        logger.warn({ organizationId, organizationPhoneId, phoneJid }, '[Baileys] обнаружена ошибка bad decrypt');
        
        // Вызываем обработчик Bad Decrypt ошибки
        const recovered = await handleBadDecryptError(organizationId, organizationPhoneId, phoneJid);
        
        if (!recovered) {
          // logger.error(`❌ Не удалось восстановить сессию после повторяющихся Bad Decrypt ошибок для ${phoneJid}. Сессия закрыта.`);
          // Сессия уже закрыта в handleBadDecryptError, не пытаемся переподключиться
          return;
        }
      }
      
      // НОВОЕ: Обработка ошибки Bad MAC из libsignal
      if (error?.message?.includes('Bad MAC') || 
          error?.message?.includes('verifyMAC') ||
          error?.stack?.includes('libsignal')) {
        logger.warn({ organizationId, organizationPhoneId, phoneJid }, '[Baileys] обнаружена ошибка Bad MAC');
        
        // Вызываем обработчик Bad MAC ошибки
        const recovered = await handleBadMacError(organizationId, organizationPhoneId, phoneJid);
        
        if (!recovered) {
          // logger.error(`❌ Не удалось восстановить сессию после повторяющихся Bad MAC ошибок для ${phoneJid}. Сессия закрыта.`);
          // Сессия уже закрыта в handleBadMacError, не пытаемся переподключиться
          return;
        }
      }
    }
  }));

  // Совместимость с v7: обработчик обновлений LID маппинга (в 6.7.x событие не генерируется)
  try {
    (currentSock.ev as any).on?.('lid-mapping.update', (mapping: any) => {
      // logger.info(`[LID] lid-mapping.update: ${JSON.stringify(mapping)}`);
      // Здесь можно задействовать currentSock.signalRepository?.lidMapping?.storeLIDPNMappings(mapping)
      // но API может отличаться между версиями — оставляем как информативный лог
    });
  } catch (e) {
    // logger.debug('LID mapping event handler not supported in this version');
  }

  // Обработчик получения новых сообщений
  currentSock.ev.on('messages.upsert', safeAsyncListener('messages.upsert', async ({ messages, type }) => { 
    if (type === 'notify') {
      for (const msg of messages) {
        try {
          // Пропускаем сообщения без контента или если это наше исходящее сообщение, не имеющее видимого контента
          if (!msg.message) {
              // logger.info(`[Message Upsert] Пропущено сообщение без контента (ID: ${msg.key.id})`);
              continue;
          }
          if (msg.key.fromMe && !msg.message.conversation && !msg.message.extendedTextMessage && !msg.message.imageMessage && !msg.message.videoMessage && !msg.message.documentMessage && !msg.message.audioMessage && !msg.message.stickerMessage) {
              // logger.info(`[Message Upsert] Пропущено исходящее системное сообщение (ID: ${msg.key.id})`);
              continue;
          }

          // v7: поддержка LID alt-идентификаторов. В 6.7.x этих полей нет, поэтому используем fallback.
          const rawRemote: string = (msg.key as any).remoteJidAlt ?? msg.key.remoteJid ?? '';
          const remoteJid = jidNormalizedUser(rawRemote);
          if (!remoteJid) {
              // logger.warn('🚫 Сообщение без remoteJid, пропущено.');
              continue;
          }

          // Пропускаем широковещательные сообщения и статусы
          if (isJidBroadcast(remoteJid) || remoteJid === 'status@broadcast') {
              // logger.info(`Пропускаем широковещательное сообщение или статус от ${remoteJid}.`);
              continue;
          }
          
          try {
            const rawParticipant: string = (msg.key as any).participantAlt ?? msg.key.participant ?? remoteJid;
            const senderJid = jidNormalizedUser(msg.key.fromMe ? (currentSock?.user?.id || phoneJid) : rawParticipant);

            let content: string | undefined;
            let messageType: string = "unknown";
            let mediaUrl: string | undefined;
            let filename: string | undefined;
            let mimeType: string | undefined;
            let size: number | undefined;
            let quotedMessageId: string | undefined;
            let quotedContent: string | undefined;

            const messageContent = msg.message;
            
            // Разбор различных типов сообщений
            if (messageContent?.conversation) {
                content = messageContent.conversation;
                messageType = "text";
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: "${content}" от ${remoteJid}`);
                }
            } else if (messageContent?.extendedTextMessage) {
                content = messageContent.extendedTextMessage.text || undefined;
                messageType = "text";
                
                // --- ОБРАБОТКА ОТВЕТА ---
                const contextInfo = messageContent.extendedTextMessage.contextInfo;
                if (contextInfo?.quotedMessage) {
                    quotedMessageId = contextInfo.stanzaId ?? undefined;
                    const qm = contextInfo.quotedMessage;
                    // Получаем текст из разных возможных полей цитируемого сообщения
                    quotedContent = qm.conversation || 
                                    qm.extendedTextMessage?.text ||
                                    qm.imageMessage?.caption ||
                                    qm.videoMessage?.caption ||
                                    qm.documentMessage?.fileName ||
                                    '[Медиафайл]'; // Плейсхолдер для медиа без текста
                    
                    // Добавляем информацию об ответе к основному контенту
                    const replyText = `ответил на: "${quotedContent}"`;
                    if (content) {
                        content = `${replyText}\n\n${content}`;
                    } else {
                        content = replyText;
                    }
                    
                    if (!msg.key.fromMe) {
                      logger.info(`  [reply] Ответ на сообщение ID: ${quotedMessageId}`);
                    }
                }
                // --- КОНЕЦ: ОБРАБОТКА ОТВЕТА ---

                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: "${content}" от ${remoteJid}`);
                }
            } else if (messageContent?.imageMessage) {
                messageType = "image";
                content = messageContent.imageMessage.caption || undefined;
                mimeType = messageContent.imageMessage.mimetype || undefined;
                size = Number(messageContent.imageMessage.fileLength) || undefined;
                // --- СКАЧИВАНИЕ И СОХРАНЕНИЕ ФОТО ---
                mediaUrl = await downloadAndSaveMedia(messageContent.imageMessage, 'image');
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: "${content || 'без подписи'}". MIME: ${mimeType}. Размер: ${size} от ${remoteJid}`);
                }
            } else if (messageContent?.videoMessage) {
                messageType = "video";
                content = messageContent.videoMessage.caption || undefined;
                mimeType = messageContent.videoMessage.mimetype || undefined;
                size = Number(messageContent.videoMessage.fileLength) || undefined;
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: "${content || 'без подписи'}". MIME: ${mimeType}. Размер: ${size} от ${remoteJid}`);
                }
            } else if (messageContent?.documentMessage) {
                messageType = "document";
                filename = messageContent.documentMessage.fileName || undefined;
                mimeType = messageContent.documentMessage.mimetype || undefined;
                size = Number(messageContent.documentMessage.fileLength) || undefined;
                // --- СКАЧИВАНИЕ И СОХРАНЕНИЕ ДОКУМЕНТА ---
                mediaUrl = await downloadAndSaveMedia(messageContent.documentMessage, 'document', filename);
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: Документ "${filename || 'без имени'}". MIME: ${mimeType}. Размер: ${size} от ${remoteJid}`);
                }
            } else if (messageContent?.audioMessage) {
                messageType = "audio";
                mimeType = messageContent.audioMessage.mimetype || undefined;
                size = Number(messageContent.audioMessage.fileLength) || undefined;
                // --- СКАЧИВАНИЕ И СОХРАНЕНИЕ АУДИО ---
                mediaUrl = await downloadAndSaveMedia(messageContent.audioMessage, 'audio');
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: Аудио. MIME: ${mimeType}. Размер: ${size} от ${remoteJid}`);
                }
            } else if (messageContent?.stickerMessage) {
                messageType = "sticker";
                mimeType = messageContent.stickerMessage.mimetype || undefined;
                size = Number(messageContent.stickerMessage.fileLength) || undefined;
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: Стикер. MIME: ${mimeType}. Размер: ${size} от ${remoteJid}`);
                }
            } else if (messageContent?.locationMessage) {
                messageType = "location";
                content = `Latitude: ${messageContent.locationMessage.degreesLatitude}, Longitude: ${messageContent.locationMessage.degreesLongitude}`;
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: Локация ${content} от ${remoteJid}`);
                }
            } else if (messageContent?.liveLocationMessage) {
                messageType = "live_location";
                content = `Live Location: Capt=${messageContent.liveLocationMessage.caption || 'N/A'}, Seq=${messageContent.liveLocationMessage.sequenceNumber}`;
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: ${content} от ${remoteJid}`);
                }
            } else if (messageContent?.contactMessage) {
                messageType = "contact";
                content = `Контакт: ${messageContent.contactMessage.displayName || messageContent.contactMessage.vcard}`;
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: ${content} от ${remoteJid}`);
                }
            } else if (messageContent?.contactsArrayMessage) {
                messageType = "contacts_array";
                content = `Контакты: ${messageContent.contactsArrayMessage.contacts?.map(c => c.displayName || c.vcard).join(', ') || 'пусто'}`;
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: ${content} от ${remoteJid}`);
                }
            } else if (messageContent?.reactionMessage) {
                messageType = "reaction";
                content = `Реакция "${messageContent.reactionMessage.text}" на сообщение ${messageContent.reactionMessage.key?.id}`;
                // Логируем только входящие сообщения
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: ${content} от ${remoteJid}`);
                }
            } else if (messageContent?.protocolMessage) {
                messageType = "protocol";
                content = `Системное сообщение (тип: ${messageContent.protocolMessage.type})`;
                // Не логируем системные сообщения
            } else if (messageContent?.call) {
                messageType = "call";
                const callId = messageContent.call.callKey ? Buffer.from(messageContent.call.callKey).toString('hex') : 'unknown';
                content = `Звонок от ${senderJid} (ID: ${callId})`;
                // Логируем только входящие звонки
                if (!msg.key.fromMe) {
                  logger.info(`📥 [${messageType}] Входящее: ${content}`);
                }
            }

            if (messageType === "unknown" && Object.keys(messageContent || {}).length > 0) {
                messageType = Object.keys(messageContent || {})[0];
                logger.warn(`  [${messageType}] Неподдерживаемый или неизвестный тип сообщения. JID: ${remoteJid}`);
            } else if (messageType === "unknown") {
                 logger.warn(`  [Неизвестный] Сообщение без опознаваемого типа контента. JID: ${remoteJid}`);
                 continue; // Пропускаем сохранение полностью пустых сообщений
            }

            // --- ИСПРАВЛЕНО: Более надежная обработка timestamp ---
            let timestampInSeconds: number;
            const ts = msg.messageTimestamp;
            if (typeof ts === 'number') {
              timestampInSeconds = ts;
            } else if (ts && typeof ts === 'object' && typeof (ts as any).toNumber === 'function') {
              // Это объект Long, преобразуем его в число
              timestampInSeconds = (ts as any).toNumber();
            } else {
              // Запасной вариант, если timestamp не пришел или в неизвестном формате
              timestampInSeconds = Math.floor(Date.now() / 1000);
            }
            const timestampDate = new Date(timestampInSeconds * 1000);


            // Сохраняем сообщение в БД
            const myJid = jidNormalizedUser(currentSock?.user?.id || phoneJid) || '';
            const contactName = msg.pushName || undefined;
            const chatId = await ensureChat(
              organizationId,
              organizationPhoneId,
              myJid,
              remoteJid,
              contactName,
              { reopenClosedTicket: !msg.key.fromMe }
            );

            const chatAssignment = await prisma.chat.findUnique({
              where: { id: chatId },
              select: { assignedUserId: true },
            });
            const hasResponsible = Boolean(chatAssignment?.assignedUserId);
            
            // --- АВТОМАТИЧЕСКОЕ СОЗДАНИЕ КЛИЕНТА (ВРЕМЕННО ОТКЛЮЧЕНО) ---
            // Создаем или обновляем клиента только для входящих сообщений (не от нас)
            // if (!msg.key.fromMe) {
            //   try {
            //     logger.info(`👤 Проверка клиента для ${senderJid}...`);
            //     const { ensureWhatsAppClient, linkClientToChat } = await import('../services/clientService');
            //     const client = await ensureWhatsAppClient(organizationId, senderJid, contactName);
            //     logger.info(`✅ Клиент обработан: ${client.name} (ID: ${client.id})`);
            //     
            //     // Связываем клиента с чатом
            //     await linkClientToChat(client.id, chatId);
            //     logger.info(`🔗 Клиент #${client.id} связан с чатом #${chatId}`);
            //   } catch (clientError) {
            //     logger.error(`⚠️ Ошибка при создании клиента для ${senderJid}:`, clientError);
            //     // Продолжаем обработку сообщения даже если создание клиента не удалось
            //   }
            // } else {
            //   logger.debug(`⏭️ Пропускаем создание клиента для исходящего сообщения`);
            // }
            
            const savedMessage = await prisma.message.create({
                data: {
                    chatId: chatId,
                    organizationPhoneId: organizationPhoneId,
                    receivingPhoneJid: myJid,
                    remoteJid: remoteJid,
                    whatsappMessageId: msg.key.id || `_temp_${Date.now()}_${Math.random()}`,
                    senderJid: senderJid,
                    fromMe: msg.key.fromMe || false,
                    content: content || '',
                    type: messageType,
                    mediaUrl: mediaUrl,
                    filename: filename,
                    mimeType: mimeType,
                    size: size,
                    timestamp: timestampDate,
                    status: 'received',
                    organizationId: organizationId,
                    // Входящие сообщения по умолчанию не прочитаны оператором
                    isReadByOperator: msg.key.fromMe || false, // Исходящие считаем прочитанными
                    // --- СОХРАНЕНИЕ ДАННЫХ ОТВЕТОВ ---
                    quotedMessageId: quotedMessageId,
                    quotedContent: quotedContent,
                },
            });

            // Увеличиваем счетчик непрочитанных сообщений для входящих сообщений
            if (!msg.key.fromMe) {
                await prisma.chat.update({
                    where: { id: chatId },
                    data: {
                        unreadCount: {
                            increment: 1,
                        },
                        lastMessageAt: timestampDate,
                    },
                });
                // logger.info(`📬 Увеличен счетчик непрочитанных для чата ${chatId}`);
            } else {
                // Для исходящих сообщений только обновляем время последнего сообщения
                await prisma.chat.update({
                    where: { id: chatId },
                    data: {
                        lastMessageAt: timestampDate,
                    },
                });
            }

            // Отправляем Socket.IO уведомление о новом сообщении
            try {
              notifyNewMessage(organizationId, {
                id: savedMessage.id,
                chatId: savedMessage.chatId,
                content: savedMessage.content,
                type: savedMessage.type,
                mediaUrl: savedMessage.mediaUrl,
                filename: savedMessage.filename,
                fromMe: savedMessage.fromMe,
                timestamp: savedMessage.timestamp,
                status: savedMessage.status,
                senderJid: savedMessage.senderJid,
                hasResponsible,
              });
            } catch (socketError) {
              logger.error('[Socket.IO] Ошибка отправки уведомления о новом сообщении:', socketError);
            }

          // logger.info(`💾 Сообщение (тип: ${messageType}, ID: ${savedMessage.id}) сохранено в БД (JID собеседника: ${remoteJid}, Ваш номер: ${phoneJid}, chatId: ${savedMessage.chatId}).`);

          } catch (error:any) {
              // Обработка ошибки Bad MAC из libsignal
              if (error?.message?.includes('Bad MAC') || 
                  error?.message?.includes('verifyMAC') ||
                  error?.stack?.includes('libsignal')) {
                logger.error(`❌ Session error (Bad MAC) при обработке сообщения от ${remoteJid}:`, error.message);
                
                // Вызываем обработчик Bad MAC ошибки
                const recovered = await handleBadMacError(organizationId, organizationPhoneId, phoneJid);
                
                if (recovered) {
                  logger.info(`✅ Попытка восстановления после Bad MAC для ${phoneJid}. Сообщение будет обработано при повторной отправке.`);
                } else {
                  logger.error(`❌ Не удалось восстановить сессию после Bad MAC для ${phoneJid}. Требуется повторная авторизация.`);
                }
                
                // Пропускаем это сообщение, но продолжаем обработку других
                continue;
              }
              
              // Обработка других ошибок
              logger.error(`❌ Ошибка при сохранении сообщения в БД для JID ${remoteJid} (Ваш номер: ${phoneJid}):`);
              if (error instanceof Error) {
                  logger.error('Сообщение об ошибке:', error.message);
                  if (error.stack) {
                      logger.error('Stack trace:', error.stack);
                  }
                  if ('code' in error && 'meta' in error && typeof error.code === 'string') {
                      logger.error(`Prisma Error Code: ${error.code}, Meta:`, JSON.stringify(error.meta, null, 2));
                  }
              } else {
                  logger.error('Неизвестная ошибка:', error);
              }
          }
        } catch (outerError: any) {
          // Обработка критических ошибок на уровне обработки сообщения
          logger.error(`❌ Критическая ошибка при обработке сообщения:`, outerError);
          
          // Проверяем на Bad MAC даже на верхнем уровне
          if (outerError?.message?.includes('Bad MAC') || 
              outerError?.message?.includes('verifyMAC') ||
              outerError?.stack?.includes('libsignal')) {
            logger.error(`❌ Критическая Session error (Bad MAC). Попытка восстановления...`);
            await handleBadMacError(organizationId, organizationPhoneId, phoneJid);
          }
        }
      }
    }
  }));

  return currentSock; // Возвращаем созданный сокет
}

/**
 * Возвращает активный экземпляр WASocket по ID телефона организации.
 * @param organizationPhoneId ID телефона организации.
 * @returns Экземпляр WASocket или null, если не найден.
 */
export function getBaileysSock(organizationPhoneId: number): WASocket | null {
  // logger.info(`[getBaileysSock] Запрошен organizationPhoneId: ${organizationPhoneId}`);
  // logger.info(`[getBaileysSock] Ключи в socks Map: [${Array.from(socks.keys()).join(', ')}]`);
  const sock = socks.get(organizationPhoneId);
  // if (!sock) {
  //   logger.warn(`[getBaileysSock] Сокет не найден для organizationPhoneId: ${organizationPhoneId}`);
  // } else {
  //   logger.info(`[getBaileysSock] Сокет найден для organizationPhoneId: ${organizationPhoneId}. JID сокета: ${sock.user?.id || 'Неизвестно'}`);
  // }
  return sock || null;
}

/**
 * Возвращает статистику ошибок сессии для указанного телефона организации.
 * @param organizationPhoneId ID телефона организации.
 * @returns Объект со статистикой ошибок
 */
export function getSessionErrorStats(organizationPhoneId: number): {
  badMacErrors: number;
  badDecryptErrors: number;
  maxBadMacErrors: number;
  maxBadDecryptErrors: number;
  isHealthy: boolean;
} {
  const badMacErrors = badMacErrorCount.get(organizationPhoneId) || 0;
  const badDecryptErrors = badDecryptErrorCount.get(organizationPhoneId) || 0;
  
  return {
    badMacErrors,
    badDecryptErrors,
    maxBadMacErrors: MAX_BAD_MAC_ERRORS,
    maxBadDecryptErrors: MAX_BAD_DECRYPT_ERRORS,
    isHealthy: badMacErrors < MAX_BAD_MAC_ERRORS && badDecryptErrors < MAX_BAD_DECRYPT_ERRORS,
  };
}

/**
 * Принудительно закрывает сессию для указанного телефона организации.
 * Полезно для ручного управления сессиями из API.
 * @param organizationPhoneId ID телефона организации
 * @param reason Причина закрытия
 */
export async function forceCloseSession(organizationPhoneId: number, reason: string = 'Manual close'): Promise<void> {
  const sock = socks.get(organizationPhoneId);
  if (!sock) {
    logger.warn(`[forceCloseSession] Сокет не найден для organizationPhoneId: ${organizationPhoneId}`);
    return;
  }
  
  const phoneJid = sock.user?.id || 'unknown';
  logger.info(`[forceCloseSession] Принудительное закрытие сессии для ${phoneJid}. Причина: ${reason}`);
  
  await closeSession(organizationPhoneId, phoneJid, reason);
  
  logger.info(`✅ Сессия принудительно закрыта для organizationPhoneId: ${organizationPhoneId}`);
}

/**
 * Отправляет сообщение через Baileys сокет.
 * @param sock Экземпляр WASocket.
 * @param jid JID получателя.
 * @param content Содержимое сообщения.
 */
export async function sendMessage(
  sock: WASocket,
  jid: string,
  content: AnyMessageContent,
  organizationId: number, // Добавляем organizationId
  organizationPhoneId: number, // Добавляем organizationPhoneId
  senderJid: string, // Добавляем senderJid (ваш номер)
  userId?: number, // <-- ДОБАВЛЕН userId (опционально)
  mediaInfo?: { // <-- ДОБАВЛЕНА информация о медиафайле
    mediaUrl?: string;
    filename?: string;
    size?: number;
  }
) {
  if (!sock || !sock.user) {
    throw new Error('Baileys socket is not connected or user is not defined.');
  }

  try {
    const sentMessage = await sock.sendMessage(jid, content);

    // Логирование mediaInfo для отладки
    logger.info(`[sendMessage] Получена информация о медиафайле:`, {
      mediaInfo,
      hasMediaUrl: !!mediaInfo?.mediaUrl,
      hasFilename: !!mediaInfo?.filename,
      hasSize: !!mediaInfo?.size
    });

    // --- НАЧАЛО НОВОГО КОДА ДЛЯ СОХРАНЕНИЯ ---
    if (sentMessage) {
      const remoteJid = jidNormalizedUser(jid); // JID получателя
      
      // Определяем тип и содержимое сообщения
      let messageType = 'text';
      let messageContent = '';
      let mediaUrl: string | undefined = mediaInfo?.mediaUrl; // Используем переданную информацию
      let filename: string | undefined = mediaInfo?.filename; // Используем переданную информацию
      let mimeType: string | undefined;
      let size: number | undefined = mediaInfo?.size; // Используем переданную информацию

      // Анализируем содержимое для определения типа
      if ((content as any).text) {
        messageType = 'text';
        messageContent = (content as any).text;
      } else if ((content as any).image) {
        messageType = 'image';
        messageContent = (content as any).caption || '';
        mimeType = 'image/jpeg'; // По умолчанию
      } else if ((content as any).video) {
        messageType = 'video';
        messageContent = (content as any).caption || '';
        mimeType = 'video/mp4'; // По умолчанию
      } else if ((content as any).document) {
        messageType = 'document';
        filename = filename || (content as any).fileName || 'document'; // Приоритет переданному filename
        messageContent = (content as any).caption || '';
        mimeType = 'application/octet-stream'; // По умолчанию
      } else if ((content as any).audio) {
        messageType = 'audio';
        mimeType = (content as any).mimetype || 'audio/mp4';
      } else if ((content as any).sticker) {
        messageType = 'sticker';
        mimeType = 'image/webp';
      } else {
        // Для других типов сообщений
        messageContent = JSON.stringify(content);
      }

  // Получаем chatId для сохранения сообщения
  const myJid = jidNormalizedUser(sock.user?.id || senderJid) || '';
  const chatId = await ensureChat(
    organizationId,
    organizationPhoneId,
    myJid,
    remoteJid,
    undefined,
    { reopenClosedTicket: false }
  );

      // --- НАЧАЛО: УЛУЧШЕННАЯ ПРОВЕРКА И ЛОГИРОВАНИЕ userId ---
      logger.info(`[sendMessage] Проверка userId перед сохранением. Полученное значение: ${userId}, тип: ${typeof userId}`);

      const messageData: any = {
        chatId: chatId,
        organizationPhoneId: organizationPhoneId,
  receivingPhoneJid: myJid,
        remoteJid: remoteJid,
  whatsappMessageId: sentMessage.key.id || `_out_${Date.now()}_${Math.random()}`,
  senderJid: myJid,
        fromMe: true,
        content: messageContent,
        type: messageType,
        mediaUrl: mediaUrl,
        filename: filename,
        mimeType: mimeType,
        size: size,
        timestamp: new Date(),
        status: 'sent',
        organizationId: organizationId,
      };

      // Присваиваем senderUserId только если userId является числом
      if (typeof userId === 'number' && !isNaN(userId)) {
        messageData.senderUserId = userId;
      } else {
        logger.warn(`[sendMessage] userId не является числом (значение: ${userId}). senderUserId не будет установлен.`);
      }
      // --- КОНЕЦ: УЛУЧШЕННАЯ ПРОВЕРКА И ЛОГИРОВАНИЕ userId ---

      // --- ОТЛАДОЧНЫЙ ЛОГ ---
      logger.info({
          msg: '[sendMessage] Data to be saved to DB',
          data: messageData,
          receivedUserId: userId,
          isUserIdNumber: typeof userId === 'number',
          mediaInfo: {
            originalMediaUrl: mediaInfo?.mediaUrl,
            originalFilename: mediaInfo?.filename,
            originalSize: mediaInfo?.size,
            finalMediaUrl: messageData.mediaUrl,
            finalFilename: messageData.filename,
            finalSize: messageData.size
          }
      }, 'Полные данные для сохранения исходящего сообщения.');

      await prisma.message.create({
        data: messageData,
      });
      logger.info(`✅ Исходящее сообщение "${messageContent}" (ID: ${sentMessage.key.id}) сохранено в БД. Chat ID: ${chatId}, Type: ${messageType}`);
    } else {
      logger.warn(`⚠️ Исходящее сообщение на ${jid} не было сохранено: sentMessage is undefined.`);
    }
    // --- КОНЕЦ НОВОГО КОДА ДЛЯ СОХРАНЕНИЯ ---

    return sentMessage;
  } catch (error: any) {
    logger.error(`❌ Ошибка при отправке и/или сохранении исходящего сообщения на ${jid}:`, error);
    throw error; // Перебрасываем ошибку дальше
  }
}


// Обработчик сигнала завершения процесса (например, Ctrl+C)
process.on('SIGINT', async () => {
  logger.info('Получен сигнал SIGINT. Закрытие Baileys...');
  // Итерируем по всем активным сокетам и закрываем их
  for (const sockToClose of socks.values()) {
    // Проверяем, существует ли сокет и находится ли его WebSocket в состоянии OPEN (числовое значение 1)
    if (sockToClose && (sockToClose.ws as any).readyState === 1) { 
      try {
        await sockToClose.end(new Error('Приложение завершает работу: SIGINT получен.'));
        logger.info(`Baileys socket для JID ${sockToClose.user?.id || 'неизвестно'} закрыт.`);
      } catch (e) {
        logger.error(`Ошибка при закрытии сокета: ${e}`);
      }
    } else if (sockToClose) {
        logger.info(`Baileys socket для JID ${sockToClose.user?.id || 'неизвестно'} не был в состоянии OPEN (readyState: ${(sockToClose.ws as any)?.readyState}).`);
    }
  }
  socks.clear(); // Очищаем Map после попытки закрытия всех сокетов
  logger.info('Все Baileys сокеты закрыты.');

  await prisma.$disconnect(); // Отключаемся от Prisma Client
  logger.info('Prisma Client отключен.');
  process.exit(0); // Завершаем процесс
});