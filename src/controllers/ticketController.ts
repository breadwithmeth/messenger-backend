// src/controllers/ticketController.ts

import { Request, Response } from 'express';
import { prisma } from '../config/authStorage';
import pino from 'pino';

const logger = pino({ level: 'info' });

/**
 * Получить список тикетов с фильтрацией и пагинацией
 */
export async function listTickets(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const {
      status,
      priority,
      assignedUserId,
      category,
      page = 1,
      limit = 20,
      sortBy = 'updatedAt',
      sortOrder = 'desc'
    } = req.query;

    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId обязателен' });
    }

    // Построение фильтров
    const where: any = {
      organizationId,
      ticketNumber: { not: null } // Только чаты с номером тикета
    };

    if (status) where.status = status as string;
    if (priority) where.priority = priority as string;
    if (assignedUserId) where.assignedUserId = parseInt(assignedUserId as string);
    if (category) where.category = category as string;

    // Пагинация
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // Сортировка
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder as string;

    // Получить тикеты
    const [tickets, total] = await Promise.all([
      prisma.chat.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          assignedUser: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          clients: {
            select: {
              phoneJid: true,
              name: true
            }
          },
          messages: {
            take: 1,
            orderBy: { timestamp: 'desc' },
            select: {
              id: true,
              content: true,
              timestamp: true
            }
          }
        }
      }),
      prisma.chat.count({ where })
    ]);

    // Форматирование ответа
    const formattedTickets = tickets.map(ticket => {
      const assignedUser = ticket.assignedUser;
      const client = ticket.clients && ticket.clients.length > 0 ? ticket.clients[0] : null;
      const lastMessage = ticket.messages && ticket.messages.length > 0 ? ticket.messages[0] : null;

      return {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        priority: ticket.priority,
        subject: ticket.subject,
        category: ticket.category,
        tags: ticket.tags ? JSON.parse(ticket.tags) : [],
        assignedUser: assignedUser ? {
          id: assignedUser.id,
          name: assignedUser.name
        } : null,
        client,
        unreadCount: ticket.unreadCount,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        lastMessageAt: ticket.lastMessageAt,
        lastMessage,
        // Добавляем недостающие поля
        name: ticket.name,
        remoteJid: ticket.remoteJid,
        receivingPhoneJid: ticket.receivingPhoneJid
      };
    });

    res.json({
      tickets: formattedTickets,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error: any) {
    logger.error({ error: error.message }, '[listTickets] Ошибка при получении списка тикетов');
    res.status(500).json({ error: 'Ошибка при получении списка тикетов' });
  }
}

/**
 * Получить тикет по номеру
 */
export async function getTicketByNumber(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const { ticketNumber } = req.params;

    const ticket = await prisma.chat.findFirst({
      where: {
        organizationId,
        ticketNumber: parseInt(ticketNumber)
      },
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        clients: {
          select: {
            phoneJid: true,
            name: true
          }
        },
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 50,
          include: {
            senderUser: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Тикет не найден' });
    }

    res.json({
      ...ticket,
      tags: ticket.tags ? JSON.parse(ticket.tags) : [],
      client: ticket.clients[0] || null,
      // Явно добавляем важные поля (они уже есть в ticket, но для ясности)
      name: ticket.name,
      remoteJid: ticket.remoteJid,
      receivingPhoneJid: ticket.receivingPhoneJid
    });
  } catch (error: any) {
    logger.error({ error: error.message }, '[getTicketByNumber] Ошибка при получении тикета');
    res.status(500).json({ error: 'Ошибка при получении тикета' });
  }
}

/**
 * Назначить тикет оператору
 */
export async function assignTicket(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const { ticketNumber } = req.params;
    const { userId: assignedUserId } = req.body;

    if (!assignedUserId) {
      return res.status(400).json({ error: 'userId обязателен' });
    }

    // Найти тикет
    const ticket = await prisma.chat.findFirst({
      where: {
        organizationId,
        ticketNumber: parseInt(ticketNumber)
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Тикет не найден' });
    }

    // Найти пользователя для назначения
    const assignedUser = await prisma.user.findFirst({
      where: {
        id: assignedUserId,
        organizationId
      }
    });

    if (!assignedUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Обновить тикет и создать запись в истории
    const [updatedTicket, history] = await prisma.$transaction([
      prisma.chat.update({
        where: { id: ticket.id },
        data: {
          assignedUserId,
          assignedAt: new Date()
        }
      }),
      prisma.ticketHistory.create({
        data: {
          chatId: ticket.id,
          userId,
          changeType: 'assigned',
          newValue: assignedUserId.toString(),
          description: `Тикет назначен пользователю ${assignedUser.name}`
        }
      })
    ]);

    res.json({
      success: true,
      ticket: updatedTicket,
      history
    });
  } catch (error: any) {
    logger.error({ error: error.message }, '[assignTicket] Ошибка при назначении тикета');
    res.status(500).json({ error: 'Ошибка при назначении тикета' });
  }
}

/**
 * Изменить статус тикета
 */
export async function changeTicketStatus(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const { ticketNumber } = req.params;
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status обязателен' });
    }

    // Валидация статуса
    const validStatuses = ['new', 'open', 'in_progress', 'pending', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }

    // Найти тикет
    const ticket = await prisma.chat.findFirst({
      where: {
        organizationId,
        ticketNumber: parseInt(ticketNumber)
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Тикет не найден' });
    }

    const oldStatus = ticket.status;
    const updateData: any = { status };

    // Дополнительные поля в зависимости от статуса
    if (status === 'resolved') {
      updateData.resolvedAt = new Date();
    } else if (status === 'closed') {
      updateData.closedAt = new Date();
      if (reason) {
        updateData.closeReason = reason;
      }
    }

    // Обновить тикет и создать запись в истории
    const [updatedTicket, history] = await prisma.$transaction([
      prisma.chat.update({
        where: { id: ticket.id },
        data: updateData
      }),
      prisma.ticketHistory.create({
        data: {
          chatId: ticket.id,
          userId,
          changeType: 'status_changed',
          oldValue: oldStatus,
          newValue: status,
          description: `Статус изменён с ${oldStatus} на ${status}${reason ? `: ${reason}` : ''}`
        }
      })
    ]);

    res.json({
      success: true,
      ticket: updatedTicket,
      history
    });
  } catch (error: any) {
    logger.error({ error: error.message }, '[changeTicketStatus] Ошибка при изменении статуса');
    res.status(500).json({ error: 'Ошибка при изменении статуса тикета' });
  }
}

/**
 * Изменить приоритет тикета
 */
export async function changeTicketPriority(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const { ticketNumber } = req.params;
    const { priority } = req.body;

    if (!priority) {
      return res.status(400).json({ error: 'priority обязателен' });
    }

    // Валидация приоритета
    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Недопустимый приоритет' });
    }

    // Найти тикет
    const ticket = await prisma.chat.findFirst({
      where: {
        organizationId,
        ticketNumber: parseInt(ticketNumber)
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Тикет не найден' });
    }

    const oldPriority = ticket.priority;

    // Обновить тикет и создать запись в истории
    const [updatedTicket, history] = await prisma.$transaction([
      prisma.chat.update({
        where: { id: ticket.id },
        data: { priority }
      }),
      prisma.ticketHistory.create({
        data: {
          chatId: ticket.id,
          userId,
          changeType: 'priority_changed',
          oldValue: oldPriority,
          newValue: priority,
          description: `Приоритет изменён с ${oldPriority} на ${priority}`
        }
      })
    ]);

    res.json({
      success: true,
      ticket: updatedTicket,
      history
    });
  } catch (error: any) {
    logger.error({ error: error.message }, '[changeTicketPriority] Ошибка при изменении приоритета');
    res.status(500).json({ error: 'Ошибка при изменении приоритета тикета' });
  }
}

/**
 * Добавить тег к тикету
 */
export async function addTicketTag(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const { ticketNumber } = req.params;
    const { tag } = req.body;

    if (!tag) {
      return res.status(400).json({ error: 'tag обязателен' });
    }

    // Найти тикет
    const ticket = await prisma.chat.findFirst({
      where: {
        organizationId,
        ticketNumber: parseInt(ticketNumber)
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Тикет не найден' });
    }

    // Получить текущие теги
    const currentTags = ticket.tags ? JSON.parse(ticket.tags) : [];
    
    // Проверить, что тег ещё не добавлен
    if (currentTags.includes(tag)) {
      return res.status(400).json({ error: 'Тег уже добавлен' });
    }

    // Добавить новый тег
    const updatedTags = [...currentTags, tag];

    // Обновить тикет и создать запись в истории
    const [updatedTicket, history] = await prisma.$transaction([
      prisma.chat.update({
        where: { id: ticket.id },
        data: { tags: JSON.stringify(updatedTags) }
      }),
      prisma.ticketHistory.create({
        data: {
          chatId: ticket.id,
          userId,
          changeType: 'tag_added',
          newValue: tag,
          description: `Добавлен тег: ${tag}`
        }
      })
    ]);

    res.json({
      success: true,
      ticket: {
        ...updatedTicket,
        tags: updatedTags
      },
      history
    });
  } catch (error: any) {
    logger.error({ error: error.message }, '[addTicketTag] Ошибка при добавлении тега');
    res.status(500).json({ error: 'Ошибка при добавлении тега' });
  }
}

/**
 * Удалить тег из тикета
 */
export async function removeTicketTag(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const { ticketNumber, tag } = req.params;

    // Найти тикет
    const ticket = await prisma.chat.findFirst({
      where: {
        organizationId,
        ticketNumber: parseInt(ticketNumber)
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Тикет не найден' });
    }

    // Получить текущие теги
    const currentTags = ticket.tags ? JSON.parse(ticket.tags) : [];
    
    // Проверить, что тег существует
    if (!currentTags.includes(tag)) {
      return res.status(400).json({ error: 'Тег не найден' });
    }

    // Удалить тег
    const updatedTags = currentTags.filter((t: string) => t !== tag);

    // Обновить тикет и создать запись в истории
    const [updatedTicket, history] = await prisma.$transaction([
      prisma.chat.update({
        where: { id: ticket.id },
        data: { tags: JSON.stringify(updatedTags) }
      }),
      prisma.ticketHistory.create({
        data: {
          chatId: ticket.id,
          userId,
          changeType: 'tag_removed',
          oldValue: tag,
          description: `Удалён тег: ${tag}`
        }
      })
    ]);

    res.json({
      success: true,
      ticket: {
        ...updatedTicket,
        tags: updatedTags
      },
      history
    });
  } catch (error: any) {
    logger.error({ error: error.message }, '[removeTicketTag] Ошибка при удалении тега');
    res.status(500).json({ error: 'Ошибка при удалении тега' });
  }
}

/**
 * Получить историю изменений тикета
 */
export async function getTicketHistory(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const { ticketNumber } = req.params;

    // Найти тикет
    const ticket = await prisma.chat.findFirst({
      where: {
        organizationId,
        ticketNumber: parseInt(ticketNumber)
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Тикет не найден' });
    }

    // Получить историю
    const history = await prisma.ticketHistory.findMany({
      where: { chatId: ticket.id },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    res.json({ history });
  } catch (error: any) {
    logger.error({ error: error.message }, '[getTicketHistory] Ошибка при получении истории');
    res.status(500).json({ error: 'Ошибка при получении истории тикета' });
  }
}

/**
 * Добавить внутреннюю заметку
 */
export async function addTicketNote(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const { ticketNumber } = req.params;
    const { note } = req.body;

    if (!note) {
      return res.status(400).json({ error: 'note обязателен' });
    }

    // Найти тикет
    const ticket = await prisma.chat.findFirst({
      where: {
        organizationId,
        ticketNumber: parseInt(ticketNumber)
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Тикет не найден' });
    }

    // Обновить заметки и создать запись в истории
    const [updatedTicket, history] = await prisma.$transaction([
      prisma.chat.update({
        where: { id: ticket.id },
        data: { internalNotes: note }
      }),
      prisma.ticketHistory.create({
        data: {
          chatId: ticket.id,
          userId,
          changeType: 'note_added',
          newValue: note.substring(0, 100), // Первые 100 символов
          description: 'Добавлена внутренняя заметка'
        }
      })
    ]);

    res.json({
      success: true,
      ticket: updatedTicket,
      history
    });
  } catch (error: any) {
    logger.error({ error: error.message }, '[addTicketNote] Ошибка при добавлении заметки');
    res.status(500).json({ error: 'Ошибка при добавлении заметки' });
  }
}

/**
 * Получить статистику по тикетам
 */
export async function getTicketStats(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;

    // Получить общую статистику
    const [total, byStatus, byPriority] = await Promise.all([
      prisma.chat.count({
        where: {
          organizationId,
          ticketNumber: { not: null }
        }
      }),
      prisma.chat.groupBy({
        by: ['status'],
        where: {
          organizationId,
          ticketNumber: { not: null }
        },
        _count: true
      }),
      prisma.chat.groupBy({
        by: ['priority'],
        where: {
          organizationId,
          ticketNumber: { not: null }
        },
        _count: true
      })
    ]);

    // Форматирование статистики по статусам
    const statusStats: any = {};
    byStatus.forEach(item => {
      statusStats[item.status] = item._count;
    });

    // Форматирование статистики по приоритетам
    const priorityStats: any = {};
    byPriority.forEach(item => {
      priorityStats[item.priority] = item._count;
    });

    res.json({
      total,
      byStatus: statusStats,
      byPriority: priorityStats
    });
  } catch (error: any) {
    logger.error({ error: error.message }, '[getTicketStats] Ошибка при получении статистики');
    res.status(500).json({ error: 'Ошибка при получении статистики' });
  }
}

/**
 * Получить сообщения тикета по номеру тикета
 */
export async function getTicketMessages(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const ticketNumber = parseInt(req.params.ticketNumber as string, 10);

    if (!organizationId) {
      logger.warn('[getTicketMessages] Несанкционированный доступ: organizationId не определен в res.locals.');
      return res.status(401).json({ error: 'Несанкционированный доступ: organizationId не определен.' });
    }

    if (isNaN(ticketNumber)) {
      logger.warn(`[getTicketMessages] Некорректный ticketNumber: "${req.params.ticketNumber}". Ожидалось число.`);
      return res.status(400).json({ error: 'Некорректный ticketNumber. Ожидалось число.' });
    }

    // Находим чат по ticketNumber
    const chat = await prisma.chat.findFirst({
      where: {
        ticketNumber: ticketNumber,
        organizationId: organizationId,
      },
      select: { id: true },
    });

    if (!chat) {
      logger.warn(`[getTicketMessages] Тикет с номером ${ticketNumber} не найден или не принадлежит организации ${organizationId}.`);
      return res.status(404).json({ error: 'Тикет не найден или не принадлежит вашей организации.' });
    }

    // Получаем все сообщения для этого чата
    const messages = await prisma.message.findMany({
      where: {
        chatId: chat.id,
        organizationId: organizationId,
      },
      include: {
        senderUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        timestamp: 'asc',
      },
    });

    logger.info(`[getTicketMessages] Успешно получено ${messages.length} сообщений для тикета ${ticketNumber} (чат ${chat.id}) организации ${organizationId}.`);
    res.status(200).json({ messages });
  } catch (error: any) {
    logger.error(`[getTicketMessages] Ошибка при получении сообщений для тикета ${req.params.ticketNumber} организации ${res.locals.organizationId}:`, error);
    res.status(500).json({
      error: 'Не удалось получить сообщения тикета.',
      details: error.message,
    });
  }
}
