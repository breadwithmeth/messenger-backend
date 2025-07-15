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
exports.createAccount = createAccount;
const authStorage_1 = require("../config/authStorage");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
/**
 * Создает новую запись о WhatsApp-номере (аккаунте) для организации.
 * @param req Запрос Express. Ожидает organizationId (из res.locals), phoneJid, displayName в теле.
 * @param res Ответ Express.
 */
function createAccount(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const organizationId = res.locals.organizationId;
        const { phoneJid, displayName } = req.body;
        if (!organizationId || !phoneJid || !displayName) {
            logger.warn('[createAccount] Отсутствуют необходимые параметры: organizationId, phoneJid, или displayName.');
            return res.status(400).json({ error: 'Missing organizationId, phoneJid, or displayName' });
        }
        try {
            // Проверяем, не существует ли уже такой JID для данной организации
            const existingPhone = yield authStorage_1.prisma.organizationPhone.findFirst({
                where: {
                    phoneJid: phoneJid,
                    organizationId: organizationId,
                },
            });
            if (existingPhone) {
                logger.warn(`[createAccount] Попытка добавить существующий номер ${phoneJid} для организации ${organizationId}.`);
                return res.status(409).json({ error: 'WhatsApp phone with this JID already exists for this organization.' });
            }
            const newPhone = yield authStorage_1.prisma.organizationPhone.create({
                data: {
                    organizationId,
                    phoneJid,
                    displayName,
                    status: 'disconnected', // Начальный статус
                },
            });
            logger.info(`✅ Создан новый аккаунт: ID ${newPhone.id}, JID ${phoneJid}, Организация ${organizationId}.`);
            res.status(201).json(newPhone);
        }
        catch (error) {
            logger.error(`❌ Ошибка при создании аккаунта для организации ${organizationId}:`, error);
            res.status(500).json({ error: 'Failed to create account', details: error.message });
        }
    });
}
