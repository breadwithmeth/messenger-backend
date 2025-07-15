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
exports.getMessageById = getMessageById;
exports.deleteMessage = deleteMessage;
const prisma_1 = __importDefault(require("../config/prisma"));
// export async function sendMessage(
//   jid: string,
//   content: string,
//   quoted?: any
// ) {
//   // This is a stub. Actual sending should be implemented via Baileys or similar.
//   // Here, just save to DB for demo.
//   return prisma.message.create({
//     data: {
//     //   senderType: 'operator',
//       senderId: 0,
//       content,
//       type: 'text',
//       // Optionally handle quoted, media, etc.
//     },
//   });
// }
// export async function getMessages(chatId: number | string) {
//   return prisma.message.findMany({
//     where: { chatId: Number(chatId) },
//     orderBy: { createdAt: 'asc' },
//   });
// }
function getMessageById(id) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma_1.default.message.findUnique({
            where: { id },
        });
    });
}
function deleteMessage(id) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma_1.default.message.delete({
            where: { id },
        });
    });
}
