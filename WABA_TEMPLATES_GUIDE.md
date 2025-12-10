# Руководство по использованию шаблонов WABA

## Что такое шаблоны?

Шаблоны (Message Templates) - это предварительно одобренные Meta сообщения, которые можно использовать для:
- Инициации разговора (первое сообщение клиенту)
- Отправки сообщений вне 24-часового окна
- Структурированных уведомлений (коды подтверждения, статусы заказов и т.д.)

## Создание шаблона

1. Зайдите в WhatsApp Manager: https://business.facebook.com/latest/whatsapp_manager/message_templates
2. Нажмите "Create Template"
3. Заполните поля:
   - **Name**: имя шаблона (например, `access`)
   - **Category**: тип шаблона (Authentication, Marketing, Utility)
   - **Language**: язык (Russian)
   - **Content**: текст с переменными {{1}}, {{2}} и т.д.

### Пример шаблона "access"

**Название:** `access`  
**Категория:** Authentication  
**Язык:** Russian  
**Текст:**
```
Ваш код доступа: {{1}}

Никому не сообщайте этот код.
```

4. Отправьте на модерацию (обычно одобряется за несколько минут)

## Использование через API

### 1. Через прямой API (с номером телефона)

```bash
curl -X POST https://bm.drawbridge.kz/api/waba/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "to": "77054810862",
    "type": "template",
    "message": {
      "name": "access",
      "language": "ru",
      "components": [
        {
          "type": "body",
          "parameters": [
            {
              "type": "text",
              "text": "1234"
            }
          ]
        }
      ]
    }
  }'
```

### 2. Через Operator API (с chatId)

```bash
curl -X POST https://bm.drawbridge.kz/api/waba/operator/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
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
              "text": "1234"
            }
          ]
        }
      ]
    }
  }'
```

## Примеры с разными типами переменных

### Текстовые переменные

Шаблон: `Привет, {{1}}! Ваш заказ №{{2}} готов.`

```json
{
  "chatId": 123,
  "type": "template",
  "template": {
    "name": "order_ready",
    "language": "ru",
    "components": [
      {
        "type": "body",
        "parameters": [
          {"type": "text", "text": "Иван"},
          {"type": "text", "text": "ORD-12345"}
        ]
      }
    ]
  }
}
```

### С хедером (изображение)

Шаблон с изображением в заголовке:

```json
{
  "chatId": 123,
  "type": "template",
  "template": {
    "name": "product_promo",
    "language": "ru",
    "components": [
      {
        "type": "header",
        "parameters": [
          {
            "type": "image",
            "image": {
              "link": "https://example.com/product.jpg"
            }
          }
        ]
      },
      {
        "type": "body",
        "parameters": [
          {"type": "text", "text": "Новый товар"},
          {"type": "text", "text": "1999"}
        ]
      }
    ]
  }
}
```

### С кнопками (URL)

Шаблон с кнопкой перехода на сайт:

```json
{
  "chatId": 123,
  "type": "template",
  "template": {
    "name": "order_tracking",
    "language": "ru",
    "components": [
      {
        "type": "body",
        "parameters": [
          {"type": "text", "text": "ORD-12345"}
        ]
      },
      {
        "type": "button",
        "sub_type": "url",
        "index": "0",
        "parameters": [
          {
            "type": "text",
            "text": "ORD-12345"
          }
        ]
      }
    ]
  }
}
```

## Примеры использования в коде

### JavaScript/TypeScript

```typescript
// Отправка кода доступа
async function sendAccessCode(chatId: number, code: string, token: string) {
  const response = await fetch('https://bm.drawbridge.kz/api/waba/operator/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatId,
      type: 'template',
      template: {
        name: 'access',
        language: 'ru',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: code }
            ]
          }
        ]
      }
    })
  });
  
  return response.json();
}

// Использование
await sendAccessCode(123, '5678', 'your_jwt_token');
```

### Python

```python
import requests

def send_access_code(chat_id: int, code: str, token: str):
    url = 'https://bm.drawbridge.kz/api/waba/operator/send'
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    data = {
        'chatId': chat_id,
        'type': 'template',
        'template': {
            'name': 'access',
            'language': 'ru',
            'components': [
                {
                    'type': 'body',
                    'parameters': [
                        {'type': 'text', 'text': code}
                    ]
                }
            ]
        }
    }
    
    response = requests.post(url, headers=headers, json=data)
    return response.json()

# Использование
send_access_code(123, '5678', 'your_jwt_token')
```

## Получение списка доступных шаблонов

```bash
curl -X GET "https://bm.drawbridge.kz/api/waba/templates?organizationPhoneId=1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Важные замечания

1. **Первое сообщение**: Для инициации разговора с клиентом ОБЯЗАТЕЛЬНО используйте шаблон (или дождитесь, пока клиент сам напишет первым)

2. **24-часовое окно**: После того, как клиент написал вам, у вас есть 24 часа для отправки любых сообщений. После - только шаблоны.

3. **Модерация**: Все шаблоны проходят модерацию Meta (обычно 1-30 минут). Статус можно проверить в WhatsApp Manager.

4. **Качество шаблонов**: Meta следит за качеством шаблонов через рейтинг. Не спамьте, иначе аккаунт заблокируют.

5. **Переменные**: 
   - Нумеруются с {{1}}
   - Максимум 10 переменных в одном шаблоне
   - Можно использовать в header, body, footer

## Категории шаблонов

### Authentication (Аутентификация)
- Коды подтверждения
- OTP
- Пароли

Пример:
```
Ваш код подтверждения: {{1}}
Действителен 5 минут.
```

### Marketing (Маркетинг)
- Акции
- Скидки
- Новости о продуктах

⚠️ Требуют opt-in от клиента

### Utility (Утилиты)
- Статусы заказов
- Напоминания
- Уведомления о доставке

Пример:
```
Ваш заказ №{{1}} отправлен.
Трек-номер: {{2}}
```

## Отладка

Если шаблон не отправляется:

1. Проверьте статус в WhatsApp Manager (должен быть "Approved")
2. Убедитесь, что язык совпадает (`ru`, `en`, `kk`)
3. Проверьте количество параметров (должно совпадать с {{1}}, {{2}} в шаблоне)
4. Проверьте формат номера телефона (без + и пробелов)

## Полезные ссылки

- [WhatsApp Manager](https://business.facebook.com/latest/whatsapp_manager)
- [Message Templates Docs](https://developers.facebook.com/docs/whatsapp/message-templates)
- [Template Guidelines](https://developers.facebook.com/docs/whatsapp/message-templates/guidelines)
- [Quality Rating](https://developers.facebook.com/docs/whatsapp/messaging-limits)
