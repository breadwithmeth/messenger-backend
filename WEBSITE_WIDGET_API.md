# API чата поддержки для сайта без `widget.js`

Эта инструкция описывает создание собственного интерфейса чата на сайте через REST API.
Готовый файл `/widget.js` не используется.

Для интерактивного чата браузеру всё равно нужен собственный frontend-код. Полностью
без JavaScript можно выполнять запросы только на серверной стороне сайта или через
обычные HTML-формы с перезагрузкой страницы.

## Параметры интеграции

Для работы нужны:

```text
API_URL=https://messenger.example.com
PUBLIC_KEY=wgt_xxxxxxxxxxxxxxxxxxxxxxxx
```

`PUBLIC_KEY` возвращается при создании виджета через `POST /api/website-widgets`.
Это публичное значение, его можно хранить во frontend-коде.

Все маршруты посетителя находятся по адресу:

```text
{API_URL}/api/widget/{PUBLIC_KEY}
```

## Сценарий работы

1. Получить конфигурацию виджета.
2. Восстановить `sessionId` и `token` из `localStorage`.
3. Если сессии нет, создать её.
4. Загрузить историю сообщений.
5. Отправлять сообщения через `POST`.
6. Получать ответы оператора периодическими запросами с `afterId`.

Одна сессия посетителя соответствует одному чату поддержки. Если удалить данные из
`localStorage`, при следующем обращении будет создан новый чат и новый тикет.

## 1. Получить настройки

```http
GET /api/widget/:publicKey/config
```

Пример:

```bash
curl https://messenger.example.com/api/widget/wgt_xxx/config
```

Ответ:

```json
{
  "widget": {
    "name": "Поддержка сайта",
    "welcomeMessage": "Здравствуйте! Чем можем помочь?",
    "primaryColor": "#2563eb"
  }
}
```

Возможная ошибка: `404`, если ключ не найден или виджет отключён.

## 2. Создать сессию посетителя

```http
POST /api/widget/:publicKey/sessions
Content-Type: application/json
```

Контактные данные необязательны:

```json
{
  "name": "Иван",
  "email": "ivan@example.com",
  "phone": "+77001234567"
}
```

Можно отправить пустой объект `{}`.

```bash
curl -X POST https://messenger.example.com/api/widget/wgt_xxx/sessions \
  -H "Content-Type: application/json" \
  -d '{"name":"Иван","email":"ivan@example.com"}'
```

Ответ `201 Created`:

```json
{
  "session": {
    "id": "3d66aa36-05d2-4aa6-a75a-f991bdd60b11",
    "token": "SESSION_TOKEN"
  }
}
```

Сохраните оба значения в браузере:

```js
localStorage.setItem('support_chat_session', JSON.stringify({
  id: response.session.id,
  token: response.session.token
}));
```

`token` возвращается только при создании сессии. Backend хранит его SHA-256 хеш и не
может вернуть исходный токен повторно.

Созданный чат получает канал `website`, статус `new`, приоритет `urgent` и отдельный
номер тикета.

### Передать или обновить данные пользователя позже

Если данные пользователя становятся известны после создания сессии, используйте:

```http
PATCH /api/widget/:publicKey/sessions/:sessionId/profile
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "name": "Иван Иванов",
  "email": "ivan@example.com",
  "phone": "+77001234567"
}
```

Пример:

```bash
curl -X PATCH https://messenger.example.com/api/widget/wgt_xxx/sessions/SESSION_ID/profile \
  -H "Authorization: Bearer SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Иван Иванов",
    "email": "ivan@example.com",
    "phone": "+77001234567"
  }'
```

Можно передать только изменившиеся поля. Чтобы очистить поле, передайте `null` или
пустую строку.

Ответ:

```json
{
  "profile": {
    "name": "Иван Иванов",
    "email": "ivan@example.com",
    "phone": "+77001234567"
  }
}
```

Endpoint обновляет данные сессии, название чата и связанную карточку клиента. Если
карточки клиента ещё нет, она будет создана с источником `website`.

После обновления данные доступны операторскому API:

```http
GET /api/chats?channel=website
Authorization: Bearer <operator-jwt>
```

Фрагмент ответа:

```json
{
  "id": 123,
  "channel": "website",
  "name": "Иван Иванов",
  "websiteVisitor": {
    "name": "Иван Иванов",
    "email": "ivan@example.com",
    "phone": "+77001234567",
    "lastSeenAt": "2026-06-15T09:00:00.000Z"
  }
}
```

## 3. Загрузить историю сообщений

```http
GET /api/widget/:publicKey/sessions/:sessionId/messages?limit=100
Authorization: Bearer <session-token>
```

```bash
curl https://messenger.example.com/api/widget/wgt_xxx/sessions/SESSION_ID/messages?limit=100 \
  -H "Authorization: Bearer SESSION_TOKEN"
```

Ответ:

```json
{
  "messages": [
    {
      "id": 451,
      "content": "Здравствуйте! Нужна помощь.",
      "type": "text",
      "mediaUrl": null,
      "filename": null,
      "fromMe": false,
      "timestamp": "2026-06-15T08:30:00.000Z",
      "status": "delivered",
      "senderUser": null
    },
    {
      "id": 452,
      "content": "Здравствуйте! Чем помочь?",
      "type": "text",
      "mediaUrl": null,
      "filename": null,
      "fromMe": true,
      "timestamp": "2026-06-15T08:30:10.000Z",
      "status": "sent",
      "senderUser": {
        "name": "Оператор"
      }
    }
  ]
}
```

Значение `fromMe` рассматривается со стороны системы поддержки:

- `false` — сообщение посетителя;
- `true` — ответ оператора.

Параметры:

| Параметр | Описание |
| --- | --- |
| `limit` | От 1 до 200, по умолчанию 100 |
| `afterId` | Вернуть сообщения с ID больше указанного |
| `after` | Вернуть сообщения после ISO-даты |

Для polling используйте `afterId`:

```http
GET /api/widget/:publicKey/sessions/:sessionId/messages?afterId=452
Authorization: Bearer <session-token>
```

## 4. Отправить сообщение

```http
POST /api/widget/:publicKey/sessions/:sessionId/messages
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "content": "Здравствуйте! Нужна помощь."
}
```

```bash
curl -X POST https://messenger.example.com/api/widget/wgt_xxx/sessions/SESSION_ID/messages \
  -H "Authorization: Bearer SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Здравствуйте! Нужна помощь."}'
```

Ответ `201 Created`:

```json
{
  "message": {
    "id": 453,
    "content": "Здравствуйте! Нужна помощь.",
    "type": "text",
    "fromMe": false,
    "timestamp": "2026-06-15T08:35:00.000Z",
    "status": "delivered"
  }
}
```

Ограничения:

- `content` обязателен;
- пустые сообщения не принимаются;
- максимальная длина — 5000 символов;
- поддерживается только тип `text`.

Если тикет был закрыт или решён, новое сообщение посетителя переоткроет чат, создаст
новый номер тикета и снова установит приоритет `urgent`.

## 5. Готовый REST-клиент

Клиент ниже создаёт или восстанавливает сессию, загружает историю, отправляет сообщения
и получает ответы polling-запросами раз в 4 секунды.

```js
const API_URL = 'https://messenger.example.com';
const PUBLIC_KEY = 'wgt_xxxxxxxxxxxxxxxxxxxxxxxx';
const STORAGE_KEY = `support_chat_${PUBLIC_KEY}`;

let session = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
let lastMessageId = null;
let pollingTimer = null;

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

async function getWidgetConfig() {
  return apiRequest(`/api/widget/${encodeURIComponent(PUBLIC_KEY)}/config`);
}

async function createSession(visitor = {}) {
  const result = await apiRequest(
    `/api/widget/${encodeURIComponent(PUBLIC_KEY)}/sessions`,
    {
      method: 'POST',
      body: JSON.stringify(visitor)
    }
  );

  session = result.session;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

async function ensureSession(visitor = {}) {
  if (session?.id && session?.token) return session;
  return createSession(visitor);
}

async function updateProfile(profile) {
  await ensureSession();

  const result = await apiRequest(
    `/api/widget/${encodeURIComponent(PUBLIC_KEY)}` +
    `/sessions/${encodeURIComponent(session.id)}/profile`,
    {
      method: 'PATCH',
      body: JSON.stringify(profile)
    }
  );

  return result.profile;
}

async function loadMessages() {
  await ensureSession();

  const query = lastMessageId === null
    ? '?limit=100'
    : `?afterId=${lastMessageId}`;

  try {
    const result = await apiRequest(
      `/api/widget/${encodeURIComponent(PUBLIC_KEY)}` +
      `/sessions/${encodeURIComponent(session.id)}/messages${query}`
    );

    for (const message of result.messages) {
      lastMessageId = Math.max(lastMessageId || 0, message.id);
      renderMessage(message);
    }
  } catch (error) {
    if (error.status === 401 || error.status === 404) {
      localStorage.removeItem(STORAGE_KEY);
      session = null;
      lastMessageId = null;
      await createSession();
      return loadMessages();
    }
    throw error;
  }
}

async function sendMessage(content) {
  await ensureSession();

  const result = await apiRequest(
    `/api/widget/${encodeURIComponent(PUBLIC_KEY)}` +
    `/sessions/${encodeURIComponent(session.id)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ content })
    }
  );

  lastMessageId = Math.max(lastMessageId || 0, result.message.id);
  renderMessage(result.message);
  return result.message;
}

function renderMessage(message) {
  const item = document.createElement('div');
  item.className = message.fromMe ? 'operator-message' : 'visitor-message';
  item.textContent = message.content;
  document.querySelector('#messages').appendChild(item);
}

function startPolling() {
  if (pollingTimer) return;

  pollingTimer = setInterval(() => {
    loadMessages().catch(console.error);
  }, 4000);
}

async function startSupportChat() {
  const config = await getWidgetConfig();
  document.querySelector('#chat-title').textContent = config.widget.name;

  await ensureSession({
    name: 'Иван',
    email: 'ivan@example.com'
  });
  await loadMessages();
  startPolling();
}

document.querySelector('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const input = document.querySelector('#chat-input');
  const content = input.value.trim();
  if (!content) return;

  input.disabled = true;

  try {
    await sendMessage(content);
    input.value = '';
  } finally {
    input.disabled = false;
    input.focus();
  }
});

startSupportChat().catch(console.error);
```

Минимальная HTML-разметка:

```html
<section id="support-chat">
  <h2 id="chat-title">Поддержка</h2>
  <div id="messages"></div>

  <form id="chat-form">
    <input
      id="chat-input"
      type="text"
      maxlength="5000"
      placeholder="Введите сообщение"
      required
    >
    <button type="submit">Отправить</button>
  </form>
</section>
```

## 6. Получение ответов без polling

REST API не отправляет события самостоятельно. Для моментальных ответов можно отдельно
подключить Socket.IO namespace `/widget`:

```js
const socket = io(`${API_URL}/widget`, {
  transports: ['websocket', 'polling'],
  auth: {
    publicKey: PUBLIC_KEY,
    sessionId: session.id,
    token: session.token
  }
});

socket.on('message:new', (message) => {
  lastMessageId = Math.max(lastMessageId || 0, message.id);
  renderMessage(message);
});
```

Если нужно полностью обойтись без дополнительных JS-библиотек, используйте polling.

## 7. CORS и авторизация

- Публичное API виджета доступно с любого origin.
- Для получения и отправки сообщений нужен session token.
- Токен передаётся в заголовке `Authorization: Bearer ...`.
- JWT сотрудника для запросов посетителя не нужен.
- Не размещайте session token в HTML, URL или серверных логах.

## 8. Лимиты

| Операция | Лимит |
| --- | --- |
| Создание сессии | 120 запросов в минуту на IP и `publicKey` |
| Получение сообщений | 120 запросов в минуту на IP и сессию |
| Отправка сообщения | 30 запросов в минуту на IP и сессию |
| Обновление профиля | 30 запросов в минуту на IP и сессию |

При ответе `429 Too Many Requests` учитывайте заголовок `Retry-After`.

## 9. Формат ошибок

```json
{
  "error": "Описание ошибки"
}
```

| HTTP | Значение |
| --- | --- |
| `201` | Сессия или сообщение успешно созданы |
| `400` | Ошибка входных параметров |
| `401` | Session token отсутствует или недействителен |
| `404` | Виджет не найден или отключён |
| `429` | Превышен rate limit |
| `500` | Внутренняя ошибка backend |

## 10. Важные замечания

- Не создавайте новую сессию при каждом открытии окна чата. Сначала проверяйте
  `localStorage`.
- Храните `sessionId` и `token` вместе.
- После `401` удалите локальную сессию и создайте новую.
- После ротации `publicKey` старые URL публичного API перестают работать. Нужно заменить
  ключ и создать новую сессию.
- Для polling используйте числовой `afterId`, а не только timestamp.
