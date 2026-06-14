-- CreateTable
CREATE TABLE "WebsiteWidget" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "welcomeMessage" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2563eb',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteWidget_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN "websiteWidgetId" INTEGER;

-- CreateTable
CREATE TABLE "WebsiteVisitorSession" (
    "id" TEXT NOT NULL,
    "websiteWidgetId" INTEGER NOT NULL,
    "chatId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "visitorName" TEXT,
    "visitorEmail" TEXT,
    "visitorPhone" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteVisitorSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteWidget_publicKey_key" ON "WebsiteWidget"("publicKey");

-- CreateIndex
CREATE INDEX "WebsiteWidget_organizationId_idx" ON "WebsiteWidget"("organizationId");

-- CreateIndex
CREATE INDEX "WebsiteWidget_status_idx" ON "WebsiteWidget"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteVisitorSession_chatId_key" ON "WebsiteVisitorSession"("chatId");

-- CreateIndex
CREATE INDEX "WebsiteVisitorSession_websiteWidgetId_idx" ON "WebsiteVisitorSession"("websiteWidgetId");

-- CreateIndex
CREATE INDEX "Chat_organizationId_websiteWidgetId_idx" ON "Chat"("organizationId", "websiteWidgetId");

-- AddForeignKey
ALTER TABLE "WebsiteWidget" ADD CONSTRAINT "WebsiteWidget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_websiteWidgetId_fkey" FOREIGN KEY ("websiteWidgetId") REFERENCES "WebsiteWidget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteVisitorSession" ADD CONSTRAINT "WebsiteVisitorSession_websiteWidgetId_fkey" FOREIGN KEY ("websiteWidgetId") REFERENCES "WebsiteWidget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteVisitorSession" ADD CONSTRAINT "WebsiteVisitorSession_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
