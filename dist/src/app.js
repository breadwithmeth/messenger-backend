"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config(); // Загружаем переменные окружения из .env
const express_1 = __importDefault(require("express"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const organizationRoutes_1 = __importDefault(require("./routes/organizationRoutes"));
const chatRoutes_1 = __importDefault(require("./routes/chatRoutes"));
const messageRoutes_1 = __importDefault(require("./routes/messageRoutes"));
const waRoutes_1 = __importDefault(require("./routes/waRoutes"));
const chatAssignmentRoutes_1 = __importDefault(require("./routes/chatAssignmentRoutes"));
const messageReadRoutes_1 = __importDefault(require("./routes/messageReadRoutes"));
const unreadRoutes_1 = __importDefault(require("./routes/unreadRoutes"));
const mediaRoutes_1 = __importDefault(require("./routes/mediaRoutes"));
const ticketRoutes_1 = __importDefault(require("./routes/ticketRoutes"));
const telegramRoutes_1 = __importDefault(require("./routes/telegramRoutes")); // <-- НОВОЕ
const wabaRoutes_1 = __importDefault(require("./routes/wabaRoutes")); // <-- WABA интеграция
const aiRoutes_1 = __importDefault(require("./routes/aiRoutes")); // <-- AI предложения ответов
const analyticsRoutes_1 = __importDefault(require("./routes/analyticsRoutes"));
const errorHandler_1 = __importDefault(require("./middlewares/errorHandler")); // Corrected import path
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path")); // <--- ДОБАВИТЬ
const pino_1 = __importDefault(require("pino")); // Добавьте импорт pino
const organizationPhoneRoutes_1 = __importDefault(require("./routes/organizationPhoneRoutes"));
const accountRoutes_1 = __importDefault(require("./routes/accountRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes")); // <-- Добавить
const contactRoutes_1 = __importDefault(require("./routes/contactRoutes"));
const clientRoutes_1 = __importDefault(require("./routes/clientRoutes")); // <-- Клиенты организации
const app = (0, express_1.default)();
const logger = (0, pino_1.default)({ level: 'info' }); // Инициализируйте logger
app.use(express_1.default.json());
// --- Расширенная настройка CORS ---
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = {
    // Если список не задан, отражаем Origin (для dev/prod) — безопаснее, чем '*', когда нужны credentials
    origin: allowedOrigins.length
        ? (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin))
                return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        }
        : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
    optionsSuccessStatus: 204,
};
app.use((0, cors_1.default)(corsOptions));
// Обрабатываем preflight без паттерна '*', который ломается в Express 5/path-to-regexp
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        // cors(corsOptions) уже проставил заголовки — возвращаем 204
        return res.sendStatus(204);
    }
    next();
});
// --- ДОБАВЛЯЕМ ОБЩЕЕ ЛОГИРОВАНИЕ ВСЕХ ЗАПРОСОВ ---
app.use((req, res, next) => {
    // console.log(`🌐 INCOMING REQUEST: ${req.method} ${req.originalUrl}`);
    // console.log(`🌐 Headers:`, req.headers);
    next();
});
// --- ДОБАВИТЬ: Раздача статических файлов ---
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
// Простой healthcheck (и для проверки CORS в проде)
app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, ts: new Date().toISOString() });
});
app.use('/api/auth', authRoutes_1.default);
app.use('/api/organizations', organizationRoutes_1.default);
app.use('/api/chats', chatRoutes_1.default);
app.use('/api/messages', messageRoutes_1.default);
app.use('/api/wa', waRoutes_1.default);
app.use('/api/organization-phones', organizationPhoneRoutes_1.default);
app.use('/api/accounts', accountRoutes_1.default);
app.use('/api/users', userRoutes_1.default); // <-- Добавить
app.use('/api/clients', clientRoutes_1.default); // <-- API для клиентов организации
app.use('/api/waba', wabaRoutes_1.default); // <-- ВАЖНО: ПЕРЕД /api, чтобы не перехватывался contactRoutes
app.use('/api', contactRoutes_1.default);
app.use('/api/chat-assignment', chatAssignmentRoutes_1.default); // Новые маршруты для назначения чатов
app.use('/api/message-read', messageReadRoutes_1.default); // Новые маршруты для непрочитанных сообщений
console.log('🔄 Подключаем unread маршруты...');
app.use('/api/unread', unreadRoutes_1.default); // Маршруты для управления непрочитанными сообщениями
console.log('✅ Unread маршруты подключены');
app.use('/api/media', mediaRoutes_1.default); // Маршруты для загрузки и отправки медиафайлов
app.use('/api/tickets', ticketRoutes_1.default); // Маршруты для тикет-системы
app.use('/api/telegram', telegramRoutes_1.default); // <-- НОВОЕ: Маршруты для Telegram
app.use('/api/ai', aiRoutes_1.default); // <-- AI предложения ответов
app.use('/api/analytics', analyticsRoutes_1.default);
// 404 JSON для несуществующих маршрутов
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', method: req.method, path: req.originalUrl });
});
// Глобальный обработчик ошибок
app.use(errorHandler_1.default);
exports.default = app;
//# sourceMappingURL=app.js.map