"use strict";
// src/controllers/chatController.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.getChatMessages = void 0;
exports.listChats = listChats;
const chatService = __importStar(require("../services/chatService"));
const pino_1 = __importDefault(require("pino"));
const authStorage_1 = require("../config/authStorage"); // Используем единый клиент Prisma
const logger = (0, pino_1.default)({ level: 'info' });
// export async function createChat(req: Request, res: Response) {
//   try {
//     const { organizationId, clientId, operatorId } = req.body;
//     if (!organizationId || !clientId || !operatorId) {
//       return res.status(400).json({ error: 'Не указаны обязательные поля' });
//     }
//     const chat = await chatService.createChat(organizationId, clientId, operatorId);
//     res.json(chat);
//   } catch (err) {
//     res.status(500).json({ error: 'Ошибка создания чата' });
//   }
// }
function listChats(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const organizationId = res.locals.organizationId; // Получаем organizationId из токена
            if (!organizationId) {
                logger.warn('[listChats] organizationId не определен в res.locals.');
                return res.status(400).json({ error: 'organizationId обязателен' });
            }
            // Получаем чаты с датой последнего сообщения и сортируем по ней
            const chats = yield chatService.getChatsByOrganizationSortedByLastMessage(organizationId);
            res.json(chats);
        }
        catch (err) {
            logger.error(`[listChats] Ошибка получения чатов для организации ${res.locals.organizationId || 'неизвестно'}:`, err);
            res.status(500).json({ error: 'Ошибка получения чатов', details: err.message });
        }
    });
}
const getChatMessages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const organizationId = res.locals.organizationId; // Получаем ID организации из middleware
    const chatId = parseInt(req.params.chatId, 10); // Получаем chatId из параметров маршрута
    if (!organizationId) {
        logger.warn('[getChatMessages] Несанкционированный доступ: organizationId не определен в res.locals.');
        return res.status(401).json({ error: 'Несанкционированный доступ: organizationId не определен.' });
    }
    if (isNaN(chatId)) {
        logger.warn(`[getChatMessages] Некорректный chatId: "${req.params.chatId}". Ожидалось число.`);
        return res.status(400).json({ error: 'Некорректный chatId. Ожидалось число.' });
    }
    try {
        // Проверяем, что чат принадлежит данной организации, чтобы предотвратить доступ к чужим чатам
        const chat = yield authStorage_1.prisma.chat.findUnique({
            where: {
                id: chatId,
                organizationId: organizationId,
            },
            select: { id: true }, // Выбираем только id, т.к. нас интересует только существование чата и его принадлежность
        });
        if (!chat) {
            logger.warn(`[getChatMessages] Чат с ID ${chatId} не найден или не принадлежит организации ${organizationId}.`);
            return res.status(404).json({ error: 'Чат не найден или не принадлежит вашей организации.' });
        }
        // Получаем все сообщения для этого чата, отсортированные по времени
        const messages = yield authStorage_1.prisma.message.findMany({
            where: {
                chatId: chatId,
                organizationId: organizationId, // Дополнительная проверка на принадлежность сообщения организации
            },
            orderBy: {
                timestamp: 'asc', // Сортируем по возрастанию времени для хронологического порядка
            },
            // Явно выбираем все поля, чтобы убедиться, что новые данные (ответы, медиа) включены
            select: {
                id: true,
                organizationId: true,
                organizationPhoneId: true,
                chatId: true,
                whatsappMessageId: true,
                receivingPhoneJid: true,
                remoteJid: true,
                senderJid: true,
                fromMe: true,
                content: true,
                type: true,
                mediaUrl: true,
                filename: true,
                mimeType: true,
                size: true,
                timestamp: true,
                status: true,
                quotedMessageId: true,
                quotedContent: true,
                createdAt: true,
                updatedAt: true,
            }
        });
        logger.info(`[getChatMessages] Успешно получено ${messages.length} сообщений для чата ${chatId} организации ${organizationId}.`);
        res.status(200).json({ messages });
    }
    catch (error) {
        logger.error(`[getChatMessages] Ошибка при получении сообщений для чата ${chatId} организации ${organizationId}:`, error);
        res.status(500).json({
            error: 'Не удалось получить сообщения чата.',
            details: error.message,
        });
    }
});
exports.getChatMessages = getChatMessages;
