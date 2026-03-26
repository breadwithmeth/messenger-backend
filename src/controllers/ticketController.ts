// src/controllers/ticketController.ts

import { Request, Response } from 'express';
import { prisma } from '../config/authStorage';
import pino from 'pino';

const logger = pino({ level: 'info' });

type TicketHistoryPoint = {
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
};

function extractTicketTimeline(
  currentTicketNumber: number | null,
  currentStatus: string | null,
  currentPriority: string | null,
  history: TicketHistoryPoint[] = []
) {
  const timeline: Array<{ number: number; status: string | null; priority: string | null; createdAt?: Date }> = [];
  const seen = new Set<number>();

  if (typeof currentTicketNumber === 'number') {
    timeline.push({
      number: currentTicketNumber,
      status: currentStatus,
      priority: currentPriority,
    });
    seen.add(currentTicketNumber);
  }

  for (const item of history) {
    const oldNumber = item.oldValue ? Number(item.oldValue) : NaN;
    const newNumber = item.newValue ? Number(item.newValue) : NaN;

    if (!Number.isNaN(newNumber) && !seen.has(newNumber)) {
      timeline.push({
        number: newNumber,
        status: null,
        priority: null,
        createdAt: item.createdAt,
      });
      seen.add(newNumber);
    }

    if (!Number.isNaN(oldNumber) && !seen.has(oldNumber)) {
      timeline.push({
        number: oldNumber,
        status: null,
        priority: null,
        createdAt: item.createdAt,
      });
      seen.add(oldNumber);
    }
  }

  return timeline;
}

/**
 * Получить список тикетов с теми же фильтрами/сортировкой, что и /api/chats
 */
export async function listTickets(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const {
      status,
      assigned,
      assignedToMe,
      priority,
      channel,
      includeProfile,
      search,
      searchType,
      limit = '50',
      offset = '0',
      sortBy = 'lastMessageAt',
      sortOrder = 'desc',
    } = req.query;

    if (!organizationId) {
      logger.warn('[listTickets] organizationId не определен в res.locals.');
      return res.status(400).json({ error: 'organizationId обязателен' });
    }

    const take = Math.min(parseInt(limit as string, 10) || 50, 100);
    let skip = parseInt(offset as string, 10) || 0;
    if (!req.query.offset && req.query.page) {
      const pageNum = parseInt(req.query.page as string, 10);
      if (!Number.isNaN(pageNum) && pageNum > 1) {
        skip = (pageNum - 1) * take;
      }
    }

    const whereCondition: any = {
      organizationId,
      ticketNumber: { not: null },
    };

    if (search && typeof search === 'string' && search.trim().length > 0) {
      const searchQuery = search.trim();
      const searchType_ = searchType === 'message' ? 'message' : searchType === 'phone' ? 'phone' : 'all';

      whereCondition.OR = whereCondition.OR || [];

      if (searchType_ === 'phone' || searchType_ === 'all') {
        whereCondition.OR.push({
          remoteJid: {
            contains: searchQuery.replace(/\D/g, ''),
            mode: 'insensitive',
          },
        });
        whereCondition.OR.push({ name: { contains: searchQuery, mode: 'insensitive' } });
        whereCondition.OR.push({ telegramUsername: { contains: searchQuery, mode: 'insensitive' } });
      }

      if (searchType_ === 'message' || searchType_ === 'all') {
        const matchingChats = await prisma.chat.findMany({
          where: {
            organizationId,
            ticketNumber: { not: null },
            messages: {
              some: {
                content: {
                  contains: searchQuery,
                  mode: 'insensitive',
                },
              },
            },
          },
          select: { id: true },
        });

        const matchingChatIds = matchingChats.map((chat) => chat.id);
        if (matchingChatIds.length > 0) {
          whereCondition.OR.push({ id: { in: matchingChatIds } });
        }
      }

      if (whereCondition.OR && whereCondition.OR.length === 0) {
        delete whereCondition.OR;
      }
    }

    if (channel && typeof channel === 'string' && (channel === 'whatsapp' || channel === 'telegram')) {
      whereCondition.channel = channel;
    }

    if (status && typeof status === 'string' && status.trim().length > 0) {
      const statuses = status.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      const validStatuses = ['new', 'open', 'in_progress', 'pending', 'resolved', 'closed'];
      const filteredStatuses = statuses.filter((s) => validStatuses.includes(s));

      if (filteredStatuses.length === 1) {
        whereCondition.status = filteredStatuses[0];
      } else if (filteredStatuses.length > 1) {
        whereCondition.status = { in: filteredStatuses };
      }
    }

    if (priority && typeof priority === 'string') {
      whereCondition.priority = priority;
    }

    if (assignedToMe === 'true') {
      if (!userId) {
        return res.status(400).json({ error: 'userId не определен. Требуется авторизация.' });
      }
      whereCondition.assignedUserId = userId;
    } else if (assigned === 'true') {
      whereCondition.assignedUserId = { not: null };
    } else if (assigned === 'false') {
      whereCondition.assignedUserId = null;
    }

    const allowedSortFields = [
      'lastMessageAt',
      'createdAt',
      'priority',
      'unreadCount',
      'ticketNumber',
      'status',
      'name',
    ];

    const sortField = typeof sortBy === 'string' && allowedSortFields.includes(sortBy) ? sortBy : 'lastMessageAt';
    const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';

    let orderBy: any;
    if (req.query.sortBy === undefined) {
      orderBy = [
        { priority: 'desc' },
        { unreadCount: 'desc' },
        { lastMessageAt: 'desc' },
      ];
    } else {
      orderBy = { [sortField]: sortDirection };
    }

    const totalCount = await prisma.chat.count({ where: whereCondition });

    const tickets = await prisma.chat.findMany({
      where: whereCondition,
      take,
      skip,
      select: {
        id: true,
        name: true,
        channel: true,
        remoteJid: true,
        receivingPhoneJid: true,
        isGroup: true,
        status: true,
        priority: true,
        unreadCount: true,
        lastMessageAt: true,
        ticketNumber: true,
        createdAt: true,
        updatedAt: true,
        subject: true,
        category: true,
        tags: true,
        assignedAt: true,
        resolvedAt: true,
        closedAt: true,
        closeReason: true,
        ticketHistory: {
          where: {
            changeType: {
              in: ['ticket_created', 'ticket_reopened'],
            },
          },
          select: {
            oldValue: true,
            newValue: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 30,
        },
        organizationPhone: {
          select: {
            id: true,
            phoneJid: true,
            displayName: true,
            connectionType: true,
          },
        },
        telegramBot: {
          select: {
            id: true,
            botUsername: true,
            botName: true,
          },
        },
        telegramChatId: true,
        telegramUsername: true,
        telegramFirstName: true,
        telegramLastName: true,
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        organizationClients: {
          select: {
            id: true,
            name: true,
            clientType: true,
            segment: true,
            status: true,
            whatsappJid: true,
            telegramUserId: true,
          },
        },
        messages: {
          take: 1,
          orderBy: {
            timestamp: 'desc',
          },
          select: {
            id: true,
            content: true,
            senderJid: true,
            timestamp: true,
            fromMe: true,
            type: true,
            isReadByOperator: true,
            mediaUrl: true,
            quotedMessageId: true,
            quotedContent: true,
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
      orderBy,
    });

    const wantProfile = String(includeProfile).toLowerCase() === 'true';
    const formattedTickets = tickets.map((ticket) => {
      const ticketsTimeline = extractTicketTimeline(
        ticket.ticketNumber,
        ticket.status,
        ticket.priority,
        ticket.ticketHistory || []
      );

      const base: any = {
        ...ticket,
        lastMessage: ticket.messages.length > 0 ? ticket.messages[0] : null,
        ticket: ticket.ticketNumber
          ? {
              number: ticket.ticketNumber,
              status: ticket.status,
              priority: ticket.priority,
            }
          : null,
        tickets: ticketsTimeline,
        hasUnreadMessages: (ticket.unreadCount || 0) > 0,
        hasReadMessages: (ticket._count?.messages || 0) > (ticket.unreadCount || 0),
        tags: ticket.tags ? JSON.parse(ticket.tags) : [],
      };

      delete base.messages;
      delete base.ticketHistory;
      delete base._count;

      if (wantProfile) {
        base.displayName = ticket.name || null;
        base.profilePhotoUrl = null;
      }

      return base;
    });

    res.json({
      tickets: formattedTickets,
      pagination: {
        total: totalCount,
        limit: take,
        offset: skip,
        hasMore: skip + take < totalCount,
      },
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
 * Закрыть тикет сотрудником (shortcut endpoint)
 */
export async function closeTicket(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const { ticketNumber } = req.params;
    const { reason } = (req.body ?? {}) as { reason?: unknown };

    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId обязателен' });
    }

    const parsedTicketNumber = parseInt(ticketNumber, 10);
    if (isNaN(parsedTicketNumber)) {
      return res.status(400).json({ error: 'Некорректный номер тикета' });
    }

    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      return res.status(400).json({ error: 'reason должен быть строкой' });
    }

    const normalizedReason = typeof reason === 'string' ? reason.trim() : undefined;

    const parsedUserId = Number(userId);
    const historyUserId = Number.isInteger(parsedUserId)
      ? (
          await prisma.user.findFirst({
            where: {
              id: parsedUserId,
              organizationId,
            },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    const ticket = await prisma.chat.findFirst({
      where: {
        organizationId,
        ticketNumber: parsedTicketNumber,
      },
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Тикет не найден' });
    }

    const now = new Date();
    const oldStatus = ticket.status;

    if (oldStatus === 'closed') {
      return res.json({
        success: true,
        ticket,
        history: null,
        message: 'Тикет уже закрыт',
      });
    }

    const [updatedTicket, history] = await prisma.$transaction([
      prisma.chat.update({
        where: { id: ticket.id },
        data: {
          status: 'closed',
          closedAt: now,
          ...(normalizedReason ? { closeReason: normalizedReason } : {}),
        },
      }),
      prisma.ticketHistory.create({
        data: {
          chatId: ticket.id,
          userId: historyUserId,
          changeType: 'status_changed',
          oldValue: oldStatus,
          newValue: 'closed',
          description: `Тикет закрыт сотрудником${normalizedReason ? `: ${normalizedReason}` : ''}`,
        },
      }),
    ]);

    res.json({
      success: true,
      ticket: updatedTicket,
      history,
    });
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack, code: error.code }, '[closeTicket] Ошибка при закрытии тикета');
    res.status(500).json({
      error: 'Ошибка при закрытии тикета',
      ...(process.env.NODE_ENV !== 'production' ? { details: error.message } : {}),
    });
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
    const { limit = '100', offset = '0', before } = req.query;

    if (!organizationId) {
      logger.warn('[getTicketMessages] Несанкционированный доступ: organizationId не определен в res.locals.');
      return res.status(401).json({ error: 'Несанкционированный доступ: organizationId не определен.' });
    }

    if (isNaN(ticketNumber)) {
      logger.warn(`[getTicketMessages] Некорректный ticketNumber: "${req.params.ticketNumber}". Ожидалось число.`);
      return res.status(400).json({ error: 'Некорректный ticketNumber. Ожидалось число.' });
    }

    const take = Math.min(parseInt(limit as string, 10) || 100, 200);
    const skip = parseInt(offset as string, 10) || 0;

    const chat = await prisma.chat.findFirst({
      where: {
        ticketNumber,
        organizationId,
      },
      select: {
        id: true,
        ticketNumber: true,
        status: true,
        priority: true,
        assignedUserId: true,
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        organizationClients: {
          select: {
            id: true,
          },
          take: 1,
        },
        ticketHistory: {
          where: {
            changeType: {
              in: ['ticket_created', 'ticket_reopened'],
            },
          },
          select: {
            oldValue: true,
            newValue: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 30,
        },
      },
    });

    if (!chat) {
      logger.warn(`[getTicketMessages] Тикет с номером ${ticketNumber} не найден или не принадлежит организации ${organizationId}.`);
      return res.status(404).json({ error: 'Тикет не найден или не принадлежит вашей организации.' });
    }

    const whereCondition: any = {
      chatId: chat.id,
      organizationId,
    };

    if (before && typeof before === 'string') {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        whereCondition.timestamp = { lt: beforeDate };
      }
    }

    const totalCount = await prisma.message.count({
      where: { chatId: chat.id, organizationId },
    });

    const messages = await prisma.message.findMany({
      where: whereCondition,
      take,
      skip,
      select: {
        id: true,
        whatsappMessageId: true,
        content: true,
        senderJid: true,
        receivingPhoneJid: true,
        fromMe: true,
        type: true,
        mediaUrl: true,
        filename: true,
        mimeType: true,
        size: true,
        timestamp: true,
        status: true,
        isReadByOperator: true,
        quotedMessageId: true,
        quotedContent: true,
        senderUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        timestamp: 'desc',
      },
    });

    const messagesInChronologicalOrder = messages.reverse();

    const tickets = extractTicketTimeline(
      chat.ticketNumber,
      chat.status,
      chat.priority,
      chat.ticketHistory || []
    );

    const primaryClientId = chat.organizationClients?.[0]?.id ?? null;

    const hasResponsible = Boolean(chat.assignedUserId);
    const responsibleUser = hasResponsible ? chat.assignedUser : null;

    const messagesWithTicket = messagesInChronologicalOrder.map((message) => {
      return {
        ...message,
        ticketNumber: chat.ticketNumber,
        ticketStatus: chat.status,
        ticketPriority: chat.priority,
        clientId: primaryClientId,
        hasResponsible,
        responsibleUser,
      };
    });

    res.status(200).json({
      chat: {
        id: chat.id,
        ticketNumber: chat.ticketNumber,
      },
      ticket: chat.ticketNumber
        ? {
            number: chat.ticketNumber,
            status: chat.status,
            priority: chat.priority,
          }
        : null,
      tickets,
      messages: messagesWithTicket,
      pagination: {
        total: totalCount,
        limit: take,
        offset: skip,
        hasMore: skip + take < totalCount,
        oldestTimestamp: messagesWithTicket.length > 0 ? messagesWithTicket[0].timestamp : null,
        newestTimestamp: messagesWithTicket.length > 0 ? messagesWithTicket[messagesWithTicket.length - 1].timestamp : null,
      },
    });
  } catch (error: any) {
    logger.error(`[getTicketMessages] Ошибка при получении сообщений для тикета ${req.params.ticketNumber} организации ${res.locals.organizationId}:`, error);
    res.status(500).json({
      error: 'Не удалось получить сообщения тикета.',
      details: error.message,
    });
  }
}
