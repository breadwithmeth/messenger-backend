-- Add HR access flags for users and chats.
ALTER TABLE "User" ADD COLUMN "isHr" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Chat" ADD COLUMN "isHr" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Chat_organizationId_isHr_idx" ON "Chat"("organizationId", "isHr");
