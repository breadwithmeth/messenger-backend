// src/controllers/accountController.ts
import { Request, Response } from 'express';
import { prisma } from '../config/authStorage';
import pino from 'pino';

const logger = pino({ level: 'info' });

/**
 * Создает новую запись о WhatsApp-номере (аккаунте) для организации.
 * @param req Запрос Express. Ожидает organizationId (из res.locals), phoneJid, displayName в теле.
 * @param res Ответ Express.
 */
export async function createAccount(req: Request, res: Response) {
  const organizationId = res.locals.organizationId;
  const { phoneJid, displayName } = req.body;

  if (!organizationId || !phoneJid || !displayName) {
    logger.warn('[createAccount] Отсутствуют необходимые параметры: organizationId, phoneJid, или displayName.');
    return res.status(400).json({ error: 'Missing organizationId, phoneJid, or displayName' });
  }

  try {
    // Проверяем, не существует ли уже такой JID для данной организации
    const existingPhone = await prisma.organizationPhone.findFirst({
        where: {
            phoneJid: phoneJid,
            organizationId: organizationId,
        },
    });

    if (existingPhone) {
        logger.warn(`[createAccount] Попытка добавить существующий номер ${phoneJid} для организации ${organizationId}.`);
        return res.status(409).json({ error: 'WhatsApp phone with this JID already exists for this organization.' });
    }

    const newPhone = await prisma.organizationPhone.create({
      data: {
        organizationId,
        phoneJid,
        displayName,
        status: 'disconnected', // Начальный статус
      },
    });
    logger.info(`✅ Создан новый аккаунт: ID ${newPhone.id}, JID ${phoneJid}, Организация ${organizationId}.`);
    res.status(201).json(newPhone);
  } catch (error: any) {
    logger.error(`❌ Ошибка при создании аккаунта для организации ${organizationId}:`, error);
    res.status(500).json({ error: 'Failed to create account', details: error.message });
  }
}
