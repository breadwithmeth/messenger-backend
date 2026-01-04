#!/bin/bash

# Тестирование автоматического уведомления о возрастном ограничении 21+
# Требуется: JWT токен, номер тикета

# Цвета для вывода
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Конфигурация
BASE_URL="http://localhost:3000"
JWT_TOKEN="YOUR_JWT_TOKEN_HERE"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Тестирование уведомлений о возрасте 21+${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Проверка токена
if [ "$JWT_TOKEN" = "YOUR_JWT_TOKEN_HERE" ]; then
  echo -e "${RED}❌ Ошибка: Установите JWT_TOKEN в скрипте${NC}"
  echo "Получите токен через: POST /api/auth/login"
  exit 1
fi

# Тест 1: Закрытие тикета (статус closed)
echo -e "${YELLOW}Тест 1: Закрытие тикета (статус closed)${NC}"
echo "Введите номер тикета для закрытия:"
read TICKET_NUMBER

if [ -z "$TICKET_NUMBER" ]; then
  echo -e "${RED}❌ Номер тикета не указан${NC}"
  exit 1
fi

echo -e "${BLUE}Отправка запроса...${NC}"
RESPONSE=$(curl -s -X PUT "${BASE_URL}/api/tickets/${TICKET_NUMBER}/status" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "closed",
    "reason": "Заказ успешно доставлен (тест)"
  }')

echo ""
echo -e "${GREEN}Ответ сервера:${NC}"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

# Проверка успешности
if echo "$RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ Тикет закрыт успешно${NC}"
  echo -e "${GREEN}✅ Уведомление о возрастном ограничении отправлено клиенту${NC}"
  echo ""
  echo -e "${BLUE}Проверьте WhatsApp/Telegram клиента - он должен получить:${NC}"
  echo "⚠️ Напоминаем: доставка алкогольной продукции осуществляется лицам старше 21 года."
  echo "При получении заказа необходимо предъявить документ, удостоверяющий личность и возраст"
  echo "(паспорт, водительское удостоверение). Спасибо за понимание!"
else
  echo -e "${RED}❌ Ошибка при закрытии тикета${NC}"
fi

echo ""
echo -e "${BLUE}========================================${NC}"

# Тест 2: Перевод в статус resolved
echo ""
echo -e "${YELLOW}Тест 2: Перевод в статус resolved${NC}"
echo "Введите номер тикета для перевода в 'resolved':"
read TICKET_NUMBER_2

if [ -z "$TICKET_NUMBER_2" ]; then
  echo -e "${YELLOW}⚠️ Тест 2 пропущен${NC}"
  exit 0
fi

echo -e "${BLUE}Отправка запроса...${NC}"
RESPONSE_2=$(curl -s -X PUT "${BASE_URL}/api/tickets/${TICKET_NUMBER_2}/status" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "resolved",
    "reason": "Проблема решена (тест)"
  }')

echo ""
echo -e "${GREEN}Ответ сервера:${NC}"
echo "$RESPONSE_2" | jq '.' 2>/dev/null || echo "$RESPONSE_2"
echo ""

# Проверка успешности
if echo "$RESPONSE_2" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ Тикет переведён в 'resolved' успешно${NC}"
  echo -e "${GREEN}✅ Уведомление о возрастном ограничении отправлено клиенту${NC}"
else
  echo -e "${RED}❌ Ошибка при изменении статуса${NC}"
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Тестирование завершено${NC}"
echo -e "${BLUE}========================================${NC}"
