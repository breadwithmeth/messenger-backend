// src/controllers/messageController.ts

import { Request, Response } from 'express';
import { getBaileysSock } from '../config/baileys'; 
import { AnyMessageContent } from '@whiskeysockets/baileys'; 
import pino from 'pino';
import { prisma } from '../config/authStorage';
// import { ensureChat } from '../config/baileys'; // Убедитесь, что ensureChat экспортируется из baileys.ts

const logger = pino({ level: 'info' });

// ID вашего внутреннего бота/системного пользователя.
// Используется, если ваш бот сам по себе считается "оператором",
// но не является конкретным пользователем, вошедшим через API.
const BOT_SYSTEM_USER_ID = 1; // Замените на фактический ID системного пользователя в вашей таблице User, если применимо

/**
 * Вспомогательная функция для поиска или создания записи клиента в БД.
 * @param whatsappJid WhatsApp JID клиента
 * @returns ID клиента из вашей БД.
 */
// async function ensureClient(whatsappJid: string): Promise<number> {
//     let client = await prisma.client.findUnique({
//         where: { whatsappJid: whatsappJid },
//     });

//     if (!client) {
//         client = await prisma.client.create({
//             data: { 
//                 whatsappJid: whatsappJid,
//                 name: whatsappJid.split('@')[0] 
//             },
//         });
//         logger.info(`✅ Создан новый клиент с JID: ${whatsappJid}, ID: ${client.id}`);
//     }
//     return client.id;
// }


/**
 * Отправляет текстовое сообщение по указанному JID и записывает отправителя.
 * @param req Request - должен содержать { jid: string, message: string, phoneNumber: string }
 * @param res Response
 */
export const sendTextMessage = async (req: Request, res: Response) => {
    const sentByUserId = res.locals.userId; 
  const { jid, message, phoneNumber } = req.body; 

  if (!jid || !message || !phoneNumber || sentByUserId === undefined) {
    return res.status(400).json({ error: 'Требуются поля jid, message, phoneNumber, и пользователь должен быть авторизован.' });
  }

  try {
    const sock = getBaileysSock(); 

    if (!sock) {
      return res.status(404).json({ error: `Аккаунт с номером ${phoneNumber} неактивен или не найден.` });
    }

    const content: AnyMessageContent = { text: message };

    logger.info(`Попытка отправить сообщение от пользователя ${sentByUserId} (через аккаунт ${phoneNumber}) на ${jid}: "${message}"`);

    const result = await sock.sendMessage(jid, content);

    // --- Сохранение исходящего сообщения в БД ---
    // const chatId = await ensureChat(jid, phoneNumber); 

    await prisma.message.create({
      data: {
        receivingPhoneJid: phoneNumber,     // Ваш номер телефона (аккаунт, с которого отправлено)
        remoteJid: jid,                     // JID получателя
        senderId: sentByUserId,             // <-- ЗДЕСЬ АЙДИ ПОЛЬЗОВАТЕЛЯ (оператора)
        content: message,
        type: 'text',
      },
    });
    logger.info(`💾 Исходящее текстовое сообщение (ID оператора: ${sentByUserId}) сохранено в БД.`);

    res.status(200).json({
      message: 'Сообщение успешно отправлено.',
      result: result,
      sentFrom: phoneNumber,
    });
  } catch (error: any) {
    logger.error(`Ошибка при отправке текстового сообщения: ${error.message}`);
    res.status(500).json({
      error: 'Не удалось отправить текстовое сообщение.',
      details: error.message,
    });
  }
};

/**
 * Отправляет медиа-сообщение по указанному JID и записывает отправителя.
 * @param req Request - должен содержать { jid: string, type: 'image' | 'video' | 'document' | 'audio', url: string, caption?: string, filename?: string, phoneNumber: string }
 * @param res Response
 */
export const sendMediaMessage = async (req: Request, res: Response) => {
  const sentByUserId = res.locals.userId; 
  const { jid, type, url, caption, filename, phoneNumber } = req.body;

  if (!jid || !type || !url || !phoneNumber || sentByUserId === undefined) {
    return res.status(400).json({ error: 'Требуются поля jid, type, url, phoneNumber, и пользователь должен быть авторизован.' });
  }

  try {
    const sock = getBaileysSock(); 

    if (!sock) {
      return res.status(404).json({ error: `Аккаунт с номером ${phoneNumber} неактивен или не найден.` });
    }

    let content: AnyMessageContent;
    let messageType: string;

    switch (type) {
      case 'image':
        content = { image: { url: url }, caption: caption };
        messageType = 'image';
        break;
      case 'video':
        content = { video: { url: url }, caption: caption };
        messageType = 'video';
        break;
      case 'document':
        // Baileys requires mimetype for documents
        // For simplicity, we'll use a generic one if not provided.
        content = { document: { url: url }, fileName: filename || 'document', mimetype: 'application/octet-stream' };
        messageType = 'document';
        break;
      case 'audio':
        content = { audio: { url: url } };
        messageType = 'audio';
        break;
      default:
        return res.status(400).json({ error: 'Неподдерживаемый тип медиа.' });
    }

    logger.info(`Попытка отправить медиа-сообщение (${type}) от пользователя ${sentByUserId} (через аккаунт ${phoneNumber}) на ${jid}.`);

    const result = await sock.sendMessage(jid, content);

    // --- Сохранение исходящего медиа-сообщения в БД ---
    // const chatId = await ensureChat(jid, phoneNumber); 

    await prisma.message.create({
      data: {
        receivingPhoneJid: phoneNumber,
        remoteJid: jid,
        senderId: sentByUserId, // <-- ЗДЕСЬ АЙДИ ПОЛЬЗОВАТЕЛЯ (оператора)
        content: caption, 
        type: messageType,
        mediaUrl: url,
        filename: filename,
      },
    });
    logger.info(`💾 Исходящее медиа-сообщение (ID оператора: ${sentByUserId}) сохранено в БД.`);

    res.status(200).json({
      message: `${type} успешно отправлено.`,
      result: result,
      sentFrom: phoneNumber,
    });
  } catch (error: any) {
    logger.error(`Ошибка при отправке медиа-сообщения: ${error.message}`);
    res.status(500).json({
      error: 'Не удалось отправить медиа-сообщение.',
      details: error.message,
    });
  }
};