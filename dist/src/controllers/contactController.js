"use strict";
// src/controllers/contactController.ts
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
exports.getContactProfile = getContactProfile;
const baileys_1 = require("../config/baileys");
const baileys_2 = require("@whiskeysockets/baileys");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
// GET /api/chats/:remoteJid/profile
function getContactProfile(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const organizationId = res.locals.organizationId;
        const { organizationPhoneId } = req.query; // какой аккаунт использовать для запроса
        const { remoteJid } = req.params;
        if (!organizationId) {
            return res.status(401).json({ error: 'Несанкционированный доступ' });
        }
        const phoneIdNum = Number(organizationPhoneId);
        if (!phoneIdNum || Number.isNaN(phoneIdNum)) {
            return res.status(400).json({ error: 'Укажите organizationPhoneId как число в query' });
        }
        const sock = (0, baileys_1.getBaileysSock)(phoneIdNum);
        if (!sock || !sock.user) {
            return res.status(503).json({ error: 'WhatsApp аккаунт не готов' });
        }
        const jid = (0, baileys_2.jidNormalizedUser)(remoteJid);
        if (!jid) {
            return res.status(400).json({ error: 'Некорректный remoteJid' });
        }
        try {
            // Фото профиля (может быть недоступно по настройкам приватности)
            let photoUrl = undefined;
            try {
                photoUrl = yield sock.profilePictureUrl(jid, 'image');
            }
            catch (e) {
                logger.debug(`[getContactProfile] Нет фото для ${jid}: ${String(e)}`);
            }
            // Имя: на бекенде мы сохраняем Chat.name из pushName. Здесь вернем только фото и jid.
            res.json({ jid, photoUrl: photoUrl || null });
        }
        catch (error) {
            logger.error(`[getContactProfile] Ошибка получения профиля ${remoteJid}:`, error);
            res.status(500).json({ error: 'Не удалось получить профиль контакта', details: error === null || error === void 0 ? void 0 : error.message });
        }
    });
}
//# sourceMappingURL=contactController.js.map