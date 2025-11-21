"use strict";
// src/routes/ticketRoutes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ticketController_1 = require("../controllers/ticketController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Применить middleware авторизации ко всем роутам
router.use(authMiddleware_1.authMiddleware);
// Статистика по тикетам
router.get('/stats', ticketController_1.getTicketStats);
// Список тикетов с фильтрацией
router.get('/', ticketController_1.listTickets);
// Получить тикет по номеру
router.get('/:ticketNumber', ticketController_1.getTicketByNumber);
// Получить сообщения тикета (только чтение)
router.get('/:ticketNumber/messages', ticketController_1.getTicketMessages);
// Назначить тикет оператору
router.post('/:ticketNumber/assign', ticketController_1.assignTicket);
// Изменить статус тикета
router.post('/:ticketNumber/status', ticketController_1.changeTicketStatus);
// Изменить приоритет тикета
router.post('/:ticketNumber/priority', ticketController_1.changeTicketPriority);
// Управление тегами
router.post('/:ticketNumber/tags', ticketController_1.addTicketTag);
router.delete('/:ticketNumber/tags/:tag', ticketController_1.removeTicketTag);
// Получить историю изменений
router.get('/:ticketNumber/history', ticketController_1.getTicketHistory);
// Добавить внутреннюю заметку
router.post('/:ticketNumber/notes', ticketController_1.addTicketNote);
exports.default = router;
//# sourceMappingURL=ticketRoutes.js.map