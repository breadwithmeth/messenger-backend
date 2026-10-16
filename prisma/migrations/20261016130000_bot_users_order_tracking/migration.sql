-- Аккаунты «Налив», привязанные к Telegram-клиентам, и трекинг статусов заказов

-- CreateTable
CREATE TABLE "BotUser" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "telegramBotId" INTEGER,
    "telegramChatId" TEXT,
    "nalivUserId" INTEGER,
    "name" TEXT,
    "login" TEXT,
    "token" TEXT,
    "sessionToken" TEXT,
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotOrderTracking" (
    "id" SERIAL NOT NULL,
    "botUserId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "lastStatus" TEXT,
    "lastStatusAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotOrderTracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotUser_telegramUserId_key" ON "BotUser"("telegramUserId");

-- CreateIndex
CREATE INDEX "BotUser_organizationId_idx" ON "BotUser"("organizationId");

-- CreateIndex
CREATE INDEX "BotOrderTracking_botUserId_idx" ON "BotOrderTracking"("botUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BotOrderTracking_botUserId_orderId_key" ON "BotOrderTracking"("botUserId", "orderId");

-- AddForeignKey
ALTER TABLE "BotOrderTracking" ADD CONSTRAINT "BotOrderTracking_botUserId_fkey" FOREIGN KEY ("botUserId") REFERENCES "BotUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
