-- DropForeignKey
ALTER TABLE "TicketHistory" DROP CONSTRAINT "TicketHistory_chatId_fkey";

-- DropForeignKey
ALTER TABLE "TicketHistory" DROP CONSTRAINT "TicketHistory_userId_fkey";

-- DropIndex
DROP INDEX "Chat_status_idx";

-- DropIndex
DROP INDEX "Chat_priority_idx";

-- DropIndex
DROP INDEX "Chat_category_idx";

-- DropIndex
DROP INDEX "Chat_organizationId_ticketNumber_key";

-- AlterTable
ALTER TABLE "Chat" DROP COLUMN "category",
DROP COLUMN "closeReason",
DROP COLUMN "closedAt",
DROP COLUMN "customerRating",
DROP COLUMN "firstResponseAt",
DROP COLUMN "internalNotes",
DROP COLUMN "resolvedAt",
DROP COLUMN "subject",
DROP COLUMN "tags",
DROP COLUMN "ticketNumber",
DROP COLUMN "updatedAt",
ALTER COLUMN "status" SET DEFAULT 'open';

-- DropTable
DROP TABLE "TicketHistory";

