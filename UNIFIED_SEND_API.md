# Универсальный API для отправки сообщений по Chat ID

## Описание

Единый эндпоинт `/api/messages/send-by-chat` автоматически определяет канал и тип подключения (WhatsApp Baileys, WhatsApp WABA или Telegram) и использует соответствующий сервис для отправки сообщений.

## Преимущества

✅ **Один эндпоинт** вместо трех разных API  
✅ **Автоматическое определение** канала и типа подключения  
✅ **Поддержка трех каналов**: WhatsApp (Baileys/WABA) и Telegram  
✅ **Поддержка всех типов** сообщений для WABA  
✅ **Унифицированный интерфейс** для фронтенда  

## Эндпоинт

```
POST /api/messages/send-by-chat
```

**Требуется авторизация:** Bearer Token (JWT)

## Параметры запроса

### Базовые параметры (обязательные)

| Параметр | Тип | Описание |
|----------|-----|----------|
| `chatId` | number | ID чата из базы данных |
| `type` | string | Тип сообщения: `text`, `image`, `document`, `video`, `audio`, `template` |

### Параметры для текста (type: "text")

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `text` | string | Да | Текст сообщения |

### Параметры для медиа (type: "image", "document", "video", "audio")

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `mediaUrl` | string | Да | URL медиафайла (только для WABA). Используйте `/api/media/upload-for-waba` для загрузки |
| `caption` | string | Нет | Подпись к медиафайлу |
| `filename` | string | Нет | Имя файла (для document) |

> **💡 Как загрузить медиафайл:** Используйте эндпоинт [`POST /api/media/upload-for-waba`](./WABA_MEDIA_UPLOAD.md) для загрузки файла и получения `mediaUrl`

### Параметры для шаблонов (type: "template")

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `template` | object | Да | Объект шаблона |
| `template.name` | string | Да | Имя шаблона |
| `template.language` | string | Нет | Язык (по умолчанию "ru") |
| `template.components` | array | Нет | Компоненты с параметрами |

## Ответ

### Успешный ответ (200 OK)

```json
{
  "success": true,
  "messageId": "wamid.HBgNNzc...",
  "chatId": 123,
  "connectionType": "waba",
  "message": {
    "id": 456,
    "content": "Привет!",
    "timestamp": "2025-12-13T10:30:00.000Z",
    ...
  }
}
```

### Ошибки

- `400` - Некорректные параметры
- `404` - Чат не найден
- `500` - Ошибка отправки
- `503` - Сервис не готов (Baileys не подключен)

## Примеры использования

### 1. Текстовое сообщение

```bash
curl -X POST https://bm.drawbridge.kz/api/messages/send-by-chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "type": "text",
    "text": "Привет! Как дела?"
  }'
```

### 2. Изображение (только WABA)

```bash
curl -X POST https://bm.drawbridge.kz/api/messages/send-by-chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "type": "image",
    "mediaUrl": "https://example.com/image.jpg",
    "caption": "Посмотри на это фото"
  }'
```

### 3. Документ (только WABA)

```bash
curl -X POST https://bm.drawbridge.kz/api/messages/send-by-chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "type": "document",
    "mediaUrl": "https://example.com/invoice.pdf",
    "filename": "invoice_2025.pdf",
    "caption": "Ваш счет"
  }'
```

### 4. Шаблон с параметрами (только WABA)

```bash
curl -X POST https://bm.drawbridge.kz/api/messages/send-by-chat \
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

### 5. Видео (только WABA)

```bash
curl -X POST https://bm.drawbridge.kz/api/messages/send-by-chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "type": "video",
    "mediaUrl": "https://example.com/video.mp4",
    "caption": "Обучающее видео"
  }'
```

### 6. Telegram (текстовое сообщение)

```bash
curl -X POST https://bm.drawbridge.kz/api/messages/send-by-chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 456,
    "type": "text",
    "text": "Привет из Telegram!"
  }'
```

## Использование в коде

### JavaScript/TypeScript

```typescript
async function sendMessage(
  chatId: number,
  type: 'text' | 'image' | 'document' | 'template',
  data: any,
  token: string
) {
  const response = await fetch('https://bm.drawbridge.kz/api/messages/send-by-chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatId,
      type,
      ...data
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send message');
  }
  
  return response.json();
}

// Примеры использования

// Текст
await sendMessage(123, 'text', { text: 'Привет!' }, token);

// Изображение
await sendMessage(123, 'image', {
  mediaUrl: 'https://example.com/image.jpg',
  caption: 'Фото'
}, token);

// Шаблон
await sendMessage(123, 'template', {
  template: {
    name: 'access',
    language: 'ru',
    components: [{
      type: 'body',
      parameters: [{ type: 'text', text: '1234' }]
    }]
  }
}, token);
```

### React Hook

```typescript
import { useState } from 'react';

export function useSendMessage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = async (
    chatId: number,
    type: string,
    data: any
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/messages/send-by-chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatId,
          type,
          ...data
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error);
      }

      const result = await response.json();
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { sendMessage, loading, error };
}

// Использование в компоненте
function ChatComponent() {
  const { sendMessage, loading, error } = useSendMessage();
  const [text, setText] = useState('');

  const handleSend = async () => {
    try {
      await sendMessage(123, 'text', { text });
      setText('');
      // Сообщение отправлено
    } catch (err) {
      console.error('Ошибка отправки:', err);
    }
  };

  return (
    <div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={loading}
      />
      <button onClick={handleSend} disabled={loading || !text}>
        {loading ? 'Отправка...' : 'Отправить'}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

### Python

```python
import requests

def send_message(chat_id: int, message_type: str, data: dict, token: str):
    """
    Отправить сообщение в чат
    
    Args:
        chat_id: ID чата
        message_type: Тип сообщения ('text', 'image', 'template', и т.д.)
        data: Данные сообщения (text, mediaUrl, template, и т.д.)
        token: JWT токен авторизации
    
    Returns:
        dict: Ответ от сервера
    """
    url = 'https://bm.drawbridge.kz/api/messages/send-by-chat'
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    payload = {
        'chatId': chat_id,
        'type': message_type,
        **data
    }
    
    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()
    return response.json()

# Примеры использования

# Текст
send_message(123, 'text', {'text': 'Привет!'}, token)

# Изображение
send_message(123, 'image', {
    'mediaUrl': 'https://example.com/image.jpg',
    'caption': 'Фото'
}, token)

# Шаблон
send_message(123, 'template', {
    'template': {
        'name': 'access',
        'language': 'ru',
        'components': [{
            'type': 'body',
            'parameters': [{'type': 'text', 'text': '1234'}]
        }]
    }
}, token)
```

## Поддержка каналов и типов сообщений

| Тип | WhatsApp Baileys | WhatsApp WABA | Telegram | Примечания |
|-----|------------------|---------------|----------|------------|
| `text` | ✅ | ✅ | ✅ | Полная поддержка для всех каналов |
| `image` | ❌ | ✅ | ❌ | Baileys/Telegram: используйте специализированные эндпоинты |
| `document` | ❌ | ✅ | ❌ | Baileys/Telegram: используйте специализированные эндпоинты |
| `video` | ❌ | ✅ | ❌ | Baileys/Telegram: используйте специализированные эндпоинты |
| `audio` | ❌ | ✅ | ❌ | Baileys/Telegram: используйте специализированные эндпоинты |
| `template` | ❌ | ✅ | ❌ | Только WABA |

## Как узнать канал и тип подключения чата?

API автоматически определяет канал (`whatsapp` или `telegram`) и тип подключения (`baileys` или `waba` для WhatsApp) из базы данных.

Чтобы узнать тип вручную:

```bash
# Получить информацию о чате
curl -X GET "https://bm.drawbridge.kz/api/chats?includeDetails=true" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

В ответе будут поля `channel` и `connectionType`:
```json
{
  "chats": [
    {
      "id": 123,
      "channel": "whatsapp",  // или "telegram"
      "connectionType": "waba",  // или "baileys" (только для whatsapp)
      ...
    }
  ]
}
```

## Миграция с отдельных эндпоинтов

### Было (старые эндпоинты):

```javascript
// Для Baileys
await fetch('/api/messages/send-text', {
  method: 'POST',
  body: JSON.stringify({
    organizationPhoneId: 1,
    receiverJid: '79001234567@s.whatsapp.net',
    text: 'Привет'
  })
});

// Для WABA
await fetch('/api/waba/operator/send', {
  method: 'POST',
  body: JSON.stringify({
    chatId: 123,
    type: 'text',
    message: 'Привет'
  })
});

// Для Telegram
await fetch('/api/telegram/send', {
  method: 'POST',
  body: JSON.stringify({
    botId: 1,
    chatId: '123456',
    text: 'Привет'
  })
});
```

### Стало (новый единый эндпоинт):

```javascript
// Работает для всех каналов и типов подключений
await fetch('/api/messages/send-by-chat', {
  method: 'POST',
  body: JSON.stringify({
    chatId: 123,
    type: 'text',
    text: 'Привет'
  })
});
```

## Обработка ошибок

```typescript
try {
  const result = await sendMessage(chatId, 'text', { text: 'Привет' }, token);
  console.log('Отправлено:', result.messageId);
} catch (error: any) {
  if (error.message.includes('не найден')) {
    // Чат не существует
    console.error('Чат не найден');
  } else if (error.message.includes('не готов')) {
    // Baileys не подключен
    console.error('WhatsApp не подключен, попробуйте позже');
  } else if (error.message.includes('не поддерживается')) {
    // Неподдерживаемый тип для данного подключения
    console.error('Этот тип сообщения не поддерживается');
  } else {
    console.error('Ошибка отправки:', error.message);
  }
}
```

## Особенности работы с Telegram

### Текстовые сообщения

Telegram через этот эндпоинт поддерживает только текстовые сообщения:

```typescript
await sendMessage(456, 'text', { text: 'Привет в Telegram!' }, token);
```

### Медиафайлы в Telegram

Для отправки медиафайлов в Telegram используйте специализированные методы Telegram Bot API:
- `sendPhoto()` - фото
- `sendDocument()` - документы
- `sendVideo()` - видео
- `sendAudio()` - аудио
- `sendVoice()` - голосовые сообщения

### Markdown и форматирование

Telegram поддерживает форматирование текста через Bot API. Для использования форматирования обращайтесь к специализированным эндпоинтам Telegram.

### Определение Telegram чата

Чтобы проверить, является ли чат Telegram чатом:

```typescript
const chat = await getChat(chatId);
if (chat.channel === 'telegram') {
  // Это Telegram чат
  console.log('Telegram Bot:', chat.telegramBot.botUsername);
}
```

## Полезные ссылки

- [📤 Загрузка медиафайлов для WABA](./WABA_MEDIA_UPLOAD.md) - **Как загружать файлы на сервер**
- [Документация WABA шаблонов](./WABA_TEMPLATES_GUIDE.md)
- [Документация WABA API](./WABA_OPERATOR_API.md)
- [Документация Baileys API](./API_DOCUMENTATION.md)
- [Документация Telegram](./TELEGRAM_INTEGRATION.md)
