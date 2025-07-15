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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMe = exports.getUsersByOrganization = exports.createUser = void 0;
const client_1 = require("@prisma/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const prisma = new client_1.PrismaClient();
/**
 * Создание нового пользователя (оператора или администратора).
 * ID организации берется из токена аутентифицированного пользователя.
 */
const createUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const { email, password, name, role } = req.body;
    // Получаем ID организации из объекта user, добавленного authMiddleware
    const organizationId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.organizationId;
    // Валидация обязательных полей
    if (!email || !password || !name) {
        return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    // Проверка, что organizationId доступен
    if (!organizationId) {
        return res.status(401).json({ error: 'Could not determine user organization. Invalid token.' });
    }
    try {
        // 1. Проверяем, существует ли организация (дополнительная проверка)
        const organization = yield prisma.organization.findUnique({
            where: { id: organizationId },
        });
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        // 2. Хешируем пароль
        const salt = yield bcrypt_1.default.genSalt(10);
        const passwordHash = yield bcrypt_1.default.hash(password, salt);
        // 3. Создаем пользователя в базе данных с ID организации создателя
        const newUser = yield prisma.user.create({
            data: {
                email,
                passwordHash,
                name,
                organizationId: organizationId, // Используем ID из токена
                role: role || 'operator',
            },
        });
        // 4. Убираем хеш пароля из ответа для безопасности
        const { passwordHash: _ } = newUser, userWithoutPassword = __rest(newUser, ["passwordHash"]);
        res.status(201).json(userWithoutPassword);
    }
    catch (error) {
        // Обработка ошибки, если пользователь с таким email уже существует
        if (error.code === 'P2002' && ((_c = (_b = error.meta) === null || _b === void 0 ? void 0 : _b.target) === null || _c === void 0 ? void 0 : _c.includes('email'))) {
            return res.status(409).json({ error: 'User with this email already exists' });
        }
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Internal server error while creating user' });
    }
});
exports.createUser = createUser;
// Получение списка пользователей (операторов) для организации текущего пользователя
const getUsersByOrganization = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // --- ИСПРАВЛЕНО: Получаем organizationId из req.user, а не из res.locals.user ---
        const { organizationId } = req.user;
        if (!organizationId) {
            return res.status(400).json({ message: 'Organization ID не найден в токене' });
        }
        const users = yield prisma.user.findMany({
            where: {
                organizationId: organizationId,
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
            },
        });
        res.status(200).json(users);
    }
    catch (error) {
        console.error('Ошибка при получении пользователей по организации:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});
exports.getUsersByOrganization = getUsersByOrganization;
// --- НОВЫЙ МЕТОД ---
// Получение информации о текущем пользователе (себе)
const getMe = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.user;
        if (!userId) {
            return res.status(400).json({ message: 'User ID не найден в токене' });
        }
        const user = yield prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                role: true,
                organizationId: true,
                createdAt: true,
            },
        });
        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }
        res.status(200).json(user);
    }
    catch (error) {
        console.error('Ошибка при получении данных пользователя:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});
exports.getMe = getMe;
//# sourceMappingURL=userController.js.map