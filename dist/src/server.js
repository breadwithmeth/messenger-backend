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
const http_1 = __importDefault(require("http"));
const app_1 = __importDefault(require("./app"));
const waService_1 = require("./services/waService"); // Импортируйте startWaSession
const telegramService_1 = require("./services/telegramService"); // <-- НОВОЕ
const socketService_1 = require("./services/socketService"); // <-- Socket.IO
const pino_1 = __importDefault(require("pino")); // Добавьте импорт pino
const authStorage_1 = require("./config/authStorage"); // Импортируйте prisma
const PORT = process.env.PORT || 3000;
const server = http_1.default.createServer(app_1.default);
const logger = (0, pino_1.default)({ level: 'info' }); // Инициализируйте logger
// Инициализируем Socket.IO
(0, socketService_1.initializeSocketIO)(server);
logger.info('[ServerInit] Socket.IO инициализирован');
function initializeConnectedSessions() {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info('[ServerInit] Начинаем инициализацию ранее подключенных WhatsApp сессий...');
        try {
            const connectedPhones = yield authStorage_1.prisma.organizationPhone.findMany({
                where: {
                    // КРИТИЧЕСКИ ВАЖНОЕ УСЛОВИЕ:
                    // Убедитесь, что здесь перечислены ВСЕ статусы, при которых вы хотите инициализировать сессию.
                    // 'connected': если сессия была активна и должна быть восстановлена.
                    // 'disconnected': если сессия временно отключилась и нужно переподключиться (обычно без QR).
                    // 'logged_out': если сессия вышла из системы и нужен НОВЫЙ QR-код (после удаления auth файлов).
                    // null: если статус еще не был установлен (например, новая запись в БД).
                    status: {
                        in: ['connected', 'disconnected', 'logged_out', 'pending']
                    },
                    // Если у вас несколько организаций и вы хотите инициализировать только определенные,
                    // раскомментируйте и установите organizationId, иначе оставьте закомментированным.
                    // organizationId: 1 // Пример: для тестирования с конкретной организацией
                },
            });
            logger.info(`[ServerInit] Запрос к БД завершен. Найдено ${connectedPhones.length} аккаунтов для инициализации.`);
            if (connectedPhones.length === 0) {
                logger.info('[ServerInit] Нет ранее подключенных WhatsApp аккаунтов со статусами "connected", "disconnected", "logged_out" или null для инициализации.');
                return;
            }
            for (const phone of connectedPhones) {
                logger.info(`[ServerInit] Обрабатываем OrganizationPhone. ID: ${phone.id}, JID: ${phone.phoneJid}, Текущий статус: ${phone.status}, Org ID: ${phone.organizationId}`);
                // Убедитесь, что phone.organizationId, phone.phoneJid, phone.id передаются правильно
                yield (0, waService_1.startWaSession)(phone.organizationId, phone.phoneJid, phone.id);
                logger.info(`[ServerInit] startWaSession вызвана для ${phone.phoneJid}.`);
            }
            logger.info(`[ServerInit] Инициализация всех найденных сессий завершена.`);
        }
        catch (error) {
            logger.error(`[ServerInit] КРИТИЧЕСКАЯ ОШИБКА при инициализации подключенных сессий: ${error.message}`, error); // Выводим и объект ошибки
        }
    });
}
server.listen(PORT, () => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`Server is running on port ${PORT}`);
    logger.info(`[ServerInit] HTTP сервер запущен на порту ${PORT}`);
    logger.info(`[ServerInit] Socket.IO доступен на ws://localhost:${PORT}`);
    // Вызываем функцию инициализации WhatsApp сессий после старта сервера
    yield initializeConnectedSessions();
    // Запускаем все активные Telegram боты
    logger.info('[ServerInit] Запуск Telegram ботов...');
    yield (0, telegramService_1.startAllTelegramBots)();
    logger.info('[ServerInit] Telegram боты запущены');
}));
// Graceful shutdown - останавливаем ботов при выключении сервера
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    logger.info('[ServerShutdown] Получен сигнал SIGINT, останавливаем Telegram ботов...');
    yield (0, telegramService_1.stopAllTelegramBots)();
    logger.info('[ServerShutdown] Telegram боты остановлены');
    process.exit(0);
}));
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    logger.info('[ServerShutdown] Получен сигнал SIGTERM, останавливаем Telegram ботов...');
    yield (0, telegramService_1.stopAllTelegramBots)();
    logger.info('[ServerShutdown] Telegram боты остановлены');
    process.exit(0);
}));
//# sourceMappingURL=server.js.map