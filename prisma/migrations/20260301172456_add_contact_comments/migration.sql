-- CreateTable
CREATE TABLE "ContactComment" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "userId" INTEGER,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactComment_clientId_idx" ON "ContactComment"("clientId");

-- CreateIndex
CREATE INDEX "ContactComment_organizationId_clientId_idx" ON "ContactComment"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "ContactComment_createdAt_idx" ON "ContactComment"("createdAt");

-- AddForeignKey
ALTER TABLE "ContactComment" ADD CONSTRAINT "ContactComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactComment" ADD CONSTRAINT "ContactComment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OrganizationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactComment" ADD CONSTRAINT "ContactComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
