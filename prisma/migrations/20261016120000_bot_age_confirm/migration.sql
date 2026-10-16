-- Подтверждение возраста 21+ в AI-диалоге

-- AlterTable
ALTER TABLE "BotDialog" ADD COLUMN "ageConfirmed" BOOLEAN NOT NULL DEFAULT false;
