"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChatsByOrganizationSortedByLastMessage = getChatsByOrganizationSortedByLastMessage;
// src/services/chatService.ts
const authStorage_1 = require("../config/authStorage");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
function getChatsByOrganizationSortedByLastMessage(organizationId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const chats = yield authStorage_1.prisma.chat.findMany({
                where: {
                    organizationId: organizationId,
                },
                orderBy: [
                    { priority: 'desc' }, // Сначала по приоритету
                    { unreadCount: 'desc' }, // Затем по количеству непрочитанных
                    { lastMessageAt: 'desc' }, // Затем по дате последнего сообщения
                ],
                include: {
                    organizationPhone: {
                        select: {
                            id: true,
                            phoneJid: true,
                            displayName: true,
                        },
                    },
                    // Включаем информацию о назначенном операторе
                    assignedUser: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    // Включаем информацию о клиентах
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
                    // --- ИЗМЕНЕНИЕ ЗДЕСЬ: Добавляем orderBy для messages, чтобы получить последнее ---
                    messages: {
                        take: 1, // Берем только одно сообщение
                        orderBy: {
                            timestamp: 'desc', // Сортируем сообщения в чате по убыванию времени (самое новое будет первым)
                        },
                        select: {
                            id: true,
                            content: true,
                            senderJid: true,
                            timestamp: true,
                            fromMe: true,
                            type: true,
                            isReadByOperator: true,
                        },
                    },
                    // --- КОНЕЦ ИЗМЕНЕНИЯ ---
                },
            });
            logger.info(`✅ Получено ${chats.length} чатов для организации ${organizationId}.`);
            // Если вы хотите, чтобы последнее сообщение было легко доступно как `chat.lastMessage`,
            // можно слегка преобразовать результат.
            const chatsWithLastMessage = chats.map(chat => (Object.assign(Object.assign({}, chat), { lastMessage: chat.messages.length > 0 ? chat.messages[0] : null, messages: undefined })));
            return chatsWithLastMessage;
        }
        catch (error) {
            logger.error(`❌ Ошибка в getChatsByOrganizationSortedByLastMessage для организации ${organizationId}:`, error);
            throw error; // Перебрасываем ошибку для обработки в контроллере
        }
    });
}
//# sourceMappingURL=chatService.js.map