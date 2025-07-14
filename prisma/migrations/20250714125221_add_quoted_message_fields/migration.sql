/*
  Warnings:

  - Made the column `whatsappMessageId` on table `Message` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "quotedContent" TEXT,
ADD COLUMN     "quotedMessageId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "content" DROP DEFAULT,
ALTER COLUMN "type" SET DEFAULT 'text',
ALTER COLUMN "chatId" DROP DEFAULT,
ALTER COLUMN "fromMe" DROP DEFAULT,
ALTER COLUMN "organizationId" DROP DEFAULT,
ALTER COLUMN "organizationPhoneId" DROP DEFAULT,
ALTER COLUMN "senderJid" DROP DEFAULT,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "timestamp" DROP DEFAULT,
ALTER COLUMN "whatsappMessageId" SET NOT NULL;
