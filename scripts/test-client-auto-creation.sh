#!/bin/bash

# Скрипт для проверки автоматического создания клиентов
# Использование: ./scripts/test-client-auto-creation.sh

echo "🧪 Тест автоматического создания клиентов"
echo "=========================================="
echo ""

# Получаем токен (замените на ваши данные)
read -p "Введите ваш JWT токен: " TOKEN
read -p "Введите ID организации: " ORG_ID

if [ -z "$TOKEN" ] || [ -z "$ORG_ID" ]; then
    echo "❌ Ошибка: TOKEN и ORG_ID обязательны"
    exit 1
fi

echo ""
echo "1️⃣ Получаем текущее количество клиентов..."
INITIAL_COUNT=$(curl -s "http://localhost:3000/api/clients?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.pagination.total')

echo "   Найдено клиентов: $INITIAL_COUNT"
echo ""

echo "2️⃣ Отправляем тестовое сообщение в WhatsApp (симуляция)..."
echo "   ⚠️  Для реального теста:"
echo "   - Отправьте сообщение на ваш WhatsApp номер организации"
echo "   - Или используйте Telegram бота"
echo ""
read -p "Отправили сообщение? Нажмите Enter для продолжения..."

echo ""
echo "3️⃣ Проверяем количество клиентов после сообщения..."
sleep 2 # Даем время на обработку

NEW_COUNT=$(curl -s "http://localhost:3000/api/clients?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.pagination.total')

echo "   Новое количество клиентов: $NEW_COUNT"
echo ""

if [ "$NEW_COUNT" -gt "$INITIAL_COUNT" ]; then
    echo "✅ ТЕСТ ПРОЙДЕН: Клиент создан автоматически!"
    echo "   Добавлено клиентов: $((NEW_COUNT - INITIAL_COUNT))"
    
    echo ""
    echo "4️⃣ Последний созданный клиент:"
    curl -s "http://localhost:3000/api/clients?limit=1&sortBy=createdAt&sortOrder=desc" \
      -H "Authorization: Bearer $TOKEN" | jq '.clients[0] | {id, name, source, whatsappJid, telegramUserId, createdAt}'
else
    echo "⚠️  Новые клиенты не обнаружены"
    echo "   Возможные причины:"
    echo "   - Клиент уже существовал"
    echo "   - Сообщение еще обрабатывается"
    echo "   - Сообщение было исходящим (от вас)"
fi

echo ""
echo "5️⃣ Проверяем список чатов с информацией о клиентах..."
LATEST_CHAT=$(curl -s "http://localhost:3000/api/chats?limit=1&sortBy=lastMessageAt&sortOrder=desc" \
  -H "Authorization: Bearer $TOKEN" | jq '.chats[0]')

echo "   Последний чат:"
echo "$LATEST_CHAT" | jq '{id, name, channel, organizationClients: .organizationClients | map({id, name, source})}'

echo ""
echo "✅ Тест завершен!"
echo ""
echo "📊 Статистика клиентов:"
curl -s "http://localhost:3000/api/clients/stats" \
  -H "Authorization: Bearer $TOKEN" | jq '{total, byType, byStatus: .byStatus | {active, inactive}}'
