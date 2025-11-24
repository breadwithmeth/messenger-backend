-- DropForeignKey
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_organizationPhoneId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_organizationPhoneId_fkey";

-- DropIndex
DROP INDEX "Chat_organizationId_receivingPhoneJid_remoteJid_key";

-- DropIndex
DROP INDEX "idx_chat_organizationId_lastMessageAt";

-- DropIndex
DROP INDEX "idx_chat_organizationId_priority";

-- DropIndex
DROP INDEX "idx_chat_organizationId_status";

-- DropIndex
DROP INDEX "idx_chat_receivingPhoneJid";

-- DropIndex
DROP INDEX "idx_chat_remoteJid";

-- DropIndex
DROP INDEX "Message_whatsappMessageId_key";

-- DropIndex
DROP INDEX "idx_message_chatId_timestamp";

-- DropIndex
DROP INDEX "idx_message_organizationId_timestamp";

-- DropIndex
DROP INDEX "idx_message_receivingPhoneJid";

-- DropIndex
DROP INDEX "idx_message_senderJid";

-- DropIndex
DROP INDEX "idx_message_whatsappMessageId";

-- DropIndex
DROP INDEX "idx_organizationPhone_organizationId";

-- DropIndex
DROP INDEX "idx_organizationPhone_status";

-- DropIndex
DROP INDEX "idx_user_email";

-- DropIndex
DROP INDEX "idx_user_organizationId";

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'whatsapp',
ADD COLUMN     "telegramBotId" INTEGER,
ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramFirstName" TEXT,
ADD COLUMN     "telegramLastName" TEXT,
ADD COLUMN     "telegramUserId" TEXT,
ADD COLUMN     "telegramUsername" TEXT,
ALTER COLUMN "remoteJid" DROP NOT NULL,
ALTER COLUMN "receivingPhoneJid" DROP NOT NULL,
ALTER COLUMN "organizationPhoneId" DROP NOT NULL,
ALTER COLUMN "organizationPhoneId" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'whatsapp',
ADD COLUMN     "telegramBotId" INTEGER,
ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramMessageId" INTEGER,
ADD COLUMN     "telegramUserId" TEXT,
ADD COLUMN     "telegramUsername" TEXT,
ALTER COLUMN "receivingPhoneJid" DROP NOT NULL,
ALTER COLUMN "remoteJid" DROP NOT NULL,
ALTER COLUMN "organizationPhoneId" DROP NOT NULL,
ALTER COLUMN "senderJid" DROP NOT NULL,
ALTER COLUMN "whatsappMessageId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TelegramBot" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "botToken" TEXT NOT NULL,
    "botUsername" TEXT,
    "botName" TEXT,
    "botId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "lastActiveAt" TIMESTAMP(3),
    "welcomeMessage" TEXT,
    "autoReply" BOOLEAN NOT NULL DEFAULT false,
    "webhookUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramBot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBot_botToken_key" ON "TelegramBot"("botToken");

-- CreateIndex
CREATE INDEX "TelegramBot_organizationId_idx" ON "TelegramBot"("organizationId");

-- CreateIndex
CREATE INDEX "TelegramBot_status_idx" ON "TelegramBot"("status");

-- CreateIndex
CREATE INDEX "Chat_channel_idx" ON "Chat"("channel");

-- CreateIndex
CREATE INDEX "Chat_organizationId_receivingPhoneJid_remoteJid_idx" ON "Chat"("organizationId", "receivingPhoneJid", "remoteJid");

-- CreateIndex
CREATE INDEX "Chat_organizationId_telegramBotId_telegramChatId_idx" ON "Chat"("organizationId", "telegramBotId", "telegramChatId");

-- CreateIndex
CREATE INDEX "Message_channel_idx" ON "Message"("channel");

-- CreateIndex
CREATE INDEX "Message_chatId_timestamp_idx" ON "Message"("chatId", "timestamp");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_organizationPhoneId_fkey" FOREIGN KEY ("organizationPhoneId") REFERENCES "OrganizationPhone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_telegramBotId_fkey" FOREIGN KEY ("telegramBotId") REFERENCES "TelegramBot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_organizationPhoneId_fkey" FOREIGN KEY ("organizationPhoneId") REFERENCES "OrganizationPhone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_telegramBotId_fkey" FOREIGN KEY ("telegramBotId") REFERENCES "TelegramBot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBot" ADD CONSTRAINT "TelegramBot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
