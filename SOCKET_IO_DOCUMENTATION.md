# Socket.IO Real-Time Notifications - Документация

## Обзор

Backend поддерживает real-time уведомления через **Socket.IO** для мгновенного обновления чатов, сообщений и статусов без необходимости делать polling запросы.

### URL подключения

```
ws://localhost:3000
```

В production замените на ваш домен:
```
wss://api.yourdomain.com
```

---

## Аутентификация

Для подключения к Socket.IO **обязательна JWT аутентификация**. Передайте токен при подключении:

### JavaScript/TypeScript

```typescript
import { io } from 'socket.io-client';

const token = localStorage.getItem('authToken'); // Ваш JWT токен

const socket = io('http://localhost:3000', {
  auth: {
    token: token
  }
});
```

### React

```typescript
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    
    const newSocket = io('http://localhost:3000', {
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('✅ Socket.IO подключен');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Socket.IO отключен');
      setConnected(false);
    });

    newSocket.on('error', (error) => {
      console.error('❌ Ошибка Socket.IO:', error);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  return { socket, connected };
}

export default useSocket;
```

---

## События от сервера

Backend отправляет следующие события клиентам:

### 1. `chat:new` - Новый чат создан

Отправляется всем пользователям организации при создании нового чата.

**Структура данных:**

```typescript
interface NewChatEvent {
  id: number;
  name: string;
  channel: 'whatsapp' | 'telegram';
  remoteJid?: string;
  receivingPhoneJid?: string;
  telegramChatId?: string;
  telegramUsername?: string;
  status: string;
  priority: string;
  createdAt: string;
  organizationId: number;
  unreadCount: number;
}
```

**Пример обработки:**

```typescript
socket.on('chat:new', (data: NewChatEvent) => {
  console.log('🆕 Новый чат:', data);
  
  // Добавить чат в список
  setChats(prevChats => [data, ...prevChats]);
  
  // Показать уведомление
  showNotification(`Новый чат от ${data.name}`);
});
```

---

### 2. `message:new` - Новое сообщение

Отправляется при получении нового сообщения (от клиента или от оператора).

**Структура данных:**

```typescript
interface NewMessageEvent {
  id: number;
  chatId: number;
  content: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document';
  mediaUrl?: string;
  filename?: string;
  fromMe: boolean;
  timestamp: string;
  status: string;
  senderJid?: string;
  senderUserId?: number;
  telegramUsername?: string;
  channel: 'whatsapp' | 'telegram';
}
```

**Пример обработки:**

```typescript
socket.on('message:new', (data: NewMessageEvent) => {
  console.log('📩 Новое сообщение:', data);
  
  // Добавить сообщение в список
  setMessages(prevMessages => [...prevMessages, data]);
  
  // Обновить lastMessage в чате
  setChats(prevChats =>
    prevChats.map(chat =>
      chat.id === data.chatId
        ? {
            ...chat,
            lastMessage: data,
            lastMessageAt: data.timestamp,
            unreadCount: data.fromMe ? chat.unreadCount : chat.unreadCount + 1
          }
        : chat
    )
  );
  
  // Показать уведомление (только для входящих)
  if (!data.fromMe) {
    showNotification(`Новое сообщение в чате #${data.chatId}`);
  }
});
```

---

### 3. `chat:updated` - Чат обновлён

Отправляется при изменении статуса, приоритета, назначения оператора и т.д.

**Структура данных:**

```typescript
interface ChatUpdatedEvent {
  id: number;
  status?: string;
  priority?: string;
  assignedUserId?: number | null;
  unreadCount?: number;
  // Другие обновлённые поля
}
```

**Пример обработки:**

```typescript
socket.on('chat:updated', (data: ChatUpdatedEvent) => {
  console.log('♻️ Чат обновлён:', data);
  
  // Обновить чат в списке
  setChats(prevChats =>
    prevChats.map(chat =>
      chat.id === data.id ? { ...chat, ...data } : chat
    )
  );
});
```

---

### 4. `messages:read` - Сообщения прочитаны

Отправляется когда оператор отмечает сообщения как прочитанные.

**Структура данных:**

```typescript
interface MessagesReadEvent {
  chatId: number;
  readByUserId: number;
}
```

**Пример обработки:**

```typescript
socket.on('messages:read', (data: MessagesReadEvent) => {
  console.log('👁️ Сообщения прочитаны:', data);
  
  // Обновить unreadCount в чате
  setChats(prevChats =>
    prevChats.map(chat =>
      chat.id === data.chatId ? { ...chat, unreadCount: 0 } : chat
    )
  );
  
  // Обновить статус сообщений
  setMessages(prevMessages =>
    prevMessages.map(msg =>
      msg.chatId === data.chatId && !msg.fromMe
        ? { ...msg, isReadByOperator: true }
        : msg
    )
  );
});
```

---

### 5. `message:status` - Статус сообщения изменён

Отправляется при изменении статуса доставки сообщения (sent, delivered, read, failed).

**Структура данных:**

```typescript
interface MessageStatusEvent {
  messageId: number;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  chatId: number;
}
```

**Пример обработки:**

```typescript
socket.on('message:status', (data: MessageStatusEvent) => {
  console.log('📊 Статус сообщения:', data);
  
  // Обновить статус сообщения
  setMessages(prevMessages =>
    prevMessages.map(msg =>
      msg.id === data.messageId ? { ...msg, status: data.status } : msg
    )
  );
});
```

---

### 6. `chat:deleted` - Чат удалён

Отправляется при удалении чата.

**Структура данных:**

```typescript
interface ChatDeletedEvent {
  chatId: number;
}
```

**Пример обработки:**

```typescript
socket.on('chat:deleted', (data: ChatDeletedEvent) => {
  console.log('🗑️ Чат удалён:', data);
  
  // Удалить чат из списка
  setChats(prevChats => prevChats.filter(chat => chat.id !== data.chatId));
  
  // Закрыть чат, если он открыт
  if (currentChatId === data.chatId) {
    setCurrentChatId(null);
  }
});
```

---

### 7. `user:notification` - Персональное уведомление

Отправляется конкретному пользователю (например, при назначении чата).

**Структура данных:**

```typescript
interface UserNotificationEvent {
  type: string;
  message: string;
  data?: any;
}
```

**Пример обработки:**

```typescript
socket.on('user:notification', (data: UserNotificationEvent) => {
  console.log('🔔 Уведомление:', data);
  
  showNotification(data.message);
});
```

---

## События от клиента

Клиент может отправлять следующие события на сервер:

### 1. `subscribe:chat` - Подписаться на чат

Подпишитесь на конкретный чат для получения уведомлений только по этому чату.

```typescript
socket.emit('subscribe:chat', { chatId: 123 });
```

### 2. `unsubscribe:chat` - Отписаться от чата

Отпишитесь от чата, когда пользователь закрывает окно чата.

```typescript
socket.emit('unsubscribe:chat', { chatId: 123 });
```

### 3. `typing:start` - Начал печатать

Уведомить других операторов, что пользователь печатает.

```typescript
socket.emit('typing:start', { chatId: 123 });
```

### 4. `typing:stop` - Закончил печатать

```typescript
socket.emit('typing:stop', { chatId: 123 });
```

---

## Комплексный React-пример

### ChatApp.tsx

```typescript
import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface Chat {
  id: number;
  name: string;
  channel: string;
  unreadCount: number;
  lastMessage?: Message;
  lastMessageAt?: string;
}

interface Message {
  id: number;
  chatId: number;
  content: string;
  fromMe: boolean;
  timestamp: string;
  type: string;
  mediaUrl?: string;
}

function ChatApp() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentChatId, setCurrentChatId] = useState<number | null>(null);

  // Инициализация Socket.IO
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    
    if (!token) {
      console.error('Токен отсутствует');
      return;
    }

    const newSocket = io('http://localhost:3000', {
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('✅ Подключено к Socket.IO');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Отключено от Socket.IO');
      setConnected(false);
    });

    newSocket.on('error', (error) => {
      console.error('❌ Ошибка Socket.IO:', error);
    });

    // Обработчики событий
    newSocket.on('chat:new', handleNewChat);
    newSocket.on('message:new', handleNewMessage);
    newSocket.on('chat:updated', handleChatUpdated);
    newSocket.on('messages:read', handleMessagesRead);
    newSocket.on('message:status', handleMessageStatus);
    newSocket.on('chat:deleted', handleChatDeleted);

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  // Подписка на чат при открытии
  useEffect(() => {
    if (socket && currentChatId) {
      socket.emit('subscribe:chat', { chatId: currentChatId });
      
      // Загружаем сообщения чата
      loadMessages(currentChatId);

      return () => {
        socket.emit('unsubscribe:chat', { chatId: currentChatId });
      };
    }
  }, [socket, currentChatId]);

  // Обработчики событий
  const handleNewChat = (data: Chat) => {
    console.log('🆕 Новый чат:', data);
    setChats(prev => [data, ...prev]);
    showNotification(`Новый чат от ${data.name}`);
  };

  const handleNewMessage = (data: Message) => {
    console.log('📩 Новое сообщение:', data);
    
    // Добавляем сообщение, если это текущий чат
    if (data.chatId === currentChatId) {
      setMessages(prev => [...prev, data]);
    }
    
    // Обновляем чат
    setChats(prev =>
      prev.map(chat =>
        chat.id === data.chatId
          ? {
              ...chat,
              lastMessage: data,
              lastMessageAt: data.timestamp,
              unreadCount: data.fromMe ? chat.unreadCount : chat.unreadCount + 1
            }
          : chat
      )
    );

    // Уведомление только для входящих
    if (!data.fromMe && data.chatId !== currentChatId) {
      showNotification(`Новое сообщение в чате`);
    }
  };

  const handleChatUpdated = (data: Partial<Chat> & { id: number }) => {
    console.log('♻️ Чат обновлён:', data);
    setChats(prev =>
      prev.map(chat => (chat.id === data.id ? { ...chat, ...data } : chat))
    );
  };

  const handleMessagesRead = (data: { chatId: number; readByUserId: number }) => {
    console.log('👁️ Сообщения прочитаны:', data);
    setChats(prev =>
      prev.map(chat =>
        chat.id === data.chatId ? { ...chat, unreadCount: 0 } : chat
      )
    );
  };

  const handleMessageStatus = (data: { messageId: number; status: string; chatId: number }) => {
    console.log('📊 Статус сообщения:', data);
    setMessages(prev =>
      prev.map(msg =>
        msg.id === data.messageId ? { ...msg, status: data.status } : msg
      )
    );
  };

  const handleChatDeleted = (data: { chatId: number }) => {
    console.log('🗑️ Чат удалён:', data);
    setChats(prev => prev.filter(chat => chat.id !== data.chatId));
    if (currentChatId === data.chatId) {
      setCurrentChatId(null);
    }
  };

  // Загрузка сообщений через API
  const loadMessages = async (chatId: number) => {
    try {
      const response = await fetch(`http://localhost:3000/api/messages/${chatId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      const data = await response.json();
      setMessages(data.messages);
    } catch (error) {
      console.error('Ошибка загрузки сообщений:', error);
    }
  };

  const showNotification = (message: string) => {
    if (Notification.permission === 'granted') {
      new Notification('Messenger', { body: message });
    }
  };

  return (
    <div className="chat-app">
      <div className="status-bar">
        {connected ? '🟢 Online' : '🔴 Offline'}
      </div>

      <div className="chat-list">
        <h2>Чаты</h2>
        {chats.map(chat => (
          <div
            key={chat.id}
            className={`chat-item ${chat.id === currentChatId ? 'active' : ''}`}
            onClick={() => setCurrentChatId(chat.id)}
          >
            <div className="chat-header">
              <span className="chat-name">{chat.name}</span>
              {chat.unreadCount > 0 && (
                <span className="unread-badge">{chat.unreadCount}</span>
              )}
            </div>
            {chat.lastMessage && (
              <div className="chat-preview">
                {chat.lastMessage.content}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="chat-window">
        {currentChatId ? (
          <>
            <div className="messages">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`message ${msg.fromMe ? 'from-me' : 'from-them'}`}
                >
                  <div className="message-content">{msg.content}</div>
                  <div className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
            <div className="message-input">
              {/* Форма отправки сообщения */}
            </div>
          </>
        ) : (
          <div className="no-chat-selected">Выберите чат</div>
        )}
      </div>
    </div>
  );
}

export default ChatApp;
```

---

## Vue.js пример

```vue
<template>
  <div class="chat-app">
    <div class="status">{{ connected ? '🟢 Online' : '🔴 Offline' }}</div>
    
    <div class="chats">
      <div
        v-for="chat in chats"
        :key="chat.id"
        @click="openChat(chat.id)"
        :class="['chat-item', { active: currentChatId === chat.id }]"
      >
        <span>{{ chat.name }}</span>
        <span v-if="chat.unreadCount > 0" class="badge">
          {{ chat.unreadCount }}
        </span>
      </div>
    </div>

    <div class="messages">
      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="['message', msg.fromMe ? 'me' : 'them']"
      >
        {{ msg.content }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { io, Socket } from 'socket.io-client';

const socket = ref<Socket | null>(null);
const connected = ref(false);
const chats = ref([]);
const messages = ref([]);
const currentChatId = ref<number | null>(null);

onMounted(() => {
  const token = localStorage.getItem('authToken');
  
  socket.value = io('http://localhost:3000', {
    auth: { token }
  });

  socket.value.on('connect', () => {
    connected.value = true;
    console.log('✅ Подключено');
  });

  socket.value.on('disconnect', () => {
    connected.value = false;
    console.log('❌ Отключено');
  });

  socket.value.on('chat:new', (data) => {
    chats.value.unshift(data);
  });

  socket.value.on('message:new', (data) => {
    if (data.chatId === currentChatId.value) {
      messages.value.push(data);
    }
    
    // Обновить чат
    const chatIndex = chats.value.findIndex(c => c.id === data.chatId);
    if (chatIndex !== -1) {
      chats.value[chatIndex].lastMessage = data;
      if (!data.fromMe) {
        chats.value[chatIndex].unreadCount++;
      }
    }
  });

  socket.value.on('chat:updated', (data) => {
    const chatIndex = chats.value.findIndex(c => c.id === data.id);
    if (chatIndex !== -1) {
      chats.value[chatIndex] = { ...chats.value[chatIndex], ...data };
    }
  });
});

onUnmounted(() => {
  if (socket.value) {
    socket.value.close();
  }
});

watch(currentChatId, (newChatId, oldChatId) => {
  if (socket.value) {
    if (oldChatId) {
      socket.value.emit('unsubscribe:chat', { chatId: oldChatId });
    }
    if (newChatId) {
      socket.value.emit('subscribe:chat', { chatId: newChatId });
      loadMessages(newChatId);
    }
  }
});

function openChat(chatId: number) {
  currentChatId.value = chatId;
}

async function loadMessages(chatId: number) {
  const response = await fetch(`http://localhost:3000/api/messages/${chatId}`, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('authToken')}`
    }
  });
  const data = await response.json();
  messages.value = data.messages;
}
</script>
```

---

## Коды ошибок

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `Authentication failed` | Невалидный или отсутствующий JWT токен | Проверьте токен, перелогиньтесь |
| `Connection refused` | Сервер недоступен | Проверьте, что backend запущен |
| `Disconnected` | Потеря соединения | Socket.IO автоматически переподключится |

---

## Best Practices

### 1. Обработка переподключений

```typescript
socket.on('connect', () => {
  console.log('Подключено');
  
  // Переподписаться на чат после переподключения
  if (currentChatId) {
    socket.emit('subscribe:chat', { chatId: currentChatId });
  }
});
```

### 2. Очистка подписок

```typescript
useEffect(() => {
  if (socket && chatId) {
    socket.emit('subscribe:chat', { chatId });
    
    return () => {
      socket.emit('unsubscribe:chat', { chatId });
    };
  }
}, [socket, chatId]);
```

### 3. Обработка ошибок

```typescript
socket.on('error', (error) => {
  console.error('Socket.IO error:', error);
  showErrorNotification('Ошибка соединения');
});
```

### 4. Debounce для typing events

```typescript
import { debounce } from 'lodash';

const sendTypingStart = debounce(() => {
  socket.emit('typing:start', { chatId });
}, 300);

const sendTypingStop = debounce(() => {
  socket.emit('typing:stop', { chatId });
}, 1000);
```

---

## Тестирование

### Тест подключения

```typescript
const socket = io('http://localhost:3000', {
  auth: { token: 'your-test-token' }
});

socket.on('connect', () => {
  console.log('✅ Подключение успешно');
});

socket.on('error', (error) => {
  console.error('❌ Ошибка:', error);
});
```

### Тест получения событий

```bash
# Отправьте тестовое сообщение через API
curl -X POST http://localhost:3000/api/messages/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"chatId": 1, "text": "Test message", "type": "text"}'

# Проверьте, что событие message:new пришло на клиент
```

---

## См. также

- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - REST API документация
- [CHATS_API_DOCUMENTATION.md](./CHATS_API_DOCUMENTATION.md) - Работа с чатами
- [MESSAGES_API_DOCUMENTATION.md](./MESSAGES_API_DOCUMENTATION.md) - Работа с сообщениями
