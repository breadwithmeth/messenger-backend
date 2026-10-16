-- Телефон клиента в AI-диалоге и заказе

-- AlterTable
ALTER TABLE "BotDialog" ADD COLUMN "phone" TEXT;

-- AlterTable
ALTER TABLE "BotOrder" ADD COLUMN "phone" TEXT;
