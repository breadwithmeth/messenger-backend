-- Store whether each message was created while its chat had the HR label.
ALTER TABLE "Message" ADD COLUMN "isHr" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Message_organizationId_isHr_idx" ON "Message"("organizationId", "isHr");
CREATE INDEX "Message_chatId_isHr_timestamp_idx" ON "Message"("chatId", "isHr", "timestamp");
