-- Товары, показанные клиенту кнопками (валидация AI-добавлений в корзину)

-- AlterTable
ALTER TABLE "BotDialog" ADD COLUMN "lastOfferItems" JSONB;
