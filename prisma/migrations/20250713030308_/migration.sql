/*
  Warnings:

  - You are about to drop the `BaileysAuth` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "BaileysAuth";

-- CreateTable
CREATE TABLE "baileys_auth" (
    "organizationId" INTEGER NOT NULL,
    "phoneJid" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" BYTEA NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "baileys_auth_pkey" PRIMARY KEY ("organizationId","phoneJid","key")
);
