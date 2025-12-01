/*
  Warnings:

  - You are about to drop the column `tags` on the `OrganizationClient` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "OrganizationClient" DROP COLUMN "tags";

-- CreateTable
CREATE TABLE "ClientTag" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT DEFAULT '#3B82F6',
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'custom',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ClientTags" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ClientTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "ClientTag_organizationId_idx" ON "ClientTag"("organizationId");

-- CreateIndex
CREATE INDEX "ClientTag_type_idx" ON "ClientTag"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTag_organizationId_name_key" ON "ClientTag"("organizationId", "name");

-- CreateIndex
CREATE INDEX "_ClientTags_B_index" ON "_ClientTags"("B");

-- AddForeignKey
ALTER TABLE "ClientTag" ADD CONSTRAINT "ClientTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ClientTags" ADD CONSTRAINT "_ClientTags_A_fkey" FOREIGN KEY ("A") REFERENCES "ClientTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ClientTags" ADD CONSTRAINT "_ClientTags_B_fkey" FOREIGN KEY ("B") REFERENCES "OrganizationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
