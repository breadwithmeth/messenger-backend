# Обновление API /api/chats - Поддержка мультиканальности

**Дата:** 24 ноября 2025  
**Версия:** 1.1.0

## Что изменилось

Эндпоинт `GET /api/chats` теперь возвращает информацию о канале (источнике) каждого чата и поддерживает фильтрацию по каналу.

## Новые возможности

### 1. Поле `channel` в ответе

Каждый чат теперь содержит поле `channel`:
- `"whatsapp"` - чат из WhatsApp
- `"telegram"` - чат из Telegram

### 2. Канал-специфичные данные

**Для Telegram чатов:**
```json
{
  "id": 123,
  "channel": "telegram",
  "telegramBot": {
    "id": 1,
    "botUsername": "support_bot",
    "botName": "Support Bot"
  },
  "telegramChatId": "123456789",
  "telegramUsername": "johndoe",
  "telegramFirstName": "John",
  "telegramLastName": "Doe"
}
```

**Для WhatsApp чатов:**
```json
{
  "id": 456,
  "channel": "whatsapp",
  "organizationPhone": {
    "id": 1,
    "phoneJid": "79001112233@s.whatsapp.net",
    "displayName": "Поддержка"
  },
  "remoteJid": "79009998877@s.whatsapp.net",
  "receivingPhoneJid": "79001112233@s.whatsapp.net",
  "isGroup": false
}
```

### 3. Фильтрация по каналу

Новый query параметр `channel`:

```http
# Все чаты
GET /api/chats?organizationId=1

# Только Telegram
GET /api/chats?organizationId=1&channel=telegram

# Только WhatsApp
GET /api/chats?organizationId=1&channel=whatsapp
```

## Обратная совместимость

✅ **100% совместимо** с существующим кодом:
- Если параметр `channel` не указан, возвращаются все чаты
- Все существующие поля сохранены
- Добавлены только новые поля

## Примеры использования

### Фильтрация на фронтенде

```typescript
// Загрузка только Telegram чатов
async function loadTelegramChats() {
  const response = await fetch(
    '/api/chats?organizationId=1&channel=telegram'
  );
  const data = await response.json();
  return data.chats;
}

// Разделение чатов по каналам
async function loadAllChats() {
  const response = await fetch('/api/chats?organizationId=1');
  const data = await response.json();
  
  const whatsappChats = data.chats.filter(c => c.channel === 'whatsapp');
  const telegramChats = data.chats.filter(c => c.channel === 'telegram');
  
  return { whatsappChats, telegramChats };
}
```

### Отображение иконки канала

```typescript
function ChatItem({ chat }) {
  const channelIcon = chat.channel === 'telegram' ? '✈️' : '💬';
  const channelName = chat.channel === 'telegram' ? 'Telegram' : 'WhatsApp';
  
  return (
    <div className="chat-item">
      <span className="channel-icon" title={channelName}>
        {channelIcon}
      </span>
      <span className="chat-name">{chat.name}</span>
    </div>
  );
}
```

## Миграция

Если вы используете TypeScript, обновите интерфейсы:

```typescript
// До
interface Chat {
  id: number;
  name: string;
  // ...
}

// После
interface Chat {
  id: number;
  name: string;
  channel: 'whatsapp' | 'telegram';
  
  // WhatsApp поля (опциональные)
  organizationPhone?: {
    id: number;
    phoneJid: string;
    displayName: string;
  };
  remoteJid?: string;
  receivingPhoneJid?: string;
  isGroup?: boolean;
  
  // Telegram поля (опциональные)
  telegramBot?: {
    id: number;
    botUsername: string;
    botName: string;
  };
  telegramChatId?: string;
  telegramUsername?: string;
  telegramFirstName?: string;
  telegramLastName?: string;
  
  // ... остальные поля
}
```

## Технические детали

### Файлы изменены
- `src/controllers/chatController.ts`:
  - Добавлен параметр фильтрации `channel`
  - Добавлены поля `channel`, `telegramBot`, `telegramChatId`, `telegramUsername`, `telegramFirstName`, `telegramLastName` в select

### SQL запрос (примерно)
```sql
SELECT 
  id, name, channel,
  -- WhatsApp поля
  remoteJid, receivingPhoneJid, isGroup,
  -- Telegram поля
  telegramBotId, telegramChatId, telegramUsername, 
  telegramFirstName, telegramLastName,
  -- Общие поля
  status, priority, unreadCount, lastMessageAt, ticketNumber
FROM "Chat"
WHERE organizationId = $1
  AND (channel = $2 OR $2 IS NULL)  -- Фильтр по каналу (опционально)
ORDER BY priority DESC, unreadCount DESC, lastMessageAt DESC
LIMIT $3 OFFSET $4;
```

## Документация

- **Полная документация:** [MULTICHANNEL_CHATS_API.md](./MULTICHANNEL_CHATS_API.md)
- **Telegram интеграция:** [TELEGRAM_INTEGRATION.md](./TELEGRAM_INTEGRATION.md)
- **Быстрый старт:** [TELEGRAM_QUICK_START.md](./TELEGRAM_QUICK_START.md)

## Что дальше?

После этого обновления вы можете:
1. Создавать Telegram ботов через API
2. Получать чаты из обоих каналов в одном запросе
3. Фильтровать чаты по источнику
4. Использовать унифицированную тикет-систему для WhatsApp и Telegram

---

**Готово к использованию!** ✅
