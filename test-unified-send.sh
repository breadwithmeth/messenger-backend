#!/bin/bash

# Тестирование универсального эндпоинта отправки сообщений

# Конфигурация
BASE_URL="https://bm.drawbridge.kz"
TOKEN="YOUR_JWT_TOKEN"      # Замените на ваш токен
WHATSAPP_CHAT_ID="123"      # Замените на ID WhatsApp чата
TELEGRAM_CHAT_ID="456"      # Замените на ID Telegram чата (опционально)

echo "🧪 Тестирование универсального API отправки сообщений..."
echo ""
echo "📱 Поддерживаемые каналы: WhatsApp (Baileys/WABA), Telegram"
echo ""

# 1. Отправка текстового сообщения в WhatsApp
echo "1️⃣ Отправка текстового сообщения в WhatsApp..."
curl -X POST "$BASE_URL/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": '"$WHATSAPP_CHAT_ID"',
    "type": "text",
    "text": "Привет! Это тестовое сообщение через универсальный API."
  }'
echo -e "\n"

# 2. Отправка текстового сообщения в Telegram
echo "2️⃣ Отправка текстового сообщения в Telegram..."
curl -X POST "$BASE_URL/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": '"$TELEGRAM_CHAT_ID"',
    "type": "text",
    "text": "Привет из Telegram через универсальный API! 🤖"
  }'
echo -e "\n"

# 3. Отправка изображения (только для WABA)
echo "3️⃣ Отправка изображения (только WABA)..."
curl -X POST "$BASE_URL/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": '"$WHATSAPP_CHAT_ID"',
    "type": "image",
    "mediaUrl": "https://picsum.photos/800/600",
    "caption": "Тестовое изображение"
  }'
echo -e "\n"

# 4. Отправка документа (только для WABA)
echo "4️⃣ Отправка документа (только WABA)..."
curl -X POST "$BASE_URL/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": '"$WHATSAPP_CHAT_ID"',
    "type": "document",
    "mediaUrl": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    "filename": "test_document.pdf",
    "caption": "Тестовый документ"
  }'
echo -e "\n"

# 5. Отправка шаблона (только для WABA)
echo "5️⃣ Отправка шаблона 'access' (только WABA)..."
curl -X POST "$BASE_URL/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": '"$WHATSAPP_CHAT_ID"',
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
              "text": "5678"
            }
          ]
        }
      ]
    }
  }'
echo -e "\n"

# 6. Отправка видео (только для WABA)
echo "6️⃣ Отправка видео (только WABA)..."
curl -X POST "$BASE_URL/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": '"$WHATSAPP_CHAT_ID"',
    "type": "video",
    "mediaUrl": "https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4",
    "caption": "Тестовое видео"
  }'
echo -e "\n"

# 7. Отправка аудио (только для WABA)
echo "7️⃣ Отправка аудио (только WABA)..."
curl -X POST "$BASE_URL/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": '"$WHATSAPP_CHAT_ID"',
    "type": "audio",
    "mediaUrl": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
  }'
echo -e "\n"

# 8. Тест с несуществующим chatId
echo "8️⃣ Тест с несуществующим chatId (должна быть ошибка 404)..."
curl -X POST "$BASE_URL/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 999999,
    "type": "text",
    "text": "Это не должно отправиться"
  }'
echo -e "\n"

# 9. Тест без обязательных параметров (должна быть ошибка 400)
echo "9️⃣ Тест без обязательных параметров (должна быть ошибка 400)..."
curl -X POST "$BASE_URL/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": '"$WHATSAPP_CHAT_ID"',
    "type": "text"
  }'
echo -e "\n"

echo "✅ Тесты завершены!"
echo ""
echo "💡 Примечания:"
echo "  - WhatsApp (WABA): поддерживает text, image, document, video, audio, template"
echo "  - WhatsApp (Baileys): поддерживает только text через этот эндпоинт"
echo "  - Telegram: поддерживает только text через этот эндпоинт"
echo "  - API автоматически определяет канал и тип подключения по chatId"
echo ""
echo "📌 Установите переменные окружения:"
echo "  export WHATSAPP_CHAT_ID=123  # ID WhatsApp чата"
echo "  export TELEGRAM_CHAT_ID=456  # ID Telegram чата"
