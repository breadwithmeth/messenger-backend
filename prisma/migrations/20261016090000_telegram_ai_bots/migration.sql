-- AI-боты Telegram: режим AI-ассистента, состояние диалога и заказы

-- AlterTable
ALTER TABLE "TelegramBot" ADD COLUMN     "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "aiSystemPrompt" TEXT;

-- CreateTable
CREATE TABLE "BotDialog" (
    "id" SERIAL NOT NULL,
    "chatId" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'awaiting_address',
    "addressLabel" TEXT,
    "addressLat" DOUBLE PRECISION,
    "addressLon" DOUBLE PRECISION,
    "businessId" INTEGER,
    "businessName" TEXT,
    "candidateAddresses" JSONB,
    "candidateBusinesses" JSONB,
    "lastSearchItems" JSONB,
    "cart" JSONB,
    "handedOff" BOOLEAN NOT NULL DEFAULT false,
    "handedOffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotDialog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotOrder" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "chatId" INTEGER NOT NULL,
    "dialogId" INTEGER,
    "businessId" INTEGER NOT NULL,
    "businessName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressLat" DOUBLE PRECISION,
    "addressLon" DOUBLE PRECISION,
    "items" JSONB NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'new',
    "telegramChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotDialog_chatId_key" ON "BotDialog"("chatId");

-- CreateIndex
CREATE INDEX "BotDialog_state_idx" ON "BotDialog"("state");

-- CreateIndex
CREATE INDEX "BotOrder_organizationId_status_idx" ON "BotOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BotOrder_chatId_idx" ON "BotOrder"("chatId");

-- AddForeignKey
ALTER TABLE "BotDialog" ADD CONSTRAINT "BotDialog_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotOrder" ADD CONSTRAINT "BotOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotOrder" ADD CONSTRAINT "BotOrder_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotOrder" ADD CONSTRAINT "BotOrder_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "BotDialog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
