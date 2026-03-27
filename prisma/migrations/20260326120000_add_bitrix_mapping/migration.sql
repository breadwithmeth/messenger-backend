CREATE TABLE "bitrix_mapping" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "bitrixContactId" INTEGER NOT NULL,
    "bitrixLeadId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bitrix_mapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bitrix_mapping_userId_key" ON "bitrix_mapping"("userId");
CREATE INDEX "bitrix_mapping_bitrixContactId_idx" ON "bitrix_mapping"("bitrixContactId");
CREATE INDEX "bitrix_mapping_bitrixLeadId_idx" ON "bitrix_mapping"("bitrixLeadId");
