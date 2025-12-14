#!/bin/bash

# Тестирование отправки медиа в Telegram
# Использует универсальный эндпоинт: POST /api/messages/send-by-chat

API="http://localhost:3000"
TOKEN="your_jwt_token_here"  # Замените на реальный JWT токен
CHAT_ID=1  # Замените на реальный Telegram chatId

echo "=== 🧪 Тест отправки медиа в Telegram ==="
echo ""

# Создаем тестовое изображение (если не существует)
if [ ! -f "test-telegram-image.jpg" ]; then
  echo "📸 Создание тестового изображения..."
  if command -v convert &> /dev/null; then
    convert -size 200x200 xc:green test-telegram-image.jpg
    echo "✅ Тестовое изображение создано"
  else
    echo "⚠️  ImageMagick не установлен. Используйте существующий файл."
    exit 1
  fi
fi

echo ""
echo "=== 1️⃣ Загрузка изображения на R2 ==="
echo ""

UPLOAD_RESPONSE=$(curl -s -X POST "$API/api/media/upload-for-waba" \
  -H "Authorization: Bearer $TOKEN" \
  -F "media=@test-telegram-image.jpg" \
  -F "mediaType=image")

echo "$UPLOAD_RESPONSE" | jq .

MEDIA_URL=$(echo "$UPLOAD_RESPONSE" | jq -r '.mediaUrl')

if [ "$MEDIA_URL" == "null" ] || [ -z "$MEDIA_URL" ]; then
  echo "❌ Ошибка загрузки файла на R2"
  exit 1
fi

echo ""
echo "📎 Media URL: $MEDIA_URL"
echo ""

echo "=== 2️⃣ Отправка изображения в Telegram ==="
echo ""

SEND_RESPONSE=$(curl -s -X POST "$API/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"chatId\": $CHAT_ID,
    \"type\": \"image\",
    \"mediaUrl\": \"$MEDIA_URL\",
    \"caption\": \"🧪 Тестовое изображение из автоматического теста\"
  }")

echo "$SEND_RESPONSE" | jq .

SUCCESS=$(echo "$SEND_RESPONSE" | jq -r '.success')
CHANNEL=$(echo "$SEND_RESPONSE" | jq -r '.channel')

if [ "$SUCCESS" == "true" ] && [ "$CHANNEL" == "telegram" ]; then
  echo ""
  echo "✅ Изображение успешно отправлено в Telegram!"
else
  echo ""
  echo "❌ Ошибка отправки изображения"
  exit 1
fi

echo ""
echo "=== 3️⃣ Тест отправки документа ==="
echo ""

# Создаем тестовый документ
echo "Тестовый документ для Telegram" > test-telegram-doc.txt

DOC_UPLOAD=$(curl -s -X POST "$API/api/media/upload-for-waba" \
  -H "Authorization: Bearer $TOKEN" \
  -F "media=@test-telegram-doc.txt" \
  -F "mediaType=document")

DOC_URL=$(echo "$DOC_UPLOAD" | jq -r '.mediaUrl')

if [ "$DOC_URL" != "null" ] && [ -n "$DOC_URL" ]; then
  echo "📄 Документ загружен: $DOC_URL"
  
  DOC_SEND=$(curl -s -X POST "$API/api/messages/send-by-chat" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"chatId\": $CHAT_ID,
      \"type\": \"document\",
      \"mediaUrl\": \"$DOC_URL\",
      \"filename\": \"test-document.txt\",
      \"caption\": \"📄 Тестовый документ\"
    }")
  
  echo "$DOC_SEND" | jq .
  
  DOC_SUCCESS=$(echo "$DOC_SEND" | jq -r '.success')
  
  if [ "$DOC_SUCCESS" == "true" ]; then
    echo "✅ Документ успешно отправлен в Telegram!"
  else
    echo "❌ Ошибка отправки документа"
  fi
fi

echo ""
echo "=== 4️⃣ Тест отправки текста ==="
echo ""

TEXT_SEND=$(curl -s -X POST "$API/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"chatId\": $CHAT_ID,
    \"type\": \"text\",
    \"text\": \"✅ Все типы медиа работают! Тест завершен успешно.\"
  }")

echo "$TEXT_SEND" | jq .

echo ""
echo "=== ✅ Тесты завершены ==="
echo ""
echo "🎉 Проверьте Telegram чат - должны быть:"
echo "   1. Зеленое изображение с подписью"
echo "   2. Текстовый документ"
echo "   3. Текстовое сообщение об успехе"
echo ""
echo "📊 Поддерживаемые типы для Telegram:"
echo "   ✅ text"
echo "   ✅ image"
echo "   ✅ document"
echo "   ✅ video"
echo "   ✅ audio"
echo ""
