-- Kaspi QR-платежи: трекинг статуса оплаты в BotOrderTracking

-- AlterTable
ALTER TABLE "BotOrderTracking" ADD COLUMN     "kaspiQrId" INTEGER,
ADD COLUMN     "paymentStatus" TEXT;
