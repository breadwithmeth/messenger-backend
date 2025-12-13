#!/bin/bash

# Тестирование загрузки медиафайлов для WABA

# Конфигурация
BASE_URL="https://bm.drawbridge.kz"
TOKEN="YOUR_JWT_TOKEN"  # Замените на ваш токен
CHAT_ID="123"           # Замените на ID чата

echo "🧪 Тестирование API загрузки медиафайлов для WABA..."
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Функция для проверки наличия файла
check_file() {
  if [ ! -f "$1" ]; then
    echo -e "${RED}❌ Файл не найден: $1${NC}"
    echo "Создайте тестовый файл или измените путь в скрипте"
    return 1
  fi
  return 0
}

# 1. Загрузка изображения
echo "1️⃣ Загрузка изображения..."
IMAGE_FILE="test-image.jpg"

if check_file "$IMAGE_FILE"; then
  RESPONSE=$(curl -s -X POST "$BASE_URL/api/media/upload-for-waba" \
    -H "Authorization: Bearer $TOKEN" \
    -F "media=@$IMAGE_FILE" \
    -F "mediaType=image")
  
  echo "$RESPONSE" | jq '.'
  
  # Извлекаем mediaUrl из ответа
  MEDIA_URL=$(echo "$RESPONSE" | jq -r '.mediaUrl')
  
  if [ "$MEDIA_URL" != "null" ]; then
    echo -e "${GREEN}✅ Изображение загружено: $MEDIA_URL${NC}"
    
    # Отправляем через WABA
    echo "   📤 Отправка изображения через WABA..."
    curl -s -X POST "$BASE_URL/api/messages/send-by-chat" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "chatId": '"$CHAT_ID"',
        "type": "image",
        "mediaUrl": "'"$MEDIA_URL"'",
        "caption": "Тестовое изображение, загруженное через API"
      }' | jq '.'
  else
    echo -e "${RED}❌ Ошибка загрузки${NC}"
  fi
fi
echo ""

# 2. Загрузка документа
echo "2️⃣ Загрузка документа..."
DOC_FILE="test-document.pdf"

if check_file "$DOC_FILE"; then
  RESPONSE=$(curl -s -X POST "$BASE_URL/api/media/upload-for-waba" \
    -H "Authorization: Bearer $TOKEN" \
    -F "media=@$DOC_FILE" \
    -F "mediaType=document")
  
  echo "$RESPONSE" | jq '.'
  
  MEDIA_URL=$(echo "$RESPONSE" | jq -r '.mediaUrl')
  
  if [ "$MEDIA_URL" != "null" ]; then
    echo -e "${GREEN}✅ Документ загружен: $MEDIA_URL${NC}"
    
    echo "   📤 Отправка документа через WABA..."
    curl -s -X POST "$BASE_URL/api/messages/send-by-chat" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "chatId": '"$CHAT_ID"',
        "type": "document",
        "mediaUrl": "'"$MEDIA_URL"'",
        "filename": "test-document.pdf",
        "caption": "Тестовый документ"
      }' | jq '.'
  else
    echo -e "${RED}❌ Ошибка загрузки${NC}"
  fi
fi
echo ""

# 3. Загрузка видео
echo "3️⃣ Загрузка видео..."
VIDEO_FILE="test-video.mp4"

if check_file "$VIDEO_FILE"; then
  RESPONSE=$(curl -s -X POST "$BASE_URL/api/media/upload-for-waba" \
    -H "Authorization: Bearer $TOKEN" \
    -F "media=@$VIDEO_FILE" \
    -F "mediaType=video")
  
  echo "$RESPONSE" | jq '.'
  
  MEDIA_URL=$(echo "$RESPONSE" | jq -r '.mediaUrl')
  
  if [ "$MEDIA_URL" != "null" ]; then
    echo -e "${GREEN}✅ Видео загружено: $MEDIA_URL${NC}"
    
    echo "   📤 Отправка видео через WABA..."
    curl -s -X POST "$BASE_URL/api/messages/send-by-chat" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "chatId": '"$CHAT_ID"',
        "type": "video",
        "mediaUrl": "'"$MEDIA_URL"'",
        "caption": "Тестовое видео"
      }' | jq '.'
  else
    echo -e "${RED}❌ Ошибка загрузки${NC}"
  fi
fi
echo ""

# 4. Загрузка аудио
echo "4️⃣ Загрузка аудио..."
AUDIO_FILE="test-audio.mp3"

if check_file "$AUDIO_FILE"; then
  RESPONSE=$(curl -s -X POST "$BASE_URL/api/media/upload-for-waba" \
    -H "Authorization: Bearer $TOKEN" \
    -F "media=@$AUDIO_FILE" \
    -F "mediaType=audio")
  
  echo "$RESPONSE" | jq '.'
  
  MEDIA_URL=$(echo "$RESPONSE" | jq -r '.mediaUrl')
  
  if [ "$MEDIA_URL" != "null" ]; then
    echo -e "${GREEN}✅ Аудио загружено: $MEDIA_URL${NC}"
    
    echo "   📤 Отправка аудио через WABA..."
    curl -s -X POST "$BASE_URL/api/messages/send-by-chat" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "chatId": '"$CHAT_ID"',
        "type": "audio",
        "mediaUrl": "'"$MEDIA_URL"'"
      }' | jq '.'
  else
    echo -e "${RED}❌ Ошибка загрузки${NC}"
  fi
fi
echo ""

# 5. Тест с неподдерживаемым типом (должна быть ошибка)
echo "5️⃣ Тест с неподдерживаемым типом (ожидается ошибка)..."
if check_file "$IMAGE_FILE"; then
  curl -s -X POST "$BASE_URL/api/media/upload-for-waba" \
    -H "Authorization: Bearer $TOKEN" \
    -F "media=@$IMAGE_FILE" \
    -F "mediaType=invalid" | jq '.'
fi
echo ""

# 6. Тест без файла (должна быть ошибка)
echo "6️⃣ Тест без файла (ожидается ошибка)..."
curl -s -X POST "$BASE_URL/api/media/upload-for-waba" \
  -H "Authorization: Bearer $TOKEN" \
  -F "mediaType=image" | jq '.'
echo ""

echo "✅ Тесты завершены!"
echo ""
echo "💡 Примечания:"
echo "  - Создайте тестовые файлы в текущей директории:"
echo "    • test-image.jpg"
echo "    • test-document.pdf"
echo "    • test-video.mp4"
echo "    • test-audio.mp3"
echo "  - Или измените пути к файлам в скрипте"
echo "  - Установите токен и chatId в начале скрипта"
