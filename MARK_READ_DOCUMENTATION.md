# Документация: Работа с прочитанными сообщениями

## 📋 Обзор

В API есть полная функциональность для управления статусом прочитанных сообщений. Доступны два набора endpoint'ов:
- `/api/unread/*` - основной функционал
- `/api/message-read/*` - альтернативный набор

---

## 🔑 Авторизация

Все endpoint'ы требуют JWT-токен в заголовке:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

Получить токен:
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}
```

---

## 📬 Пометить сообщения как прочитанные

### 1. Пометить конкретные сообщения

**Endpoint:** `POST /api/unread/:chatId/mark-read`

**Параметры:**
- `:chatId` (path) - ID чата
- `messageIds` (body, optional) - массив ID конкретных сообщений

**Поведение:**
- Если `messageIds` указан - помечает только эти сообщения
- Если `messageIds` НЕ указан - помечает ВСЕ непрочитанные входящие сообщения

**Пример запроса:**
```bash
POST /api/unread/5/mark-read
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "messageIds": [123, 124, 125]
}
```

**Или без конкретных ID (пометить все):**
```bash
POST /api/unread/5/mark-read
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{}
```

**Ответ (200 OK):**
```json
{
  "success": true,
  "markedCount": 3,
  "unreadCount": 5,
  "message": "Отмечено как прочитанные 3 сообщений"
}
```

**Где:**
- `markedCount` - сколько сообщений было помечено
- `unreadCount` - сколько непрочитанных осталось в чате после операции

---

### 2. Пометить весь чат как прочитанный

**Endpoint:** `POST /api/unread/:chatId/mark-chat-read`

**Описание:** Помечает ВСЕ входящие непрочитанные сообщения чата как прочитанные и обнуляет счётчик `unreadCount`.

**Пример запроса:**
```bash
POST /api/unread/5/mark-chat-read
Authorization: Bearer eyJhbGc...
```

**Ответ (200 OK):**
```json
{
  "success": true,
  "markedCount": 15,
  "message": "Весь чат отмечен как прочитанный"
}
```

---

### 3. Альтернативные endpoint'ы (message-read)

Те же функции доступны через `/api/message-read`:

```bash
# Пометить конкретные сообщения
POST /api/message-read/:chatId/read
POST /api/message-read/:chatId/mark-read  # Алиас
```

---

## 📊 Получить статистику непрочитанных

### 1. Общая статистика

**Endpoint:** `GET /api/unread/counts`

**Описание:** Возвращает агрегированную статистику по всей организации.

**Пример запроса:**
```bash
GET /api/unread/counts
Authorization: Bearer eyJhbGc...
```

**Ответ (200 OK):**
```json
{
  "total": {
    "unreadMessages": 150,
    "chatsWithUnread": 12
  },
  "assigned": {
    "unreadMessages": 45,
    "chatsWithUnread": 5
  }
}
```

**Где:**
- `total` - статистика по ВСЕМ чатам организации
- `assigned` - статистика по чатам, назначенным текущему пользователю

---

### 2. Список чатов с непрочитанными

**Endpoint:** `GET /api/unread/chats`

**Query параметры:**
- `assignedOnly` (optional, boolean) - только назначенные текущему пользователю
  - `true` - только мои назначенные чаты
  - `false` или не указано - все чаты организации

**Пример запроса:**
```bash
# Все чаты с непрочитанными
GET /api/unread/chats?assignedOnly=false
Authorization: Bearer eyJhbGc...

# Только мои назначенные
GET /api/unread/chats?assignedOnly=true
Authorization: Bearer eyJhbGc...
```

**Ответ (200 OK):**
```json
{
  "chats": [
    {
      "id": 5,
      "remoteJid": "79123456789@s.whatsapp.net",
      "displayName": "Клиент 1",
      "unreadCount": 8,
      "lastMessageAt": "2025-11-16T10:30:00.000Z",
      "status": "open",
      "priority": "normal",
      "assignedUser": {
        "id": 2,
        "name": "Оператор Иван",
        "email": "ivan@example.com"
      }
    },
    {
      "id": 7,
      "remoteJid": "79987654321@s.whatsapp.net",
      "displayName": "Клиент 2",
      "unreadCount": 3,
      "lastMessageAt": "2025-11-16T09:15:00.000Z",
      "status": "pending",
      "priority": "high",
      "assignedUser": null
    }
  ],
  "total": 12
}
```

---

### 3. Альтернативный endpoint для статистики

```bash
GET /api/message-read/unread-count
GET /api/message-read/stats
```

---

## 🔄 Интеграция с фронтендом

### Пример: Автоматическая отметка при открытии чата

```javascript
// React/Vue/Angular пример
async function openChat(chatId) {
  try {
    // 1. Загрузить сообщения
    const messagesResponse = await fetch(
      `${API_BASE}/api/chats/${chatId}/messages`,
      {
        headers: {
          'Authorization': `Bearer ${getToken()}`
        }
      }
    );
    const { messages } = await messagesResponse.json();
    
    // 2. Автоматически пометить весь чат как прочитанный
    const markReadResponse = await fetch(
      `${API_BASE}/api/unread/${chatId}/mark-chat-read`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`
        }
      }
    );
    const { markedCount } = await markReadResponse.json();
    
    console.log(`✅ Помечено как прочитанные: ${markedCount} сообщений`);
    
    // 3. Отобразить сообщения
    displayMessages(messages);
    
    // 4. Обновить счётчик непрочитанных в UI
    updateUnreadBadge(chatId, 0);
    
  } catch (error) {
    console.error('Ошибка открытия чата:', error);
  }
}
```

---

### Пример: Пометить только новые сообщения

```javascript
// Пометить только сообщения, которые были непрочитанными
async function markNewMessagesAsRead(chatId, unreadMessageIds) {
  try {
    const response = await fetch(
      `${API_BASE}/api/unread/${chatId}/mark-read`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messageIds: unreadMessageIds
        })
      }
    );
    
    const result = await response.json();
    console.log(`Помечено: ${result.markedCount}, осталось: ${result.unreadCount}`);
    
    return result;
  } catch (error) {
    console.error('Ошибка отметки сообщений:', error);
  }
}
```

---

### Пример: Realtime обновление счётчика

```javascript
// Опрос статистики каждые 5 секунд
setInterval(async () => {
  const response = await fetch(`${API_BASE}/api/unread/counts`, {
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });
  const stats = await response.json();
  
  // Обновить badge с общим количеством
  updateGlobalUnreadBadge(stats.total.unreadMessages);
  
  // Обновить badge для "Мои чаты"
  updateMyChatsUnreadBadge(stats.assigned.unreadMessages);
}, 5000);
```

---

## 🧪 Тестирование

### Bash скрипт для тестирования

Создан файл `test-mark-read.sh` для быстрого тестирования всех функций.

**Использование:**
```bash
# 1. Получить JWT токен
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}' \
  | jq -r '.token')

# 2. Запустить тесты
./test-mark-read.sh
```

---

### cURL примеры

```bash
# Получить токен
TOKEN="YOUR_JWT_TOKEN"

# 1. Список чатов с непрочитанными
curl -X GET "http://localhost:4000/api/unread/chats" \
  -H "Authorization: Bearer $TOKEN"

# 2. Статистика
curl -X GET "http://localhost:4000/api/unread/counts" \
  -H "Authorization: Bearer $TOKEN"

# 3. Пометить весь чат как прочитанный
curl -X POST "http://localhost:4000/api/unread/5/mark-chat-read" \
  -H "Authorization: Bearer $TOKEN"

# 4. Пометить конкретные сообщения
curl -X POST "http://localhost:4000/api/unread/5/mark-read" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messageIds": [123, 124, 125]}'
```

---

## ⚠️ Важные замечания

### 1. Только входящие сообщения
Система помечает как прочитанные **ТОЛЬКО входящие** сообщения (`fromMe: false`). Исходящие сообщения (`fromMe: true`) по умолчанию считаются прочитанными оператором.

### 2. Автоматический пересчёт
При каждой операции отметки система автоматически:
- Обновляет поле `isReadByOperator` в таблице `Message`
- Устанавливает `readAt` = текущее время
- Пересчитывает `unreadCount` в таблице `Chat`

### 3. Безопасность
Все операции ограничены контекстом организации пользователя:
- Нельзя пометить сообщения из чатов другой организации
- JWT токен содержит `organizationId` и `userId`
- Все запросы валидируются middleware

---

## 🔍 Связанные эндпоинты

Для полной работы с чатами используйте также:

```bash
# Получить список чатов
GET /api/chats?status=open

# Получить сообщения чата
GET /api/chats/:chatId/messages

# Назначить чат оператору
POST /api/chat-assignment/assign

# Закрыть чат (автоматически обнуляет unreadCount)
POST /api/chat-assignment/close
```

---

## 📚 Схема базы данных

### Таблица Message
```prisma
model Message {
  id               Int      @id @default(autoincrement())
  chatId           Int
  text             String?
  fromMe           Boolean  @default(false)
  isReadByOperator Boolean  @default(false)  // ✅ Прочитано оператором
  readAt           DateTime?                // ✅ Когда прочитано
  timestamp        DateTime @default(now())
  
  chat             Chat     @relation(...)
}
```

### Таблица Chat
```prisma
model Chat {
  id            Int      @id @default(autoincrement())
  remoteJid     String
  displayName   String?
  unreadCount   Int      @default(0)  // ✅ Количество непрочитанных
  status        String   @default("pending")  // open, pending, closed
  assignedUserId Int?
  
  messages      Message[]
  assignedUser  User?    @relation(...)
}
```

---

## 🎯 Быстрый старт

1. **Авторизоваться:**
   ```bash
   POST /api/auth/login
   ```

2. **Получить чаты с непрочитанными:**
   ```bash
   GET /api/unread/chats
   ```

3. **Открыть чат и пометить как прочитанный:**
   ```bash
   POST /api/unread/:chatId/mark-chat-read
   ```

4. **Проверить статистику:**
   ```bash
   GET /api/unread/counts
   ```

---

## 📞 Поддержка

Если нужна помощь или возникли вопросы:
- Проверьте логи сервера (pino logger)
- Убедитесь что JWT токен валиден
- Проверьте что chatId существует и принадлежит вашей организации

Все ошибки логируются в консоль с префиксом `[markMessagesAsRead]` или `[markChatAsRead]`.
