/*
  Warnings:

  - Added the required column `receivingPhoneJid` to the `Chat` table without a default value. This is not possible if the table is not empty.
  - Added the required column `remoteJid` to the `Chat` table without a default value. This is not possible if the table is not empty.
  - Added the required column `receivingPhoneJid` to the `Message` table without a default value. This is not possible if the table is not empty.
  - Added the required column `remoteJid` to the `Message` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "receivingPhoneJid" TEXT NOT NULL,
ADD COLUMN     "remoteJid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "receivingPhoneJid" TEXT NOT NULL,
ADD COLUMN     "remoteJid" TEXT NOT NULL;
