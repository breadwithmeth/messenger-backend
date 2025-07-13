/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,receivingPhoneJid,remoteJid]` on the table `Chat` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Chat_organizationId_receivingPhoneJid_key";

-- CreateIndex
CREATE UNIQUE INDEX "Chat_organizationId_receivingPhoneJid_remoteJid_key" ON "Chat"("organizationId", "receivingPhoneJid", "remoteJid");
