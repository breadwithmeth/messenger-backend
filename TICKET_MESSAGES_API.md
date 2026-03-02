# Tickets API

## Обзор

Тикет в системе = чат (`Chat`) с заполненным `ticketNumber`.

### Жизненный цикл

- При первом сообщении клиента (WhatsApp/Telegram) автоматически создаётся чат и тикет со статусом `new`.
- Если клиент пишет снова в чат со статусом `closed` или `resolved`, тикет автоматически переоткрывается как новый:
  - генерируется новый `ticketNumber`
  - статус сбрасывается в `new`
  - назначение сотрудника сбрасывается

### Аутентификация

Все эндпоинты ниже требуют JWT (`Authorization: Bearer <token>`).

Базовый префикс: `/api/tickets`

---

## Статусы и приоритеты

### Статусы тикета

- `new`
- `open`
- `in_progress`
- `pending`
- `resolved`
- `closed`

### Приоритеты

- `low`
- `normal`
- `high`
- `urgent`

---

## Эндпоинты

### 1) Статистика тикетов

`GET /api/tickets/stats`

Ответ:

```json
{
  "total": 42,
  "byStatus": {
    "new": 10,
    "open": 20,
    "closed": 12
  },
  "byPriority": {
    "normal": 25,
    "high": 12,
    "urgent": 5
  }
}
```

---

### 2) Список тикетов

`GET /api/tickets`

Query params:

- `status`
- `priority`
- `assignedUserId`
- `category`
- `page` (default: `1`)
- `limit` (default: `20`)
- `sortBy` (default: `updatedAt`)
- `sortOrder` (`asc`/`desc`, default: `desc`)

Ответ:

```json
{
  "tickets": [],
  "pagination": {
    "total": 0,
    "page": 1,
    "limit": 20,
    "pages": 0
  }
}
```

---

### 3) Получить тикет по номеру

`GET /api/tickets/:ticketNumber`

Ответ: объект тикета + связанные данные (назначенный пользователь, клиент, сообщения).

---

### 4) Получить сообщения тикета

`GET /api/tickets/:ticketNumber/messages`

Ответ:

```json
{
  "messages": []
}
```

---

### 5) Назначить тикет сотруднику

`POST /api/tickets/:ticketNumber/assign`

Body:

```json
{
  "userId": 12
}
```

Ответ:

```json
{
  "success": true,
  "ticket": {},
  "history": {}
}
```

---

### 6) Изменить статус тикета

`POST /api/tickets/:ticketNumber/status`

Body:

```json
{
  "status": "in_progress",
  "reason": "optional"
}
```

`reason` используется в основном при `closed`.

---

### 7) Быстро закрыть тикет сотрудником

`POST /api/tickets/:ticketNumber/close`

Body (optional):

```json
{
  "reason": "Вопрос решён"
}
```

Что делает:

- ставит `status = closed`
- ставит `closedAt`
- сохраняет запись в `TicketHistory`

---

### 8) Изменить приоритет

`POST /api/tickets/:ticketNumber/priority`

Body:

```json
{
  "priority": "high"
}
```

---

### 9) Добавить тег

`POST /api/tickets/:ticketNumber/tags`

Body:

```json
{
  "tag": "sales"
}
```

---

### 10) Удалить тег

`DELETE /api/tickets/:ticketNumber/tags/:tag`

---

### 11) История изменений тикета

`GET /api/tickets/:ticketNumber/history`

Ответ:

```json
{
  "history": []
}
```

---

### 12) Внутренняя заметка

`POST /api/tickets/:ticketNumber/notes`

Body:

```json
{
  "note": "Позвонить клиенту после 18:00"
}
```

---

## Отправка сообщения в тикет

Для отправки исходящего сообщения по номеру тикета используется messages API:

`POST /api/messages/send-by-ticket`

Body:

```json
{
  "ticketNumber": "299",
  "text": "Здравствуйте!"
}
```

---

## Коды ошибок (типовые)

- `400` — невалидные параметры (`ticketNumber`, `status`, `priority`, и т.д.)
- `401` — нет/невалидный токен
- `404` — тикет или пользователь не найден
- `500` — внутренняя ошибка сервера

---

## Примечание по авто-открытию

Авто-логика работает на уровне входящих сообщений:

- WhatsApp: при обработке входящего сообщения в `ensureChat(...)`
- Telegram: при обработке входящего в `ensureTelegramChat(...)`

Если клиент пишет в уже закрытый/решённый тикет, оператор получает новый тикетный номер для новой сессии обработки.
