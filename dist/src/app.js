"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const organizationRoutes_1 = __importDefault(require("./routes/organizationRoutes"));
const chatRoutes_1 = __importDefault(require("./routes/chatRoutes"));
const messageRoutes_1 = __importDefault(require("./routes/messageRoutes"));
const waRoutes_1 = __importDefault(require("./routes/waRoutes"));
const errorHandler_1 = __importDefault(require("./middlewares/errorHandler")); // Corrected import path
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path")); // <--- ДОБАВИТЬ
const pino_1 = __importDefault(require("pino")); // Добавьте импорт pino
const organizationPhoneRoutes_1 = __importDefault(require("./routes/organizationPhoneRoutes"));
const accountRoutes_1 = __importDefault(require("./routes/accountRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes")); // <-- Добавить
const app = (0, express_1.default)();
const logger = (0, pino_1.default)({ level: 'info' }); // Инициализируйте logger
app.use(express_1.default.json());
app.use((0, cors_1.default)());
// --- ДОБАВИТЬ: Раздача статических файлов ---
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
app.use('/api/auth', authRoutes_1.default);
app.use('/api/organizations', organizationRoutes_1.default);
app.use('/api/chats', chatRoutes_1.default);
app.use('/api/messages', messageRoutes_1.default);
app.use('/api/wa', waRoutes_1.default);
app.use('/api/organization-phones', organizationPhoneRoutes_1.default);
app.use('/api/accounts', accountRoutes_1.default);
app.use('/api/users', userRoutes_1.default); // <-- Добавить
// Глобальный обработчик ошибок
app.use(errorHandler_1.default);
exports.default = app;
//# sourceMappingURL=app.js.map