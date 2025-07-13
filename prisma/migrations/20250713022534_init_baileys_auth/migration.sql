-- CreateTable
CREATE TABLE "BaileysAuth" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "phoneJid" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" BYTEA NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "BaileysAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BaileysAuth_key_key" ON "BaileysAuth"("key");

-- CreateIndex
CREATE INDEX "BaileysAuth_organizationId_phoneJid_idx" ON "BaileysAuth"("organizationId", "phoneJid");

-- CreateIndex
CREATE UNIQUE INDEX "BaileysAuth_organizationId_phoneJid_key_key" ON "BaileysAuth"("organizationId", "phoneJid", "key");
