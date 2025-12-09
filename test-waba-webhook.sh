#!/bin/bash

# Тест webhook verification (GET запрос от Meta)
echo "=== Тест 1: Webhook Verification ==="
curl -X GET "http://localhost:3000/api/waba/webhook?hub.mode=subscribe&hub.verify_token=test_verify_token_123&hub.challenge=test_challenge_string"
echo -e "\n"

# Тест входящего текстового сообщения (POST запрос от Meta)
echo "=== Тест 2: Входящее текстовое сообщение ==="
curl -X POST http://localhost:3000/api/waba/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "WABA_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "79001234567",
            "phone_number_id": "PHONE_NUMBER_ID"
          },
          "contacts": [{
            "profile": {
              "name": "Test User"
            },
            "wa_id": "79009876543"
          }],
          "messages": [{
            "from": "79009876543",
            "id": "wamid.test123",
            "timestamp": "'$(date +%s)'",
            "type": "text",
            "text": {
              "body": "Привет! Это тестовое сообщение"
            }
          }]
        },
        "field": "messages"
      }]
    }]
  }'
echo -e "\n"

# Тест статуса доставки
echo "=== Тест 3: Статус доставки сообщения ==="
curl -X POST http://localhost:3000/api/waba/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "WABA_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "79001234567",
            "phone_number_id": "PHONE_NUMBER_ID"
          },
          "statuses": [{
            "id": "wamid.test456",
            "status": "delivered",
            "timestamp": "'$(date +%s)'",
            "recipient_id": "79009876543"
          }]
        },
        "field": "messages"
      }]
    }]
  }'
echo -e "\n"

# Тест входящего изображения
echo "=== Тест 4: Входящее изображение ==="
curl -X POST http://localhost:3000/api/waba/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "WABA_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "79001234567",
            "phone_number_id": "PHONE_NUMBER_ID"
          },
          "contacts": [{
            "profile": {
              "name": "Test User"
            },
            "wa_id": "79009876543"
          }],
          "messages": [{
            "from": "79009876543",
            "id": "wamid.test789",
            "timestamp": "'$(date +%s)'",
            "type": "image",
            "image": {
              "caption": "Тестовое изображение",
              "mime_type": "image/jpeg",
              "sha256": "test_hash",
              "id": "media_id_123"
            }
          }]
        },
        "field": "messages"
      }]
    }]
  }'
echo -e "\n"

echo "=== Тесты завершены ==="
