# Быстрый старт: Telegram боты

## Шаг 1: Создание бота в Telegram

1. Откройте Telegram
2. Найдите [@BotFather](https://t.me/BotFather)
3. Отправьте `/newbot`
4. Придумайте название и username (должен заканчиваться на `bot`)
5. Сохраните токен вида `1234567890:ABCDEF-GhIjKlMnOpQrStUvWxYz`

## Шаг 2: Добавление бота в систему

```bash
curl -X POST http://localhost:3000/api/telegram/organizations/1/bots \
  -H "Content-Type: application/json" \
  -d '{
    "botToken": "YOUR_BOT_TOKEN_HERE",
    "welcomeMessage": "Здравствуйте! Напишите ваш вопрос, и оператор ответит вам в ближайшее время.",
    "autoStart": true
  }'
```

**Ответ:**
```json
{
  "bot": {
    "id": 1,
    "botUsername": "your_support_bot",
    "status": "active",
    "isRunning": true
  }
}
```

## Шаг 3: Проверка работы

1. Найдите вашего бота в Telegram: `@your_support_bot`
2. Отправьте команду `/start`
3. Бот должен ответить приветственным сообщением
4. Отправьте любое текстовое сообщение

## Шаг 4: Просмотр чатов

```bash
# Список всех чатов бота
curl http://localhost:3000/api/telegram/bots/1/chats

# Только открытые тикеты
curl http://localhost:3000/api/telegram/bots/1/chats?status=open
```

## Шаг 5: Ответ клиенту

```bash
curl -X POST http://localhost:3000/api/telegram/bots/1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "TELEGRAM_CHAT_ID",
    "content": "Спасибо за обращение! Мы работаем над вашим вопросом."
  }'
```

**Где взять `chatId`?**
- Получите его из ответа `/api/telegram/bots/1/chats`
- Поле `telegramChatId` в объекте чата

## Управление ботом

### Остановить бота
```bash
curl -X POST http://localhost:3000/api/telegram/bots/1/stop
```

### Запустить бота
```bash
curl -X POST http://localhost:3000/api/telegram/bots/1/start
```

### Обновить настройки
```bash
curl -X PUT http://localhost:3000/api/telegram/bots/1 \
  -H "Content-Type: application/json" \
  -d '{
    "welcomeMessage": "Новое приветственное сообщение"
  }'
```

### Удалить бота
```bash
curl -X DELETE http://localhost:3000/api/telegram/bots/1
```

## Интеграция с существующим API

### Получение всех сообщений чата (WhatsApp + Telegram)

```bash
# Все сообщения чата #123
curl http://localhost:3000/api/messages/chat/123?limit=50&offset=0

# Только из Telegram
curl http://localhost:3000/api/messages/chat/123?channel=telegram
```

### Получение всех чатов организации (мультиканальный)

```bash
# Все чаты (WhatsApp + Telegram)
curl http://localhost:3000/api/chats?organizationId=1

# Только Telegram
curl http://localhost:3000/api/chats?organizationId=1&channel=telegram

# Только WhatsApp
curl http://localhost:3000/api/chats?organizationId=1&channel=whatsapp
```

### Назначение тикета оператору

```bash
curl -X POST http://localhost:3000/api/chat-assignment/assign \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "userId": 5
  }'
```

### Изменение статуса тикета

```bash
curl -X PATCH http://localhost:3000/api/chats/123 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress"
  }'
```

### Закрытие тикета

```bash
curl -X PATCH http://localhost:3000/api/chats/123 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "resolved",
    "closeReason": "Вопрос решён"
  }'
```

## Примеры для фронтенда

### React: Отправка сообщения

```typescript
async function sendTelegramMessage(botId: number, chatId: string, message: string) {
  const response = await fetch(`http://localhost:3000/api/telegram/bots/${botId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatId,
      content: message,
    }),
  });
  
  const data = await response.json();
  return data;
}

// Использование
await sendTelegramMessage(1, '123456789', 'Привет из React!');
```

### React: Список чатов с real-time обновлением

```typescript
import { useEffect, useState } from 'react';

function TelegramChats({ botId }) {
  const [chats, setChats] = useState([]);
  
  useEffect(() => {
    // Загрузка чатов
    async function loadChats() {
      const response = await fetch(
        `http://localhost:3000/api/telegram/bots/${botId}/chats?status=open`
      );
      const data = await response.json();
      setChats(data.chats);
    }
    
    loadChats();
    
    // Обновление каждые 5 секунд
    const interval = setInterval(loadChats, 5000);
    return () => clearInterval(interval);
  }, [botId]);
  
  return (
    <div>
      {chats.map(chat => (
        <div key={chat.id}>
          <h3>{chat.name || chat.telegramUsername}</h3>
          <p>Тикет #{chat.ticketNumber}</p>
          <p>Непрочитанных: {chat.unreadCount}</p>
        </div>
      ))}
    </div>
  );
}
```

## Типичные ошибки

### Ошибка: "Unauthorized"
- Проверьте токен бота
- Убедитесь, что бот не был удалён в @BotFather

### Бот не отвечает
- Проверьте статус: `GET /api/telegram/bots/1`
- Если `status: "error"`, перезапустите: `POST /api/telegram/bots/1/start`

### Сообщения не сохраняются
- Проверьте логи сервера
- Убедитесь, что база данных доступна
- Проверьте миграции: `npx prisma migrate status`

## Дополнительно

Полная документация: [TELEGRAM_INTEGRATION.md](./TELEGRAM_INTEGRATION.md)
