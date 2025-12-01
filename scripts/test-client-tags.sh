#!/bin/bash

# Тестовый скрипт для проверки API управления тегами клиентов

# Цвета для вывода
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

API_URL="http://localhost:3000"

# Получить токен (замените на свои данные)
echo -e "${BLUE}📝 Авторизация...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "${API_URL}/api/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123"
  }')

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo -e "${RED}❌ Ошибка авторизации${NC}"
  echo $LOGIN_RESPONSE | jq '.'
  exit 1
fi

echo -e "${GREEN}✅ Авторизация успешна${NC}"
echo "Token: ${TOKEN:0:20}..."
echo ""

# Функция для красивого вывода ответа
print_response() {
  local response=$1
  local status=$2
  
  if [ $status -eq 200 ] || [ $status -eq 201 ] || [ $status -eq 204 ]; then
    echo -e "${GREEN}✅ Успешно (HTTP $status)${NC}"
  else
    echo -e "${RED}❌ Ошибка (HTTP $status)${NC}"
  fi
  
  if [ ! -z "$response" ] && [ "$response" != "" ]; then
    echo "$response" | jq '.' 2>/dev/null || echo "$response"
  fi
  echo ""
}

# 1. Создание тегов
echo -e "${BLUE}🏷️ Тест 1: Создание тегов${NC}"

echo "Создание тега VIP..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/clients/tags" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "VIP",
    "color": "#FFD700"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"
TAG_VIP_ID=$(echo "$BODY" | jq -r '.id')

echo "Создание тега Оптовик..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/clients/tags" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Оптовик",
    "color": "#4CAF50"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"
TAG_WHOLESALE_ID=$(echo "$BODY" | jq -r '.id')

echo "Создание тега Новый клиент..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/clients/tags" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Новый клиент",
    "color": "#2196F3"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"
TAG_NEW_ID=$(echo "$BODY" | jq -r '.id')

# 2. Получение всех тегов
echo -e "${BLUE}🏷️ Тест 2: Получение списка всех тегов${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_URL}/api/clients/tags" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

# 3. Получение тега по ID
echo -e "${BLUE}🏷️ Тест 3: Получение тега по ID${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_URL}/api/clients/tags/${TAG_VIP_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

# 4. Обновление тега
echo -e "${BLUE}📝 Тест 4: Обновление тега${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "${API_URL}/api/clients/tags/${TAG_NEW_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Потенциальный клиент",
    "color": "#03A9F4"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

# 5. Создание тестового клиента
echo -e "${BLUE}👤 Тест 5: Создание тестового клиента для работы с тегами${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/clients" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Тестовый Клиент для Тегов",
    "email": "test-tags@example.com",
    "phone": "+79001112233",
    "clientType": "individual"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"
CLIENT_ID=$(echo "$BODY" | jq -r '.id')

echo "ID созданного клиента: $CLIENT_ID"
echo ""

# 6. Добавление тегов клиенту
echo -e "${BLUE}🔗 Тест 6: Добавление тегов клиенту${NC}"

echo "Добавление тега VIP..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/clients/${CLIENT_ID}/tags/${TAG_VIP_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

echo "Добавление тега Оптовик..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/clients/${CLIENT_ID}/tags/${TAG_WHOLESALE_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

# 7. Получение клиента с тегами
echo -e "${BLUE}👤 Тест 7: Получение клиента с тегами${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_URL}/api/clients/${CLIENT_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

# 8. Фильтрация клиентов по тегам
echo -e "${BLUE}🔍 Тест 8: Фильтрация клиентов по тегу VIP${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_URL}/api/clients?tags=${TAG_VIP_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

# 9. Фильтрация по нескольким тегам
echo -e "${BLUE}🔍 Тест 9: Фильтрация по нескольким тегам${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_URL}/api/clients?tags=${TAG_VIP_ID},${TAG_WHOLESALE_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

# 10. Удаление тега у клиента
echo -e "${BLUE}🔓 Тест 10: Удаление тега у клиента${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "${API_URL}/api/clients/${CLIENT_ID}/tags/${TAG_WHOLESALE_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

# 11. Проверка, что тег удален
echo -e "${BLUE}✅ Тест 11: Проверка удаления тега${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_URL}/api/clients/${CLIENT_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "Клиент должен иметь только 1 тег (VIP):"
print_response "$BODY" "$HTTP_CODE"

# 12. Удаление тега
echo -e "${BLUE}❌ Тест 12: Удаление тега${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "${API_URL}/api/clients/tags/${TAG_NEW_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

# 13. Проверка списка тегов после удаления
echo -e "${BLUE}📋 Тест 13: Проверка списка тегов после удаления${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_URL}/api/clients/tags" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "Должно остаться 2 тега (VIP и Оптовик):"
print_response "$BODY" "$HTTP_CODE"

# 14. Тест на дубликат имени
echo -e "${BLUE}⚠️ Тест 14: Попытка создать тег с дублирующимся именем${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/clients/tags" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "VIP",
    "color": "#000000"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "Должна быть ошибка 409 (Conflict):"
print_response "$BODY" "$HTTP_CODE"

# 15. Очистка - удаление тестового клиента
echo -e "${BLUE}🧹 Тест 15: Удаление тестового клиента${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "${API_URL}/api/clients/${CLIENT_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
print_response "$BODY" "$HTTP_CODE"

echo -e "${GREEN}✨ Все тесты завершены!${NC}"
