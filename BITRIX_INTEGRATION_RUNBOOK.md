# Bitrix Integration Runbook

This runbook describes how to set up, validate, and operate the Bitrix integration.

## 1. Required Environment Variables

Set these in `.env` (or your secret manager in production):

```bash
# Core integration
BITRIX_DOMAIN=your-company.bitrix24.com
BITRIX_TOKEN=strong-shared-secret
BITRIX_LINE_ID=3
BITRIX_CONNECTOR_CODE=myconnector
BITRIX_DEFAULT_SOURCE=WHATSAPP
BITRIX_RATE_LIMIT_MS=200

# OAuth (recommended for production)
BITRIX_CLIENT_ID=local.xxx
BITRIX_CLIENT_SECRET=xxx
BITRIX_REDIRECT_URI=https://your-api.example.com/integrations/bitrix/oauth/callback

# Optional fallback auth for imconnector.send.messages
# If webhook URL already contains /rest/{user}/{token}/, auth may come from URL
BITRIX_WEBHOOK_URL=https://your-company.bitrix24.com/rest/1/xxxx/
BITRIX_APP_TOKEN=

# Queue processing
REDIS_URL=redis://localhost:6379
```

Notes:
- `BITRIX_TOKEN` is used by incoming webhooks (`x-bitrix-token` header).
- Use either full webhook credentials in `BITRIX_WEBHOOK_URL` or OAuth (`/connect`).
- `REDIS_URL` is strongly recommended. Without Redis, the app falls back to inline processing.

## 2. Database Preparation

Apply migrations before running the server:

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected tables for Bitrix integration:
- `bitrix_mapping`
- `bitrix_processed_event`
- `chat_mapping`
- `bitrix_tokens`
- `bitrix_incoming_event`

## 3. OAuth Connection Flow

1. Open:

```text
GET /integrations/bitrix/connect
```

2. Complete OAuth in Bitrix UI.
3. Bitrix redirects to:

```text
GET /integrations/bitrix/oauth/callback?code=...
```

4. Success response should include `ok: true`, `domain`, and `expiresAt`.

## 4. Webhook Endpoints

Configured routes:
- `POST /integrations/bitrix/outgoing`
- `POST /integrations/bitrix/imconnector`

Common rules:
- Both endpoints return `200` quickly.
- You must pass `x-bitrix-token: $BITRIX_TOKEN`.
- Invalid token requests are ignored after returning `200`.

## 5. Smoke Validation

Use the provided script:

```bash
chmod +x ./test-bitrix-smoke.sh
./test-bitrix-smoke.sh
```

The script validates:
- Health check
- `outgoing` webhook contract
- `imconnector` webhook contract

## 6. Operational Checks

Verify during startup logs:
- `Bitrix worker initialized`
- `Bitrix connector worker initialized`

Runtime checks:
- No repeated `No auth context` warnings
- No burst of `Rate limit exceeded`
- No repeating `Mapping not found for lead`

## 7. Troubleshooting

`Bitrix OAuth token unavailable`
- Complete `/integrations/bitrix/connect` again.
- Verify `BITRIX_CLIENT_ID`, `BITRIX_CLIENT_SECRET`, `BITRIX_REDIRECT_URI`, `BITRIX_DOMAIN`.

`No auth context`
- Provide full `BITRIX_WEBHOOK_URL` with credentials, or
- Complete OAuth and ensure tokens are stored in `bitrix_tokens`.

`Mapping not found for lead`
- Lead was not linked yet in local mapping.
- Ensure inbound message sync from messenger to Bitrix is active.

`Chat not found` on incoming from Bitrix
- Incoming payload contains unknown local `chat.id`.
- Verify mapping consistency and channel-specific identifiers.

## 8. Security and Production Notes

- Never commit real Bitrix secrets/tokens to Git.
- Rotate any leaked credentials immediately.
- Restrict webhook traffic by network rules where possible.
- Keep `BITRIX_TOKEN` long and random.
- Monitor queue failures (`bitrix-sync`, `bitrix-connector-send`).
