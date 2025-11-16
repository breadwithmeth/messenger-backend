#!/bin/bash

# Тестирование функционала "пометить как прочитанное"
# Замените YOUR_JWT_TOKEN на реальный токен из /api/auth/login

BASE_URL="http://localhost:4000"
TOKEN="YOUR_JWT_TOKEN"

echo "🧪 Тест 1: Получить список чатов с непрочитанными"
curl -s -X GET "$BASE_URL/api/unread/chats" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo ""
echo "🧪 Тест 2: Получить статистику непрочитанных"
curl -s -X GET "$BASE_URL/api/unread/counts" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo ""
echo "🧪 Тест 3: Пометить весь чат #1 как прочитанный"
curl -s -X POST "$BASE_URL/api/unread/1/mark-chat-read" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq .

echo ""
echo "🧪 Тест 4: Пометить конкретные сообщения как прочитанные"
curl -s -X POST "$BASE_URL/api/unread/2/mark-read" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messageIds": [1, 2, 3]}' | jq .

echo ""
echo "✅ Тесты завершены!"
