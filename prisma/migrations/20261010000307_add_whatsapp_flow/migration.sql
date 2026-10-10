-- WhatsApp Flow: поле для хранения Flow ID + таблица ответов формы
-- ВНИМАНИЕ: дрейф схемы по индексу Chat(organizationId, channel, remoteJid) в этой миграции
-- не исправляется — в БД есть дубли чатов и уникальный индекс требует предварительной очистки данных.

-- AlterTable
ALTER TABLE "OrganizationPhone" ADD COLUMN     "wabaFlowId" TEXT;

-- CreateTable (дрейф прошлых изменений: модель WabaWebhookLog есть в schema.prisma, но отсутствовала в БД)
CREATE TABLE "WabaWebhookLog" (
    "id" SERIAL NOT NULL,
    "organizationPhoneId" INTEGER,
    "phoneNumberId" TEXT,
    "eventType" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WabaWebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowSubmission" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "organizationPhoneId" INTEGER,
    "chatId" INTEGER NOT NULL,
    "remoteJid" TEXT,
    "flowId" TEXT,
    "flowToken" TEXT,
    "name" TEXT,
    "city" TEXT,
    "address" TEXT,
    "paymentType" TEXT,
    "rawData" JSONB NOT NULL,
    "whatsappMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlowSubmission_organizationId_createdAt_idx" ON "FlowSubmission"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "FlowSubmission_chatId_idx" ON "FlowSubmission"("chatId");

-- AddForeignKey
ALTER TABLE "FlowSubmission" ADD CONSTRAINT "FlowSubmission_organizationPhoneId_fkey" FOREIGN KEY ("organizationPhoneId") REFERENCES "OrganizationPhone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WabaWebhookLog" ADD CONSTRAINT "WabaWebhookLog_organizationPhoneId_fkey" FOREIGN KEY ("organizationPhoneId") REFERENCES "OrganizationPhone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
