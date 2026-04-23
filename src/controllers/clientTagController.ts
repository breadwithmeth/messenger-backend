import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import pino from 'pino';
import * as tagService from '../services/clientTagService';

const logger = pino({ level: process.env.APP_LOG_LEVEL || 'silent' });

/**
 * 🏷️ GET /api/clients/tags - Получить все теги организации
 */
export async function getTags(req: AuthRequest, res: Response) {
  try {
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const tags = await tagService.getOrganizationTags(organizationId);
    res.json(tags);
  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Ошибка при получении тегов');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * 🏷️ GET /api/clients/tags/:id - Получить тег по ID
 */
export async function getTagById(req: AuthRequest, res: Response) {
  try {
    const organizationId = req.user?.organizationId;
    const tagId = parseInt(req.params.id);
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (isNaN(tagId)) {
      return res.status(400).json({ error: 'Invalid tag ID' });
    }
    
    const tag = await tagService.getTagById(tagId, organizationId);
    
    if (!tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    
    res.json(tag);
  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Ошибка при получении тега');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * ➕ POST /api/clients/tags - Создать новый тег
 */
export async function createTag(req: AuthRequest, res: Response) {
  try {
    const organizationId = req.user?.organizationId;
    const { name, color } = req.body;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const tag = await tagService.createTag({
      name: name.trim(),
      color,
      organizationId
    });
    
    res.status(201).json(tag);
  } catch (error: any) {
    if (error.message === 'Тег с таким именем уже существует') {
      return res.status(409).json({ error: error.message });
    }
    logger.error({ error: error.message }, '❌ Ошибка при создании тега');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * 📝 PUT /api/clients/tags/:id - Обновить тег
 */
export async function updateTag(req: AuthRequest, res: Response) {
  try {
    const organizationId = req.user?.organizationId;
    const tagId = parseInt(req.params.id);
    const { name, color } = req.body;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (isNaN(tagId)) {
      return res.status(400).json({ error: 'Invalid tag ID' });
    }
    
    const data: any = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name must be a non-empty string' });
      }
      data.name = name.trim();
    }
    if (color !== undefined) {
      data.color = color;
    }
    
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    const tag = await tagService.updateTag(tagId, organizationId, data);
    res.json(tag);
  } catch (error: any) {
    if (error.message === 'Тег не найден') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Тег с таким именем уже существует') {
      return res.status(409).json({ error: error.message });
    }
    logger.error({ error: error.message }, '❌ Ошибка при обновлении тега');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * ❌ DELETE /api/clients/tags/:id - Удалить тег
 */
export async function deleteTag(req: AuthRequest, res: Response) {
  try {
    const organizationId = req.user?.organizationId;
    const tagId = parseInt(req.params.id);
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (isNaN(tagId)) {
      return res.status(400).json({ error: 'Invalid tag ID' });
    }
    
    await tagService.deleteTag(tagId, organizationId);
    res.status(204).send();
  } catch (error: any) {
    if (error.message === 'Тег не найден') {
      return res.status(404).json({ error: error.message });
    }
    logger.error({ error: error.message }, '❌ Ошибка при удалении тега');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * 🔗 POST /api/clients/:clientId/tags/:tagId - Добавить тег клиенту
 */
export async function addTagToClient(req: AuthRequest, res: Response) {
  try {
    const organizationId = req.user?.organizationId;
    const clientId = parseInt(req.params.clientId);
    const tagId = parseInt(req.params.tagId);
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (isNaN(clientId) || isNaN(tagId)) {
      return res.status(400).json({ error: 'Invalid client or tag ID' });
    }
    
    await tagService.addTagToClient(clientId, tagId, organizationId);
    res.status(204).send();
  } catch (error: any) {
    if (error.message === 'Клиент не найден' || error.message === 'Тег не найден') {
      return res.status(404).json({ error: error.message });
    }
    logger.error({ error: error.message }, '❌ Ошибка при добавлении тега клиенту');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * 🔓 DELETE /api/clients/:clientId/tags/:tagId - Удалить тег у клиента
 */
export async function removeTagFromClient(req: AuthRequest, res: Response) {
  try {
    const organizationId = req.user?.organizationId;
    const clientId = parseInt(req.params.clientId);
    const tagId = parseInt(req.params.tagId);
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (isNaN(clientId) || isNaN(tagId)) {
      return res.status(400).json({ error: 'Invalid client or tag ID' });
    }
    
    await tagService.removeTagFromClient(clientId, tagId, organizationId);
    res.status(204).send();
  } catch (error: any) {
    if (error.message === 'Клиент не найден') {
      return res.status(404).json({ error: error.message });
    }
    logger.error({ error: error.message }, '❌ Ошибка при удалении тега у клиента');
    res.status(500).json({ error: 'Internal server error' });
  }
}
