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

    // fallback: ищем по remoteJid и organizationPhoneId независимо от receivingPhoneJid, чтобы не плодить дубликаты
    if (!chat) {
      chat = await prisma.chat.findFirst({
        where: {
          organizationId,
          channel: 'whatsapp',
          organizationPhoneId,
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
          // Уникальное ограничение на (organizationId, channel, organizationPhoneId, remoteJid)
          const existing = await prisma.chat.findFirst({
            where: {
              organizationId,
              channel: 'whatsapp',
              organizationPhoneId,
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
        // logger.info(`✅ Учетные данные (creds) успешно загружены из БД для ${key}.`);
      } else {
        // logger.warn(`⚠️ Загруженные creds неполны для ${key}. Инициализация новых.`);
        creds = initAuthCreds();
      }
    } catch (e) {
      // logger.error(`⚠️ Ошибка парсинга creds из БД для ${key}. Инициализация новых.`, e);
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
    // logger.info(`creds не найдены в БД для ${key}, инициализация новых.`);
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
      // logger.info(`🔐 Сохранение обновленных creds в БД для ${key}.`);
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
  // logger.info(`Используется WhatsApp Web API версии: ${version.join('.')}`);

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

    logger.warn(`[Baileys] QR не был получен вовремя для ${phoneJid}. Переводим сессию в disconnected.`);

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

    // logger.info(`[ConnectionUpdate] Status for ${phoneJid}: connection=${connection}, QR_present=${!!qr}`);
    // if (lastDisconnect) {
    //   logger.info(`[ConnectionUpdate] lastDisconnect for ${phoneJid}: reason=${(lastDisconnect.error as Boom)?.output?.statusCode || lastDisconnect.error?.message || 'Неизвестно'}`);
    // }

    // Если получен QR-код
    if (qr) {
      qrResolved = true;
      clearTimeout(qrWatchdog);

      // logger.info(`[ConnectionUpdate] QR code received for ${phoneJid}. Length: ${qr.length}`);
      // Сохраняем QR-код в БД и обновляем статус
      await prisma.organizationPhone.update({
        where: { id: organizationPhoneId },
        data: { qrCode: qr, status: 'pending' },
      });

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
      // logger.info(`[Connection] Соединение закрыто для ${phoneJid}. Причина: ${lastDisconnect?.error}. Переподключение: ${shouldReconnect}`);
      
      // Удаляем сокет из Map перед попыткой переподключения или завершением
      socks.delete(organizationPhoneId);

      if (shouldReconnect) {
        await prisma.organizationPhone.update({
          where: { id: organizationPhoneId },
          data: { status: 'disconnected', qrCode: null },
        }).catch(() => undefined);

        // Задержка перед попыткой переподключения
        await new Promise(resolve => setTimeout(resolve, 3000));
        // logger.info(`[Connection] Попытка переподключения для ${phoneJid}...`);
        // Рекурсивно вызываем startBaileys для создания новой сессии
        void startBaileys(organizationId, organizationPhoneId, phoneJid).catch((err) => {
          logger.error({ err }, `[Connection] Ошибка при переподключении Baileys для ${phoneJid}`);
        });
      } else {
          // logger.error(`[Connection] Подключение для ${phoneJid} не будет переподключено (Logged out). Очистка данных сессии...`);
          // --- ДОБАВЛЕНО: Детальный лог ошибки ---
          // logger.error(`[Connection] Детали ошибки 'lastDisconnect' для ${phoneJid}:`, lastDisconnect);
          
          // --- ИСПРАВЛЕНО: Используем только номер для ключа, как в useDBAuthState ---
          const key = phoneJid.split('@')[0].split(':')[0];

          // Очищаем данные сессии из БД по правильному ключу
          await prisma.baileysAuth.deleteMany({
            where: {
              organizationId: organizationId,
              phoneJid: key, // Используем только номер
            }
          });
          // logger.info(`✅ Данные сессии для ${key} удалены из БД.`);

          // Обновляем статус в БД на 'logged_out' и очищаем QR-код
          await prisma.organizationPhone.update({
              where: { id: organizationPhoneId },
              data: { status: 'logged_out', lastConnectedAt: new Date(), qrCode: null }, 
          });
      }
    } else if (connection === 'open') {
      qrResolved = true;
      clearTimeout(qrWatchdog);

      // Если соединение открыто
      // logger.info(`✅ Подключено к WhatsApp для ${phoneJid} (Организация: ${organizationId}, Phone ID: ${organizationPhoneId})`);
      
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
        // logger.warn(`⚠️ PhoneJid ${actualPhoneJid} уже используется другим телефоном (ID: ${existingPhone.id}). Обновляем только статус.`);
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
    }
  }));

  // Обработчик обновления учетных данных
  currentSock.ev.on('creds.update', saveCreds); // Используем saveCreds для сохранения

  // ИСПРАВЛЕНИЕ: Добавляем обработчик ошибок синхронизации app state и сессий
  currentSock.ev.on('connection.update', safeAsyncListener('connection.update(recovery)', async (update) => {
    // Перехватываем ошибки синхронизации app state
    if (update.lastDisconnect?.error) {
      const error = update.lastDisconnect.error as any;
      
      // Проверяем на ошибки дешифрования в app state
      if (error?.message?.includes('bad decrypt') || 
          error?.message?.includes('error:1C800064') ||
          error?.name === 'critical_unblock_low') {
        // logger.warn(`⚠️ Обнаружена ошибка дешифрования app state для ${phoneJid}.`);
        
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
        // logger.warn(`⚠️ Обнаружена ошибка Bad MAC (libsignal) для ${phoneJid}.`);
        
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
