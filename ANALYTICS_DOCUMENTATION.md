# Analytics API Documentation

## Общее

В проекте доступна аналитика по чатам через API.

- Базовый префикс: `/api/analytics`
- Авторизация: требуется (используется `authMiddleware`)
- Формат: JSON

Аналитика работает по данным из БД (таблицы `Chat` и `Message`).

---

## 1) Аналитика по чатам (summary)

**Endpoint**

`GET /api/analytics/chats`

**Назначение**

Возвращает сводные метрики по чатам и сообщениям за период + SLA и «тикетизацию» чатов по неактивности.

---

## Query параметры

Все параметры опциональные.

### Период

- `from` — начало периода (ISO-строка даты), пример: `2026-02-01` или `2026-02-01T00:00:00.000Z`
- `to` — конец периода (ISO-строка даты)

Поведение по умолчанию:
- если `from` не задан — берётся последние 7 дней
- если `to` не задан — берётся текущее время

Ограничение:
- если `from > to` — вернётся `400`

### Фильтры

- `channel` — канал чатов: `whatsapp` или `telegram`
- `organizationPhoneId` — фильтр по WhatsApp-аккаунту организации (число)
- `assignedUserId` — фильтр по назначенному оператору (число)

### Тикетизация чатов по неактивности

- `idleMinutes` — порог неактивности, после которого диалог считается завершённым и следующий входящий/исходящий блок считается «новым тикетом».

По умолчанию: `120` минут (2 часа).

Ограничения:
- min: 5 минут
- max: 1440 минут (24 часа)

---

## Формат ответа

Ответ содержит следующие секции:

### `range`

Диапазон дат фактически применённый сервером.

```json
{
  "range": {
    "from": "2026-02-01T00:00:00.000Z",
    "to": "2026-02-11T10:00:00.000Z"
  }
}
```

### `filters`

Фактически применённые фильтры.

```json
{
  "filters": {
    "channel": "whatsapp",
    "organizationPhoneId": 123,
    "assignedUserId": 45
  }
}
```

### `chats`

- `created` — сколько чатов создано в периоде
- `active` — сколько чатов имели сообщения в периоде
- `byStatus` — распределение чатов по статусам (`new/open/in_progress/closed/...`) 
- `byChannel` — распределение чатов по каналам

```json
{
  "chats": {
    "created": 120,
    "active": 310,
    "byStatus": {
      "new": 5,
      "open": 100,
      "closed": 15
    },
    "byChannel": {
      "whatsapp": 110,
      "telegram": 10
    }
  }
}
```

### `messages`

Количество сообщений в периоде:
- `total`
- `inbound` — входящие (`fromMe=false`)
- `outbound` — исходящие (`fromMe=true`)

```json
{
  "messages": {
    "total": 4500,
    "inbound": 2600,
    "outbound": 1900
  }
}
```

### `sla`

SLA по чатам (классический view):

- `firstResponseSeconds` — время до первого ответа оператора после первого входящего
- `resolutionSeconds` — время до `resolvedAt/closedAt` относительно первого входящего

Формат:

```json
{
  "sla": {
    "firstResponseSeconds": {
      "chatsWithResponse": 80,
      "avg": 95.4,
      "p50": 60
    },
    "resolutionSeconds": {
      "chatsClosed": 50,
      "avg": 3600,
      "p50": 2400
    }
  }
}
```

Важно:
- «Ответ оператора» сейчас определяется как сообщение, у которого `senderUserId != null`.

### `tickets`

Это ключевая часть «как будто тикеты».

Логика:
- берётся таймлайн сообщений в рамках `chatId`
- если gap между соседними сообщениями больше `idleMinutes` — начинается новый «тикет» (сессия)
- в рамках ответа вычисляются сводные метрики по таким тикет-сессиям

Поля:
- `idleMinutes` — применённый порог
- `started` — сколько тикетов началось в периоде (по времени старта сессии)
- `active` — сколько тикетов имели сообщения в периоде
- `openAtEnd` — сколько тикетов «открыто» на момент `to` (последнее сообщение было не более чем `idleMinutes` назад)
- `closedByIdleAtEnd` — сколько тикетов «закрыто» на момент `to` по правилу неактивности
- `withInbound` — тикеты, где было хотя бы одно входящее в пределах тикета
- `withResponse` — тикеты с ответом оператора (см. правило `senderUserId != null`)
- `firstResponseSeconds.avg/p50` — SLA первого ответа по тикетам

Пример:

```json
{
  "tickets": {
    "idleMinutes": 120,
    "started": 210,
    "active": 260,
    "openAtEnd": 40,
    "closedByIdleAtEnd": 220,
    "withInbound": 200,
    "withResponse": 150,
    "firstResponseSeconds": {
      "avg": 110.2,
      "p50": 75
    }
  }
}
```

---

## Примеры запросов

### 1) Быстрый обзор за 7 дней

`GET /api/analytics/chats`

### 2) WhatsApp за период

`GET /api/analytics/chats?channel=whatsapp&from=2026-02-01&to=2026-02-11`

### 3) «Тикеты» с порогом 2 часа (явно)

`GET /api/analytics/chats?idleMinutes=120&from=2026-02-01&to=2026-02-11`

### 4) «Тикеты» с порогом 30 минут

`GET /api/analytics/chats?idleMinutes=30&from=2026-02-01&to=2026-02-11`

### 5) По конкретному WhatsApp-аккаунту организации

`GET /api/analytics/chats?organizationPhoneId=123&from=2026-02-01&to=2026-02-11`

### 6) По конкретному оператору

`GET /api/analytics/chats?assignedUserId=45&from=2026-02-01&to=2026-02-11`

---

## Примечания по производительности

- Метрика `tickets` использует SQL с оконными функциями по сообщениям (PostgreSQL). На больших объёмах данных важно иметь индексы по `Message(chatId, timestamp)` (в Prisma уже задан индекс `@@index([chatId, timestamp])`).
- Если период большой (месяцы) и сообщений очень много, рекомендуемо ограничивать диапазон `from/to` или добавить агрегацию/кэширование.

---

## 2) Аналитика по операторам (summary)

**Endpoint**

`GET /api/analytics/operators`

**Назначение**

Возвращает метрики по операторам за период (сообщения, активные/затронутые чаты, SLA первого ответа по «тикетам»).

### Query параметры

Все параметры опциональные.

- `from` — начало периода (ISO-строка даты)
- `to` — конец периода (ISO-строка даты)
- `channel` — `whatsapp` или `telegram`
- `organizationPhoneId` — фильтр по WhatsApp-аккаунту организации (число)
- `operatorId` — вернуть данные только по одному оператору (число)
- `idleMinutes` — порог для «тикетизации» (как в `/api/analytics/chats`), по умолчанию `120`

### Формат ответа

```json
{
  "range": {
    "from": "2026-02-01T00:00:00.000Z",
    "to": "2026-02-11T10:00:00.000Z"
  },
  "filters": {
    "channel": "whatsapp",
    "organizationPhoneId": 123,
    "operatorId": null
  },
  "operators": [
    {
      "id": 45,
      "email": "operator@company.com",
      "name": "Иван",
      "role": "operator",
      "messages": {
        "outbound": 190
      },
      "chats": {
        "touched": 60,
        "assignedActive": 40
      },
      "tickets": {
        "idleMinutes": 120,
        "answered": 35,
        "firstResponseSeconds": {
          "avg": 110.2,
          "p50": 75
        }
      }
    }
  ]
}
```

**Пояснения к метрикам**

- `messages.outbound` — количество исходящих сообщений, где `senderUserId = operator.id`.
- `chats.touched` — количество уникальных чатов, где оператор отправлял сообщения в период.
- `chats.assignedActive` — количество уникальных чатов, назначенных на оператора (`Chat.assignedUserId`) и имевших сообщения в период.
- `tickets.answered` — количество «тикетов»-сессий, где оператор был первым ответившим после первого входящего (в пределах сессии).
- `tickets.firstResponseSeconds` — SLA первого ответа в секундах по таким тикетам.

### Примеры запросов

- `GET /api/analytics/operators`
- `GET /api/analytics/operators?from=2026-02-01&to=2026-02-11&channel=whatsapp`
- `GET /api/analytics/operators?operatorId=45&from=2026-02-01&to=2026-02-11`

---

## 3) Список «тикетов» по активности (ticket sessions)

**Endpoint**

`GET /api/analytics/tickets`

**Назначение**

Формирует список «тикетов»-сессий на основе активности сообщений в чатах:
- берётся таймлайн сообщений по `chatId`
- если gap между соседними сообщениями > `idleMinutes` — начинается новая сессия (`sessionNo`)
- в выдачу попадают сессии, у которых были сообщения в периоде (`from..to`)

### Query параметры

Все параметры опциональные.

- `from`, `to` — период (как в `/api/analytics/chats`)
- `channel` — `whatsapp` или `telegram`
- `organizationPhoneId` — фильтр по WhatsApp-аккаунту организации
- `assignedUserId` — фильтр по назначенному оператору (`Chat.assignedUserId`)
- `idleMinutes` — порог неактивности (по умолчанию `120`)
- `state` — фильтр по состоянию на момент `to`: `open` или `closed`

### Пагинация

- `limit` — количество элементов (по умолчанию `50`, максимум `200`)
- `offset` — смещение (по умолчанию `0`)

### Формат ответа

```json
{
  "range": {
    "from": "2026-02-01T00:00:00.000Z",
    "to": "2026-02-11T10:00:00.000Z"
  },
  "filters": {
    "channel": "whatsapp",
    "organizationPhoneId": 123,
    "assignedUserId": 45,
    "state": "open"
  },
  "tickets": [
    {
      "id": "1001:3",
      "chatId": 1001,
      "sessionNo": 3,
      "startedAt": "2026-02-10T12:00:00.000Z",
      "lastAt": "2026-02-10T12:45:00.000Z",
      "isOpenAtEnd": true,
      "channel": "whatsapp",
      "organizationPhoneId": 123,
      "assignedUserId": 45,
      "chatStatus": "open",
      "firstInboundAt": "2026-02-10T12:00:00.000Z",
      "firstReplyAt": "2026-02-10T12:02:00.000Z",
      "firstReplyUserId": 45,
      "firstResponseSeconds": 120
    }
  ],
  "pagination": {
    "total": 250,
    "limit": 50,
    "offset": 0
  }
}
```

### Примеры запросов

- `GET /api/analytics/tickets`
- `GET /api/analytics/tickets?from=2026-02-01&to=2026-02-11&idleMinutes=120`
- `GET /api/analytics/tickets?channel=telegram&from=2026-02-01&to=2026-02-11&limit=100&offset=0`
- `GET /api/analytics/tickets?state=open&from=2026-02-01&to=2026-02-11`

---

## Roadmap (если потребуется)

Если нужно отображать «тикеты» как список элементов (для UI), можно добавить отдельный endpoint с пагинацией:
- список тикет-сессий (chatId + sessionNo + startedAt/lastAt + status open/closed)
- сортировка и фильтры
