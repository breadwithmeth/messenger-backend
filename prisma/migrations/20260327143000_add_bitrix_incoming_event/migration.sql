-- Persist incoming Bitrix/Open Lines events for cross-restart idempotency
CREATE TABLE IF NOT EXISTS "bitrix_incoming_event" (
  "id" SERIAL NOT NULL,
  "dedupKey" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "bitrixChatId" TEXT,
  "externalUserId" TEXT,
  "externalMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bitrix_incoming_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bitrix_incoming_event_dedupKey_key"
  ON "bitrix_incoming_event"("dedupKey");

CREATE INDEX IF NOT EXISTS "bitrix_incoming_event_source_bitrixChatId_idx"
  ON "bitrix_incoming_event"("source", "bitrixChatId");

CREATE INDEX IF NOT EXISTS "bitrix_incoming_event_source_externalUserId_idx"
  ON "bitrix_incoming_event"("source", "externalUserId");
