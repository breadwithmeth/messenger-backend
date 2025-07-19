-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedUserId" INTEGER,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'open',
ADD COLUMN     "unreadCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isReadByOperator" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "readAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
