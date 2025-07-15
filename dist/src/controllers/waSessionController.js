"use strict";
// 📁 src/controllers/waSessionController.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSessionHandler = startSessionHandler;
exports.getSessionsHandler = getSessionsHandler;
exports.getQrHandler = getQrHandler;
// import { getQrCodeForSession } from '../config/baileys'; // <-- УДАЛИТЬ ЭТУ СТРОКУ, т.к. она больше не нужна
const authStorage_1 = require("../config/authStorage"); // Импортируем prisma клиент
// ... (ваша функция startSessionHandler - она уже была переписана и корректна) ...
function startSessionHandler(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        // ... (код startSessionHandler без изменений) ...
    });
}
// ... (ваша функция getSessionsHandler - она уже была переписана и корректна) ...
function getSessionsHandler(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        // ... (код getSessionsHandler без изменений) ...
    });
}
// Получение QR-кода для подключения
function getQrHandler(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const organizationId = res.locals.organizationId; // Получаем из middleware
        const { phoneJid } = req.query; // Query params по умолчанию строки
        if (!organizationId || !phoneJid) {
            return res.status(400).json({ error: 'organizationId и phoneJid обязательны.' });
        }
        try {
            // Находим OrganizationPhone, чтобы получить его текущий статус и QR-код из БД
            const organizationPhone = yield authStorage_1.prisma.organizationPhone.findUnique({
                where: {
                    organizationId: organizationId,
                    phoneJid: String(phoneJid), // Убеждаемся, что phoneJid - это строка
                },
                select: { id: true, status: true, qrCode: true }, // Выбираем qrCode
            });
            if (!organizationPhone) {
                return res.status(404).json({ error: 'Указанный номер WhatsApp не найден для вашей организации. Пожалуйста, сначала запустите сессию.' });
            }
            // Если сессия уже подключена, QR-код не нужен
            if (organizationPhone.status === 'connected') {
                return res.status(200).json({ message: 'Сессия уже подключена, QR-код не требуется.', status: organizationPhone.status });
            }
            // Получаем QR-код непосредственно из записи БД
            const qr = organizationPhone.qrCode;
            if (!qr) {
                // Если QR-код еще не готов, но сессия в статусе 'pending' или 'loading'
                if (organizationPhone.status === 'pending' || organizationPhone.status === 'loading') {
                    return res.status(202).json({ error: 'QR код ещё не готов или сессия находится в процессе запуска. Попробуйте снова через несколько секунд.', status: organizationPhone.status });
                }
                return res.status(404).json({ error: 'QR код недоступен. Возможно, сессия была отключена или требует перезапуска.', status: organizationPhone.status });
            }
            res.json({ qrCode: qr, status: organizationPhone.status }); // Отдаем QR-код
        }
        catch (error) {
            console.error('Ошибка получения QR-кода:', error);
            res.status(500).json({ error: 'Не удалось получить QR-код. Подробности в логах сервера.' });
        }
    });
}
//# sourceMappingURL=waSessionController.js.map