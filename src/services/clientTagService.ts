import pino from 'pino';
import prisma from '../config/prisma';

const logger = pino({ level: process.env.APP_LOG_LEVEL || 'silent' });

interface CreateTagInput {
  name: string;
  color?: string;
  organizationId: number;
}

interface UpdateTagInput {
  name?: string;
  color?: string;
}

/**
 * 🏷️ Получить все теги организации
 */
export async function getOrganizationTags(organizationId: number) {
  logger.info({ organizationId }, '🏷️ Получение тегов организации');
  
  const tags = await prisma.clientTag.findMany({
    where: { organizationId },
    include: {
      _count: {
        select: { clients: true }
      }
    },
    orderBy: { name: 'asc' }
  });
  
  logger.info({ count: tags.length }, '✅ Теги получены');
  return tags;
}

/**
 * 🏷️ Получить тег по ID
 */
export async function getTagById(tagId: number, organizationId: number) {
  logger.info({ tagId, organizationId }, '🏷️ Получение тега по ID');
  
  const tag = await prisma.clientTag.findFirst({
    where: { 
      id: tagId,
      organizationId 
    },
    include: {
      _count: {
        select: { clients: true }
      }
    }
  });
  
  if (tag) {
    logger.info({ tagId }, '✅ Тег найден');
  } else {
    logger.warn({ tagId }, '⚠️ Тег не найден');
  }
  
  return tag;
}

/**
 * ➕ Создать новый тег
 */
export async function createTag(data: CreateTagInput) {
  logger.info({ name: data.name, organizationId: data.organizationId }, '➕ Создание нового тега');
  
  // Проверяем, не существует ли уже тег с таким именем
  const existing = await prisma.clientTag.findFirst({
    where: {
      name: data.name,
      organizationId: data.organizationId
    }
  });
  
  if (existing) {
    logger.warn({ name: data.name }, '⚠️ Тег с таким именем уже существует');
    throw new Error('Тег с таким именем уже существует');
  }
  
  const tag = await prisma.clientTag.create({
    data: {
      name: data.name,
      color: data.color,
      organizationId: data.organizationId
    }
  });
  
  logger.info({ tagId: tag.id, name: tag.name }, '✅ Тег создан');
  return tag;
}

/**
 * 📝 Обновить тег
 */
export async function updateTag(tagId: number, organizationId: number, data: UpdateTagInput) {
  logger.info({ tagId, organizationId }, '📝 Обновление тега');
  
  // Проверяем существование тега
  const existing = await getTagById(tagId, organizationId);
  if (!existing) {
    throw new Error('Тег не найден');
  }
  
  // Если меняется имя, проверяем уникальность
  if (data.name) {
    const duplicate = await prisma.clientTag.findFirst({
      where: {
        name: data.name,
        organizationId,
        id: { not: tagId }
      }
    });
    
    if (duplicate) {
      logger.warn({ name: data.name }, '⚠️ Тег с таким именем уже существует');
      throw new Error('Тег с таким именем уже существует');
    }
  }
  
  const tag = await prisma.clientTag.update({
    where: { id: tagId },
    data
  });
  
  logger.info({ tagId }, '✅ Тег обновлен');
  return tag;
}

/**
 * ❌ Удалить тег
 */
export async function deleteTag(tagId: number, organizationId: number) {
  logger.info({ tagId, organizationId }, '❌ Удаление тега');
  
  // Проверяем существование тега
  const existing = await getTagById(tagId, organizationId);
  if (!existing) {
    throw new Error('Тег не найден');
  }
  
  await prisma.clientTag.delete({
    where: { id: tagId }
  });
  
  logger.info({ tagId }, '✅ Тег удален');
}

/**
 * 🔗 Добавить тег клиенту
 */
export async function addTagToClient(clientId: number, tagId: number, organizationId: number) {
  logger.info({ clientId, tagId, organizationId }, '🔗 Добавление тега клиенту');
  
  // Проверяем, что клиент принадлежит организации
  const client = await prisma.organizationClient.findFirst({
    where: { 
      id: clientId,
      organizationId 
    }
  });
  
  if (!client) {
    logger.warn({ clientId }, '⚠️ Клиент не найден');
    throw new Error('Клиент не найден');
  }
  
  // Проверяем, что тег принадлежит организации
  const tag = await getTagById(tagId, organizationId);
  if (!tag) {
    throw new Error('Тег не найден');
  }
  
  // Добавляем связь
  await prisma.organizationClient.update({
    where: { id: clientId },
    data: {
      tags: {
        connect: { id: tagId }
      }
    }
  });
  
  logger.info({ clientId, tagId }, '✅ Тег добавлен клиенту');
}

/**
 * 🔓 Удалить тег у клиента
 */
export async function removeTagFromClient(clientId: number, tagId: number, organizationId: number) {
  logger.info({ clientId, tagId, organizationId }, '🔓 Удаление тега у клиента');
  
  // Проверяем, что клиент принадлежит организации
  const client = await prisma.organizationClient.findFirst({
    where: { 
      id: clientId,
      organizationId 
    }
  });
  
  if (!client) {
    logger.warn({ clientId }, '⚠️ Клиент не найден');
    throw new Error('Клиент не найден');
  }
  
  // Удаляем связь
  await prisma.organizationClient.update({
    where: { id: clientId },
    data: {
      tags: {
        disconnect: { id: tagId }
      }
    }
  });
  
  logger.info({ clientId, tagId }, '✅ Тег удален у клиента');
}
