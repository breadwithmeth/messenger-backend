// src/controllers/organizationPhoneController.ts
import { Request, Response } from 'express';
import { prisma } from '../config/authStorage';
import { startBaileys, getBaileysSock } from '../config/baileys';
import pino from 'pino';
import WebSocket from 'ws'; 
const logger = pino({ level: 'info' });

/**
 * Создает новую запись о WhatsApp-номере для организации.
 * @param req Запрос Express. Ожидает organizationId (из res.locals), phoneJid, displayName в теле.
 * @param res Ответ Express.
 */
export async function createOrganizationPhone(req: Request, res: Response) {
  const organizationId = res.locals.organizationId;
  const { phoneJid, displayName } = req.body;

  if (!organizationId || !phoneJid || !displayName) {
    logger.warn('[createOrganizationPhone] Отсутствуют необходимые параметры: organizationId, phoneJid, или displayName.');
    return res.status(400).json({ error: 'Missing organizationId, phoneJid, or displayName' });
  }

  try {
    // Проверяем, не существует ли уже такой JID для данной организации
    const existingPhone = await prisma.organizationPhone.findUnique({
    where: {
        phoneJid: phoneJid,
            organizationId: organizationId,

        },
    },)

    if (existingPhone) {
        logger.warn(`[createOrganizationPhone] Попытка добавить существующий номер ${phoneJid} для организации ${organizationId}.`);
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
    logger.info(`✅ Создан новый телефон организации: ID ${newPhone.id}, JID ${phoneJid}, Организация ${organizationId}.`);
    res.status(201).json(newPhone);
  } catch (error: any) {
    logger.error(`❌ Ошибка при создании телефона организации для ${organizationId}:`, error);
    res.status(500).json({ error: 'Failed to create organization phone', details: error.message });
  }
}

/**
 * Получает список всех WhatsApp-номеров, связанных с организацией.
 * Включает статус и QR-код (если доступен).
 * @param req Запрос Express. Ожидает organizationId (из res.locals).
 * @param res Ответ Express.
 */
export async function listOrganizationPhones(req: Request, res: Response) {
    const organizationId = res.locals.organizationId;

    if (!organizationId) {
        logger.warn('[listOrganizationPhones] organizationId не определен в res.locals.');
        return res.status(400).json({ error: 'organizationId is required.' });
    }

    try {
        const phones = await prisma.organizationPhone.findMany({
            where: { organizationId: organizationId },
            // Выбираем только необходимые поля, чтобы не передавать лишние данные
            select: {
                id: true,
                phoneJid: true,
                displayName: true,
                status: true,
                qrCode: true, // Включаем QR-код
                lastConnectedAt: true,
                createdAt: true,
                updatedAt: true,
            }
        });
        logger.info(`✅ Получено ${phones.length} телефонов для организации ${organizationId}.`);
        res.status(200).json(phones);
    } catch (error: any) {
        logger.error(`❌ Ошибка при получении списка телефонов для организации ${organizationId}:`, error);
        res.status(500).json({ error: 'Failed to retrieve organization phones', details: error.message });
    }
}

/**
 * Инициирует подключение WhatsApp-номера к Baileys.
 * Если номер еще не подключен, запускает процесс получения QR-кода.
 * @param req Запрос Express. Ожидает organizationId (из res.locals), organizationPhoneId в параметрах маршрута.
 * @param res Ответ Express.
 */
export async function connectOrganizationPhone(req: Request, res: Response) {
  const organizationId = res.locals.organizationId;
  const organizationPhoneId = parseInt(req.params.organizationPhoneId as string, 10);

  if (!organizationId || isNaN(organizationPhoneId)) {
    logger.warn('[connectOrganizationPhone] Отсутствуют или некорректны organizationId или organizationPhoneId.');
    return res.status(400).json({ error: 'Missing organizationId or invalid organizationPhoneId' });
  }

  try {
    const phone = await prisma.organizationPhone.findUnique({
      where: { id: organizationPhoneId, organizationId: organizationId },
    });

    if (!phone) {
      logger.warn(`[connectOrganizationPhone] Телефон с ID ${organizationPhoneId} не найден или не принадлежит организации ${organizationId}.`);
      return res.status(404).json({ error: 'Organization phone not found or does not belong to your organization.' });
    }
    if (!phone.phoneJid) {
        logger.warn(`[connectOrganizationPhone] JID телефона не установлен для organizationPhoneId: ${organizationPhoneId}.`);
        return res.status(400).json({ error: 'Phone JID is not set for this organization phone.' });
    }

    // !!! ВНИМАНИЕ: УДАЛЕНА ПРОВЕРКА НА СУЩЕСТВУЮЩИЙ СОКЕТ !!!
    // const existingSock = getBaileysSock(organizationPhoneId);
    // if (existingSock && existingSock.user) {
    //     const currentWebSocket = existingSock.ws as unknown as WebSocket; // Или другой вариант приведения
    //     const connectionStatus = currentWebSocket.readyState === WebSocket.OPEN ? 'connected' : 'connecting';
    //     logger.info(`[connectOrganizationPhone] Сокет для ${phone.phoneJid} уже активен (статус: ${currentWebSocket.readyState}).`);
    //     return res.status(200).json({ status: connectionStatus, message: 'WhatsApp session already active or connecting.' });
    // }

    // Запускаем Baileys сессию. QR-код будет сохранен в БД через обработчик 'connection.update'.
    await startBaileys(organizationId, organizationPhoneId, phone.phoneJid);
    logger.info(`[connectOrganizationPhone] Инициирован запуск Baileys для ${phone.phoneJid}.`);
    res.status(202).json({ message: 'WhatsApp session connection initiated. Check the /api/organization-phones endpoint for QR code or status updates.' });
  } catch (error: any) {
    logger.error(`❌ Ошибка при попытке подключения телефона организации ${organizationPhoneId}:`, error);
    res.status(500).json({ error: 'Failed to initiate WhatsApp session', details: error.message });
  }
}


/**
 * Отключает WhatsApp-номер от Baileys (выход из сессии).
 * @param req Запрос Express. Ожидает organizationId (из res.locals), organizationPhoneId в параметрах маршрута.
 * @param res Ответ Express.
 */
export async function disconnectOrganizationPhone(req: Request, res: Response) {
    const organizationId = res.locals.organizationId;
    const organizationPhoneId = parseInt(req.params.organizationPhoneId as string, 10);

    if (!organizationId || isNaN(organizationPhoneId)) {
        logger.warn('[disconnectOrganizationPhone] Отсутствуют или некорректны organizationId или organizationPhoneId.');
        return res.status(400).json({ error: 'Missing organizationId or invalid organizationPhoneId' });
    }

    try {
        const phone = await prisma.organizationPhone.findUnique({
            where: { id: organizationPhoneId, organizationId: organizationId },
        });

        if (!phone) {
            logger.warn(`[disconnectOrganizationPhone] Телефон с ID ${organizationPhoneId} не найден или не принадлежит организации ${organizationId}.`);
            return res.status(404).json({ error: 'Organization phone not found or does not belong to your organization.' });
        }

        const sock = getBaileysSock(organizationPhoneId);
        if (sock) {
            await sock.logout(); // Завершаем сессию WhatsApp
            // Статус будет обновлен в БД на 'logged_out' через обработчик 'connection.update' в baileys.ts
            logger.info(`[disconnectOrganizationPhone] WhatsApp сессия для ${phone.phoneJid} запросила выход.`);
            res.status(200).json({ message: 'WhatsApp session logout initiated.' });
        } else {
            // Если сокет не найден, возможно, он уже был отключен или не запущен.
            // Обновим статус в БД на всякий случай, если он не был обновлен ранее.
            await prisma.organizationPhone.update({
                where: { id: organizationPhoneId },
                data: { status: 'disconnected', qrCode: null }, // Очищаем QR-код при отключении
            });
            logger.warn(`[disconnectOrganizationPhone] Сокет для organizationPhoneId ${organizationPhoneId} не найден, но статус обновлен на 'disconnected'.`);
            res.status(200).json({ message: 'WhatsApp session already disconnected or not active.' });
        }
    } catch (error: any) {
        logger.error(`❌ Ошибка при отключении телефона организации ${organizationPhoneId}:`, error);
        res.status(500).json({ error: 'Failed to disconnect WhatsApp session', details: error.message });
    }
}