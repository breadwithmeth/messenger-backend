#!/bin/bash

# Тестирование загрузки медиа на Cloudflare R2
# Использует эндпоинт: POST /api/media/upload-for-waba

API="http://localhost:3000"
TOKEN="your_jwt_token_here"  # Замените на реальный JWT токен

echo "=== 🧪 Тест загрузки медиа на Cloudflare R2 ==="
echo ""

# Создаем тестовое изображение (если не существует)
if [ ! -f "test-image.jpg" ]; then
  echo "📸 Создание тестового изображения..."
  # Создаем простое изображение 100x100 с помощью ImageMagick (если установлен)
  if command -v convert &> /dev/null; then
    convert -size 100x100 xc:blue test-image.jpg
    echo "✅ Тестовое изображение создано: test-image.jpg"
  else
    echo "⚠️  ImageMagick не установлен. Пожалуйста, создайте test-image.jpg вручную."
    exit 1
  fi
fi

echo ""
echo "=== 1️⃣ Загрузка изображения на R2 ==="
echo ""

RESPONSE=$(curl -s -X POST "$API/api/media/upload-for-waba" \
  -H "Authorization: Bearer $TOKEN" \
  -F "media=@test-image.jpg" \
  -F "mediaType=image")

echo "$RESPONSE" | jq .

# Извлекаем mediaUrl
MEDIA_URL=$(echo "$RESPONSE" | jq -r '.mediaUrl')
echo ""
echo "📎 Media URL: $MEDIA_URL"
echo ""

# Проверяем, что URL содержит r2.drawbridge.kz
if [[ "$MEDIA_URL" == *"r2.drawbridge.kz"* ]]; then
  echo "✅ Файл загружен на Cloudflare R2!"
else
  echo "❌ Файл НЕ загружен на R2 (неожиданный URL)"
  exit 1
fi

echo ""
echo "=== 2️⃣ Проверка доступности файла ==="
echo ""

# Проверяем, что файл доступен по публичному URL
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$MEDIA_URL")

if [ "$HTTP_CODE" == "200" ]; then
  echo "✅ Файл доступен по публичному URL (HTTP $HTTP_CODE)"
else
  echo "❌ Файл НЕ доступен (HTTP $HTTP_CODE)"
  exit 1
fi

echo ""
echo "=== 3️⃣ Отправка изображения в чат через WABA ==="
echo ""

# Замените на реальный chatId
CHAT_ID=1

SEND_RESPONSE=$(curl -s -X POST "$API/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"chatId\": $CHAT_ID,
    \"message\": \"Тестовое изображение с R2\",
    \"type\": \"image\",
    \"mediaUrl\": \"$MEDIA_URL\"
  }")

echo "$SEND_RESPONSE" | jq .

# Проверяем успешность отправки
SUCCESS=$(echo "$SEND_RESPONSE" | jq -r '.success')

if [ "$SUCCESS" == "true" ]; then
  echo ""
  echo "✅ Сообщение с изображением успешно отправлено!"
else
  echo ""
  echo "❌ Ошибка отправки сообщения"
  exit 1
fi

echo ""
echo "=== ✅ Все тесты пройдены успешно! ==="
echo ""
echo "🌐 R2 интеграция работает корректно:"
echo "   - Файлы загружаются на Cloudflare R2"
echo "   - Публичные URL генерируются правильно"
echo "   - Файлы доступны по публичным URL"
echo "   - WABA API принимает URL с R2"
echo ""
