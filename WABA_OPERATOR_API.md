# WABA Operator API - Документация для операторов

API endpoints для операторов для работы с WhatsApp Business API (WABA).

## Базовая авторизация

Все endpoints требуют JWT токен в заголовке:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## 1. Отправка сообщения оператором

**Упрощённый API для отправки сообщений из чата**

```http
POST /api/waba/operator/send
Authorization: Bearer <token>
Content-Type: application/json
```

### Параметры:

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `chatId` | number | ✅ | ID чата |
| `message` | string | ✅ | Текст сообщения или описание |
| `type` | string | ❌ | Тип: `text`, `image`, `document` (по умолчанию: `text`) |
| `mediaUrl` | string | ❌ | URL медиафайла (для `image`, `document`) |
| `caption` | string | ❌ | Подпись к медиа |
| `filename` | string | ❌ | Имя файла (для `document`) |

### Примеры:

#### Текстовое сообщение
```bash
curl -X POST https://bm.drawbridge.kz/api/waba/operator/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "message": "Здравствуйте! Ваш заказ готов к выдаче."
  }'
```

#### Отправка изображения
```bash
curl -X POST https://bm.drawbridge.kz/api/waba/operator/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "type": "image",
    "mediaUrl": "https://example.com/photo.jpg",
    "message": "Фото вашего заказа",
    "caption": "Заказ #12345"
  }'
```

#### Отправка документа
```bash
curl -X POST https://bm.drawbridge.kz/api/waba/operator/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "type": "document",
    "mediaUrl": "https://example.com/invoice.pdf",
    "message": "Счёт на оплату",
    "filename": "invoice_12345.pdf",
    "caption": "Счёт #12345"
  }'
```

### Ответ:
```json
{
  "success": true,
  "messageId": "wamid.HBgNNzk...",
  "message": {
    "id": 456,
    "chatId": 123,
    "content": "Здравствуйте! Ваш заказ готов к выдаче.",
    "status": "sent",
    "timestamp": "2025-12-09T12:34:56.000Z"
  }
}
```

### Возможные ошибки:
- `400` - Отсутствуют обязательные поля или неверный тип
- `404` - Чат не найден
- `500` - WABA не настроен (нет `wabaAccessToken`)

---

## 2. Проверка статуса доставки сообщения

**Получить статус доставки конкретного сообщения**

```http
GET /api/waba/operator/message-status/:messageId
Authorization: Bearer <token>
```

### Параметры:
- `messageId` - ID сообщения из базы данных

### Пример:
```bash
curl -X GET https://bm.drawbridge.kz/api/waba/operator/message-status/456 \
  -H "Authorization: Bearer $TOKEN"
```

### Ответ:
```json
{
  "id": 456,
  "whatsappMessageId": "wamid.HBgNNzk...",
  "status": "delivered",
  "timestamp": "2025-12-09T12:34:56.000Z",
  "delivered": true,
  "read": false
}
```

### Статусы (`status`):
- `sent` - отправлено на сервер WhatsApp
- `delivered` - доставлено на устройство получателя  
- `read` - прочитано получателем
- `failed` - не доставлено (ошибка)
- `pending` - в процессе отправки

### Флаги:
- `delivered` - `true` если статус `delivered` или `read`
- `read` - `true` если статус `read`

---

## 3. Получение истории сообщений чата

**Получить все сообщения чата с информацией о доставке**

```http
GET /api/waba/operator/chat/:chatId/messages?limit=50&offset=0
Authorization: Bearer <token>
```

### Параметры:
- `chatId` - ID чата
- `limit` - количество сообщений (по умолчанию: 50)
- `offset` - смещение для пагинации (по умолчанию: 0)

### Пример:
```bash
curl -X GET "https://bm.drawbridge.kz/api/waba/operator/chat/123/messages?limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN"
```

### Ответ:
```json
{
  "messages": [
    {
      "id": 458,
      "whatsappMessageId": "wamid.HBgNNzk...",
      "content": "Спасибо!",
      "mediaUrl": null,
      "type": "text",
      "fromMe": false,
      "timestamp": "2025-12-09T12:40:00.000Z",
      "status": "received",
      "delivered": false,
      "read": false,
      "isReadByOperator": true,
      "senderUser": null
    },
    {
      "id": 457,
      "whatsappMessageId": "wamid.HBgNNzk...",
      "content": "Ваш заказ готов",
      "mediaUrl": null,
      "type": "text",
      "fromMe": true,
      "timestamp": "2025-12-09T12:35:00.000Z",
      "status": "read",
      "delivered": true,
      "read": true,
      "isReadByOperator": true,
      "senderUser": {
        "id": 5,
        "email": "operator@example.com"
      }
    }
  ],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

### Поля сообщения:
- `fromMe` - `true` если отправлено оператором, `false` если от клиента
- `delivered` - сообщение доставлено получателю
- `read` - сообщение прочитано получателем
- `isReadByOperator` - оператор прочитал входящее сообщение
- `senderUser` - информация об операторе (если `fromMe: true`)

---

## Использование в JavaScript/TypeScript

### Отправка сообщения
```typescript
interface SendMessageRequest {
  chatId: number;
  message: string;
  type?: 'text' | 'image' | 'document';
  mediaUrl?: string;
  caption?: string;
  filename?: string;
}

async function sendWABAMessage(token: string, data: SendMessageRequest) {
  const response = await fetch('https://bm.drawbridge.kz/api/waba/operator/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send message');
  }
  
  return await response.json();
}

// Использование
const result = await sendWABAMessage(myToken, {
  chatId: 123,
  message: 'Привет!'
});
console.log('Sent:', result.messageId);
```

### Проверка статуса
```typescript
async function checkMessageStatus(token: string, messageId: number) {
  const response = await fetch(
    `https://bm.drawbridge.kz/api/waba/operator/message-status/${messageId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );
  
  return await response.json();
}

// Использование
const status = await checkMessageStatus(myToken, 456);
if (status.delivered) {
  console.log('✅ Доставлено');
}
if (status.read) {
  console.log('👁️ Прочитано');
}
```

### Получение истории чата
```typescript
async function getChatHistory(token: string, chatId: number, limit = 50, offset = 0) {
  const response = await fetch(
    `https://bm.drawbridge.kz/api/waba/operator/chat/${chatId}/messages?limit=${limit}&offset=${offset}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );
  
  return await response.json();
}

// Использование
const history = await getChatHistory(myToken, 123, 20);
console.log(`Всего сообщений: ${history.total}`);
history.messages.forEach(msg => {
  const direction = msg.fromMe ? '➡️' : '⬅️';
  const statusIcon = msg.read ? '👁️' : msg.delivered ? '✅' : '⏱️';
  console.log(`${direction} ${statusIcon} ${msg.content}`);
});
```

---

## Интеграция во фронтенд

### React пример

```tsx
import { useState } from 'react';

function ChatOperatorPanel({ chatId, token }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const sendMessage = async () => {
    setSending(true);
    try {
      const response = await fetch('https://bm.drawbridge.kz/api/waba/operator/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatId,
          message,
          type: 'text',
        }),
      });
      
      if (response.ok) {
        setMessage('');
        alert('✅ Сообщение отправлено');
      }
    } catch (error) {
      alert('❌ Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <textarea 
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder="Введите сообщение..."
      />
      <button onClick={sendMessage} disabled={sending}>
        {sending ? 'Отправка...' : 'Отправить'}
      </button>
    </div>
  );
}
```

---

## Webhook события (автоматическое обновление статусов)

Статусы доставки обновляются автоматически через webhook от Meta:

1. **Сообщение отправлено** → `status: "sent"`
2. **Доставлено на устройство** → `status: "delivered"` (webhook от Meta)
3. **Прочитано пользователем** → `status: "read"` (webhook от Meta)

Для real-time обновлений во фронтенде используйте:
- **Polling** - периодический запрос `/operator/message-status/:id`
- **WebSockets** - подключение к серверу для получения событий
- **Server-Sent Events (SSE)** - односторонний поток событий

---

## Важные замечания

### Лимиты WhatsApp
- **24-часовое окно**: После последнего сообщения от клиента можно отвечать 24 часа
- **После 24 часов**: Можно отправлять только pre-approved шаблоны
- **Первое сообщение**: Клиент должен начать диалог первым

### Рекомендации
- ✅ Проверяйте статус доставки для важных сообщений
- ✅ Показывайте индикаторы доставки/прочтения оператору
- ✅ Логируйте все отправленные сообщения
- ✅ Обрабатывайте ошибки отправки (ретраи, уведомления)

### Безопасность
- 🔒 JWT токен должен быть защищён
- 🔒 Проверяйте права доступа оператора к чату
- 🔒 Валидируйте медиа URL перед отправкой

---

## Дата создания
**2025-12-09** - API для операторов WABA
