#!/bin/bash

# Примеры отправки сообщений через WABA API

# 1. Получите JWT токен (сначала авторизуйтесь)
# Замените на ваши данные
API_URL="https://bm.drawbridge.kz"
# API_URL="http://localhost:4000"

# Получение токена
echo "=== Получение JWT токена ==="
TOKEN_RESPONSE=$(curl -s -X POST ${API_URL}/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@naliv.kz",
    "password": "123456"
  }')

TOKEN=$(echo $TOKEN_RESPONSE | grep -o '"token":"[^"]*' | grep -o '[^"]*$')
echo "Token: ${TOKEN:0:20}..."
echo ""

# Если токен уже есть, раскомментируйте и используйте:
# TOKEN="your_jwt_token_here"

# 2. ОТПРАВКА ТЕКСТОВОГО СООБЩЕНИЯ
echo "=== Тест 1: Отправка текстового сообщения ==="
curl -X POST ${API_URL}/api/waba/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 8,
    "to": "77772851609",
    "type": "text",
    "message": "Мы рады сообщить вам что вы теперь часть нашей программы лояльности! Спасибо что вы с нами."
  }'
echo -e "\n"


echo "=== Тест 1: Отправка текстового сообщения ==="
curl -X POST ${API_URL}/api/waba/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 8,
    "to": "77710131111",
    "type": "text",
    "message": "Мы рады сообщить вам что вы теперь часть нашей программы лояльности! Спасибо что вы с нами."
  }'
echo -e "\n"

# 3. ОТПРАВКА ИЗОБРАЖЕНИЯ
echo "=== Тест 2: Отправка изображения ==="
curl -X POST ${API_URL}/api/waba/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 8,
    "to": "77054810862",
    "type": "image",
    "message": {
      "link": "https://picsum.photos/400/300",
      "caption": "Тестовое изображение"
    }
  }'
echo -e "\n"

# 4. ОТПРАВКА ДОКУМЕНТА
echo "=== Тест 3: Отправка документа ==="
curl -X POST ${API_URL}/api/waba/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 8,
    "to": "79009876543",
    "type": "document",
    "message": {
      "link": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      "filename": "test.pdf",
      "caption": "Тестовый PDF документ"
    }
  }'
echo -e "\n"

# 5. ОТПРАВКА ИНТЕРАКТИВНОГО СООБЩЕНИЯ С КНОПКАМИ
echo "=== Тест 4: Интерактивное сообщение с кнопками ==="
curl -X POST ${API_URL}/api/waba/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 8,
    "to": "77054810862",
    "type": "interactive",
    "message": {
      "type": "button",
      "body": {
        "text": "Выберите действие:"
      },
      "action": {
        "buttons": [
          {
            "type": "reply",
            "reply": {
              "id": "btn_order",
              "title": "Заказать"
            }
          },
          {
            "type": "reply",
            "reply": {
              "id": "btn_cancel",
              "title": "Отменить"
            }
          },
          {
            "type": "reply",
            "reply": {
              "id": "btn_help",
              "title": "Помощь"
            }
          }
        ]
      }
    }
  }'
echo -e "\n"

# 6. ОТПРАВКА ШАБЛОННОГО СООБЩЕНИЯ (требует предварительного создания в Meta)
echo "=== Тест 5: Шаблонное сообщение ==="
curl -X POST ${API_URL}/api/waba/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 8,
    "to": "77054810862",
    "type": "template",
    "message": {
      "name": "hello_world",
      "language": "en_US"
    }
  }'
echo -e "\n"

# 7. ПОЛУЧЕНИЕ СПИСКА ШАБЛОНОВ
echo "=== Тест 6: Получение списка шаблонов ==="
curl -X GET "${API_URL}/api/waba/templates?organizationPhoneId=1" \
  -H "Authorization: Bearer $TOKEN"
echo -e "\n"

echo "=== Все тесты завершены ==="
