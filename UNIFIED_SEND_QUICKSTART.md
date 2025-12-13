# Быстрый старт: Универсальный API отправки сообщений

## Один эндпоинт для всех каналов

```
POST /api/messages/send-by-chat
```

## Поддерживаемые каналы

| Канал | Типы сообщений | Примечания |
|-------|----------------|------------|
| **WhatsApp (WABA)** | text, image, document, video, audio, template | Полная поддержка всех типов |
| **WhatsApp (Baileys)** | text | Только текстовые сообщения |
| **Telegram** | text | Только текстовые сообщения |

## Примеры

### WhatsApp текст

```bash
curl -X POST https://bm.drawbridge.kz/api/messages/send-by-chat \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"chatId": 123, "type": "text", "text": "Привет!"}'
```

### Telegram текст

```bash
curl -X POST https://bm.drawbridge.kz/api/messages/send-by-chat \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"chatId": 456, "type": "text", "text": "Привет в Telegram!"}'
```

### WABA изображение

```bash
curl -X POST https://bm.drawbridge.kz/api/messages/send-by-chat \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "type": "image",
    "mediaUrl": "https://example.com/image.jpg",
    "caption": "Описание"
  }'
```

### WABA шаблон

```bash
curl -X POST https://bm.drawbridge.kz/api/messages/send-by-chat \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "type": "template",
    "template": {
      "name": "access",
      "language": "ru",
      "components": [{
        "type": "body",
        "parameters": [{"type": "text", "text": "1234"}]
      }]
    }
  }'
```

## TypeScript/JavaScript

```typescript
async function sendMessage(chatId: number, text: string, token: string) {
  const response = await fetch('https://bm.drawbridge.kz/api/messages/send-by-chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatId,
      type: 'text',
      text
    })
  });
  
  return response.json();
}

// Использование
await sendMessage(123, 'Привет!', token);
```

## React

```typescript
import { useState } from 'react';

function ChatInput({ chatId }: { chatId: number }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    setLoading(true);
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
          type: 'text',
          text
        })
      });

      if (response.ok) {
        setText('');
        // Сообщение отправлено
      }
    } finally {
      setLoading(false);
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
        Отправить
      </button>
    </div>
  );
}
```

## Ответ API

```json
{
  "success": true,
  "messageId": "wamid.HBgNNzc...",
  "chatId": 123,
  "channel": "whatsapp",
  "connectionType": "waba"
}
```

Или для Telegram:

```json
{
  "success": true,
  "messageId": 12345,
  "chatId": 456,
  "channel": "telegram"
}
```

## Обработка ошибок

```typescript
try {
  const result = await sendMessage(chatId, text, token);
  console.log('Отправлено:', result.messageId);
} catch (error) {
  if (error.message.includes('не найден')) {
    // Чат не существует
  } else if (error.message.includes('не готов')) {
    // Сервис не подключен
  } else if (error.message.includes('не поддерживается')) {
    // Неподдерживаемый тип для данного канала
  }
}
```

## Документация

- 📘 [Полная документация](./UNIFIED_SEND_API.md)
- 🧪 [Тестовый скрипт](./test-unified-send.sh)
