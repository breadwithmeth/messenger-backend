-- Finalize Bitrix integration schema to match prisma/schema.prisma

-- Existing table from previous migration: bitrix_mapping
ALTER TABLE "bitrix_mapping"
  ADD COLUMN IF NOT EXISTS "chatId" INTEGER;

CREATE INDEX IF NOT EXISTS "bitrix_mapping_chatId_idx"
  ON "bitrix_mapping"("chatId");

-- Dedup store for outgoing webhook events
CREATE TABLE IF NOT EXISTS "bitrix_processed_event" (
  "id" SERIAL NOT NULL,
  "hash" TEXT NOT NULL,
  "leadId" INTEGER NOT NULL,
  "comment" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bitrix_processed_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bitrix_processed_event_hash_key"
  ON "bitrix_processed_event"("hash");

CREATE INDEX IF NOT EXISTS "bitrix_processed_event_leadId_idx"
  ON "bitrix_processed_event"("leadId");

-- Mapping between local chat and Bitrix connector chat/user context
CREATE TABLE IF NOT EXISTS "chat_mapping" (
  "id" SERIAL NOT NULL,
  "chatId" INTEGER NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "bitrixChatId" TEXT,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chat_mapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "chat_mapping_chatId_key"
  ON "chat_mapping"("chatId");

CREATE INDEX IF NOT EXISTS "chat_mapping_externalUserId_idx"
  ON "chat_mapping"("externalUserId");

CREATE INDEX IF NOT EXISTS "chat_mapping_bitrixChatId_idx"
  ON "chat_mapping"("bitrixChatId");

-- OAuth tokens storage (domain-scoped)
CREATE TABLE IF NOT EXISTS "bitrix_tokens" (
  "id" SERIAL NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "domain" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bitrix_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bitrix_tokens_domain_key"
  ON "bitrix_tokens"("domain");

CREATE INDEX IF NOT EXISTS "bitrix_tokens_expiresAt_idx"
  ON "bitrix_tokens"("expiresAt");
