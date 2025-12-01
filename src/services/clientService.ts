import { PrismaClient } from '@prisma/client';
import pino from 'pino';

const prisma = new PrismaClient();
const logger = pino({ level: 'info' });

/**
 * Автоматически создает или обновляет клиента при получении сообщения из WhatsApp
 * @param organizationId ID организации
 * @param whatsappJid JID клиента в WhatsApp (например, 79001234567@s.whatsapp.net)
 * @param name Имя из pushName или undefined
 * @returns OrganizationClient
 */
export async function ensureWhatsAppClient(
  organizationId: number,
  whatsappJid: string,
  name?: string
) {
  try {
    // Валидация входных данных
    if (!organizationId || !whatsappJid) {
      throw new Error('organizationId и whatsappJid обязательны');
    }

    // Ищем существующего клиента по WhatsApp JID
    let client = await prisma.organizationClient.findFirst({
      where: {
        organizationId,
        whatsappJid
      }
    });

    if (client) {
      logger.info(`🔍 Найден существующий клиент WhatsApp: ${client.name} (ID: ${client.id})`);
      
      // Обновляем имя, если оно было передано и отличается
      if (name && client.name !== name) {
        client = await prisma.organizationClient.update({
          where: { id: client.id },
          data: { name }
        });
        logger.info(`📝 Обновлено имя клиента WhatsApp: ${name} (${whatsappJid})`);
      }
      return client;
    }

    // Создаем нового клиента
    // Извлекаем телефон из JID (убираем @s.whatsapp.net)
    const phone = whatsappJid.split('@')[0];
    
    client = await prisma.organizationClient.create({
      data: {
        organizationId,
        clientType: 'individual',
        name: name || `WhatsApp ${phone}`,
        phone: phone.startsWith('+') ? phone : `+${phone}`,
        whatsappJid,
        status: 'active',
        source: 'whatsapp'
      }
    });

    logger.info(`✅ Создан новый клиент WhatsApp: ${client.name} (ID: ${client.id}, JID: ${whatsappJid})`);
    return client;
  } catch (error) {
    logger.error(`❌ Ошибка при создании/обновлении клиента WhatsApp (${whatsappJid}):`, error);
    throw error;
  }
}

/**
 * Автоматически создает или обновляет клиента при получении сообщения из Telegram
 * @param organizationId ID организации
 * @param telegramUserId ID пользователя в Telegram
 * @param telegramUsername Username в Telegram (@username)
 * @param firstName Имя пользователя
 * @param lastName Фамилия пользователя
 * @returns OrganizationClient
 */
export async function ensureTelegramClient(
  organizationId: number,
  telegramUserId: string,
  telegramUsername?: string,
  firstName?: string,
  lastName?: string
) {
  try {
    // Валидация входных данных
    if (!organizationId || !telegramUserId) {
      throw new Error('organizationId и telegramUserId обязательны');
    }

    // Ищем существующего клиента по Telegram User ID
    let client = await prisma.organizationClient.findFirst({
      where: {
        organizationId,
        telegramUserId
      }
    });

    // Формируем полное имя
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || 
                     telegramUsername || 
                     `Telegram User ${telegramUserId}`;

    if (client) {
      logger.info(`🔍 Найден существующий клиент Telegram: ${client.name} (ID: ${client.id})`);
      
      // Обновляем данные клиента, если они изменились
      const updates: any = {};
      
      if (fullName && client.name !== fullName) {
        updates.name = fullName;
      }
      
      if (Object.keys(updates).length > 0) {
        client = await prisma.organizationClient.update({
          where: { id: client.id },
          data: updates
        });
        logger.info(`📝 Обновлены данные клиента Telegram: ${fullName} (@${telegramUsername})`);
      }
      
      return client;
    }

    // Создаем нового клиента
    client = await prisma.organizationClient.create({
      data: {
        organizationId,
        clientType: 'individual',
        name: fullName,
        telegramUserId,
        status: 'active',
        source: 'telegram'
      }
    });

    logger.info(`✅ Создан новый клиент Telegram: ${fullName} (ID: ${client.id}, UserID: ${telegramUserId}, @${telegramUsername || 'без username'})`);
    return client;
  } catch (error) {
    logger.error(`❌ Ошибка при создании/обновлении клиента Telegram (${telegramUserId}):`, error);
    throw error;
  }
}

/**
 * Обновляет финансовую статистику клиента после покупки
 * @param clientId ID клиента
 * @param purchaseAmount Сумма покупки
 */
export async function updateClientPurchaseStats(
  clientId: number,
  purchaseAmount: number
) {
  try {
    const client = await prisma.organizationClient.findUnique({
      where: { id: clientId }
    });

    if (!client) {
      throw new Error(`Client with id ${clientId} not found`);
    }

    const currentRevenue = parseFloat(client.totalRevenue?.toString() || '0');
    const currentCount = client.purchaseCount || 0;
    
    const newRevenue = currentRevenue + purchaseAmount;
    const newCount = currentCount + 1;
    const newAverage = newRevenue / newCount;

    await prisma.organizationClient.update({
      where: { id: clientId },
      data: {
        totalRevenue: newRevenue,
        purchaseCount: newCount,
        averageCheck: newAverage,
        lastPurchaseDate: new Date()
      }
    });

    logger.info(`💰 Обновлена статистика клиента #${clientId}: +${purchaseAmount}, всего ${newRevenue}`);
  } catch (error) {
    logger.error(`❌ Ошибка при обновлении статистики покупок клиента:`, error);
    throw error;
  }
}

/**
 * Связывает клиента с чатом
 * @param clientId ID клиента
 * @param chatId ID чата
 */
export async function linkClientToChat(
  clientId: number,
  chatId: number
) {
  try {
    // Проверяем, существует ли уже связь
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        organizationClients: {
          where: { id: clientId }
        }
      }
    });

    if (!chat) {
      throw new Error(`Chat with id ${chatId} not found`);
    }

    if (chat.organizationClients.length === 0) {
      // Связываем клиента с чатом
      await prisma.chat.update({
        where: { id: chatId },
        data: {
          organizationClients: {
            connect: { id: clientId }
          }
        }
      });

      logger.info(`🔗 Клиент #${clientId} связан с чатом #${chatId}`);
    }
  } catch (error) {
    logger.error(`❌ Ошибка при связывании клиента с чатом:`, error);
    throw error;
  }
}

/**
 * Поиск клиента по различным параметрам
 * @param organizationId ID организации
 * @param searchParams Параметры поиска
 * @returns OrganizationClient | null
 */
export async function findClient(
  organizationId: number,
  searchParams: {
    email?: string;
    phone?: string;
    whatsappJid?: string;
    telegramUserId?: string;
  }
) {
  try {
    const { email, phone, whatsappJid, telegramUserId } = searchParams;

    const where: any = { organizationId };

    if (whatsappJid) {
      where.whatsappJid = whatsappJid;
    } else if (telegramUserId) {
      where.telegramUserId = telegramUserId;
    } else if (email) {
      where.email = email;
    } else if (phone) {
      where.phone = phone;
    }

    const client = await prisma.organizationClient.findFirst({ where });
    
    return client;
  } catch (error) {
    logger.error(`❌ Ошибка при поиске клиента:`, error);
    throw error;
  }
}
