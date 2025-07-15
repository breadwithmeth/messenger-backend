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
exports.getBaileysAuthState = getBaileysAuthState;
exports.setBaileysAuthState = setBaileysAuthState;
exports.removeBaileysAuthState = removeBaileysAuthState;
const prisma_1 = __importDefault(require("../config/prisma"));
function getBaileysAuthState(organizationId, phoneJid, key) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma_1.default.baileysAuthState.findUnique({
            where: {
                organizationId_phoneJid_key: {
                    organizationId,
                    phoneJid,
                    key,
                },
            },
        });
    });
}
function setBaileysAuthState(organizationId, phoneJid, key, value) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma_1.default.baileysAuthState.upsert({
            where: {
                organizationId_phoneJid_key: {
                    organizationId,
                    phoneJid,
                    key,
                },
            },
            update: { value },
            create: { organizationId, phoneJid, key, value },
        });
    });
}
function removeBaileysAuthState(organizationId, phoneJid, key) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma_1.default.baileysAuthState.deleteMany({
            where: { organizationId, phoneJid, key },
        });
    });
}
//# sourceMappingURL=baileysAuthStateService.js.map