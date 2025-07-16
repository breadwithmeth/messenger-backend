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

const logger = pino({ level: 'info' });

// Глобальная Map для хранения активных экземпляров WASocket по organizationPhoneId
const socks = new Map<number, WASocket>(); 

// Интерфейс для кастомного хранилища сигналов
interface CustomSignalStorage {
  get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T]; }>;
  set(data: SignalDataSet): Promise<void>;
  del(keys: string[]): Promise<void>;
}

// --- НОВАЯ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ---
/**
 * Скачивает медиа из сообщения и сохраняет его локально.
 * @param messageContent Содержимое сообщения (например, imageMessage).
 * @param type Тип медиа ('image', 'video', 'audio', 'document').
 * @param originalFilename Имя файла (для документов).
 * @returns Путь к сохраненному файлу для использования в URL.
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

    const mediaDir = path.join(__dirname, '..', '..', 'public', 'media');
    await fs.mkdir(mediaDir, { recursive: true });

    const extension = path.extname(originalFilename || '') || `.${messageContent.mimetype?.split('/')[1] || 'bin'}`;
    const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${extension}`;
    const filePath = path.join(mediaDir, uniqueFilename);

    await fs.writeFile(filePath, buffer);
    logger.info(`✅ Медиафайл сохранен: ${filePath}`);

    // Возвращаем относительный URL-путь
    return `/media/${uniqueFilename}`;
  } catch (error) {
    logger.error('❌ Ошибка при скачивании или сохранении медиа:', error);
    return undefined;
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
        logger.info(`✅ Учетные данные (creds) успешно загружены из БД для ${key}.`);
      } else {
        logger.warn(`⚠️ Загруженные creds неполны для ${key}. Инициализация новых.`);
        creds = initAuthCreds();
      }
    } catch (e) {
      logger.error(`⚠️ Ошибка парсинга creds из БД для ${key}. Инициализация новых.`, e);
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
    logger.info(`creds не найдены в БД для ${key}, инициализация новых.`);
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
      logger.info(`🔐 Сохранение обновленных creds в БД для ${key}.`);
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
  logger.info(`Используется WhatsApp Web API версии: ${version.join('.')}`);

  // Создаем новый экземпляр Baileys WASocket
  const currentSock = makeWASocket({ 
    version,
    auth: state, // Используем состояние из useDBAuthState
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
          logger.error(`[Connection] Подключение для ${phoneJid} не будет переподключено (Logged out). Очистка данных сессии...`);
          // --- ДОБАВЛЕНО: Детальный лог ошибки ---
          logger.error(`[Connection] Детали ошибки 'lastDisconnect' для ${phoneJid}:`, lastDisconnect);
          
          // --- ИСПРАВЛЕНО: Используем только номер для ключа, как в useDBAuthState ---
          const key = phoneJid.split('@')[0].split(':')[0];

          // Очищаем данные сессии из БД по правильному ключу
          await prisma.baileysAuth.deleteMany({
            where: {
              organizationId: organizationId,
              phoneJid: key, // Используем только номер
            }
          });
          logger.info(`✅ Данные сессии для ${key} удалены из БД.`);

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
  currentSock.ev.on('creds.update', saveCreds); // Используем saveCreds для сохранения

  // Обработчик получения новых сообщений
  currentSock.ev.on('messages.upsert', async ({ messages, type }) => { 
    if (type === 'notify') {
      for (const msg of messages) {
        // Пропускаем сообщения без контента или если это наше исходящее сообщение, не имеющее видимого контента
        if (!msg.message) {
            logger.info(`[Message Upsert] Пропущено сообщение без контента (ID: ${msg.key.id})`);
            continue;
        }
        if (msg.key.fromMe && !msg.message.conversation && !msg.message.extendedTextMessage && !msg.message.imageMessage && !msg.message.videoMessage && !msg.message.documentMessage && !msg.message.audioMessage && !msg.message.stickerMessage) {
            logger.info(`[Message Upsert] Пропущено исходящее системное сообщение (ID: ${msg.key.id})`);
            continue;
        }

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
            // --- НОВЫЕ ПЕРЕМЕННЫЕ ДЛЯ ОТВЕТОВ ---
            let quotedMessageId: string | undefined;
            let quotedContent: string | undefined;

            const messageContent = msg.message;
            console.log(messageContent.extendedTextMessage?.contextInfo?.quotedMessage)
            // Разбор различных типов сообщений
            if (messageContent?.conversation) {
                content = messageContent.conversation;
                messageType = "text";
                logger.info(`  [${messageType}] Содержимое: "${content}"`);
            } else if (messageContent?.extendedTextMessage) {
                content = messageContent.extendedTextMessage.text || undefined;
                messageType = "text";
                
                // --- НАЧАЛО: ОБРАБОТКА ОТВЕТА ---
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
                    logger.info(`  [reply] Ответ на сообщение ID: ${quotedMessageId}`);
                }
                // --- КОНЕЦ: ОБРАБОТКА ОТВЕТА ---

                logger.info(`  [${messageType}] Содержимое: "${content}"`);
            } else if (messageContent?.imageMessage) {
                messageType = "image";
                content = messageContent.imageMessage.caption || undefined;
                mimeType = messageContent.imageMessage.mimetype || undefined;
                size = Number(messageContent.imageMessage.fileLength) || undefined;
                // --- СКАЧИВАНИЕ И СОХРАНЕНИЕ ФОТО ---
                mediaUrl = await downloadAndSaveMedia(messageContent.imageMessage, 'image');
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
                // --- СКАЧИВАНИЕ И СОХРАНЕНИЕ ДОКУМЕНТА ---
                mediaUrl = await downloadAndSaveMedia(messageContent.documentMessage, 'document', filename);
                logger.info(`  [${messageType}] Документ: "${filename || 'без имени'}". MIME: ${mimeType}. Размер: ${size}.`);
            } else if (messageContent?.audioMessage) {
                messageType = "audio";
                mimeType = messageContent.audioMessage.mimetype || undefined;
                size = Number(messageContent.audioMessage.fileLength) || undefined;
                // --- СКАЧИВАНИЕ И СОХРАНЕНИЕ АУДИО ---
                mediaUrl = await downloadAndSaveMedia(messageContent.audioMessage, 'audio');
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
            } else if (messageContent?.liveLocationMessage) {
                messageType = "live_location";
                content = `Live Location: Capt=${messageContent.liveLocationMessage.caption || 'N/A'}, Seq=${messageContent.liveLocationMessage.sequenceNumber}`;
                logger.info(`  [${messageType}] ${content}`);
            } else if (messageContent?.contactMessage) {
                messageType = "contact";
                content = `Контакт: ${messageContent.contactMessage.displayName || messageContent.contactMessage.vcard}`;
                logger.info(`  [${messageType}] Контакт: ${content}`);
            } else if (messageContent?.contactsArrayMessage) {
                messageType = "contacts_array";
                content = `Контакты: ${messageContent.contactsArrayMessage.contacts?.map(c => c.displayName || c.vcard).join(', ') || 'пусто'}`;
                logger.info(`  [${messageType}] Контакты: ${content}`);
            } else if (messageContent?.reactionMessage) {
                messageType = "reaction";
                content = `Реакция "${messageContent.reactionMessage.text}" на сообщение ${messageContent.reactionMessage.key?.id}`;
                logger.info(`  [${messageType}] ${content}`);
            } else if (messageContent?.protocolMessage) {
                messageType = "protocol";
                content = `Системное сообщение (тип: ${messageContent.protocolMessage.type})`;
                logger.info(`  [${messageType}] ${content}`);
            } else if (messageContent?.call) {
                messageType = "call";
                const callId = messageContent.call.callKey ? Buffer.from(messageContent.call.callKey).toString('hex') : 'unknown';
                content = `Звонок от ${senderJid} (ID: ${callId})`;
                logger.info(`  [${messageType}] ${content}`);
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
                    // --- СОХРАНЕНИЕ ДАННЫХ ОТВЕТОВ ---
                    quotedMessageId: quotedMessageId,
                    quotedContent: quotedContent,
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
  senderJid: string, // Добавляем senderJid (ваш номер)
  userId?: number // <-- ДОБАВЛЕН userId (опционально)
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

      // --- НАЧАЛО: УЛУЧШЕННАЯ ПРОВЕРКА И ЛОГИРОВАНИЕ userId ---
      logger.info(`[sendMessage] Проверка userId перед сохранением. Полученное значение: ${userId}, тип: ${typeof userId}`);

      const messageData: any = {
        chatId: chatId,
        organizationPhoneId: organizationPhoneId,
        receivingPhoneJid: senderJid,
        remoteJid: remoteJid,
        whatsappMessageId: sentMessage.key.id || `_out_${Date.now()}_${Math.random()}`,
        senderJid: jidNormalizedUser(sock.user?.id || senderJid),
        fromMe: true,
        content: messageContent,
        type: type,
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
          isUserIdNumber: typeof userId === 'number'
      }, 'Полные данные для сохранения исходящего сообщения.');


      await prisma.message.create({
        data: messageData,
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