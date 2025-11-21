// src/routes/ticketRoutes.ts

import { Router } from 'express';
import {
  listTickets,
  getTicketByNumber,
  assignTicket,
  changeTicketStatus,
  changeTicketPriority,
  addTicketTag,
  removeTicketTag,
  getTicketHistory,
  addTicketNote,
  getTicketStats,
  getTicketMessages
} from '../controllers/ticketController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Применить middleware авторизации ко всем роутам
router.use(authMiddleware);

// Статистика по тикетам
router.get('/stats', getTicketStats);

// Список тикетов с фильтрацией
router.get('/', listTickets);

// Получить тикет по номеру
router.get('/:ticketNumber', getTicketByNumber);

// Получить сообщения тикета (только чтение)
router.get('/:ticketNumber/messages', getTicketMessages);

// Назначить тикет оператору
router.post('/:ticketNumber/assign', assignTicket);

// Изменить статус тикета
router.post('/:ticketNumber/status', changeTicketStatus);

// Изменить приоритет тикета
router.post('/:ticketNumber/priority', changeTicketPriority);

// Управление тегами
router.post('/:ticketNumber/tags', addTicketTag);
router.delete('/:ticketNumber/tags/:tag', removeTicketTag);

// Получить историю изменений
router.get('/:ticketNumber/history', getTicketHistory);

// Добавить внутреннюю заметку
router.post('/:ticketNumber/notes', addTicketNote);

export default router;
