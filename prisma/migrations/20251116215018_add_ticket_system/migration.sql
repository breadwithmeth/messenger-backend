-- CreateTable
CREATE TABLE "TicketHistory" (
    "id" SERIAL NOT NULL,
    "chatId" INTEGER NOT NULL,
    "userId" INTEGER,
    "changeType" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketHistory_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN "ticketNumber" INTEGER,
ADD COLUMN "tags" TEXT,
ADD COLUMN "category" TEXT,
ADD COLUMN "subject" TEXT,
ADD COLUMN "firstResponseAt" TIMESTAMP(3),
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "closeReason" TEXT,
ADD COLUMN "customerRating" INTEGER,
ADD COLUMN "internalNotes" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "status" SET DEFAULT 'new';

-- CreateIndex
CREATE INDEX "TicketHistory_chatId_idx" ON "TicketHistory"("chatId");

-- CreateIndex
CREATE INDEX "TicketHistory_changeType_idx" ON "TicketHistory"("changeType");

-- CreateIndex
CREATE INDEX "TicketHistory_createdAt_idx" ON "TicketHistory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_organizationId_ticketNumber_key" ON "Chat"("organizationId", "ticketNumber");

-- CreateIndex
CREATE INDEX "Chat_status_idx" ON "Chat"("status");

-- CreateIndex
CREATE INDEX "Chat_priority_idx" ON "Chat"("priority");

-- CreateIndex
CREATE INDEX "Chat_category_idx" ON "Chat"("category");

-- AddForeignKey
ALTER TABLE "TicketHistory" ADD CONSTRAINT "TicketHistory_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketHistory" ADD CONSTRAINT "TicketHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
