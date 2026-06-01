# Рассылка по шаблону через API

Документ описывает массовую отправку **WhatsApp шаблона** через WABA endpoint в этом проекте.

## Endpoint

`POST /api/waba/broadcast-template`

- Требует авторизацию (`authMiddleware`)
- Заголовок: `Authorization: Bearer <JWT_TOKEN>`
- Контент: `application/json`

## Назначение

Endpoint отправляет один шаблон сразу в список номеров (`recipients`) и сохраняет исходящие сообщения в БД.

## Тело запроса

```json
{
  "organizationPhoneId": 1,
  "recipients": ["+7 (701) 111-22-33", "77021234567"],
  "templateName": "promo_offer_v1",
  "language": "ru",
  "components": [
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Иван" },
        { "type": "text", "text": "20%" }
      ]
    }
  ],
  "delayMs": 250,
  "dryRun": false
}
```

## Поля

- `organizationPhoneId` (number, обязательно): ID WhatsApp-номера организации с `connectionType = "waba"`.
- `recipients` (array, обязательно): массив телефонов получателей.
- `templateName` (string, обязательно): имя одобренного шаблона в Meta.
- `language` (string, опционально, default: `"ru"`): язык шаблона.
- `components` (array, опционально): параметры шаблона. По умолчанию отправляется `[{"type":"body","parameters":[]}]`.
- `delayMs` (number, опционально, default: `250`): задержка между отправками в миллисекундах.
- `dryRun` (boolean, опционально, default: `false`): если `true`, реальная отправка в WABA не выполняется (проверка списка и формата).

## Нормализация номеров

Перед отправкой каждый номер нормализуется: из строки удаляются все символы кроме цифр.

Примеры:

- `"+7 (701) 111-22-33"` → `"77011112233"`
- `"7-702-123-45-67"` → `"77021234567"`

Если после нормализации не осталось валидных номеров, вернется ошибка `400`.

## Пример: dry run

```bash
curl -X POST "http://localhost:3000/api/waba/broadcast-template" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "recipients": ["+77011112233", "+77021234567"],
    "templateName": "promo_offer_v1",
    "language": "ru",
    "components": [{"type":"body","parameters":[]}],
    "delayMs": 100,
    "dryRun": true
  }'
```

## Пример: реальная отправка

```bash
curl -X POST "http://localhost:3000/api/waba/broadcast-template" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "recipients": ["77011112233", "77021234567"],
    "templateName": "promo_offer_v1",
    "language": "ru",
    "components": [
      {
        "type": "body",
        "parameters": [
          {"type":"text","text":"Иван"},
          {"type":"text","text":"20%"}
        ]
      }
    ],
    "delayMs": 250,
    "dryRun": false
  }'
```

## Успешный ответ

```json
{
  "success": true,
  "dryRun": false,
  "organizationPhoneId": 1,
  "templateName": "promo_offer_v1",
  "language": "ru",
  "totals": {
    "requested": 2,
    "normalized": 2,
    "success": 2,
    "fail": 0
  },
  "results": [
    { "to": "77011112233", "success": true, "messageId": "wamid.HBg..." },
    { "to": "77021234567", "success": true, "messageId": "wamid.HBg..." }
  ]
}
```

## Частые ошибки

- `400`: `organizationPhoneId, recipients[] and templateName are required`
- `400`: `No valid recipients after phone normalization`
- `404`: `Organization phone not found or not configured for WABA`
- `500`: `WABA service not configured` (обычно не задан `wabaAccessToken` у номера)

## Получение информации по шаблонам

`GET /api/waba/templates`

- Требует авторизацию (`authMiddleware`)
- Обязательный query-параметр: `organizationPhoneId`
- Работает только для номера с `connectionType = "waba"` внутри вашей организации

### Query параметры

- `organizationPhoneId` (number, обязательно)
- `limit` (number, опционально, default: `50`)
- `after` (string, опционально): курсор следующей страницы
- `name` (string, опционально): фильтр по имени шаблона
- `language` (string, опционально): фильтр по языку (`ru`, `en_US` и т.д.)
- `status` (string, опционально): фильтр по статусу (`APPROVED`, `PENDING`, `REJECTED` и т.д.)
- `category` (string, опционально): фильтр по категории (`MARKETING`, `UTILITY`, `AUTHENTICATION`)

### Пример запроса

```bash
curl -X GET "http://localhost:3000/api/waba/templates?organizationPhoneId=1&limit=20&status=APPROVED" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### Пример ответа

```json
{
  "organizationPhoneId": 1,
  "data": [
    {
      "id": "1234567890",
      "name": "promo_offer_v1",
      "language": "ru",
      "status": "APPROVED",
      "category": "MARKETING",
      "components": []
    }
  ],
  "paging": {
    "cursors": {
      "before": "QVFI...",
      "after": "QVFI..."
    }
  },
  "raw": {
    "data": []
  }
}
```

## Полезно перед рассылкой

1. Проверить доступные шаблоны: `GET /api/waba/templates`
2. Сначала запускать с `dryRun: true`
3. После dry-run отправлять с реальными `components`
4. Для больших списков увеличивать `delayMs` (чтобы снизить риск лимитов у Meta)
