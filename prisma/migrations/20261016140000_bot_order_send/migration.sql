-- Отправка заказов бота в «Налив»: детали адреса, цена доставки, ID заказа в системе

-- AlterTable
ALTER TABLE "BotDialog" ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "addressHouse" TEXT,
ADD COLUMN     "deliveryPrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "BotOrder" ADD COLUMN     "nalivOrderId" INTEGER,
ADD COLUMN     "nalivOrderUuid" TEXT;
