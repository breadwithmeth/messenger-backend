-- CreateTable
CREATE TABLE "OrganizationPhone" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "phoneJid" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationPhone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationPhone_phoneJid_key" ON "OrganizationPhone"("phoneJid");

-- AddForeignKey
ALTER TABLE "OrganizationPhone" ADD CONSTRAINT "OrganizationPhone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
