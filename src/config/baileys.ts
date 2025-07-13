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
  ConnectionState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { createAuthDBAdapter, prisma, StoredDataType } from './authStorage';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { Buffer } from 'buffer';
import * as fs from 'fs/promises'; // Для работы с файловой системой (удаление папок)
import path from 'path'; // Для работы с путями файлов

const logger = pino({ level: 'info' });

// Глобальная Map для хранения активных экземпляров WASocket по organizationPhoneId
const socks = new Map<number, WASocket>(); 

// Интерфейс для кастомного хранилища сигналов
interface CustomSignalStorage {
  get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T]; }>;
  set(data: SignalDataSet): Promise<void>;
  del(keys: string[]): Promise<void>;
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
  name?: string
): Promise<number> {
    try {
        const normalizedRemoteJid = jidNormalizedUser(remoteJid);

        let chat = await prisma.chat.findUnique({
            where: {
                organizationId_receivingPhoneJid_remoteJid: {
                    organizationId,
                    receivingPhoneJid: jidNormalizedUser(receivingPhoneJid),
                    remoteJid: normalizedRemoteJid,
                },
            },
        });

        if (!chat) {
            chat = await prisma.chat.create({
                data: {
                    organizationId,
                    receivingPhoneJid: jidNormalizedUser(receivingPhoneJid),
                    remoteJid: normalizedRemoteJid,
                    organizationPhoneId: organizationPhoneId,
                    name: name || normalizedRemoteJid.split('@')[0],
                    isGroup: isJidGroup(normalizedRemoteJid),
                    lastMessageAt: new Date(),
                },
            });
            logger.info(`✅ Создан новый чат для JID: ${normalizedRemoteJid} (Ваш номер: ${receivingPhoneJid}, Организация: ${organizationId}, Phone ID: ${organizationPhoneId}, ID чата: ${chat.id})`);
        } else {
             await prisma.chat.update({
                where: { id: chat.id },
                data: { lastMessageAt: new Date() },
            });
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
 * Запускает или перезапускает Baileys сессию для указанного телефона организации.
 * @param organizationId ID организации.
 * @param organizationPhoneId ID телефона организации в вашей БД.
 * @param phoneJid JID номера телефона WhatsApp (например, '77051234567@s.whatsapp.net').
 * @returns Экземпляр WASocket.
 */
export async function startBaileys(organizationId: number, organizationPhoneId: number, phoneJid: string): Promise<WASocket> {
  // Определяем путь к папке с auth-данными для конкретного JID
  const authFolderPath = `./baileys_auth_info/${phoneJid}`;

  // Создаем адаптер для хранения данных авторизации в вашей БД
  const authDB = createAuthDBAdapter(organizationId, phoneJid); 

  let creds: AuthenticationCreds;

  // 1. Попытка загрузить весь объект creds из БД
  const storedCredsData = await authDB.get('creds');
  if (storedCredsData) {
    const credsValueString = storedCredsData.value;
    const credsType = storedCredsData.type;

    if (credsType === 'base64_json') {
      try {
        const decodedCredsJsonString = Buffer.from(credsValueString, 'base64').toString('utf8');
        const parsedCreds = JSON.parse(decodedCredsJsonString, BufferJSON.reviver) as AuthenticationCreds;

        // Проверяем полноту загруженных учетных данных
        if (parsedCreds.noiseKey && parsedCreds.signedIdentityKey && parsedCreds.registered !== undefined) {
          creds = parsedCreds;
          logger.info(`✅ Полные учетные данные (creds) успешно загружены и распарсены из БД для ${phoneJid}.`);
        } else {
          logger.warn(`⚠️ Загруженные creds неполны для ${phoneJid}. Инициализация новых creds.`);
          await authDB.delete('creds'); // Удаляем неполные creds
          creds = initAuthCreds();
        }
      } catch (e: unknown) {
        logger.error(`⚠️ Ошибка парсинга creds из базы данных (Base64/JSON) для ${phoneJid}. Инициализация новых creds:`, e);
        await authDB.delete('creds'); // Удаляем некорректные creds
        creds = initAuthCreds();
      }
    } else {
      logger.warn(`Неожиданный тип creds '${credsType}' для ${phoneJid}. Ожидается 'base64_json'. Удаление старых данных и инициализация новых creds.`);
      await authDB.delete('creds'); // Удаляем creds с неправильным типом
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
    logger.info(`creds не найдены в БД для ${phoneJid}, инициализация новых creds.`);
  }

  // 2. Создаем SignalStorage для всех остальных ключей (pre-keys, session keys, etc.)
  const signalStorage: CustomSignalStorage = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T]; }> {
      const data: { [id: string]: SignalDataTypeMap[T]; } = {};
      for (const id of ids.filter(id => id)) {
        const dbKey = `${type}-${id}`;
        const storedData = await authDB.get(dbKey);

        if (storedData) {
          const valueString = storedData.value;
          const dataType = storedData.type;

          try {
            if (dataType === 'json' || dataType === 'base64_json') {
              const decodedString = dataType === 'base64_json' ? Buffer.from(valueString, 'base64').toString('utf8') : valueString;
              data[id] = JSON.parse(decodedString, BufferJSON.reviver) as unknown as SignalDataTypeMap[T];
            } else if (dataType === 'buffer') {
              data[id] = Buffer.from(valueString, 'base64') as unknown as SignalDataTypeMap[T];
            }
          } catch (e) {
            logger.warn(`Ошибка при получении/парсинге ключа ${dbKey}:`, e);
          }
        }
      }
      return data;
    },

    async set(data: SignalDataSet): Promise<void> {
      for (const _key in data) {
        const type = _key as string;
        const subData = data[_key as keyof SignalDataTypeMap];

        if (subData) {
          for (const id in subData) {
            const dbKey = `${type}-${id}`;
            const value = subData[id];

            let valueToStore: string;
            let dataType: StoredDataType;

            if (value !== null) {
              if (value instanceof Buffer) {
                valueToStore = value.toString('base64');
                dataType = 'buffer';
              } else {
                valueToStore = Buffer.from(JSON.stringify(value, BufferJSON.replacer), 'utf8').toString('base64');
                dataType = 'base64_json';
              }
              await authDB.set(dbKey, valueToStore, dataType);
            } else {
              await authDB.delete(dbKey);
            }
          }
        }
      }
    },

    async del(keys: string[]): Promise<void> {
      for (const key of keys) {
        await authDB.delete(key);
      }
    },
  };

  // Создаем кэшируемое хранилище ключей для Baileys
  const signalKeyStore = makeCacheableSignalKeyStore(signalStorage, logger);

  // Формируем объект авторизации для Baileys
  const auth: AuthenticationState = {
    creds,
    keys: signalKeyStore,
  };

  // Получаем последнюю версию WhatsApp Web API
  const { version } = await fetchLatestBaileysVersion();
  logger.info(`Используется WhatsApp Web API версии: ${version.join('.')}`);

  // Создаем новый экземпляр Baileys WASocket
  const currentSock = makeWASocket({ 
    version,
    auth,
    browser: ['Ubuntu', 'Chrome', '22.04.4'], // Устанавливаем информацию о браузере
    logger: logger, // Используем ваш pino logger
    // Функция для получения сообщений из кэша или БД (для Baileys)
    getMessage: async (key) => {
        logger.debug(`Попытка получить сообщение из getMessage: ${key.id} от ${key.remoteJid}`);
        const msg = await prisma.message.findUnique({
            where: { whatsappMessageId: key.id || '' },
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

  // Обработчик событий обновления соединения
  currentSock.ev.on('connection.update', async (update: Partial<ConnectionState>) => { 
    const { connection, lastDisconnect, qr } = update;

    logger.info(`[ConnectionUpdate] Status for ${phoneJid}: connection=${connection}, QR_present=${!!qr}`);
    if (lastDisconnect) {
      logger.info(`[ConnectionUpdate] lastDisconnect for ${phoneJid}: reason=${(lastDisconnect.error as Boom)?.output?.statusCode || lastDisconnect.error?.message || 'Неизвестно'}`);
    }

    // Если получен QR-код
    if (qr) {
      logger.info(`[ConnectionUpdate] QR code received for ${phoneJid}. Length: ${qr.length}`);
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
      logger.info(`[ConnectionUpdate] No QR code in this update for ${phoneJid}.`);
    }

    // Если соединение закрыто
    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.info(`[Connection] Соединение закрыто для ${phoneJid}. Причина: ${lastDisconnect?.error}. Переподключение: ${shouldReconnect}`);
      
      // Удаляем сокет из Map перед попыткой переподключения или завершением
      socks.delete(organizationPhoneId);

      if (shouldReconnect) {
        // Задержка перед попыткой переподключения
        await new Promise(resolve => setTimeout(resolve, 3000));
        logger.info(`[Connection] Попытка переподключения для ${phoneJid}...`);
        // Рекурсивно вызываем startBaileys для создания новой сессии
        startBaileys(organizationId, organizationPhoneId, phoneJid);
      } else {
          logger.error(`[Connection] Подключение для ${phoneJid} не будет переподключено (Logged out).`);
          
          // Удаляем папку с файлами авторизации при выходе из системы
          try {
            const fullAuthPath = path.resolve(authFolderPath);
            const stats = await fs.stat(fullAuthPath).catch(() => null); 
            if (stats && stats.isDirectory()) {
              await fs.rm(fullAuthPath, { recursive: true, force: true });
              logger.info(`✅ Успешно удалена папка авторизации: ${fullAuthPath}`);
            } else {
              logger.info(`Папка авторизации ${fullAuthPath} не существует или не является директорией. Пропуск удаления.`);
            }
          } catch (error) {
            logger.error(`❌ Ошибка при удалении папки авторизации ${authFolderPath}: ${error}`);
          }

          // Обновляем статус в БД на 'logged_out' и очищаем QR-код
          await prisma.organizationPhone.update({
              where: { id: organizationPhoneId },
              data: { status: 'logged_out', lastConnectedAt: new Date(), qrCode: null }, 
          });
      }
    } else if (connection === 'open') {
      // Если соединение открыто
      logger.info(`✅ Подключено к WhatsApp для ${phoneJid} (Организация: ${organizationId}, Phone ID: ${organizationPhoneId})`);
      // Обновляем статус в БД на 'connected', сохраняем фактический JID и очищаем QR-код
      await prisma.organizationPhone.update({
          where: { id: organizationPhoneId },
          data: { status: 'connected', phoneJid: currentSock?.user?.id || phoneJid, lastConnectedAt: new Date(), qrCode: null }, 
      });
    }
  });

  // Обработчик обновления учетных данных
  currentSock.ev.on('creds.update', async () => { 
    logger.info(`🔐 Учетные данные (creds) обновлены для ${phoneJid}.`);
    const base64Creds = Buffer.from(JSON.stringify(creds, BufferJSON.replacer), 'utf8').toString('base64');
    await authDB.set('creds', base64Creds, 'base64_json');
  });

  // Обработчик получения новых сообщений
  currentSock.ev.on('messages.upsert', async ({ messages, type }) => { 
    if (type === 'notify') {
      for (const msg of messages) {
        // Пропускаем сообщения без контента или если это наше исходящее сообщение, не имеющее видимого контента
        if (!msg.message) continue;
        if (msg.key.fromMe && !msg.message.conversation && !msg.message.extendedTextMessage && !msg.message.imageMessage && !msg.message.videoMessage && !msg.message.documentMessage && !msg.message.audioMessage && !msg.message.stickerMessage) continue;

        const remoteJid = jidNormalizedUser(msg.key.remoteJid || '');
        if (!remoteJid) {
            logger.warn('🚫 Сообщение без remoteJid, пропущено.');
            continue;
        }

        // Пропускаем широковещательные сообщения и статусы
        if (isJidBroadcast(remoteJid) || remoteJid === 'status@broadcast') {
            logger.info(`Пропускаем широковещательное сообщение или статус от ${remoteJid}.`);
            continue;
        }

        try {
            const senderJid = jidNormalizedUser(msg.key.fromMe ? (currentSock?.user?.id || phoneJid) : (msg.key.participant || remoteJid));

            let content: string | undefined;
            let messageType: string = "unknown";
            let mediaUrl: string | undefined;
            let filename: string | undefined;
            let mimeType: string | undefined;
            let size: number | undefined;

            const messageContent = msg.message;

            // Разбор различных типов сообщений
            if (messageContent?.conversation) {
                content = messageContent.conversation;
                messageType = "text";
            } else if (messageContent?.extendedTextMessage) {
                content = messageContent.extendedTextMessage.text || undefined;
                messageType = "text";
            } else if (messageContent?.imageMessage) {
                messageType = "image";
                content = messageContent.imageMessage.caption || undefined;
                mimeType = messageContent.imageMessage.mimetype || undefined;
                size = Number(messageContent.imageMessage.fileLength) || undefined;
                logger.info(`  [${messageType}] Содержимое: "${content || 'без подписи'}". MIME: ${mimeType}. Размер: ${size}.`);
            } else if (messageContent?.videoMessage) {
                messageType = "video";
                content = messageContent.videoMessage.caption || undefined;
                mimeType = messageContent.videoMessage.mimetype || undefined;
                size = Number(messageContent.videoMessage.fileLength) || undefined;
                logger.info(`  [${messageType}] Содержимое: "${content || 'без подписи'}". MIME: ${mimeType}. Размер: ${size}.`);
            } else if (messageContent?.documentMessage) {
                messageType = "document";
                filename = messageContent.documentMessage.fileName || undefined;
                mimeType = messageContent.documentMessage.mimetype || undefined;
                size = Number(messageContent.documentMessage.fileLength) || undefined;
                logger.info(`  [${messageType}] Документ: "${filename || 'без имени'}". MIME: ${mimeType}. Размер: ${size}.`);
            } else if (messageContent?.audioMessage) {
                messageType = "audio";
                mimeType = messageContent.audioMessage.mimetype || undefined;
                size = Number(messageContent.audioMessage.fileLength) || undefined;
                logger.info(`  [${messageType}] Аудио. MIME: ${mimeType}. Размер: ${size}.`);
            } else if (messageContent?.stickerMessage) {
                messageType = "sticker";
                mimeType = messageContent.stickerMessage.mimetype || undefined;
                size = Number(messageContent.stickerMessage.fileLength) || undefined;
                logger.info(`  [${messageType}] Стикер. MIME: ${mimeType}. Размер: ${size}.`);
            } else if (messageContent?.locationMessage) {
                messageType = "location";
                content = `Latitude: ${messageContent.locationMessage.degreesLatitude}, Longitude: ${messageContent.locationMessage.degreesLongitude}`;
                logger.info(`  [${messageType}] Локация: ${content}`);
            } else if (messageContent?.contactMessage) {
                messageType = "contact";
                content = `Контакт: ${messageContent.contactMessage.displayName || messageContent.contactMessage.vcard}`;
                logger.info(`  [${messageType}] Контакт: ${content}`);
            } else if (messageContent?.contactsArrayMessage) {
                messageType = "contacts_array";
                content = `Контакты: ${messageContent.contactsArrayMessage.contacts?.map(c => c.displayName || c.vcard).join(', ') || 'пусто'}`;
                logger.info(`  [${messageType}] Контакты: ${content}`);
            }

            if (messageType === "unknown" && Object.keys(messageContent || {}).length > 0) {
                messageType = Object.keys(messageContent || {})[0];
                logger.warn(`  [${messageType}] Неподдерживаемый или неизвестный тип сообщения. JID: ${remoteJid}`);
            } else if (messageType === "unknown") {
                 logger.warn(`  [Неизвестный] Сообщение без опознаваемого типа контента. JID: ${remoteJid}`);
            }

            // Преобразование timestamp в Date
            const timestampDate = new Date(
              (typeof msg.messageTimestamp === 'object' && msg.messageTimestamp !== null && 'toNumber' in msg.messageTimestamp
                ? (msg.messageTimestamp as Long).toNumber()
                : (msg.messageTimestamp || 0)) * 1000
            );

            // Сохраняем сообщение в БД
            const savedMessage = await prisma.message.create({
                data: {
                    chatId: await ensureChat(organizationId, organizationPhoneId, phoneJid, remoteJid), // Вызов ensureChat
                    organizationPhoneId: organizationPhoneId,
                    receivingPhoneJid: phoneJid,
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
                },
            });
            logger.info(`💾 Сообщение (тип: ${messageType}, ID: ${savedMessage.id}) сохранено в БД (JID собеседника: ${remoteJid}, Ваш номер: ${phoneJid}, chatId: ${savedMessage.chatId}).`);

        } catch (error:any) {
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
      }
    }
  });

  return currentSock; // Возвращаем созданный сокет
}

/**
 * Возвращает активный экземпляр WASocket по ID телефона организации.
 * @param organizationPhoneId ID телефона организации.
 * @returns Экземпляр WASocket или null, если не найден.
 */
export function getBaileysSock(organizationPhoneId: number): WASocket | null {
  logger.info(`[getBaileysSock] Запрошен organizationPhoneId: ${organizationPhoneId}`);
  logger.info(`[getBaileysSock] Ключи в socks Map: [${Array.from(socks.keys()).join(', ')}]`);
  const sock = socks.get(organizationPhoneId);
  if (!sock) {
    logger.warn(`[getBaileysSock] Сокет не найден для organizationPhoneId: ${organizationPhoneId}`);
  } else {
    logger.info(`[getBaileysSock] Сокет найден для organizationPhoneId: ${organizationPhoneId}. JID сокета: ${sock.user?.id || 'Неизвестно'}`);
  }
  return sock || null;
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
  senderJid: string // Добавляем senderJid (ваш номер)
) {
  if (!sock || !sock.user) {
    throw new Error('Baileys socket is not connected or user is not defined.');
  }

  try {
    const sentMessage = await sock.sendMessage(jid, content);

    // --- НАЧАЛО НОВОГО КОДА ДЛЯ СОХРАНЕНИЯ ---
    if (sentMessage) {
      const remoteJid = jidNormalizedUser(jid); // JID получателя
      const type = 'text'; // Предполагаем текстовое сообщение, но можно расширить
      const messageContent = (content as { text?: string })?.text || '';

      // Получаем chatId для сохранения сообщения
      const chatId = await ensureChat(organizationId, organizationPhoneId, senderJid, remoteJid);

      await prisma.message.create({
        data: {
          chatId: chatId,
          organizationPhoneId: organizationPhoneId,
          receivingPhoneJid: senderJid, // Ваш номер телефона
          remoteJid: remoteJid, // JID получателя
          whatsappMessageId: sentMessage.key.id || `_out_${Date.now()}_${Math.random()}`,
          senderJid: jidNormalizedUser(sock.user?.id || senderJid), // JID отправителя (ваш аккаунт)
          fromMe: true, // Это сообщение отправлено "от меня"
          content: messageContent,
          type: type,
          timestamp: new Date(),
          status: 'sent', // Статус "отправлено"
          organizationId: organizationId,
          // Добавьте сюда поля для медиа, если sendMessage будет поддерживать их
          // mediaUrl: ...,
          // filename: ...,
          // mimeType: ...,
          // size: ...,
        },
      });
      logger.info(`✅ Исходящее сообщение "${messageContent}" (ID: ${sentMessage.key.id}) сохранено в БД. Chat ID: ${chatId}`);
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