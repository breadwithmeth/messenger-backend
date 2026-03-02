-- CreateTable
CREATE TABLE "ChatComment" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "chatId" INTEGER NOT NULL,
    "userId" INTEGER,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatComment_chatId_idx" ON "ChatComment"("chatId");

-- CreateIndex
CREATE INDEX "ChatComment_organizationId_chatId_idx" ON "ChatComment"("organizationId", "chatId");

-- CreateIndex
CREATE INDEX "ChatComment_createdAt_idx" ON "ChatComment"("createdAt");

-- AddForeignKey
ALTER TABLE "ChatComment" ADD CONSTRAINT "ChatComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatComment" ADD CONSTRAINT "ChatComment_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatComment" ADD CONSTRAINT "ChatComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
