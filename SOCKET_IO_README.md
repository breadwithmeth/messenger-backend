# Socket.IO Real-Time System - Complete Guide

## 🚀 Обзор

Backend messenger теперь поддерживает **real-time уведомления** через Socket.IO для мгновенной синхронизации данных между клиентами.

### Что реализовано

✅ **Полная Socket.IO инфраструктура**
- JWT аутентификация
- Система комнат (organization, user, chat)
- 7+ типов событий
- Интеграция со всеми каналами (WhatsApp Baileys, WABA, Telegram)

✅ **События от сервера:**
- `chat:new` - Новый чат создан
- `message:new` - Новое сообщение
- `chat:updated` - Чат обновлён
- `messages:read` - Сообщения прочитаны
- `message:status` - Статус сообщения изменён
- `chat:deleted` - Чат удалён
- `user:notification` - Персональное уведомление

✅ **События от клиента:**
- `subscribe:chat` - Подписаться на чат
- `unsubscribe:chat` - Отписаться от чата
- `typing:start` - Начал печатать
- `typing:stop` - Закончил печатать

---

## 📚 Документация

### Для разработчиков фронтенда

| Документ | Описание |
|----------|----------|
| **[SOCKET_IO_QUICK_START.md](./SOCKET_IO_QUICK_START.md)** | ⚡ Быстрый старт за 5 минут |
| **[SOCKET_IO_DOCUMENTATION.md](./SOCKET_IO_DOCUMENTATION.md)** | 📖 Полная документация API |
| **[SOCKET_IO_TESTING.md](./SOCKET_IO_TESTING.md)** | 🧪 Руководство по тестированию |

### Для backend разработчиков

| Документ | Описание |
|----------|----------|
| **[SOCKET_IO_ARCHITECTURE.md](./SOCKET_IO_ARCHITECTURE.md)** | 🏗️ Архитектура системы |

---

## ⚡ Quick Start (5 минут)

### 1. Установите Socket.IO клиент

```bash
npm install socket.io-client
```

### 2. Подключитесь к серверу

```typescript
import { io } from 'socket.io-client';

const token = localStorage.getItem('authToken');

const socket = io('http://localhost:3000', {
  auth: { token }
});

socket.on('connect', () => {
  console.log('✅ Подключено');
});
```

### 3. Подпишитесь на события

```typescript
// Новое сообщение
socket.on('message:new', (data) => {
  console.log('📩 Новое сообщение:', data);
  // Обновите UI
});

// Новый чат
socket.on('chat:new', (data) => {
  console.log('🆕 Новый чат:', data);
  // Добавьте чат в список
});
```

### 4. Готово! 🎉

Теперь ваше приложение получает real-time уведомления без polling.

---

## 🎯 Примеры использования

### React Hook

```typescript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    const newSocket = io('http://localhost:3000', {
      auth: { token }
    });

    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => setConnected(false));

    setSocket(newSocket);

    return () => newSocket.close();
  }, []);

  return { socket, connected };
}
```

### Vue.js Composable

```typescript
import { ref, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';

export function useSocket() {
  const socket = ref(null);
  const connected = ref(false);

  onMounted(() => {
    const token = localStorage.getItem('authToken');
    socket.value = io('http://localhost:3000', {
      auth: { token }
    });

    socket.value.on('connect', () => {
      connected.value = true;
    });

    socket.value.on('disconnect', () => {
      connected.value = false;
    });
  });

  onUnmounted(() => {
    if (socket.value) {
      socket.value.close();
    }
  });

  return { socket, connected };
}
```

---

## 🔧 Backend Integration

### Файлы с Socket.IO интеграцией

| Файл | Роль |
|------|------|
| `src/services/socketService.ts` | 🎯 Главный сервис Socket.IO |
| `src/server.ts` | 🚀 Инициализация Socket.IO сервера |
| `src/config/baileys.ts` | 💬 Уведомления WhatsApp (Baileys) |
| `src/controllers/wabaController.ts` | 📲 Уведомления WABA |
| `src/services/telegramService.ts` | ✈️ Уведомления Telegram |
| `src/controllers/messageController.ts` | 📤 Уведомления исходящих сообщений |

### Как отправить уведомление

```typescript
import { notifyNewMessage } from './services/socketService';

// После сохранения сообщения в БД
notifyNewMessage(organizationId, {
  id: message.id,
  chatId: message.chatId,
  content: message.content,
  fromMe: false,
  timestamp: message.timestamp,
  channel: 'whatsapp',
});
```

---

## 🌐 Поддерживаемые каналы

| Канал | Входящие | Исходящие | Статус |
|-------|----------|-----------|--------|
| **WhatsApp (Baileys)** | ✅ | ✅ | Работает |
| **WhatsApp (WABA)** | ✅ | ✅ | Работает |
| **Telegram** | ✅ | 🔄 | Работает (входящие) |

---

## 🧪 Тестирование

### Быстрый тест через HTML

Скопируйте [test-socket.html](./SOCKET_IO_TESTING.md#базовый-тест-подключения) и откройте в браузере.

### Тест через Node.js

```bash
npm install socket.io-client

node test-socket.js
```

Пример `test-socket.js`:

```javascript
const io = require('socket.io-client');

const socket = io('http://localhost:3000', {
  auth: { token: 'YOUR_JWT_TOKEN' }
});

socket.on('connect', () => {
  console.log('✅ Подключено');
});

socket.on('message:new', (data) => {
  console.log('📩 Новое сообщение:', data);
});
```

---

## 🔐 Безопасность

### JWT Аутентификация

Каждое подключение **обязательно** требует JWT токен:

```typescript
const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-token-here'
  }
});
```

### Изоляция данных

- Пользователи видят только данные **своей организации**
- Персональные уведомления только для **конкретного пользователя**
- Подписка на чаты только **своей организации**

---

## 📊 События - Полный список

### От сервера → Клиенту

| Событие | Когда отправляется | Структура данных |
|---------|-------------------|------------------|
| `chat:new` | Создан новый чат | `{ id, name, channel, status, ... }` |
| `message:new` | Получено/отправлено сообщение | `{ id, chatId, content, fromMe, ... }` |
| `chat:updated` | Обновлён статус/приоритет | `{ id, status?, priority?, ... }` |
| `messages:read` | Сообщения прочитаны | `{ chatId, readByUserId }` |
| `message:status` | Статус доставки изменён | `{ messageId, status, chatId }` |
| `chat:deleted` | Чат удалён | `{ chatId }` |
| `user:notification` | Персональное уведомление | `{ type, message, data? }` |

### От клиента → Серверу

| Событие | Описание | Параметры |
|---------|----------|-----------|
| `subscribe:chat` | Подписаться на чат | `{ chatId: number }` |
| `unsubscribe:chat` | Отписаться от чата | `{ chatId: number }` |
| `typing:start` | Начал печатать | `{ chatId: number }` |
| `typing:stop` | Закончил печатать | `{ chatId: number }` |

---

## 🚀 Production Checklist

Перед запуском в production:

- [ ] HTTPS/WSS для Socket.IO
- [ ] JWT токены с коротким TTL
- [ ] CORS ограничен доменами
- [ ] Redis Adapter для масштабирования
- [ ] Мониторинг подключений
- [ ] Rate limiting для событий
- [ ] Логирование всех операций
- [ ] Документация для команды

---

## 🔗 Связанная документация

### API Documentation

- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - REST API
- [CHATS_API_DOCUMENTATION.md](./CHATS_API_DOCUMENTATION.md) - Работа с чатами
- [MESSAGES_API_DOCUMENTATION.md](./MESSAGES_API_DOCUMENTATION.md) - Работа с сообщениями

### Integration Guides

- [TELEGRAM_INTEGRATION.md](./TELEGRAM_INTEGRATION.md) - Интеграция Telegram
- [R2_INTEGRATION_COMPLETE.md](./R2_INTEGRATION_COMPLETE.md) - Cloudflare R2
- [SESSION_MANAGEMENT_API.md](./SESSION_MANAGEMENT_API.md) - Управление сессиями

---

## ❓ FAQ

### Q: Нужно ли использовать Socket.IO для всех запросов?

**A:** Нет. Socket.IO только для real-time уведомлений. Используйте REST API для:
- Загрузки истории сообщений
- Отправки сообщений
- Получения списка чатов
- Обновления статусов

### Q: Что если соединение разорвано?

**A:** Socket.IO автоматически переподключится. Обработайте события:

```typescript
socket.on('disconnect', () => {
  console.log('Переподключение...');
});

socket.on('connect', () => {
  console.log('Восстановлено');
  // Переподпишитесь на чаты
});
```

### Q: Как масштабировать на несколько серверов?

**A:** Используйте Redis Adapter. См. [SOCKET_IO_ARCHITECTURE.md](./SOCKET_IO_ARCHITECTURE.md#масштабирование).

### Q: Поддерживается ли fallback на long polling?

**A:** Да, Socket.IO автоматически использует long polling если WebSocket недоступен.

---

## 🐛 Troubleshooting

### Не приходят события

1. Проверьте JWT токен (валидность, срок действия)
2. Убедитесь что событие `connect` получено
3. Проверьте логи backend: `[Socket.IO]`
4. Откройте DevTools → Network → WS

### Ошибка аутентификации

```
Error: Authentication failed: Invalid token
```

**Решение:** Обновите JWT токен, повторите логин.

### События приходят с задержкой

**Причины:**
- Fallback на long polling (медленнее WebSocket)
- Медленное соединение
- Backend под нагрузкой

**Проверка:**

```typescript
socket.on('connect', () => {
  console.log('Транспорт:', socket.io.engine.transport.name);
  // Должно быть: "websocket"
});
```

---

## 📝 Changelog

### v1.0.0 (2025-12-14)

**Добавлено:**
- ✅ Полная Socket.IO инфраструктура
- ✅ JWT аутентификация
- ✅ 7 типов событий
- ✅ Интеграция с Baileys, WABA, Telegram
- ✅ Документация для фронтенда
- ✅ Примеры для React, Vue, Vanilla JS
- ✅ Тестовые скрипты

**Источники уведомлений:**
- WhatsApp Baileys (входящие + исходящие)
- WABA (входящие + исходящие)
- Telegram (входящие)

---

## 🤝 Поддержка

При возникновении проблем:

1. Проверьте [SOCKET_IO_TESTING.md](./SOCKET_IO_TESTING.md)
2. Проверьте логи backend
3. Используйте тестовые скрипты
4. Проверьте browser devtools → Network → WS

---

## 📖 Начало работы

### Для фронтенд разработчиков

👉 Начните с [SOCKET_IO_QUICK_START.md](./SOCKET_IO_QUICK_START.md)

### Для backend разработчиков

👉 Изучите [SOCKET_IO_ARCHITECTURE.md](./SOCKET_IO_ARCHITECTURE.md)

### Для тестирования

👉 Откройте [SOCKET_IO_TESTING.md](./SOCKET_IO_TESTING.md)

---

**Готовы начать?** Откройте [SOCKET_IO_QUICK_START.md](./SOCKET_IO_QUICK_START.md) 🚀
