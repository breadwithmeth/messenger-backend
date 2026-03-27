#!/bin/bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
BITRIX_TOKEN="${BITRIX_TOKEN:-replace-with-strong-shared-secret}"

echo "[1/3] Health check: ${BASE_URL}/health"
HEALTH_CODE=$(curl -s -o /tmp/bitrix-health.json -w "%{http_code}" "${BASE_URL}/health")
if [[ "$HEALTH_CODE" != "200" ]]; then
  echo "Health check failed, status=${HEALTH_CODE}"
  cat /tmp/bitrix-health.json || true
  exit 1
fi
cat /tmp/bitrix-health.json

echo ""
echo "[2/3] POST /integrations/bitrix/outgoing"
OUTGOING_CODE=$(curl -s -o /tmp/bitrix-outgoing.json -w "%{http_code}" \
  -X POST "${BASE_URL}/integrations/bitrix/outgoing" \
  -H "Content-Type: application/json" \
  -H "x-bitrix-token: ${BITRIX_TOKEN}" \
  -d '{
    "event": "ONCRMCOMMENTADD",
    "data": {
      "FIELDS": {
        "ENTITY_ID": "1",
        "COMMENT": "#reply smoke test from bitrix"
      }
    }
  }')

if [[ "$OUTGOING_CODE" != "200" ]]; then
  echo "Outgoing webhook failed, status=${OUTGOING_CODE}"
  cat /tmp/bitrix-outgoing.json || true
  exit 1
fi
cat /tmp/bitrix-outgoing.json

echo ""
echo "[3/3] POST /integrations/bitrix/imconnector"
IMCONNECTOR_CODE=$(curl -s -o /tmp/bitrix-imconnector.json -w "%{http_code}" \
  -X POST "${BASE_URL}/integrations/bitrix/imconnector" \
  -H "Content-Type: application/json" \
  -H "x-bitrix-token: ${BITRIX_TOKEN}" \
  -d '{
    "data": {
      "chat": {
        "id": "1"
      },
      "message": {
        "text": "smoke test from bitrix imconnector"
      }
    }
  }')

if [[ "$IMCONNECTOR_CODE" != "200" ]]; then
  echo "Imconnector webhook failed, status=${IMCONNECTOR_CODE}"
  cat /tmp/bitrix-imconnector.json || true
  exit 1
fi
cat /tmp/bitrix-imconnector.json

echo ""
echo "Bitrix smoke test completed successfully."
