# API Документация: Получение списка чатов

## Эндпоинт

```http
GET /api/chats
```

## Описание

Получает список чатов организации с поддержкой фильтрации, сортировки и пагинации. 

> ⏰ **Важно о сортировке по времени:** По умолчанию чаты сортируются по **времени последнего сообщения** (`lastMessageAt`), а НЕ по времени создания чата. Это означает, что чаты с недавней активностью будут выше в списке.

Чаты автоматически сортируются по приоритету, количеству непрочитанных сообщений и времени последнего сообщения.

## Авторизация

Требуется аутентификация. `organizationId` и `userId` извлекаются из `res.locals` (устанавливаются middleware аутентификации).

## Параметры запроса

| Параметр | Тип | Обязательный | Описание | Пример |
|----------|-----|--------------|----------|--------|
| `status` | string | Нет | Фильтр по статусу тикета | `new`, `open`, `in_progress`, `resolved`, `closed`, `pending` |
| `assigned` | boolean | Нет | Фильтр по назначению оператору (любому) | `true` (назначенные), `false` (неназначенные) |
| `assignedToMe` | boolean | Нет | Фильтр по назначению текущему пользователю | `true` (мои чаты) |
| `priority` | string | Нет | Фильтр по приоритету | `low`, `normal`, `high`, `urgent` |
| `channel` | string | Нет | Фильтр по каналу коммуникации | `whatsapp`, `telegram` |
| `includeProfile` | boolean | Нет | Включить информацию о профиле контакта | `true`, `false` |
| `sortBy` | string | Нет | Поле для сортировки | `lastMessageAt` (по умолчанию), `createdAt`, `priority`, `unreadCount`, `ticketNumber`, `status`, `name` |
| `sortOrder` | string | Нет | Направление сортировки | `desc` (по умолчанию), `asc` |
| `limit` | number | Нет | Количество чатов на странице (макс 100) | `50` (по умолчанию) |
| `offset` | number | Нет | Смещение для пагинации | `0` (по умолчанию) |

## Сортировка

### Умная сортировка по умолчанию (без указания `sortBy`)

Если параметр `sortBy` **не указан**, чаты автоматически сортируются в оптимальном порядке:

1. **По приоритету** (DESC) - сначала `urgent`, затем `high`, `normal`, `low`
2. **По количеству непрочитанных** (DESC) - чаты с большим количеством непрочитанных сообщений выше
3. **По времени последнего сообщения** (DESC) - новые чаты выше

```typescript
// Умная сортировка (по умолчанию)
orderBy: [
  { priority: 'desc' },      // 1. Приоритетные чаты
  { unreadCount: 'desc' },   // 2. С непрочитанными сообщениями
  { lastMessageAt: 'desc' }, // 3. По времени последнего сообщения
]
```

### Кастомная сортировка (с указанием `sortBy`)

Если параметр `sortBy` **указан**, применяется одно поле для сортировки:

> 💡 **По умолчанию:** Если не указывать параметр `sortBy`, используется **`lastMessageAt`** (время последнего сообщения) в рамках умной сортировки.

| `sortBy` | Описание |
|----------|----------|
| `lastMessageAt` | ⭐ **Сортировка по времени последнего сообщения** (по умолчанию) |
| `createdAt` | Сортировка по времени создания чата (когда чат был впервые создан) |
| `priority` | Сортировка по приоритету (`urgent` > `high` > `normal` > `low`) |
| `unreadCount` | Сортировка по количеству непрочитанных |
| `ticketNumber` | Сортировка по номеру тикета |
| `status` | Сортировка по статусу |
| `name` | Сортировка по имени контакта (алфавитный) |

**Примеры:**

```bash
# Сортировка по количеству непрочитанных (убывание)
GET /api/chats?sortBy=unreadCount&sortOrder=desc

# Сортировка по дате создания (от старых к новым)
GET /api/chats?sortBy=createdAt&sortOrder=asc

# Сортировка по имени (алфавитный порядок)
GET /api/chats?sortBy=name&sortOrder=asc

# Сортировка по номеру тикета
GET /api/chats?sortBy=ticketNumber&sortOrder=desc
```

## Формат ответа

### Успешный ответ (200 OK)

```json
{
  "chats": [
    {
      "id": 123,
      "name": "John Doe",
      "channel": "telegram",
      "ticketNumber": 42,
      "status": "open",
      "priority": "high",
      "unreadCount": 5,
      "lastMessageAt": "2025-11-24T15:30:00.000Z",
      "createdAt": "2025-11-24T10:00:00.000Z",
      
      // Информация о назначении
      "assignedUser": {
        "id": 2,
        "name": "Иван Иванов",
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
      "organizationPhone": null,
      "remoteJid": null,
      "receivingPhoneJid": null,
      "isGroup": false,
      
      // Последнее сообщение
      "lastMessage": {
        "id": 456,
        "content": "Здравствуйте, нужна помощь!",
        "senderJid": null,
        "timestamp": "2025-11-24T15:30:00.000Z",
        "fromMe": false,
        "type": "text",
        "isReadByOperator": false,
        "mediaUrl": null
      }
    },
    {
      "id": 124,
      "name": "Jane Smith",
      "channel": "whatsapp",
      "ticketNumber": 43,
      "status": "new",
      "priority": "normal",
      "unreadCount": 3,
      "lastMessageAt": "2025-11-24T15:25:00.000Z",
      "createdAt": "2025-11-24T14:00:00.000Z",
      
      "assignedUser": null,
      
      // WhatsApp-специфичные поля
      "organizationPhone": {
        "id": 1,
        "phoneJid": "79001112233@s.whatsapp.net",
        "displayName": "Поддержка"
      },
      "remoteJid": "79009998877@s.whatsapp.net",
      "receivingPhoneJid": "79001112233@s.whatsapp.net",
      "isGroup": false,
      
      // Telegram поля (null для WhatsApp чатов)
      "telegramBot": null,
      "telegramChatId": null,
      "telegramUsername": null,
      "telegramFirstName": null,
      "telegramLastName": null,
      
      "lastMessage": {
        "id": 457,
        "content": "Где мой заказ?",
        "senderJid": "79009998877@s.whatsapp.net",
        "timestamp": "2025-11-24T15:25:00.000Z",
        "fromMe": false,
        "type": "text",
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

## Примеры использования

### 1. Получить все чаты (с сортировкой по умолчанию)

```bash
curl -X GET "http://localhost:3000/api/chats" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Результат:** Все чаты отсортированы по:
1. Приоритету (urgent → high → normal → low)
2. Непрочитанным (5 → 3 → 1 → 0)
3. Времени последнего сообщения (новые → старые)

### 2. Только открытые чаты

```bash
curl -X GET "http://localhost:3000/api/chats?status=open" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. Неназначенные чаты (для автоматического распределения)

```bash
curl -X GET "http://localhost:3000/api/chats?assigned=false" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. **Чаты, назначенные мне (текущему пользователю)**

```bash
curl -X GET "http://localhost:3000/api/chats?assignedToMe=true" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Результат:** Только чаты, где `assignedUserId` равен ID текущего авторизованного пользователя.

### 5. Срочные чаты с непрочитанными сообщениями

```bash
curl -X GET "http://localhost:3000/api/chats?priority=urgent&status=open" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 6. Только Telegram чаты

```bash
curl -X GET "http://localhost:3000/api/chats?channel=telegram" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 7. Только WhatsApp чаты

```bash
curl -X GET "http://localhost:3000/api/chats?channel=whatsapp" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 8. С пагинацией (страница 2, по 20 чатов)

```bash
curl -X GET "http://localhost:3000/api/chats?limit=20&offset=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 9. Сортировка по количеству непрочитанных (убывание)

```bash
curl -X GET "http://localhost:3000/api/chats?sortBy=unreadCount&sortOrder=desc" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 10. Сортировка по дате создания (от старых к новым)

```bash
curl -X GET "http://localhost:3000/api/chats?sortBy=createdAt&sortOrder=asc" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 11. Сортировка по имени (алфавитный порядок)

```bash
curl -X GET "http://localhost:3000/api/chats?sortBy=name&sortOrder=asc" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 12. Мои чаты с сортировкой по времени последнего сообщения

```bash
curl -X GET "http://localhost:3000/api/chats?assignedToMe=true&sortBy=lastMessageAt&sortOrder=desc" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 13. Комбинированные фильтры с сортировкой

```bash
# Открытые Telegram чаты с высоким приоритетом, неназначенные, отсортированные по дате
curl -X GET "http://localhost:3000/api/chats?channel=telegram&status=open&priority=high&assigned=false&sortBy=createdAt&sortOrder=desc" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Примеры для фронтенда

### React: Компонент списка чатов

```typescript
import { useEffect, useState } from 'react';

interface Chat {
  id: number;
  name: string;
  channel: 'whatsapp' | 'telegram';
  ticketNumber: number;
  status: string;
  priority: string;
  unreadCount: number;
  lastMessageAt: string;
  assignedUser?: {
    id: number;
    name: string;
    email: string;
  };
  lastMessage?: {
    content: string;
    fromMe: boolean;
    timestamp: string;
  };
}

function ChatList() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({
    status: '',
    channel: '',
    assigned: '',
    assignedToMe: false, // Новое поле для моих чатов
    priority: '',
    sortBy: '',        // Новое поле для сортировки
    sortOrder: 'desc', // Направление сортировки
  });

  useEffect(() => {
    loadChats();
  }, [filter]);

  async function loadChats() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      
      if (filter.status) params.append('status', filter.status);
      if (filter.channel) params.append('channel', filter.channel);
      if (filter.assigned) params.append('assigned', filter.assigned);
      if (filter.assignedToMe) params.append('assignedToMe', 'true');
      if (filter.priority) params.append('priority', filter.priority);
      if (filter.sortBy) {
        params.append('sortBy', filter.sortBy);
        params.append('sortOrder', filter.sortOrder);
      }

      const response = await fetch(
        `http://localhost:3000/api/chats?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );

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
      {/* Фильтры */}
      <div className="filters">
        <select 
          value={filter.status} 
          onChange={(e) => setFilter({...filter, status: e.target.value})}
        >
          <option value="">Все статусы</option>
          <option value="new">Новые</option>
          <option value="open">Открытые</option>
          <option value="in_progress">В работе</option>
          <option value="resolved">Решённые</option>
          <option value="closed">Закрытые</option>
        </select>

        <select 
          value={filter.channel} 
          onChange={(e) => setFilter({...filter, channel: e.target.value})}
        >
          <option value="">Все каналы</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="telegram">Telegram</option>
        </select>

        <select 
          value={filter.priority} 
          onChange={(e) => setFilter({...filter, priority: e.target.value})}
        >
          <option value="">Все приоритеты</option>
          <option value="urgent">Срочные</option>
          <option value="high">Высокий</option>
          <option value="normal">Обычный</option>
          <option value="low">Низкий</option>
        </select>

        <select 
          value={filter.assigned} 
          onChange={(e) => setFilter({...filter, assigned: e.target.value})}
        >
          <option value="">Все</option>
          <option value="false">Неназначенные</option>
          <option value="true">Назначенные</option>
        </select>

        {/* Чекбокс для фильтрации моих чатов */}
        <label>
          <input
            type="checkbox"
            checked={filter.assignedToMe}
            onChange={(e) => setFilter({...filter, assignedToMe: e.target.checked})}
          />
          Только мои чаты
        </label>

        {/* Новый dropdown для сортировки */}
        <select 
          value={filter.sortBy} 
          onChange={(e) => setFilter({...filter, sortBy: e.target.value})}
        >
          <option value="">Умная сортировка (по умолчанию)</option>
          <option value="lastMessageAt">По времени последнего сообщения</option>
          <option value="createdAt">По дате создания</option>
          <option value="unreadCount">По количеству непрочитанных</option>
          <option value="priority">По приоритету</option>
          <option value="ticketNumber">По номеру тикета</option>
          <option value="name">По имени</option>
          <option value="status">По статусу</option>
        </select>

        {/* Направление сортировки (если выбрана кастомная сортировка) */}
        {filter.sortBy && (
          <select 
            value={filter.sortOrder} 
            onChange={(e) => setFilter({...filter, sortOrder: e.target.value})}
          >
            <option value="desc">По убыванию ↓</option>
            <option value="asc">По возрастанию ↑</option>
          </select>
        )}
      </div>

      {/* Список чатов */}
      {loading ? (
        <div>Загрузка...</div>
      ) : (
        <div className="chat-list">
          {chats.map(chat => (
            <ChatItem key={chat.id} chat={chat} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChatItem({ chat }: { chat: Chat }) {
  const channelIcon = chat.channel === 'telegram' ? '✈️' : '💬';
  const priorityColor = {
    urgent: 'red',
    high: 'orange',
    normal: 'blue',
    low: 'gray',
  }[chat.priority];

  return (
    <div className="chat-item" style={{ borderLeft: `4px solid ${priorityColor}` }}>
      {/* Канал */}
      <span className="channel-icon">{channelIcon}</span>

      {/* Информация */}
      <div className="chat-info">
        <h3>{chat.name}</h3>
        <p className="ticket">Тикет #{chat.ticketNumber}</p>
        
        {/* Последнее сообщение */}
        {chat.lastMessage && (
          <p className="last-message">
            {chat.lastMessage.fromMe ? '➡️ Вы: ' : '⬅️ '}
            {chat.lastMessage.content}
          </p>
        )}
        
        {/* Время */}
        <p className="time">
          {new Date(chat.lastMessageAt).toLocaleString('ru-RU')}
        </p>
      </div>

      {/* Статус и непрочитанные */}
      <div className="chat-meta">
        <span className={`status status-${chat.status}`}>
          {chat.status}
        </span>
        
        {chat.unreadCount > 0 && (
          <span className="unread-badge">{chat.unreadCount}</span>
        )}
        
        {chat.assignedUser && (
          <span className="assigned">
            👤 {chat.assignedUser.name}
          </span>
        )}
      </div>
    </div>
  );
}

export default ChatList;
```

### Vue.js: Компонент с фильтрацией

```vue
<template>
  <div class="chats-container">
    <!-- Фильтры -->
    <div class="filters">
      <select v-model="filters.status">
        <option value="">Все статусы</option>
        <option value="new">Новые</option>
        <option value="open">Открытые</option>
        <option value="in_progress">В работе</option>
      </select>

      <select v-model="filters.channel">
        <option value="">Все каналы</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="telegram">Telegram</option>
      </select>
    </div>

    <!-- Список чатов -->
    <div class="chat-list">
      <div 
        v-for="chat in chats" 
        :key="chat.id" 
        class="chat-item"
        :class="`priority-${chat.priority}`"
      >
        <span class="channel-icon">
          {{ chat.channel === 'telegram' ? '✈️' : '💬' }}
        </span>
        
        <div class="chat-content">
          <h3>{{ chat.name }}</h3>
          <p class="ticket">Тикет #{{ chat.ticketNumber }}</p>
          
          <p v-if="chat.lastMessage" class="last-message">
            {{ chat.lastMessage.content }}
          </p>
          
          <span class="time">
            {{ formatTime(chat.lastMessageAt) }}
          </span>
        </div>

        <div class="chat-badges">
          <span v-if="chat.unreadCount > 0" class="unread">
            {{ chat.unreadCount }}
          </span>
          <span :class="`priority priority-${chat.priority}`">
            {{ chat.priority }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';

const filters = ref({
  status: '',
  channel: '',
  assigned: '',
});

const chats = ref([]);

async function loadChats() {
  const params = new URLSearchParams();
  
  if (filters.value.status) params.append('status', filters.value.status);
  if (filters.value.channel) params.append('channel', filters.value.channel);
  if (filters.value.assigned) params.append('assigned', filters.value.assigned);

  const response = await fetch(`http://localhost:3000/api/chats?${params}`, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    },
  });

  const data = await response.json();
  chats.value = data.chats;
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleString('ru-RU');
}

watch(filters, loadChats, { deep: true });
onMounted(loadChats);
</script>

<style scoped>
.priority-urgent {
  border-left: 4px solid red;
}
.priority-high {
  border-left: 4px solid orange;
}
.priority-normal {
  border-left: 4px solid blue;
}
.priority-low {
  border-left: 4px solid gray;
}
</style>
```

## Определение отправителя сообщения

### Правило: Если есть `senderUser`, значит сообщение от оператора

```typescript
function isOperatorMessage(message: Message): boolean {
  return message.senderUser !== null;
}

// Пример использования
if (message.senderUser) {
  console.log(`Оператор ${message.senderUser.name || message.senderUser.email} написал:`);
  console.log(message.content);
} else {
  console.log('Клиент написал:');
  console.log(message.content);
}
```

### Пример структуры сообщения

```json
// Сообщение ОТ ОПЕРАТОРА
{
  "id": 456,
  "content": "Здравствуйте! Чем могу помочь?",
  "fromMe": true,
  "timestamp": "2025-11-24T15:30:00.000Z",
  "senderUser": {
    "id": 1,
    "name": "Иван Иванов",
    "email": "ivan@example.com"
  }
}

// Сообщение ОТ КЛИЕНТА
{
  "id": 457,
  "content": "Где мой заказ?",
  "fromMe": false,
  "timestamp": "2025-11-24T15:31:00.000Z",
  "senderUser": null
}
```

### React: Компонент сообщения с определением отправителя

```typescript
function MessageBubble({ message }: { message: Message }) {
  const isFromOperator = message.senderUser !== null;
  
  return (
    <div className={`message ${isFromOperator ? 'operator' : 'client'}`}>
      <div className="message-header">
        {isFromOperator ? (
          <span className="sender">
            👤 {message.senderUser.name || message.senderUser.email}
          </span>
        ) : (
          <span className="sender">
            👥 Клиент
          </span>
        )}
        <span className="time">
          {new Date(message.timestamp).toLocaleTimeString('ru-RU')}
        </span>
      </div>
      
      <div className="message-content">
        {message.content}
      </div>
    </div>
  );
}
```

## Коды ошибок

| Код | Описание | Причина |
|-----|----------|---------|
| 400 | Bad Request | `organizationId` не определён в `res.locals` |
| 401 | Unauthorized | Отсутствует или недействительный токен авторизации |
| 500 | Internal Server Error | Ошибка сервера или базы данных |

## Производительность

- ✅ Используются индексы для быстрой фильтрации (`@@index([status])`, `@@index([priority])`, `@@index([channel])`)
- ✅ Оптимизированные `select` - только необходимые поля
- ✅ Пагинация ограничена максимум 100 чатами за запрос
- ✅ Сортировка выполняется на уровне БД

## См. также

- [MULTICHANNEL_CHATS_API.md](./MULTICHANNEL_CHATS_API.md) - Мультиканальные чаты
- [TELEGRAM_INTEGRATION.md](./TELEGRAM_INTEGRATION.md) - Интеграция с Telegram
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - Полная документация API
