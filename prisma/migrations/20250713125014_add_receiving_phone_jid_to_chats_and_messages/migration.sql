/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `senderId` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the `MessageEvent` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[whatsappMessageId]` on the table `Message` will be added. If there are existing duplicate values, this will fail.
  - Made the column `content` on table `Message` required. This step will fail if there are existing NULL values in that column.
  - Made the column `chatId` on table `Message` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_chatId_fkey";

-- DropForeignKey
ALTER TABLE "MessageEvent" DROP CONSTRAINT "MessageEvent_messageId_fkey";

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "isGroup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastMessageAt" TIMESTAMP(3),
ADD COLUMN     "organizationPhoneId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "createdAt",
DROP COLUMN "senderId",
ADD COLUMN     "fromMe" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organizationId" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "organizationPhoneId" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "senderJid" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "whatsappMessageId" TEXT,
ALTER COLUMN "content" SET NOT NULL,
ALTER COLUMN "content" SET DEFAULT '',
ALTER COLUMN "type" DROP DEFAULT,
ALTER COLUMN "chatId" SET NOT NULL,
ALTER COLUMN "chatId" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "OrganizationPhone" ADD COLUMN     "lastConnectedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropTable
DROP TABLE "MessageEvent";

-- CreateIndex
CREATE UNIQUE INDEX "Message_whatsappMessageId_key" ON "Message"("whatsappMessageId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_organizationPhoneId_fkey" FOREIGN KEY ("organizationPhoneId") REFERENCES "OrganizationPhone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_organizationPhoneId_fkey" FOREIGN KEY ("organizationPhoneId") REFERENCES "OrganizationPhone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
