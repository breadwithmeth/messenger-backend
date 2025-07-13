/*
  Warnings:

  - You are about to drop the column `jid` on the `Chat` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[organizationId,receivingPhoneJid]` on the table `Chat` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `receivingPhoneJid` to the `Chat` table without a default value. This is not possible if the table is not empty.
  - Made the column `remoteJid` on table `Chat` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Chat_organizationId_jid_key";

-- AlterTable
ALTER TABLE "Chat" DROP COLUMN "jid",
ADD COLUMN     "receivingPhoneJid" TEXT NOT NULL,
ALTER COLUMN "remoteJid" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Chat_organizationId_receivingPhoneJid_key" ON "Chat"("organizationId", "receivingPhoneJid");
