"use strict";
// src/services/aiService.ts
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
exports.getSuggestedResponses = getSuggestedResponses;
exports.checkAIServiceHealth = checkAIServiceHealth;
const openai_1 = __importDefault(require("openai"));
const authStorage_1 = require("../config/authStorage");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
// DeepSeek API configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
if (!DEEPSEEK_API_KEY) {
    logger.warn('[AI Service] DEEPSEEK_API_KEY не установлен в переменных окружения');
}
const openai = new openai_1.default({
    apiKey: DEEPSEEK_API_KEY,
    baseURL: DEEPSEEK_BASE_URL,
});
/**
 * Получает предложения ответов для чата на основе истории сообщений за последний час
 */
function getSuggestedResponses(chatId_1, organizationId_1) {
    return __awaiter(this, arguments, void 0, function* (chatId, organizationId, limit = 3) {
        var _a, _b;
        try {
            logger.info(`[AI Service] Генерация предложений для чата #${chatId}`);
            // Получаем чат для контекста
            const chat = yield authStorage_1.prisma.chat.findUnique({
                where: { id: chatId, organizationId },
                select: {
                    id: true,
                    name: true,
                    channel: true,
                    status: true,
                },
            });
            if (!chat) {
                throw new Error('Чат не найден');
            }
            // Получаем сообщения за последний час
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const messages = yield authStorage_1.prisma.message.findMany({
                where: {
                    chatId,
                    timestamp: {
                        gte: oneHourAgo,
                    },
                },
                orderBy: {
                    timestamp: 'asc',
                },
                select: {
                    id: true,
                    content: true,
                    fromMe: true,
                    timestamp: true,
                    type: true,
                    senderUser: {
                        select: {
                            name: true,
                            email: true,
                        },
                    },
                },
                take: 50, // Ограничиваем количество сообщений для контекста
            });
            if (messages.length === 0) {
                logger.warn(`[AI Service] Нет сообщений за последний час для чата #${chatId}`);
                return [];
            }
            // Формируем историю диалога для AI
            const conversationHistory = messages
                .filter(msg => msg.type === 'text' && msg.content) // Только текстовые сообщения
                .map(msg => {
                const sender = msg.fromMe
                    ? `Оператор${msg.senderUser ? ` (${msg.senderUser.name || msg.senderUser.email})` : ''}`
                    : `Клиент (${chat.name})`;
                return `${sender}: ${msg.content}`;
            })
                .join('\n');
            if (!conversationHistory) {
                logger.warn(`[AI Service] Нет текстовых сообщений для анализа в чате #${chatId}`);
                return [];
            }
            // Определяем последнее сообщение от клиента
            const lastClientMessage = messages
                .filter(msg => !msg.fromMe && msg.type === 'text' && msg.content)
                .slice(-1)[0];
            if (!lastClientMessage) {
                logger.info(`[AI Service] Нет сообщений от клиента для ответа в чате #${chatId}`);
                return [];
            }
            // Формируем промт для DeepSeek
            const systemPrompt = `Ты - помощник для операторов службы поддержки сервиса доставки алкоголя "Налив/Градусы24". Твоя задача - предложить ${limit} кратких и профессиональных варианта ответа на последнее сообщение клиента на основе контекста разговора.

КОНТЕКСТ БИЗНЕСА:
- Сервис доставки алкогольных напитков
- Важна скорость доставки и качество продукции
- Работаем с эмоциональными клиентами (иногда в состоянии алкогольного опьянения)
- Могут быть конфликты из-за: опозданий доставки, неправильного заказа, качества продукции, цен

ГЛАВНАЯ ЦЕЛЬ:
- Максимально мирно разрешить конфликтную ситуацию
- Де-эскалация напряжения
- Сохранить клиента и репутацию компании

СТРАТЕГИЯ ОТВЕТОВ:
1. ЭМПАТИЯ - признать чувства клиента ("понимаю ваше недовольство", "вижу, что ситуация вас расстроила")
2. ИЗВИНЕНИЯ - принести извинения даже если вины нет ("приносим извинения за неудобства")
3. РЕШЕНИЕ - предложить конкретное решение (компенсация, скидка, перезаказ, возврат)
4. ДЕЙСТВИЕ - показать, что проблема решается прямо сейчас

ТАКТИКИ ДЕ-ЭСКАЛАЦИИ:
- Спокойный, уважительный тон даже при грубости клиента
- Не спорить и не обвинять клиента
- Использовать фразы: "давайте разберёмся", "мы поможем вам", "сделаем всё возможное"
- Предлагать компенсацию: промокод, бесплатная доставка, возврат средств
- При агрессии - подчёркивать готовность помочь

ВАЖНО:
- НЕ обещать то, что не можем выполнить
- Быть честными о времени доставки и ценах
- При технических проблемах - объяснить и извиниться
- Если клиент пьян и агрессивен - сохранять профессионализм

Требования к ответам:
- Ответы должны быть на русском языке
- Каждый ответ 1-3 предложения
- Вежливый, но не заискивающий тон
- Учитывай эмоциональное состояние клиента
- Предлагай конкретные действия для решения проблемы
- Варианты: 1) эмпатичный с решением 2) извинения с компенсацией 3) уточняющий с готовностью помочь
- Не используй номера или маркеры списка
- Каждый ответ на новой строке`;
            const userPrompt = `История разговора с клиентом:
${conversationHistory}

Последнее сообщение клиента: "${lastClientMessage.content}"

Проанализируй тон и эмоции клиента. Если есть признаки конфликта или недовольства - предложи варианты для де-эскалации и мирного решения. Предложи ${limit} варианта ответа оператора. Каждый вариант на отдельной строке без нумерации.`;
            logger.info(`[AI Service] Отправка запроса в DeepSeek API для чата #${chatId}`);
            // Запрос к DeepSeek API
            const completion = yield openai.chat.completions.create({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.7,
                max_tokens: 500,
            });
            const response = (_b = (_a = completion.choices[0]) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.content;
            if (!response) {
                logger.error('[AI Service] DeepSeek не вернул ответ');
                return [];
            }
            // Парсим ответ - разделяем по строкам и фильтруем пустые
            const suggestions = response
                .split('\n')
                .map(line => line.trim())
                .filter(line => {
                // Убираем строки с нумерацией (1., 2., - и т.д.)
                return line.length > 0 && !line.match(/^[\d\-\*\•]+[\.\)]\s*/);
            })
                .slice(0, limit); // Ограничиваем до запрошенного количества
            logger.info(`[AI Service] Сгенерировано ${suggestions.length} предложений для чата #${chatId}`);
            return suggestions;
        }
        catch (error) {
            logger.error(`[AI Service] Ошибка генерации предложений для чата #${chatId}:`, error);
            // Более детальная ошибка для отладки
            if (error.response) {
                logger.error('[AI Service] DeepSeek API ответ:', error.response.data);
            }
            throw new Error(`Не удалось сгенерировать предложения: ${error.message}`);
        }
    });
}
/**
 * Проверка доступности DeepSeek API
 */
function checkAIServiceHealth() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const completion = yield openai.chat.completions.create({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'test' }],
                max_tokens: 5,
            });
            return !!((_b = (_a = completion.choices[0]) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.content);
        }
        catch (error) {
            logger.error('[AI Service] Health check failed:', error);
            return false;
        }
    });
}
//# sourceMappingURL=aiService.js.map