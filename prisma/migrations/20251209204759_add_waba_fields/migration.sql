-- AlterTable
ALTER TABLE "OrganizationPhone" 
ADD COLUMN "connectionType" TEXT NOT NULL DEFAULT 'baileys',
ADD COLUMN "wabaAccessToken" TEXT,
ADD COLUMN "wabaPhoneNumberId" TEXT,
ADD COLUMN "wabaId" TEXT,
ADD COLUMN "wabaApiVersion" TEXT DEFAULT 'v21.0',
ADD COLUMN "wabaVerifyToken" TEXT;
