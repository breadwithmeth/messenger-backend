/*
  Warnings:

  - You are about to drop the column `chatId` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `senderType` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the `Chat` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ChatNote` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ChatTag` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Tag` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_operatorId_fkey";

-- DropForeignKey
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ChatNote" DROP CONSTRAINT "ChatNote_chatId_fkey";

-- DropForeignKey
ALTER TABLE "ChatNote" DROP CONSTRAINT "ChatNote_userId_fkey";

-- DropForeignKey
ALTER TABLE "ChatTag" DROP CONSTRAINT "ChatTag_chatId_fkey";

-- DropForeignKey
ALTER TABLE "ChatTag" DROP CONSTRAINT "ChatTag_tagId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_chatId_fkey";

-- DropForeignKey
ALTER TABLE "Tag" DROP CONSTRAINT "Tag_organizationId_fkey";

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "chatId",
DROP COLUMN "senderType";

-- DropTable
DROP TABLE "Chat";

-- DropTable
DROP TABLE "ChatNote";

-- DropTable
DROP TABLE "ChatTag";

-- DropTable
DROP TABLE "Tag";
