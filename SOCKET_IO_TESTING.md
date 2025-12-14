# Socket.IO Testing Guide - Руководство по тестированию

## Быстрая проверка работоспособности

### 1. Проверка запуска сервера

После запуска backend проверьте логи:

```bash
npm run dev
```

**Ожидаемый вывод:**

```
✅ Socket.IO сервис инициализирован
🚀 Сервер запущен на порту 3000
Socket.IO доступен на ws://localhost:3000
```

---

## Тестирование через браузер

### Базовый тест подключения

Создайте файл `test-socket.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Socket.IO Test</title>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
  <style>
    body { font-family: Arial; padding: 20px; }
    .log { 
      background: #f0f0f0; 
      padding: 10px; 
      margin: 10px 0; 
      border-radius: 5px;
      max-height: 400px;
      overflow-y: auto;
    }
    .log-item { 
      margin: 5px 0; 
      padding: 5px;
      border-bottom: 1px solid #ddd;
    }
    .success { color: green; }
    .error { color: red; }
    .info { color: blue; }
    input, button { padding: 10px; margin: 5px; }
  </style>
</head>
<body>
  <h1>Socket.IO Test Dashboard</h1>
  
  <div>
    <h3>Подключение</h3>
    <input type="text" id="token" placeholder="JWT Token" style="width: 400px;">
    <button onclick="connect()">Подключить</button>
    <button onclick="disconnect()">Отключить</button>
    <p>Статус: <span id="status">🔴 Отключено</span></p>
  </div>

  <div>
    <h3>Управление чатами</h3>
    <input type="number" id="chatId" placeholder="Chat ID">
    <button onclick="subscribeChat()">Подписаться на чат</button>
    <button onclick="unsubscribeChat()">Отписаться</button>
  </div>

  <div>
    <h3>Индикатор печати</h3>
    <input type="number" id="typingChatId" placeholder="Chat ID">
    <button onclick="startTyping()">Начать печатать</button>
    <button onclick="stopTyping()">Прекратить печатать</button>
  </div>

  <div>
    <h3>События (последние 20)</h3>
    <div class="log" id="log"></div>
  </div>

  <script>
    let socket = null;
    const logs = [];

    function log(message, type = 'info') {
      const timestamp = new Date().toLocaleTimeString();
      const logItem = `[${timestamp}] ${message}`;
      logs.unshift({ message: logItem, type });
      
      if (logs.length > 20) logs.pop();
      
      const logDiv = document.getElementById('log');
      logDiv.innerHTML = logs
        .map(l => `<div class="log-item ${l.type}">${l.message}</div>`)
        .join('');
    }

    function connect() {
      const token = document.getElementById('token').value;
      
      if (!token) {
        log('❌ Введите JWT токен', 'error');
        return;
      }

      log('Подключение...', 'info');

      socket = io('http://localhost:3000', {
        auth: { token }
      });

      socket.on('connect', () => {
        log('✅ Подключено успешно', 'success');
        document.getElementById('status').textContent = '🟢 Подключено';
      });

      socket.on('disconnect', () => {
        log('❌ Отключено от сервера', 'error');
        document.getElementById('status').textContent = '🔴 Отключено';
      });

      socket.on('error', (error) => {
        log(`❌ Ошибка: ${error}`, 'error');
      });

      socket.on('chat:new', (data) => {
        log(`🆕 Новый чат #${data.id}: ${data.name}`, 'success');
      });

      socket.on('message:new', (data) => {
        log(`📩 Новое сообщение в чате #${data.chatId}: ${data.content}`, 'success');
      });

      socket.on('chat:updated', (data) => {
        log(`♻️ Чат #${data.id} обновлён`, 'info');
      });

      socket.on('messages:read', (data) => {
        log(`👁️ Сообщения в чате #${data.chatId} прочитаны`, 'info');
      });

      socket.on('message:status', (data) => {
        log(`📊 Сообщение #${data.messageId} статус: ${data.status}`, 'info');
      });

      socket.on('chat:deleted', (data) => {
        log(`🗑️ Чат #${data.chatId} удалён`, 'info');
      });

      socket.on('user:notification', (data) => {
        log(`🔔 Уведомление: ${data.message}`, 'info');
      });
    }

    function disconnect() {
      if (socket) {
        socket.close();
        socket = null;
        log('Отключение...', 'info');
      }
    }

    function subscribeChat() {
      const chatId = parseInt(document.getElementById('chatId').value);
      if (!socket || !chatId) return;
      
      socket.emit('subscribe:chat', { chatId });
      log(`📍 Подписка на чат #${chatId}`, 'info');
    }

    function unsubscribeChat() {
      const chatId = parseInt(document.getElementById('chatId').value);
      if (!socket || !chatId) return;
      
      socket.emit('unsubscribe:chat', { chatId });
      log(`📍 Отписка от чата #${chatId}`, 'info');
    }

    function startTyping() {
      const chatId = parseInt(document.getElementById('typingChatId').value);
      if (!socket || !chatId) return;
      
      socket.emit('typing:start', { chatId });
      log(`⌨️ Начали печатать в чате #${chatId}`, 'info');
    }

    function stopTyping() {
      const chatId = parseInt(document.getElementById('typingChatId').value);
      if (!socket || !chatId) return;
      
      socket.emit('typing:stop', { chatId });
      log(`⌨️ Прекратили печатать в чате #${chatId}`, 'info');
    }
  </script>
</body>
</html>
```

**Использование:**

1. Откройте `test-socket.html` в браузере
2. Получите JWT токен (через авторизацию или из devtools)
3. Вставьте токен и нажмите "Подключить"
4. Проверьте, что статус изменился на "🟢 Подключено"
5. Отправьте тестовое сообщение через API и проверьте, что пришло событие

---

## Тестирование через Node.js

Создайте файл `test-socket.js`:

```javascript
const io = require('socket.io-client');

// Замените на ваш токен
const TOKEN = 'YOUR_JWT_TOKEN_HERE';

console.log('🔌 Подключение к Socket.IO...');

const socket = io('http://localhost:3000', {
  auth: { token: TOKEN }
});

socket.on('connect', () => {
  console.log('✅ Подключено успешно');
  console.log('Socket ID:', socket.id);
  
  // Подписаться на чат
  socket.emit('subscribe:chat', { chatId: 1 });
  console.log('📍 Подписались на чат #1');
});

socket.on('disconnect', () => {
  console.log('❌ Отключено от сервера');
});

socket.on('error', (error) => {
  console.error('❌ Ошибка:', error);
});

socket.on('chat:new', (data) => {
  console.log('🆕 Новый чат:', data);
});

socket.on('message:new', (data) => {
  console.log('📩 Новое сообщение:', data);
});

socket.on('chat:updated', (data) => {
  console.log('♻️ Чат обновлён:', data);
});

socket.on('messages:read', (data) => {
  console.log('👁️ Сообщения прочитаны:', data);
});

socket.on('message:status', (data) => {
  console.log('📊 Статус сообщения:', data);
});

socket.on('chat:deleted', (data) => {
  console.log('🗑️ Чат удалён:', data);
});

socket.on('user:notification', (data) => {
  console.log('🔔 Уведомление:', data);
});

// Тест typing events через 5 секунд
setTimeout(() => {
  console.log('\n⌨️ Тестирование typing events...');
  socket.emit('typing:start', { chatId: 1 });
  console.log('Начали печатать в чате #1');
  
  setTimeout(() => {
    socket.emit('typing:stop', { chatId: 1 });
    console.log('Прекратили печатать в чате #1');
  }, 3000);
}, 5000);
```

**Запуск:**

```bash
npm install socket.io-client
node test-socket.js
```

---

## Сценарии тестирования

### Сценарий 1: Входящее сообщение от клиента

**Цель:** Проверить, что при получении сообщения от клиента приходит Socket.IO уведомление

**Шаги:**

1. Подключитесь к Socket.IO через `test-socket.html` или `test-socket.js`
2. Отправьте сообщение в WhatsApp/Telegram боту от клиента
3. Проверьте, что получили событие `message:new`

**Ожидаемый результат:**

```
📩 Новое сообщение: {
  id: 123,
  chatId: 45,
  content: "Привет!",
  fromMe: false,
  channel: "whatsapp",
  timestamp: "2025-12-14T12:00:00Z"
}
```

---

### Сценарий 2: Отправка сообщения оператором

**Цель:** Проверить, что при отправке сообщения оператором приходит Socket.IO уведомление

**Шаги:**

1. Подключитесь к Socket.IO
2. Отправьте сообщение через API:

```bash
curl -X POST http://localhost:3000/api/messages/send-by-chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 45,
    "text": "Здравствуйте! Чем могу помочь?",
    "type": "text"
  }'
```

3. Проверьте, что получили событие `message:new` с `fromMe: true`

**Ожидаемый результат:**

```
📩 Новое сообщение: {
  id: 124,
  chatId: 45,
  content: "Здравствуйте! Чем могу помочь?",
  fromMe: true,
  senderUserId: 1,
  channel: "whatsapp",
  timestamp: "2025-12-14T12:01:00Z"
}
```

---

### Сценарий 3: Создание нового чата

**Цель:** Проверить уведомление о новом чате

**Шаги:**

1. Подключитесь к Socket.IO
2. Отправьте сообщение от нового клиента (новый номер/ID)
3. Проверьте, что получили событие `chat:new`

**Ожидаемый результат:**

```
🆕 Новый чат: {
  id: 46,
  name: "John Doe",
  channel: "telegram",
  status: "new",
  priority: "normal",
  unreadCount: 1
}
```

---

### Сценарий 4: Подписка на чат

**Цель:** Проверить подписку на конкретный чат

**Шаги:**

1. Подключитесь к Socket.IO
2. Отправьте событие:

```javascript
socket.emit('subscribe:chat', { chatId: 45 });
```

3. Отправьте сообщение в этот чат
4. Проверьте, что получили уведомление

**Ожидаемый результат:** Получено событие `message:new` для чата #45

---

### Сценарий 5: Typing indicator

**Цель:** Проверить индикаторы печати

**Шаги:**

1. Откройте два браузера/клиента с одним JWT токеном
2. В первом отправьте:

```javascript
socket.emit('typing:start', { chatId: 45 });
```

3. Во втором проверьте, что пришло событие (если реализовано broadcast)
4. Отправьте `typing:stop`

**Примечание:** Текущая реализация не делает broadcast typing events, это можно добавить при необходимости.

---

## Проверка ошибок

### Ошибка аутентификации

**Тест:**

```javascript
const socket = io('http://localhost:3000', {
  auth: { token: 'invalid-token' }
});

socket.on('error', (error) => {
  console.log('Ожидаемая ошибка:', error);
  // Ожидается: "Authentication failed: Invalid token"
});
```

---

### Отсутствие токена

**Тест:**

```javascript
const socket = io('http://localhost:3000');

socket.on('error', (error) => {
  console.log('Ожидаемая ошибка:', error);
  // Ожидается: "Authentication failed: No token provided"
});
```

---

## Мониторинг в production

### Browser DevTools

1. Откройте DevTools → Network
2. Фильтр: WS (WebSocket)
3. Найдите `socket.io` соединение
4. Проверьте Messages для отладки событий

### Backend Logs

Проверяйте логи с префиксом `[Socket.IO]`:

```bash
tail -f logs/app.log | grep "Socket.IO"
```

**Ожидаемые логи:**

```
[Socket.IO] ✅ Сервис инициализирован
[Socket.IO] 🔌 Клиент подключён: A1B2C3D4
[Socket.IO] 👤 Пользователь userId=1, orgId=1
[Socket.IO] 📍 Присоединился к org_1
[Socket.IO] 📍 Присоединился к user_1
[Socket.IO] 📤 Отправка chat:new в org_1
[Socket.IO] 📤 Отправка message:new в org_1
```

---

## Нагрузочное тестирование

Для тестирования производительности используйте artillery:

```bash
npm install -g artillery
```

Создайте `socket-load-test.yml`:

```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 10
  engines:
    socketio:
      transports: ["websocket"]
scenarios:
  - engine: socketio
    flow:
      - emit:
          channel: "subscribe:chat"
          data:
            chatId: 1
      - think: 5
      - emit:
          channel: "typing:start"
          data:
            chatId: 1
      - think: 2
      - emit:
          channel: "typing:stop"
          data:
            chatId: 1
```

**Запуск:**

```bash
artillery run socket-load-test.yml
```

---

## Troubleshooting

### Проблема: Не приходят события

**Проверьте:**

1. Backend запущен и Socket.IO инициализирован
2. JWT токен валидный и не истёк
3. Клиент подключён (событие `connect` получено)
4. CORS настроен правильно
5. Логи backend на наличие ошибок

**Решение:**

```javascript
socket.on('connect', () => {
  console.log('✅ Подключено, Socket ID:', socket.id);
});

socket.on('connect_error', (error) => {
  console.error('❌ Ошибка подключения:', error.message);
});
```

---

### Проблема: События приходят с задержкой

**Причины:**

- Медленное интернет-соединение
- Backend под нагрузкой
- Fallback на long polling вместо WebSocket

**Проверка:**

```javascript
socket.on('connect', () => {
  console.log('Транспорт:', socket.io.engine.transport.name);
  // Должно быть: "websocket"
});
```

---

## Чек-лист перед production

- [ ] JWT токены с коротким TTL (1-24 часа)
- [ ] CORS настроен только для разрешённых доменов
- [ ] Socket.IO использует WSS (HTTPS) в production
- [ ] Rate limiting для событий от клиента
- [ ] Логирование всех Socket.IO событий
- [ ] Мониторинг количества подключений
- [ ] Redis Adapter для горизонтального масштабирования
- [ ] Документация для фронтенд команды
- [ ] Тесты покрывают все события

---

## Полезные ссылки

- [SOCKET_IO_DOCUMENTATION.md](./SOCKET_IO_DOCUMENTATION.md) - Полная документация API
- [SOCKET_IO_QUICK_START.md](./SOCKET_IO_QUICK_START.md) - Быстрый старт
- [SOCKET_IO_ARCHITECTURE.md](./SOCKET_IO_ARCHITECTURE.md) - Архитектура системы
- [Socket.IO Official Docs](https://socket.io/docs/v4/) - Официальная документация
