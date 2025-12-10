# Примеры отправки сообщений через WABA API

## Базовый формат запроса

```bash
POST /api/waba/send
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

## 1. Текстовое сообщение

```bash
curl -X POST https://bm.drawbridge.kz/api/waba/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "to": "79009876543",
    "type": "text",
    "message": "Здравствуйте! Ваш заказ готов к выдаче."
  }'
```

**Ответ:**
```json
{
  "success": true,
  "data": {
    "messaging_product": "whatsapp",
    "contacts": [{"input": "79009876543", "wa_id": "79009876543"}],
    "messages": [{"id": "wamid.HBgNNzk..."}]
  }
}
```

## 2. Изображение

```bash
curl -X POST https://bm.drawbridge.kz/api/waba/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "to": "79009876543",
    "type": "image",
    "message": {
      "link": "https://example.com/image.jpg",
      "caption": "Фото вашего заказа"
    }
  }'
```

## 3. Документ (PDF, DOCX, etc.)

```bash
curl -X POST https://bm.drawbridge.kz/api/waba/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "to": "79009876543",
    "type": "document",
    "message": {
      "link": "https://example.com/invoice.pdf",
      "filename": "invoice_12345.pdf",
      "caption": "Ваш счёт"
    }
  }'
```

## 4. Видео

```bash
curl -X POST https://bm.drawbridge.kz/api/waba/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "to": "79009876543",
    "type": "video",
    "message": {
      "link": "https://example.com/video.mp4",
      "caption": "Инструкция по использованию"
    }
  }'
```

## 5. Интерактивное сообщение с кнопками

```bash
curl -X POST https://bm.drawbridge.kz/api/waba/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "to": "79009876543",
    "type": "interactive",
    "message": {
      "type": "button",
      "body": {
        "text": "Подтвердите получение заказа:"
      },
      "action": {
        "buttons": [
          {
            "type": "reply",
            "reply": {
              "id": "confirm_yes",
              "title": "Получил"
            }
          },
          {
            "type": "reply",
            "reply": {
              "id": "confirm_no",
              "title": "Не получил"
            }
          }
        ]
      }
    }
  }'
```

**Максимум 3 кнопки!**

## 6. Интерактивный список (до 10 элементов)

```bash
curl -X POST https://bm.drawbridge.kz/api/waba/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "to": "79009876543",
    "type": "interactive",
    "message": {
      "type": "list",
      "header": {
        "type": "text",
        "text": "Выберите категорию"
      },
      "body": {
        "text": "Доступные товары:"
      },
      "action": {
        "button": "Каталог",
        "sections": [
          {
            "title": "Популярное",
            "rows": [
              {"id": "item_1", "title": "Товар 1", "description": "100 руб"},
              {"id": "item_2", "title": "Товар 2", "description": "200 руб"}
            ]
          }
        ]
      }
    }
  }'
```

## 7. Шаблонное сообщение (требует одобрения Meta)

```bash
curl -X POST https://bm.drawbridge.kz/api/waba/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "to": "79009876543",
    "type": "template",
    "message": {
      "name": "order_confirmation",
      "language": "ru",
      "components": [
        {
          "type": "body",
          "parameters": [
            {"type": "text", "text": "12345"}
          ]
        }
      ]
    }
  }'
```

## Получение списка шаблонов

```bash
curl -X GET "https://bm.drawbridge.kz/api/waba/templates?organizationPhoneId=1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Использование в коде JavaScript/TypeScript

```typescript
// Отправка текстового сообщения
async function sendWABAMessage(token: string, to: string, text: string) {
  const response = await fetch('https://bm.drawbridge.kz/api/waba/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      organizationPhoneId: 1,
      to: to,
      type: 'text',
      message: text,
    }),
  });
  
  return await response.json();
}

// Отправка изображения
async function sendImage(token: string, to: string, imageUrl: string, caption?: string) {
  const response = await fetch('https://bm.drawbridge.kz/api/waba/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      organizationPhoneId: 1,
      to: to,
      type: 'image',
      message: {
        link: imageUrl,
        caption: caption,
      },
    }),
  });
  
  return await response.json();
}

// Использование
const result = await sendWABAMessage(myToken, '79009876543', 'Привет!');
console.log('Message ID:', result.data.messages[0].id);
```

## Использование в Python

```python
import requests

API_URL = "https://bm.drawbridge.kz"
TOKEN = "your_jwt_token"

def send_waba_message(to, message, org_phone_id=1):
    response = requests.post(
        f"{API_URL}/api/waba/send",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json"
        },
        json={
            "organizationPhoneId": org_phone_id,
            "to": to,
            "type": "text",
            "message": message
        }
    )
    return response.json()

# Использование
result = send_waba_message("79009876543", "Привет из Python!")
print(f"Message ID: {result['data']['messages'][0]['id']}")
```

## Важные замечания

### Формат номера телефона
- **Без** знака `+`
- **С** кодом страны
- Пример: `79009876543` (Россия), `12125551234` (США)

### Ограничения
- **Кнопки:** максимум 3 кнопки в одном сообщении
- **Список:** максимум 10 элементов
- **Длина текста кнопки:** до 20 символов
- **Первое сообщение:** должно быть template или пользователь сам начал диалог

### Типы медиа
- **Изображения:** JPG, PNG (макс 5MB)
- **Документы:** PDF, DOC, DOCX, XLS, XLSX (макс 100MB)
- **Видео:** MP4 (макс 16MB)
- **Аудио:** AAC, MP3, OGG (макс 16MB)

### Статусы доставки
Отслеживаются автоматически через webhook:
- `sent` - отправлено на сервер WhatsApp
- `delivered` - доставлено на устройство получателя
- `read` - прочитано получателем
- `failed` - не доставлено (ошибка)

## Тестирование

Используйте созданный скрипт:
```bash
./test-waba-send.sh
```

Или вручную через Postman/Insomnia с примерами выше.
