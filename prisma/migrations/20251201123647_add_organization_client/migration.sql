-- CreateTable
CREATE TABLE "OrganizationClient" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "clientType" TEXT NOT NULL DEFAULT 'individual',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "secondaryPhone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "companyName" TEXT,
    "taxId" TEXT,
    "registrationNumber" TEXT,
    "legalAddress" TEXT,
    "contactPerson" TEXT,
    "contactPosition" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT,
    "tags" TEXT,
    "segment" TEXT,
    "assignedUserId" INTEGER,
    "totalRevenue" DECIMAL(15,2),
    "lastPurchaseDate" TIMESTAMP(3),
    "purchaseCount" INTEGER NOT NULL DEFAULT 0,
    "averageCheck" DECIMAL(15,2),
    "discount" DECIMAL(5,2),
    "notes" TEXT,
    "birthday" TIMESTAMP(3),
    "whatsappJid" TEXT,
    "telegramUserId" TEXT,
    "emailSubscribed" BOOLEAN NOT NULL DEFAULT false,
    "smsSubscribed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationClient_organizationId_idx" ON "OrganizationClient"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationClient_email_idx" ON "OrganizationClient"("email");

-- CreateIndex
CREATE INDEX "OrganizationClient_phone_idx" ON "OrganizationClient"("phone");

-- CreateIndex
CREATE INDEX "OrganizationClient_status_idx" ON "OrganizationClient"("status");

-- CreateIndex
CREATE INDEX "OrganizationClient_segment_idx" ON "OrganizationClient"("segment");

-- CreateIndex
CREATE INDEX "OrganizationClient_assignedUserId_idx" ON "OrganizationClient"("assignedUserId");

-- CreateIndex
CREATE INDEX "OrganizationClient_clientType_idx" ON "OrganizationClient"("clientType");

-- CreateIndex
CREATE INDEX "OrganizationClient_whatsappJid_idx" ON "OrganizationClient"("whatsappJid");

-- CreateIndex
CREATE INDEX "OrganizationClient_telegramUserId_idx" ON "OrganizationClient"("telegramUserId");

-- AddForeignKey
ALTER TABLE "OrganizationClient" ADD CONSTRAINT "OrganizationClient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationClient" ADD CONSTRAINT "OrganizationClient_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
