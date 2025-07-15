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
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
exports.createAuthDBAdapter = createAuthDBAdapter;
// src/config/authStorage.ts
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
exports.prisma = prisma;
function createAuthDBAdapter(organizationId, phoneJid) {
    return {
        get(key) {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    const record = yield prisma.baileysAuth.findUnique({
                        where: {
                            organizationId_phoneJid_key: {
                                organizationId,
                                phoneJid,
                                key,
                            },
                        },
                    });
                    return record ? { value: record.value, type: record.type } : null;
                }
                catch (error) {
                    console.error(`Prisma: Ошибка при получении ключа "${key}" для ${organizationId}/${phoneJid}:`, error);
                    // Не выбрасываем ошибку, чтобы Baileys мог продолжить, как если бы ключ отсутствовал
                    return null;
                }
            });
        },
        set(key, value, dataType) {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    yield prisma.baileysAuth.upsert({
                        where: {
                            organizationId_phoneJid_key: {
                                organizationId,
                                phoneJid,
                                key,
                            },
                        },
                        update: {
                            value: value,
                            type: dataType,
                        },
                        create: {
                            organizationId: organizationId,
                            phoneJid: phoneJid,
                            key: key,
                            value: value,
                            type: dataType,
                        },
                    });
                }
                catch (error) {
                    console.error(`Prisma: Ошибка при установке ключа "${key}" для ${organizationId}/${phoneJid}:`, error);
                    throw error; // Здесь выбрасываем, так как запись важна
                }
            });
        },
        delete(key) {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    yield prisma.baileysAuth.delete({
                        where: {
                            organizationId_phoneJid_key: {
                                organizationId,
                                phoneJid,
                                key,
                            },
                        },
                    });
                }
                catch (error) {
                    if (error.code === 'P2025') { // P2025 - запись не найдена
                        return;
                    }
                    console.error(`Prisma: Ошибка при удалении ключа "${key}" для ${organizationId}/${phoneJid}:`, error);
                    throw error;
                }
            });
        },
    };
}
