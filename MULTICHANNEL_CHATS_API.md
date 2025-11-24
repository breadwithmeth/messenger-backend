# API Endpoint Update: /api/chats

## Обновление от 24.11.2025

Эндпоинт `/api/chats` теперь поддерживает **мультиканальные чаты** (WhatsApp и Telegram).

## Новые возможности

### 1. Фильтр по каналу

Теперь можно фильтровать чаты по источнику (каналу):

```http
GET /api/chats?organizationId=1&channel=telegram
GET /api/chats?organizationId=1&channel=whatsapp
GET /api/chats?organizationId=1  # Все каналы
```

### 2. Информация о канале в ответе

Каждый чат теперь содержит:
- Поле `channel` (`"whatsapp"` или `"telegram"`)
- Специфичные данные для каждого канала

## Полный формат ответа

```json
{
  "chats": [
    {
      "id": 123,
      "name": "John Doe",
      "channel": "telegram",
      "ticketNumber": 42,
      "status": "open",
      "priority": "medium",
      "unreadCount": 3,
      "lastMessageAt": "2025-11-24T12:00:00Z",
      "createdAt": "2025-11-24T10:00:00Z",
      
      // Общие поля
      "assignedUser": {
        "id": 5,
        "name": "Оператор Иван",
        "email": "ivan@example.com"
      },
      
      // Telegram-специфичные поля (если channel === "telegram")
      "telegramBot": {
        "id": 1,
        "botUsername": "support_bot",
        "botName": "Support Bot"
      },
      "telegramChatId": "123456789",
      "telegramUsername": "johndoe",
      "telegramFirstName": "John",
      "telegramLastName": "Doe",
      
      // WhatsApp-специфичные поля (если channel === "whatsapp")
      "organizationPhone": {
        "id": 1,
        "phoneJid": "79001112233@s.whatsapp.net",
        "displayName": "Поддержка"
      },
      "remoteJid": "79009998877@s.whatsapp.net",
      "receivingPhoneJid": "79001112233@s.whatsapp.net",
      "isGroup": false,
      
      // Последнее сообщение
      "lastMessage": {
        "id": 456,
        "content": "Последнее сообщение",
        "fromMe": false,
        "type": "text",
        "timestamp": "2025-11-24T12:00:00Z",
        "isReadByOperator": false,
        "mediaUrl": null
      }
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

## Параметры запроса

| Параметр | Тип | Описание | Пример |
|----------|-----|----------|--------|
| `organizationId` | number | ID организации (обязательно) | `1` |
| `channel` | string | Фильтр по каналу | `telegram`, `whatsapp` |
| `status` | string | Статус тикета | `new`, `open`, `in_progress`, `resolved`, `closed` |
| `assigned` | boolean | Назначены ли чаты | `true`, `false` |
| `priority` | string | Приоритет | `low`, `normal`, `high`, `urgent` |
| `includeProfile` | boolean | Включить профиль контакта | `true`, `false` |
| `limit` | number | Количество чатов (макс 100) | `50` |
| `offset` | number | Смещение для пагинации | `0` |

## Примеры использования

### 1. Все чаты (WhatsApp + Telegram)

```bash
curl "http://localhost:3000/api/chats?organizationId=1"
```

### 2. Только Telegram чаты

```bash
curl "http://localhost:3000/api/chats?organizationId=1&channel=telegram"
```

### 3. Только WhatsApp чаты

```bash
curl "http://localhost:3000/api/chats?organizationId=1&channel=whatsapp"
```

### 4. Открытые Telegram тикеты

```bash
curl "http://localhost:3000/api/chats?organizationId=1&channel=telegram&status=open"
```

### 5. Неназначенные чаты из WhatsApp

```bash
curl "http://localhost:3000/api/chats?organizationId=1&channel=whatsapp&assigned=false"
```

### 6. С пагинацией

```bash
curl "http://localhost:3000/api/chats?organizationId=1&limit=20&offset=40"
```

## Примеры для фронтенда

### React: Компонент списка чатов с фильтром по каналу

```typescript
import { useState, useEffect } from 'react';

interface Chat {
  id: number;
  name: string;
  channel: 'whatsapp' | 'telegram';
  ticketNumber: number;
  status: string;
  priority: string;
  unreadCount: number;
  lastMessageAt: string;
  telegramUsername?: string;
  organizationPhone?: {
    displayName: string;
  };
  lastMessage?: {
    content: string;
    fromMe: boolean;
  };
}

function ChatList({ organizationId }: { organizationId: number }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'telegram'>('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadChats();
  }, [channelFilter]);

  async function loadChats() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        organizationId: organizationId.toString(),
        limit: '50',
      });
      
      if (channelFilter !== 'all') {
        params.append('channel', channelFilter);
      }

      const response = await fetch(`http://localhost:3000/api/chats?${params}`);
      const data = await response.json();
      setChats(data.chats);
    } catch (error) {
      console.error('Ошибка загрузки чатов:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Фильтр по каналу */}
      <div className="filters">
        <button onClick={() => setChannelFilter('all')}>
          Все ({chats.length})
        </button>
        <button onClick={() => setChannelFilter('whatsapp')}>
          WhatsApp
        </button>
        <button onClick={() => setChannelFilter('telegram')}>
          Telegram
        </button>
      </div>

      {/* Список чатов */}
      {loading ? (
        <div>Загрузка...</div>
      ) : (
        <div className="chat-list">
          {chats.map(chat => (
            <div key={chat.id} className="chat-item">
              {/* Иконка канала */}
              <span className="channel-icon">
                {chat.channel === 'telegram' ? '✈️' : '💬'}
              </span>

              {/* Информация о контакте */}
              <div className="chat-info">
                <h3>
                  {chat.name || chat.telegramUsername || 'Без имени'}
                </h3>
                <p>Тикет #{chat.ticketNumber}</p>
                
                {/* Последнее сообщение */}
                {chat.lastMessage && (
                  <p className="last-message">
                    {chat.lastMessage.fromMe ? '➡️' : '⬅️'} 
                    {chat.lastMessage.content}
                  </p>
                )}
              </div>

              {/* Непрочитанные */}
              {chat.unreadCount > 0 && (
                <span className="unread-badge">{chat.unreadCount}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ChatList;
```

### React: Определение источника чата

```typescript
function ChatHeader({ chat }: { chat: Chat }) {
  const getChannelInfo = () => {
    if (chat.channel === 'telegram') {
      return {
        icon: '✈️',
        name: 'Telegram',
        identifier: `@${chat.telegramUsername || chat.telegramChatId}`,
        botName: chat.telegramBot?.botName || 'Telegram Bot',
      };
    } else {
      return {
        icon: '💬',
        name: 'WhatsApp',
        identifier: chat.remoteJid,
        phoneName: chat.organizationPhone?.displayName || 'WhatsApp',
      };
    }
  };

  const info = getChannelInfo();

  return (
    <div className="chat-header">
      <span className="channel-icon">{info.icon}</span>
      <div>
        <h2>{chat.name}</h2>
        <p className="channel-info">
          {info.name} • {info.identifier}
        </p>
        {chat.channel === 'telegram' && (
          <p className="bot-name">через {info.botName}</p>
        )}
      </div>
    </div>
  );
}
```

### Vue.js: Компонент с фильтром

```vue
<template>
  <div class="chat-list">
    <!-- Фильтр каналов -->
    <div class="channel-filter">
      <button 
        @click="channelFilter = 'all'" 
        :class="{ active: channelFilter === 'all' }"
      >
        Все
      </button>
      <button 
        @click="channelFilter = 'whatsapp'" 
        :class="{ active: channelFilter === 'whatsapp' }"
      >
        WhatsApp
      </button>
      <button 
        @click="channelFilter = 'telegram'" 
        :class="{ active: channelFilter === 'telegram' }"
      >
        Telegram
      </button>
    </div>

    <!-- Список чатов -->
    <div v-for="chat in chats" :key="chat.id" class="chat-item">
      <span class="channel-badge" :class="chat.channel">
        {{ chat.channel === 'telegram' ? '✈️ Telegram' : '💬 WhatsApp' }}
      </span>
      <h3>{{ chat.name }}</h3>
      <p>Тикет #{{ chat.ticketNumber }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';

const channelFilter = ref<'all' | 'whatsapp' | 'telegram'>('all');
const chats = ref([]);

async function loadChats() {
  const params = new URLSearchParams({ organizationId: '1' });
  if (channelFilter.value !== 'all') {
    params.append('channel', channelFilter.value);
  }

  const response = await fetch(`http://localhost:3000/api/chats?${params}`);
  const data = await response.json();
  chats.value = data.chats;
}

watch(channelFilter, loadChats);
onMounted(loadChats);
</script>
```

## Обратная совместимость

✅ **Полностью совместимо** с предыдущей версией API:
- Все существующие запросы работают как раньше
- Если параметр `channel` не указан, возвращаются чаты из всех каналов
- Старые WhatsApp чаты имеют `channel: "whatsapp"`

## Миграция существующего кода

### До (старая версия):
```javascript
const response = await fetch('/api/chats?organizationId=1');
const data = await response.json();
// data.chats содержал только WhatsApp чаты
```

### После (новая версия):
```javascript
const response = await fetch('/api/chats?organizationId=1');
const data = await response.json();
// data.chats теперь содержит WhatsApp + Telegram
// Каждый чат имеет поле channel: "whatsapp" | "telegram"

// Фильтрация на клиенте (если нужно):
const whatsappChats = data.chats.filter(chat => chat.channel === 'whatsapp');
const telegramChats = data.chats.filter(chat => chat.channel === 'telegram');

// Или использовать серверную фильтрацию:
const telegramResponse = await fetch('/api/chats?organizationId=1&channel=telegram');
```

## Преимущества

1. **Единый эндпоинт** для всех каналов коммуникации
2. **Гибкая фильтрация** - можно получить чаты из конкретного канала или всех сразу
3. **Расширяемость** - легко добавить новые каналы (Viber, Facebook и т.д.)
4. **Обратная совместимость** - старый код продолжает работать

## См. также

- [TELEGRAM_INTEGRATION.md](./TELEGRAM_INTEGRATION.md) - Полная документация Telegram интеграции
- [TELEGRAM_QUICK_START.md](./TELEGRAM_QUICK_START.md) - Быстрый старт с Telegram ботами
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - Общая документация API
