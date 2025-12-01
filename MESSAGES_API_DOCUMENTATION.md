# API получения сообщений

## Описание

API для получения сообщений из конкретного чата с поддержкой пагинации и курсорной навигации.

## Эндпоинт

```
GET /api/chats/:chatId/messages
```

## Заголовки запроса

```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

## Параметры URL

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `chatId` | number | Да | ID чата, из которого нужно получить сообщения |

## Query параметры

| Параметр | Тип | Значение по умолчанию | Описание |
|----------|-----|----------------------|----------|
| `limit` | number | 100 | Количество сообщений для загрузки (максимум 200) |
| `offset` | number | 0 | Смещение для пагинации |
| `before` | string (ISO 8601) | - | Временная метка для курсорной пагинации (загрузка более старых сообщений) |

## Поведение загрузки

### Первоначальная загрузка
При первом открытии чата **БЕЗ** параметра `before`:
- Загружаются **последние 100 сообщений** (самые новые)
- Сообщения возвращаются в **хронологическом порядке** (от старых к новым)
- Это обеспечивает правильное отображение в UI чата

### Подгрузка старых сообщений
При скролле вверх используйте параметр `before`:
- Укажите `before` = timestamp самого старого сообщения на экране
- Будут загружены более старые сообщения (до указанного времени)

## Примеры запросов

### 1. Получить последние 100 сообщений

```bash
GET /api/chats/22/messages
```

```bash
curl -X GET "http://localhost:3000/api/chats/22/messages" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 2. Получить последние 50 сообщений

```bash
GET /api/chats/22/messages?limit=50
```

```bash
curl -X GET "http://localhost:3000/api/chats/22/messages?limit=50" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 3. Пагинация со смещением

```bash
GET /api/chats/22/messages?limit=50&offset=50
```

⚠️ **Внимание**: При использовании `offset` без `before` вы получаете следующие 50 сообщений из последних, а не более старые.

### 4. Курсорная пагинация (рекомендуется)

Загрузить сообщения до определенного момента времени:

```bash
GET /api/chats/22/messages?before=2025-01-31T10:30:00.000Z&limit=50
```

```bash
curl -X GET "http://localhost:3000/api/chats/22/messages?before=2025-01-31T10:30:00.000Z&limit=50" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Формат ответа

### Успешный ответ (200 OK)

```json
{
  "messages": [
    {
      "id": 315,
      "whatsappMessageId": "3A1234567890ABCDEF",
      "content": "Привет, как дела?",
      "senderJid": "77013446556@s.whatsapp.net",
      "receivingPhoneJid": "77054810862:95@s.whatsapp.net",
      "fromMe": false,
      "type": "text",
      "mediaUrl": null,
      "filename": null,
      "mimeType": null,
      "size": null,
      "timestamp": "2025-01-31T10:25:03.028Z",
      "status": "delivered",
      "isReadByOperator": false,
      "quotedMessageId": null,
      "senderUser": null
    },
    {
      "id": 320,
      "whatsappMessageId": "3A9876543210FEDCBA",
      "content": null,
      "senderJid": "77013446556@s.whatsapp.net",
      "receivingPhoneJid": "77054810862:95@s.whatsapp.net",
      "fromMe": false,
      "type": "audio",
      "mediaUrl": "https://r2.drawbridge.kz/media/1764568761132-6527989.ogg",
      "filename": "1764568761132-6527989.ogg",
      "mimeType": "audio/ogg; codecs=opus",
      "size": 20817,
      "timestamp": "2025-01-31T10:26:01.132Z",
      "status": "delivered",
      "isReadByOperator": false,
      "quotedMessageId": null,
      "senderUser": null
    }
  ],
  "pagination": {
    "total": 350,
    "limit": 100,
    "offset": 0,
    "hasMore": true,
    "oldestTimestamp": "2025-01-31T10:25:03.028Z",
    "newestTimestamp": "2025-01-31T10:26:01.132Z"
  }
}
```

### Поля сообщения

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | number | Уникальный ID сообщения в БД |
| `whatsappMessageId` | string | ID сообщения в WhatsApp |
| `content` | string \| null | Текстовое содержимое сообщения |
| `senderJid` | string | JID отправителя (номер телефона в формате WhatsApp) |
| `receivingPhoneJid` | string | JID получателя (ваш номер WhatsApp Business) |
| `fromMe` | boolean | `true` - исходящее, `false` - входящее |
| `type` | string | Тип сообщения: `text`, `image`, `audio`, `video`, `document`, `sticker`, `reaction`, `protocol` |
| `mediaUrl` | string \| null | URL медиафайла в R2 хранилище (для медиа-сообщений) |
| `filename` | string \| null | Имя файла |
| `mimeType` | string \| null | MIME-тип файла |
| `size` | number \| null | Размер файла в байтах |
| `timestamp` | string (ISO 8601) | Время отправки/получения сообщения |
| `status` | string | Статус доставки: `pending`, `sent`, `delivered`, `read`, `failed` |
| `isReadByOperator` | boolean | Прочитано ли сообщение оператором |
| `quotedMessageId` | string \| null | ID цитируемого сообщения (для ответов) |
| `senderUser` | object \| null | Информация об операторе (если сообщение отправлено оператором) |

### Поля пагинации

| Поле | Тип | Описание |
|------|-----|----------|
| `total` | number | Общее количество сообщений в чате |
| `limit` | number | Количество сообщений в текущем ответе |
| `offset` | number | Смещение от начала |
| `hasMore` | boolean | `true` если есть еще сообщения для загрузки |
| `oldestTimestamp` | string \| null | Временная метка самого старого сообщения в ответе |
| `newestTimestamp` | string \| null | Временная метка самого нового сообщения в ответе |

## Обработка ошибок

### 400 Bad Request - Некорректный chatId

```json
{
  "error": "Некорректный chatId. Ожидалось число."
}
```

### 401 Unauthorized - Отсутствует авторизация

```json
{
  "error": "Несанкционированный доступ: organizationId не определен."
}
```

### 404 Not Found - Чат не найден

```json
{
  "error": "Чат не найден или не принадлежит вашей организации."
}
```

### 500 Internal Server Error

```json
{
  "error": "Не удалось получить сообщения чата.",
  "details": "Подробное описание ошибки"
}
```

## Рекомендации по использованию

### 1. Первоначальная загрузка чата

```javascript
// При открытии чата
const response = await fetch('/api/chats/22/messages?limit=100', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();
// Сообщения уже в правильном порядке (от старых к новым)
displayMessages(data.messages);
```

### 2. Бесконечный скролл вверх (загрузка истории)

```javascript
// При скролле вверх используйте oldestTimestamp
const oldestMessage = messages[0];
const response = await fetch(
  `/api/chats/22/messages?before=${oldestMessage.timestamp}&limit=50`,
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

const data = await response.json();
// Вставьте новые сообщения в начало списка
messages.unshift(...data.messages);
```

### 3. Проверка наличия новых сообщений

```javascript
// Используйте newestTimestamp для проверки новых сообщений
const newestMessage = messages[messages.length - 1];
const response = await fetch(
  `/api/chats/22/messages?after=${newestMessage.timestamp}&limit=10`,
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);
```

### 4. Обработка медиафайлов

```javascript
messages.forEach(message => {
  if (message.mediaUrl) {
    // URL уже полный, можно использовать напрямую
    console.log(`Медиафайл: ${message.mediaUrl}`);
    // Пример: https://r2.drawbridge.kz/media/1764568761132-6527989.ogg
    
    // Отображение в зависимости от типа
    switch (message.type) {
      case 'image':
        displayImage(message.mediaUrl);
        break;
      case 'audio':
        displayAudio(message.mediaUrl, message.mimeType);
        break;
      case 'video':
        displayVideo(message.mediaUrl);
        break;
      case 'document':
        displayDocument(message.mediaUrl, message.filename);
        break;
    }
  }
});
```

## Производительность

- **Оптимизация запросов**: Используется `select` для получения только необходимых полей
- **Индексация**: Таблица `Message` проиндексирована по `chatId` и `timestamp`
- **Ограничения**: Максимум 200 сообщений за один запрос
- **Кеширование**: Рекомендуется кешировать загруженные сообщения на клиенте

## Особенности

1. **Порядок сообщений**: Всегда в хронологическом порядке (от старых к новым)
2. **Последние сообщения первыми**: По умолчанию загружаются последние 100 сообщений
3. **R2 Storage**: Все медиафайлы хранятся в Cloudflare R2 с полными URL
4. **Безопасность**: Доступ только к чатам своей организации
5. **Мультиканальность**: Поддержка WhatsApp и Telegram (один API)

## Интеграция с WebSocket

Для получения новых сообщений в реальном времени используйте WebSocket:

```javascript
const socket = io('http://localhost:3000', {
  auth: {
    token: authToken
  }
});

socket.on('new-message', (message) => {
  if (message.chatId === currentChatId) {
    // Добавить новое сообщение в конец списка
    messages.push(message);
    displayMessage(message);
  }
});
```

## Связанные эндпоинты

- `GET /api/chats` - Получение списка чатов
- `POST /api/chats/:chatId/messages` - Отправка сообщения
- `PATCH /api/chats/:chatId/messages/:messageId/read` - Отметить сообщение как прочитанное
- `GET /api/chats/:chatId` - Получение информации о чате
