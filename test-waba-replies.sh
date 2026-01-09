#!/bin/bash

# Тест для проверки отображения реплаев в WABA
# Убедитесь, что сервер запущен перед выполнением этого скрипта

echo "🧪 Тестирование отображения реплаев в WABA"
echo "=========================================="
echo ""

# Настройки (измените на ваши)
BASE_URL="http://localhost:3000"
TOKEN="your_auth_token_here"
CHAT_ID="1"  # ID чата для тестирования

echo "📋 Шаг 1: Получение сообщений из чата"
echo "Запрос: GET /api/chats/$CHAT_ID/messages"
echo ""

RESPONSE=$(curl -s -X GET "$BASE_URL/api/chats/$CHAT_ID/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

echo "Ответ:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""
echo "----------------------------------------"
echo ""

# Проверяем наличие quotedContent в ответе
if echo "$RESPONSE" | grep -q "quotedContent"; then
  echo "✅ Поле quotedContent присутствует в ответе"
  
  # Извлекаем примеры сообщений с реплаями
  echo ""
  echo "📝 Примеры сообщений с реплаями:"
  echo "$RESPONSE" | jq '.messages[] | select(.quotedContent != null) | {id, content, quotedContent, quotedMessageId}' 2>/dev/null
else
  echo "❌ Поле quotedContent отсутствует в ответе"
  echo ""
  echo "⚠️  Возможные причины:"
  echo "   1. Сервер не был перезапущен после изменений"
  echo "   2. В чате нет сообщений с реплаями"
  echo "   3. Изменения не были скомпилированы (запустите: npm run build)"
fi

echo ""
echo "=========================================="
echo ""
echo "📋 Шаг 2: Получение списка чатов (последнее сообщение)"
echo "Запрос: GET /api/chats"
echo ""

CHATS_RESPONSE=$(curl -s -X GET "$BASE_URL/api/chats" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

echo "Ответ (последнее сообщение):"
echo "$CHATS_RESPONSE" | jq '.chats[0].lastMessage' 2>/dev/null || echo "$CHATS_RESPONSE"
echo ""

if echo "$CHATS_RESPONSE" | grep -q "quotedContent"; then
  echo "✅ Поле quotedContent присутствует в lastMessage"
else
  echo "❌ Поле quotedContent отсутствует в lastMessage"
fi

echo ""
echo "=========================================="
echo ""
echo "💡 Инструкции для тестирования:"
echo ""
echo "1. Отправьте сообщение через WABA в WhatsApp"
echo "2. В WhatsApp ответьте на это сообщение (свайп вправо)"
echo "3. Проверьте логи сервера:"
echo "   tail -f /path/to/server.log | grep reply"
echo ""
echo "4. Ожидаемый лог:"
echo "   [reply] Ответ на сообщение ID: wamid.xxx, текст: \"Оригинальный текст\""
echo "   📥 WABA: Входящее [text]: \"ответил на: \\\"Оригинальный текст\\\"\\n\\nОтвет\""
echo ""
echo "5. Запустите этот скрипт снова для проверки API"
echo ""
echo "=========================================="
