# Socket.IO - Быстрый старт

## 1. Установка клиента

```bash
npm install socket.io-client
```

## 2. Базовое подключение

```typescript
import { io } from 'socket.io-client';

const token = localStorage.getItem('authToken');

const socket = io('http://localhost:3000', {
  auth: { token }
});

socket.on('connect', () => {
  console.log('✅ Подключено');
});

socket.on('disconnect', () => {
  console.log('❌ Отключено');
});
```

## 3. Подписка на события

```typescript
// Новый чат
socket.on('chat:new', (data) => {
  console.log('🆕 Новый чат:', data);
});

// Новое сообщение
socket.on('message:new', (data) => {
  console.log('📩 Сообщение:', data);
});

// Обновление чата
socket.on('chat:updated', (data) => {
  console.log('♻️ Обновление:', data);
});

// Сообщения прочитаны
socket.on('messages:read', (data) => {
  console.log('👁️ Прочитано:', data);
});

// Статус сообщения
socket.on('message:status', (data) => {
  console.log('📊 Статус:', data);
});

// Чат удалён
socket.on('chat:deleted', (data) => {
  console.log('🗑️ Удалено:', data);
});
```

## 4. Отправка событий

```typescript
// Подписаться на чат
socket.emit('subscribe:chat', { chatId: 123 });

// Отписаться от чата
socket.emit('unsubscribe:chat', { chatId: 123 });

// Начал печатать
socket.emit('typing:start', { chatId: 123 });

// Закончил печатать
socket.emit('typing:stop', { chatId: 123 });
```

## 5. React Hook пример

```typescript
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    const newSocket = io('http://localhost:3000', {
      auth: { token }
    });

    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => setConnected(false));

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  return { socket, connected };
}

// Использование:
function ChatList() {
  const { socket, connected } = useSocket();
  const [chats, setChats] = useState([]);

  useEffect(() => {
    if (!socket) return;

    socket.on('chat:new', (data) => {
      setChats(prev => [data, ...prev]);
    });

    socket.on('message:new', (data) => {
      setChats(prev =>
        prev.map(chat =>
          chat.id === data.chatId
            ? { ...chat, lastMessage: data, unreadCount: chat.unreadCount + 1 }
            : chat
        )
      );
    });
  }, [socket]);

  return (
    <div>
      <div>{connected ? '🟢 Online' : '🔴 Offline'}</div>
      {chats.map(chat => (
        <div key={chat.id}>{chat.name}</div>
      ))}
    </div>
  );
}
```

## 6. Vue.js пример

```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';

const socket = ref(null);
const connected = ref(false);
const chats = ref([]);

onMounted(() => {
  const token = localStorage.getItem('authToken');
  socket.value = io('http://localhost:3000', {
    auth: { token }
  });

  socket.value.on('connect', () => {
    connected.value = true;
  });

  socket.value.on('chat:new', (data) => {
    chats.value.unshift(data);
  });

  socket.value.on('message:new', (data) => {
    const chat = chats.value.find(c => c.id === data.chatId);
    if (chat) {
      chat.lastMessage = data;
      chat.unreadCount++;
    }
  });
});

onUnmounted(() => {
  if (socket.value) {
    socket.value.close();
  }
});
</script>

<template>
  <div>
    <div>{{ connected ? '🟢 Online' : '🔴 Offline' }}</div>
    <div v-for="chat in chats" :key="chat.id">
      {{ chat.name }}
    </div>
  </div>
</template>
```

## 7. Vanilla JavaScript пример

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
</head>
<body>
  <div id="status">Подключение...</div>
  <div id="chats"></div>

  <script>
    const token = localStorage.getItem('authToken');
    const socket = io('http://localhost:3000', {
      auth: { token }
    });

    socket.on('connect', () => {
      document.getElementById('status').textContent = '🟢 Online';
    });

    socket.on('disconnect', () => {
      document.getElementById('status').textContent = '🔴 Offline';
    });

    socket.on('chat:new', (data) => {
      const chatsDiv = document.getElementById('chats');
      const chatDiv = document.createElement('div');
      chatDiv.textContent = `Новый чат: ${data.name}`;
      chatsDiv.appendChild(chatDiv);
    });

    socket.on('message:new', (data) => {
      console.log('Новое сообщение:', data);
      // Обновить UI
    });
  </script>
</body>
</html>
```

## События - Краткая справка

| Событие | Описание | От сервера | От клиента |
|---------|----------|------------|------------|
| `chat:new` | Новый чат создан | ✅ | ❌ |
| `message:new` | Новое сообщение | ✅ | ❌ |
| `chat:updated` | Чат обновлён | ✅ | ❌ |
| `messages:read` | Сообщения прочитаны | ✅ | ❌ |
| `message:status` | Статус сообщения | ✅ | ❌ |
| `chat:deleted` | Чат удалён | ✅ | ❌ |
| `user:notification` | Персональное уведомление | ✅ | ❌ |
| `subscribe:chat` | Подписаться на чат | ❌ | ✅ |
| `unsubscribe:chat` | Отписаться от чата | ❌ | ✅ |
| `typing:start` | Начал печатать | ❌ | ✅ |
| `typing:stop` | Закончил печатать | ❌ | ✅ |

## Полная документация

Смотрите [SOCKET_IO_DOCUMENTATION.md](./SOCKET_IO_DOCUMENTATION.md) для подробной информации.
