-- Drop old unique constraint (org + channel + remoteJid)
DO $$
BEGIN
  ALTER TABLE "Chat" DROP CONSTRAINT IF EXISTS "Chat_organizationId_channel_remoteJid_key";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Add new unique constraint including organizationPhoneId
CREATE UNIQUE INDEX IF NOT EXISTS "Chat_org_channel_phone_remoteJid_key"
  ON "Chat" ("organizationId", "channel", "organizationPhoneId", "remoteJid");
