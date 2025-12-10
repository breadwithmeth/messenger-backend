#!/bin/bash

# Тестирование отправки шаблонов через WABA Operator API

# Конфигурация
BASE_URL="https://bm.drawbridge.kz"
TOKEN="YOUR_JWT_TOKEN"  # Замените на ваш токен
CHAT_ID="123"           # Замените на ID чата

echo "🧪 Тестирование отправки шаблонов WABA..."
echo ""

# 1. Отправка простого шаблона с кодом доступа
echo "1️⃣ Отправка шаблона 'access' с кодом 1234..."
curl -X POST "$BASE_URL/api/waba/operator/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": '"$CHAT_ID"',
    "type": "template",
    "template": {
      "name": "access",
      "language": "ru",
      "components": [
        {
          "type": "body",
          "parameters": [
            {
              "type": "text",
              "text": "1234"
            }
          ]
        }
      ]
    }
  }'
echo -e "\n"

# 2. Отправка шаблона с несколькими параметрами
echo "2️⃣ Отправка шаблона 'order_ready' с двумя параметрами..."
curl -X POST "$BASE_URL/api/waba/operator/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": '"$CHAT_ID"',
    "type": "template",
    "template": {
      "name": "order_ready",
      "language": "ru",
      "components": [
        {
          "type": "body",
          "parameters": [
            {
              "type": "text",
              "text": "Иван"
            },
            {
              "type": "text",
              "text": "ORD-12345"
            }
          ]
        }
      ]
    }
  }'
echo -e "\n"

# 3. Получение списка доступных шаблонов
echo "3️⃣ Получение списка шаблонов..."
curl -X GET "$BASE_URL/api/waba/templates?organizationPhoneId=1" \
  -H "Authorization: Bearer $TOKEN"
echo -e "\n"

echo "✅ Тесты завершены!"
