# Интеграция с Telegram

## Обзор

Система поддерживает работу с несколькими каналами коммуникации:
- **WhatsApp** (через Baileys)
- **Telegram** (через node-telegram-bot-api)

Все сообщения из обоих каналов хранятся в единой базе данных и доступны через унифицированный API.

## Архитектура

### База данных

#### Модель TelegramBot
```prisma
model TelegramBot {
  id              Int      @id @default(autoincrement())
  organizationId  Int
  botToken        String   @unique       // Токен от @BotFather
  botUsername     String?                // @bot_username
  botName         String?                // Имя бота
  botId           String?                // ID бота в Telegram
  status          String   @default("inactive") // inactive, active, error
  lastActiveAt    DateTime?
  welcomeMessage  String?                // Приветственное сообщение
  autoReply       Boolean  @default(false)
  webhookUrl      String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  chats           Chat[]
  messages        Message[]
}
```

#### Модель Chat (мультиканальная)
```prisma
model Chat {
  channel             String   @default("whatsapp") // whatsapp | telegram
  
  // WhatsApp поля
  receivingPhoneJid   String?
  remoteJid           String?
  organizationPhoneId Int?
  
  // Telegram поля
  telegramBotId       Int?
  telegramChatId      String?
  telegramUserId      String?
  telegramUsername    String?
  telegramFirstName   String?
  telegramLastName    String?
  
  // ... остальные поля
}
```

#### Модель Message (мультиканальная)
```prisma
model Message {
  channel             String   @default("whatsapp") // whatsapp | telegram
  
  // WhatsApp поля
  organizationPhoneId Int?
  whatsappMessageId   String?
  
  // Telegram поля
  telegramBotId       Int?
  telegramMessageId   Int?
  telegramChatId      String?
  telegramUserId      String?
  telegramUsername    String?
  
  // ... остальные поля
}
```

### Сервис (telegramService.ts)

Основные функции:

- `startTelegramBot(botId)` - запускает бота по ID
- `stopTelegramBot(botId)` - останавливает бота
- `getTelegramBot(botId)` - получает экземпляр активного бота
- `sendTelegramMessage(botId, chatId, content, options)` - отправка сообщений
- `startAllTelegramBots()` - запускает все активные боты (вызывается при старте сервера)
- `stopAllTelegramBots()` - останавливает все боты (graceful shutdown)

Обработчики событий:
- `/start` - создаёт чат, отправляет приветственное сообщение
- `message` - обрабатывает текстовые сообщения
- `photo`, `document`, `video`, `voice` - обрабатывает медиафайлы

## API Endpoints

### Управление ботами

#### Список ботов организации
```http
GET /api/telegram/organizations/:organizationId/bots
```

Ответ:
```json
{
  "bots": [
    {
      "id": 1,
      "organizationId": 1,
      "botToken": "1234567890:ABCDEF...",
      "botUsername": "support_bot",
      "botName": "Support Bot",
      "status": "active",
      "lastActiveAt": "2025-01-24T12:00:00Z",
      "welcomeMessage": "Привет! Чем могу помочь?",
      "createdAt": "2025-01-24T10:00:00Z"
    }
  ]
}
```

#### Получить информацию о боте
```http
GET /api/telegram/bots/:botId
```

Ответ:
```json
{
  "bot": {
    "id": 1,
    "organizationId": 1,
    "botUsername": "support_bot",
    "status": "active",
    "isRunning": true,
    "organization": {
      "id": 1,
      "name": "My Company"
    },
    ...
  }
}
```

#### Создать бота
```http
POST /api/telegram/organizations/:organizationId/bots
Content-Type: application/json

{
  "botToken": "1234567890:ABCDEF...",
  "welcomeMessage": "Привет! Чем могу помочь?",
  "autoStart": true
}
```

Как получить токен бота:
1. Откройте Telegram и найдите [@BotFather](https://t.me/BotFather)
2. Отправьте команду `/newbot`
3. Следуйте инструкциям (укажите имя и username бота)
4. Получите токен вида `1234567890:ABCDEF...`

Ответ:
```json
{
  "bot": {
    "id": 1,
    "organizationId": 1,
    "botToken": "1234567890:ABCDEF...",
    "status": "active",
    ...
  }
}
```

#### Обновить бота
```http
PUT /api/telegram/bots/:botId
Content-Type: application/json

{
  "botToken": "new_token",
  "welcomeMessage": "Новое приветствие",
  "autoReply": true,
  "webhookUrl": "https://example.com/webhook"
}
```

**Важно:** При изменении `botToken` бот будет автоматически перезапущен.

#### Удалить бота
```http
DELETE /api/telegram/bots/:botId
```

Ответ:
```json
{
  "success": true
}
```

### Управление состоянием

#### Запустить бота
```http
POST /api/telegram/bots/:botId/start
```

#### Остановить бота
```http
POST /api/telegram/bots/:botId/stop
```

### Отправка сообщений

#### Отправить сообщение через бота
```http
POST /api/telegram/bots/:botId/messages
Content-Type: application/json

{
  "chatId": "123456789",
  "content": "Привет! Это ответ от оператора.",
  "replyToMessageId": 42
}
```

Ответ:
```json
{
  "success": true,
  "messageId": 43,
  "timestamp": "2025-01-24T12:00:00Z"
}
```

### Чаты

#### Получить чаты бота
```http
GET /api/telegram/bots/:botId/chats?limit=50&offset=0&status=open
```

Параметры:
- `limit` - количество чатов (default: 50)
- `offset` - смещение для пагинации (default: 0)
- `status` - фильтр по статусу: `new`, `open`, `in_progress`, `resolved`, `closed`

Ответ:
```json
{
  "chats": [
    {
      "id": 123,
      "channel": "telegram",
      "telegramChatId": "987654321",
      "telegramUsername": "john_doe",
      "telegramFirstName": "John",
      "name": "John Doe",
      "ticketNumber": 42,
      "status": "open",
      "priority": "medium",
      "lastMessageAt": "2025-01-24T12:00:00Z",
      "unreadCount": 3,
      "assignedUser": {
        "id": 5,
        "name": "Оператор Иван"
      },
      "_count": {
        "messages": 15
      }
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

## Примеры использования

### 1. Создание и запуск бота

```bash
# Создать бота
curl -X POST http://localhost:3000/api/telegram/organizations/1/bots \
  -H "Content-Type: application/json" \
  -d '{
    "botToken": "1234567890:ABCDEF...",
    "welcomeMessage": "Здравствуйте! Напишите ваш вопрос.",
    "autoStart": true
  }'

# Или запустить вручную
curl -X POST http://localhost:3000/api/telegram/bots/1/start
```

### 2. Получение чатов из Telegram

```bash
# Все открытые чаты
curl http://localhost:3000/api/telegram/bots/1/chats?status=open

# С пагинацией
curl http://localhost:3000/api/telegram/bots/1/chats?limit=20&offset=40
```

### 3. Отправка сообщения клиенту

```bash
curl -X POST http://localhost:3000/api/telegram/bots/1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "123456789",
    "content": "Спасибо за обращение! Мы решили вашу проблему.",
    "replyToMessageId": 42
  }'
```

### 4. Получение всех сообщений (WhatsApp + Telegram)

Используйте существующий API `/api/messages`:

```bash
# Все сообщения чата (независимо от канала)
curl http://localhost:3000/api/messages/chat/123

# Фильтр по каналу
curl http://localhost:3000/api/messages/chat/123?channel=telegram
```

### 5. Унифицированный список чатов

```bash
# Все чаты (WhatsApp + Telegram)
curl http://localhost:3000/api/chats?organizationId=1

# Только Telegram
curl http://localhost:3000/api/chats?organizationId=1&channel=telegram

# Только WhatsApp
curl http://localhost:3000/api/chats?organizationId=1&channel=whatsapp
```

**Ответ включает информацию о канале:**
```json
{
  "chats": [
    {
      "id": 123,
      "channel": "telegram",
      "name": "John Doe",
      "telegramBot": { "id": 1, "botUsername": "support_bot" },
      "telegramChatId": "123456789",
      "telegramUsername": "johndoe",
      "ticketNumber": 42,
      "status": "open",
      ...
    }
  ]
}
```

📖 **Подробная документация:** [MULTICHANNEL_CHATS_API.md](./MULTICHANNEL_CHATS_API.md)

## Workflow для операторов

### Сценарий 1: Новое сообщение от клиента

1. Клиент пишет боту в Telegram: "Привет"
2. Бот отправляет приветственное сообщение
3. Система создаёт новый чат со статусом `new` и генерирует номер тикета
4. Сообщение сохраняется в БД с `channel: "telegram"`
5. Оператор видит новый тикет в интерфейсе

### Сценарий 2: Ответ оператора

1. Оператор назначает тикет себе
2. Оператор отправляет ответ через API:
   ```http
   POST /api/telegram/bots/1/messages
   {
     "chatId": "123456789",
     "content": "Добрый день! Сейчас помогу."
   }
   ```
3. Сообщение отправляется клиенту в Telegram
4. Сообщение сохраняется в БД с `fromMe: true`
5. Обновляется `lastMessageAt` чата

### Сценарий 3: Закрытие тикета

1. Оператор помог клиенту
2. Оператор меняет статус через API:
   ```http
   PATCH /api/chats/123
   {
     "status": "resolved",
     "closeReason": "Проблема решена"
   }
   ```
3. Тикет закрывается, фиксируется `resolvedAt`

## События и логи

Все события логируются через `pino`:

```
[Telegram] Запуск бота @support_bot (ID: 1)
[Telegram] Бот @support_bot успешно запущен
[Telegram] /start от пользователя john_doe в чате 123456789
[Telegram] Создан новый чат #42 для john_doe, тикет #15
[Telegram] Сохранено входящее сообщение от john_doe в чат #42
[Telegram] Отправлено сообщение в чат 123456789
```

## Мультиканальная архитектура

### Отличия каналов

| Поле | WhatsApp | Telegram |
|------|----------|----------|
| `channel` | `"whatsapp"` | `"telegram"` |
| Идентификатор бота | `organizationPhoneId` | `telegramBotId` |
| ID чата | `remoteJid` | `telegramChatId` |
| ID сообщения | `whatsappMessageId` | `telegramMessageId` |
| Username | `senderJid` | `telegramUsername` |

### Унифицированные поля

Независимо от канала:
- `chatId` - ID чата в БД
- `organizationId` - ID организации
- `fromMe` - направление сообщения
- `content` - текст сообщения
- `type` - тип (text, image, video, audio, document)
- `mediaUrl`, `filename`, `mimeType`, `size` - для медиафайлов
- `timestamp`, `status` - метаданные
- `ticketNumber`, `status`, `priority` - тикет-система

## Миграция существующих чатов

Если у вас уже есть WhatsApp чаты, они продолжат работать как обычно. Новые Telegram чаты будут создаваться с `channel: "telegram"`.

```sql
-- Количество чатов по каналам
SELECT channel, COUNT(*) 
FROM "Chat" 
GROUP BY channel;

-- Количество сообщений по каналам
SELECT channel, COUNT(*) 
FROM "Message" 
GROUP BY channel;
```

## Безопасность

### Токены ботов

- Храните токены в секретном месте (БД зашифрована)
- Не публикуйте токены в коде или логах
- Регулярно обновляйте токены через @BotFather
- Используйте webhook HTTPS для продакшена

### Права доступа

- Проверяйте `organizationId` пользователя перед доступом к ботам
- Операторы должны видеть только чаты своей организации
- Добавьте аутентификацию для всех эндпоинтов

## Troubleshooting

### Бот не запускается

1. Проверьте токен:
   ```bash
   curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
   ```

2. Проверьте логи:
   ```
   [Telegram] Ошибка запуска бота ID 1: ...
   ```

3. Проверьте статус в БД:
   ```sql
   SELECT * FROM "TelegramBot" WHERE id = 1;
   ```

### Сообщения не приходят

1. Проверьте, что бот запущен:
   ```bash
   curl http://localhost:3000/api/telegram/bots/1
   ```

2. Проверьте логи polling:
   ```
   [Telegram] Ошибка polling для бота ID 1: ...
   ```

3. Перезапустите бота:
   ```bash
   curl -X POST http://localhost:3000/api/telegram/bots/1/stop
   curl -X POST http://localhost:3000/api/telegram/bots/1/start
   ```

### Медиафайлы не загружаются

1. Проверьте права на папку `public/media`
2. Проверьте размер файла (Telegram ограничивает до 20MB для ботов)
3. Проверьте логи загрузки файлов

## Roadmap

Планируемые улучшения:

- [ ] Webhook вместо polling для продакшена
- [ ] Поддержка inline-кнопок в Telegram
- [ ] Автоответы на основе ключевых слов
- [ ] Интеграция с CRM
- [ ] Аналитика по каналам
- [ ] Групповые чаты в Telegram
- [ ] Пересылка сообщений между операторами
- [ ] Шаблоны быстрых ответов

## Ссылки

- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [node-telegram-bot-api GitHub](https://github.com/yagop/node-telegram-bot-api)
- [BotFather](https://t.me/BotFather)
