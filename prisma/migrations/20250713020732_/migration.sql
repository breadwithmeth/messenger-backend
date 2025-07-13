/*
  Warnings:

  - You are about to drop the column `authState` on the `Session` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[organizationId,phoneJid]` on the table `Session` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_organizationId_fkey";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "authState",
ALTER COLUMN "status" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Session_organizationId_phoneJid_key" ON "Session"("organizationId", "phoneJid");
