# API Документация - Система назначения чатов, непрочитанные сообщения и медиафайлы

## Назначение чатов операторам

### 1. Назначить чат оператору
```http
POST /api/chat-assignment/:chatId/assign
Authorization: Bearer <token>
Content-Type: application/json

{
  "operatorId": 2
}
```

**Ответ:**
```json
{
  "success": true,
  "chat": {
    "id": 1,
    "assignedUserId": 2,
    "assignedAt": "2025-07-19T10:30:00Z",
    "status": "open",
    "assignedUser": {
      "id": 2,
      "name": "Иван Петров",
      "email": "ivan@example.com"
    }
  },
  "message": "Чат назначен оператору Иван Петров"
}
```

### 2. Снять назначение с чата
```http
DELETE /api/chat-assignment/:chatId/unassign
Authorization: Bearer <token>
```

### 3. Получить назначенные чаты
```http
GET /api/chat-assignment/assigned
GET /api/chat-assignment/assigned/:operatorId
Authorization: Bearer <token>
```

### 4. Получить неназначенные чаты
```http
GET /api/chat-assignment/unassigned
Authorization: Bearer <token>
```

### 5. Закрыть чат
```http
POST /api/chat-assignment/:chatId/close
Authorization: Bearer <token>
```

### 6. Обновить приоритет чата
```http
PATCH /api/chat-assignment/:chatId/priority
Authorization: Bearer <token>
Content-Type: application/json

{
  "priority": "high"  // low, normal, high, urgent
}
```

## Управление непрочитанными сообщениями

### 1. Отметить сообщения как прочитанные
```http
POST /api/unread/:chatId/mark-read
Authorization: Bearer <token>
Content-Type: application/json

{
  "messageIds": [1, 2, 3]  // Опционально, если не указано - отмечаются все
}
```

### 2. Отметить весь чат как прочитанный
```http
POST /api/unread/:chatId/mark-chat-read
Authorization: Bearer <token>
```

### 3. Получить статистику непрочитанных
```http
GET /api/unread/counts
Authorization: Bearer <token>
```

**Ответ:**
```json
{
  "total": {
    "unreadMessages": 25,
    "chatsWithUnread": 8
  },
  "assigned": {
    "unreadMessages": 10,
    "chatsWithUnread": 3
  }
}
```

### 4. Получить чаты с непрочитанными сообщениями
```http
GET /api/unread/chats?assignedOnly=true
Authorization: Bearer <token>
```

## Загрузка и отправка медиафайлов

### 1. Загрузить и отправить медиафайл
```http
POST /api/media/send
Authorization: Bearer <token>
Content-Type: multipart/form-data

FormData:
- media: <file>
- organizationPhoneId: 1
- receiverJid: "79001234567@s.whatsapp.net"
- mediaType: "image"  // image, video, document, audio
- caption: "Описание файла" (опционально)
```

**Ответ:**
```json
{
  "success": true,
  "messageId": "whatsapp-message-id-123",
  "mediaType": "image",
  "fileName": "photo.jpg",
  "fileUrl": "/media/image/1640995200000_abc123.jpg",
  "caption": "Описание файла",
  "size": 1024567
}
```

### 2. Просто загрузить медиафайл (без отправки)
```http
POST /api/media/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

FormData:
- media: <file>
- mediaType: "document"
```

**Ответ:**
```json
{
  "success": true,
  "fileName": "1640995200000_abc123.pdf",
  "fileUrl": "/media/document/1640995200000_abc123.pdf",
  "filePath": "/path/to/file.pdf",
  "mediaType": "document",
  "size": 2048567,
  "mimeType": "application/pdf"
}
```

## Обновленный API чатов

### Получить список чатов с фильтрацией
```http
GET /api/chats?status=open&assigned=true&priority=high
Authorization: Bearer <token>
```

**Параметры запроса:**
- `status`: open, closed, pending
- `assigned`: true, false (назначенные/неназначенные)
- `priority`: low, normal, high, urgent

**Ответ:**
```json
{
  "chats": [
    {
      "id": 1,
      "name": "Чат с клиентом",
      "status": "open",
      "priority": "high",
      "unreadCount": 3,
      "assignedUserId": 2,
      "assignedUser": {
        "id": 2,
        "name": "Иван Петров",
        "email": "ivan@example.com"
      },
      "assignedAt": "2025-07-19T10:30:00Z",
      "lastMessage": {
        "id": 123,
        "content": "Последнее сообщение",
        "timestamp": "2025-07-19T12:00:00Z",
        "fromMe": false,
        "isReadByOperator": false
      },
      "organizationPhone": {
        "id": 1,
        "phoneJid": "79001111111@s.whatsapp.net",
        "displayName": "Основной номер"
      }
    }
  ],
  "total": 1
}
```

## Обновленный API сообщений

### Получить сообщения чата с информацией об отправителе
```http
GET /api/chats/:chatId/messages
Authorization: Bearer <token>
```

**Ответ:**
```json
{
  "messages": [
    {
      "id": 1,
      "content": "Привет!",
      "timestamp": "2025-07-19T12:00:00Z",
      "fromMe": false,
      "type": "text",
      "isReadByOperator": true,
      "readAt": "2025-07-19T12:05:00Z",
      "senderUser": {
        "id": 2,
        "name": "Иван Петров",
        "email": "ivan@example.com"
      },
      "mediaUrl": null,
      "filename": null
    }
  ]
}
```

## Коды ошибок

- `400` - Неверные параметры запроса
- `401` - Неавторизованный доступ
- `403` - Недостаточно прав
- `404` - Ресурс не найден
- `413` - Файл слишком большой
- `415` - Неподдерживаемый тип медиафайла
- `500` - Внутренняя ошибка сервера
- `503` - WhatsApp сокет не готов

## Ограничения по размеру файлов

- **Изображения**: до 10 МБ
- **Видео**: до 50 МБ  
- **Документы**: до 20 МБ
- **Аудио**: до 15 МБ

## Поддерживаемые форматы

### Изображения
- JPEG, PNG, GIF, WebP

### Видео
- MP4, AVI, MOV, WMV, WebM

### Документы
- PDF, DOC, DOCX, XLS, XLSX, TXT, CSV

### Аудио
- MP3, WAV, OGG, M4A
