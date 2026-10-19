-- qrPaymentId Kaspi не влезает в INT4 -> TEXT

-- AlterTable
ALTER TABLE "BotOrderTracking" ALTER COLUMN "kaspiQrId" TYPE TEXT;
