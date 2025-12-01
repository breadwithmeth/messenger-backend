-- CreateTable
CREATE TABLE "_ChatOrganizationClients" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ChatOrganizationClients_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ChatOrganizationClients_B_index" ON "_ChatOrganizationClients"("B");

-- AddForeignKey
ALTER TABLE "_ChatOrganizationClients" ADD CONSTRAINT "_ChatOrganizationClients_A_fkey" FOREIGN KEY ("A") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChatOrganizationClients" ADD CONSTRAINT "_ChatOrganizationClients_B_fkey" FOREIGN KEY ("B") REFERENCES "OrganizationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
