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
  BufferJSON // <--- Этот импорт остается
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { createAuthDBAdapter, prisma, StoredDataType } from './authStorage';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { Buffer } from 'buffer';

const logger = pino({ level: 'info' });

let sock: WASocket | null = null;

interface CustomSignalStorage {
  get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T]; }>;
  set(data: SignalDataSet): Promise<void>;
  del(keys: string[]): Promise<void>;
}

export async function startBaileys(organizationId: number, phoneJid: string): Promise<WASocket> {
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
        // --- ИСПРАВЛЕНО: используем JSON.parse с BufferJSON.reviver ---
        const parsedCreds = JSON.parse(decodedCredsJsonString, BufferJSON.reviver) as AuthenticationCreds;

        if (parsedCreds.noiseKey && parsedCreds.signedIdentityKey && parsedCreds.registered !== undefined) {
          creds = parsedCreds;
          logger.info('✅ Полные учетные данные (creds) успешно загружены и распарсены из БД.');
        } else {
          logger.warn('⚠️ Загруженные creds неполны (отсутствуют noiseKey, signedIdentityKey или registered). Инициализация новых creds.');
          await authDB.delete('creds');
          creds = initAuthCreds();
        }
      } catch (e: unknown) {
        logger.error('⚠️ Ошибка парсинга creds из базы данных (Base64/JSON). Инициализация новых creds:', e);
        await authDB.delete('creds');
        creds = initAuthCreds();
      }
    } else {
      logger.warn(`Неожиданный тип creds '${credsType}'. Ожидается 'base64_json'. Удаление старых данных и инициализация новых creds.`);
      await authDB.delete('creds');
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
    logger.info('creds не найдены в БД, инициализация новых creds.');
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
              // --- ИСПРАВЛЕНО: используем JSON.parse с BufferJSON.reviver ---
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
                // --- ИСПРАВЛЕНО: используем JSON.stringify с BufferJSON.replacer ---
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

  const signalKeyStore = makeCacheableSignalKeyStore(signalStorage, logger);

  const auth: AuthenticationState = {
    creds,
    keys: signalKeyStore,
  };

  const { version } = await fetchLatestBaileysVersion();
  logger.info(`Используется WhatsApp Web API версии: ${version.join('.')}`);

  sock = makeWASocket({
    version,
    auth,
    browser: ['Ubuntu', 'Chrome', '22.04.4'],
    logger: logger,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('🔑 Новый QR-код для подключения:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.info(`Соединение закрыто, переподключение: ${shouldReconnect}`);
      if (shouldReconnect) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        startBaileys(organizationId, phoneJid);
      }
    } else if (connection === 'open') {
      logger.info(`✅ Подключено к WhatsApp для ${organizationId} / ${phoneJid}`);
    }
  });

  sock.ev.on('creds.update', async () => {
    logger.info('🔐 Учетные данные (creds) обновлены.');
    // --- ИСПРАВЛЕНО: используем JSON.stringify с BufferJSON.replacer ---
    const base64Creds = Buffer.from(JSON.stringify(creds, BufferJSON.replacer), 'utf8').toString('base64');
    await authDB.set('creds', base64Creds, 'base64_json');
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'notify') {
      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe && !msg.message.conversation && !msg.message.extendedTextMessage) continue; 

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) {
            logger.warn('🚫 Сообщение без remoteJid, пропущено.');
            continue; 
        }

        try {
            // chatID все еще требуется для связи с моделью Chat
            let senderType: string;
            let senderId: number; 

            if (msg.key.fromMe) {
                senderType = 'operator';
            } else {
                senderType = 'client';
                const participantJid = msg.key.participant || remoteJid; 
                const numericPart = parseInt(participantJid.split('@')[0]);

                if (!isNaN(numericPart)) {
                    senderId = numericPart;
                } else {
                    senderId = 0; 
                    logger.warn(`⚠️ Не удалось получить числовой senderId из JID: ${participantJid}. Установлен ID по умолчанию: ${senderId}`);
                }
                logger.info(`↙️ Полученное сообщение от клиента ${senderId} для ${phoneJid} из чата ${remoteJid}`);
            }
            
            let content: string | undefined;
            let messageType: string = "unknown"; 
            let mediaUrl: string | undefined;
            let filename: string | undefined;
            let mimeType: string | undefined;
            let size: number | undefined;

            const messageContent = msg.message;

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
                // --- ПЛЕЙСХОЛДЕР ДЛЯ СКАЧИВАНИЯ И ЗАГРУЗКИ МЕДИА ---
                // const stream = await downloadContentFromMessage(messageContent.imageMessage, 'image');
                // const buffer = await getBuffer(stream); 
                // mediaUrl = await uploadToCloudStorage(buffer, mimeType); 
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

            // Сохраняем сообщение в БД
            const savedMessage = await prisma.message.create({
                data: {
                    receivingPhoneJid: phoneJid, // <-- Прямое использование phoneJid из параметра startBaileys
                    remoteJid: remoteJid,       // <-- Прямое использование remoteJid из WhatsApp-сообщения
                    senderId: 0, 
                    content: content,
                    type: messageType,
                    mediaUrl: mediaUrl,
                    filename: filename,
                    mimeType: mimeType,
                    size: size,
                },
            });
            logger.info(`💾 Сообщение (тип: ${messageType}, ID: ${savedMessage.id}) сохранено в БД  (JID собеседника: ${remoteJid}, Ваш номер: ${phoneJid}).`);

        } catch (error: unknown) {
            logger.error(`❌ Ошибка при сохранении сообщения в БД для JID ${remoteJid} (Ваш номер: ${phoneJid}):`, error);
        }
      }}
  });

  return sock;
}

export function getBaileysSock(): WASocket {
  if (!sock) {
    throw new Error('Baileys socket не инициализирован. Пожалуйста, сначала вызовите startBaileys().');
  }
  return sock;
}

export async function sendMessage(
  jid: string,
  content: AnyMessageContent,
  options?: { quoted?: WAMessage }
): Promise<any> {
  const client = getBaileysSock();
  return await client.sendMessage(jid, content, options);
}

process.on('SIGINT', async () => {
  logger.info('Получен сигнал SIGINT. Закрытие Baileys...');
  if (sock) {
    await sock.end(new Error('Приложение завершает работу: SIGINT получен.'));
    logger.info('Baileys socket закрыт.');
  }
  await prisma.$disconnect();
  logger.info('Prisma Client отключен.');
  process.exit(0);
});