# Управление номерами телефонов организации (WhatsApp)

Этот раздел описывает API для управления номерами WhatsApp на уровне организации.

В проекте поддерживаются два типа подключений:

- **Baileys (Web WhatsApp)** — подключение через QR-код и поддержание Web-сессии.
- **WABA (WhatsApp Business API)** — работа через Meta WhatsApp Cloud API (вебхуки и отправка сообщений). Такие номера **не подключаются** через Baileys.

## Аутентификация

Все эндпоинты ниже требуют JWT.

- Заголовок: `Authorization: Bearer <token>`
- `organizationId` берётся из `authMiddleware` и доступен как `res.locals.organizationId`.

Базовый префикс: `/api/organization-phones`

## Модель `OrganizationPhone` (поля, которые возвращает список)

`GET /all` возвращает массив объектов со следующими полями:

- `id: number`
- `phoneJid: string` — WhatsApp JID, например `79001112233@s.whatsapp.net`
- `displayName: string | null`
- `status: string` — фактические значения зависят от lifecycle Baileys/WABA. В коде используются, как минимум:
  - `disconnected` — номер создан, сессии нет
  - `pending` — ожидается сканирование QR / процесс подключения
  - `connected` — сессия активна
  - `logged_out` — выполнен logout (сессия завершена)
- `qrCode: string | null` — строка QR (появляется при подключении Baileys)
- `lastConnectedAt: string | null` (ISO Date)
- `createdAt: string` (ISO Date)
- `updatedAt: string` (ISO Date)

Примечания:

- При успешном подключении QR-код очищается (`qrCode = null`).
- Поле `connectionType` (`baileys | waba`) хранится в БД, но в текущей реализации `GET /all` его **не возвращает** (выбираются только поля выше).

## API

### 1) Создать номер

`POST /api/organization-phones/`

Создаёт запись номера WhatsApp для текущей организации.

Body:

```json
{
  "phoneJid": "79001112233@s.whatsapp.net",
  "displayName": "Main WA"
}
```

Ответы:

- `201` — созданный объект `OrganizationPhone` (как в БД)
- `400` — не хватает `organizationId` / `phoneJid` / `displayName`
- `409` — номер с таким `phoneJid` уже существует для организации (логическая проверка)
- `500` — внутренняя ошибка

Примечание: после создания статус выставляется в `disconnected`.

---

### 2) Получить список номеров

`GET /api/organization-phones/all`

Ответы:

- `200` — массив:

```json
[
  {
    "id": 1,
    "phoneJid": "79001112233@s.whatsapp.net",
    "displayName": "Main WA",
    "status": "disconnected",
    "qrCode": null,
    "lastConnectedAt": null,
    "createdAt": "2026-02-28T10:00:00.000Z",
    "updatedAt": "2026-02-28T10:00:00.000Z"
  }
]
```

- `400` — если `organizationId` не определён в `res.locals`
- `500` — внутренняя ошибка

---

### 3) Инициировать подключение (Baileys) и получить QR

`POST /api/organization-phones/:organizationPhoneId/connect`

Запускает Baileys-сессию. QR-код сохраняется в БД и появляется в ответе `GET /all` (поле `qrCode`).

Ответы:

- `202` — подключение инициировано:

```json
{
  "message": "WhatsApp session connection initiated. Check the /api/organization-phones endpoint for QR code or status updates."
}
```

- `200` — если сессия уже активна/подключается (защита от дублей):

```json
{ "status": "connected", "message": "WhatsApp session already active or connecting." }
```

или

```json
{ "status": "connecting", "message": "WhatsApp session already active or connecting." }
```

- `400` — некорректные параметры, отсутствует `phoneJid`, или номер настроен как WABA:

```json
{
  "error": "This phone is configured for WABA and cannot be connected via Baileys.",
  "connectionType": "waba"
}
```

- `404` — номер не найден / не принадлежит организации
- `500` — внутренняя ошибка

#### Рекомендуемый flow получения QR (фронт)

1) Создать номер (`POST /`).
2) Запросить подключение (`POST /:id/connect`).
3) Поллить `GET /all` до тех пор, пока:
   - `status === "pending"` и `qrCode` заполнен → показать QR
   - после сканирования QR: `status === "connected"` и `qrCode === null`

---

### 4) Отключить номер (logout)

`DELETE /api/organization-phones/:organizationPhoneId/disconnect`

Поведение:

- Если Baileys-сокет существует — вызывается `logout()`. Статус затем обновляется обработчиком `connection.update` на `logged_out` и QR очищается.
- Если сокета нет — статус в БД принудительно выставляется в `disconnected` и QR очищается.

Ответы:

- `200`:

```json
{ "message": "WhatsApp session logout initiated." }
```

или

```json
{ "message": "WhatsApp session already disconnected or not active." }
```

- `400` — некорректные параметры
- `404` — номер не найден / не принадлежит организации
- `500` — внутренняя ошибка

## Важно про WABA

- Номера с `connectionType = "waba"` **не подключаются** через `POST /:id/connect`.
- WABA-номера могут **создаваться автоматически** при получении webhook (`/api/waba/webhook`) по `wabaPhoneNumberId`.
- Отправка/входящие сообщения WABA обслуживаются отдельными эндпоинтами `/api/waba/...` (см. документацию WABA/маршруты сервиса).
