# Telegram AI-боты (сценарий: адрес → магазин → телефон → корзина → заказ)

AI-боты Telegram принимают заказы у клиентов без участия оператора:

```
/start ──► приветствие ──► адрес ──► геокодинг ──► ближайший магазин ──► телефон ──► корзина (AI) ──► подтверждение ──► BotOrder
                                                                                │
                                      кнопка «Поделиться номером» или текстом   │   «оператор» ──► живой оператор
```

- **Бот — «Гоша»**: живой продавец-консультант (реагирует на выбор, предлагает закуски, короткие ответы с эмодзи). Характер задаётся системным промтом, дополнить можно через `aiSystemPrompt` бота.
- **Телефон**: запрашивается после подтверждения магазина нативной Telegram-кнопкой «Поделиться номером» (один тап) или текстом (+7 705 123 45 67, 8705..., и т.п.). Можно ответить «позже» — тогда бот спросит при оформлении. Контактом можно поделиться в любой момент — бот запомнит. Телефон хранится в `BotDialog.phone` и попадает в `BotOrder.phone`, сводку заказа и уведомление операторам.
- Токены ботов хранятся в БД (`TelegramBot`), запуск — long-polling, как у обычных ботов поддержки.
- AI-режим включается **флагом `aiEnabled`** на конкретном боте — остальные боты работают как раньше.
- Вся переписка (входящие и ответы AI) сохраняется в `Chat`/`Message` — операторы видят её в существующем UI.
- Модель: `qwen2.5:7b` на Ollama-совместимом сервере `nssl.drawbridge.kz` (`/api/chat`, `format: "json"`).
- Заказ сохраняется в таблицу `BotOrder` (статус `new`) + уведомление операторов по Socket.IO (`bot_order_created`).

⚠️ Важно: боты подхватываются из БД **только при старте сервера** (`startAllTelegramBots()`). Бот, добавленный после деплоя, нужно запустить вручную: `POST /api/telegram/bots/:botId/start`.

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `AI_BOT_BASE_URL` | `https://nssl.drawbridge.kz` | Ollama-совместимый AI-сервер |
| `AI_BOT_API_KEY` | — | Bearer-токен AI-сервера (**обязательна**) |
| `AI_BOT_MODEL` | `qwen2.5:7b` | Модель по умолчанию |
| `NALIV_API_BASE_URL` | `https://njt25.naliv.kz` | Публичный API «Налив» (геокодер, магазины, товары) |
| `AI_BOT_HTTP_TIMEOUT_MS` | `60000` | Таймаут HTTP-запросов к AI/«Налив» |
| `AI_BOT_HTTP_RETRY_COUNT` | `2` | Ретраи для «Налив» (5xx/429/сеть) |

## Включение AI-бота

1. Создать бота у @BotFather, получить токен.
2. Зарегистрировать бота с AI-режимом:

```bash
curl -X POST https://bm.drawbridge.kz/api/telegram/organizations/1/bots \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "botToken": "123456:ABC-DEF...",
    "welcomeMessage": "👋 Привет! Я ассистент доставки. Напишите ваш адрес...",
    "aiEnabled": true,
    "aiModel": "qwen2.5:7b",
    "aiSystemPrompt": "необязательные доп. инструкции боту"
  }'
```

3. Запустить: `POST /api/telegram/bots/:botId/start` (или `autoStart`).
4. В Telegram написать боту `/start`.

Включение/отключение AI-режима на работающем боте: `PUT /api/telegram/bots/:botId` с `{"aiEnabled": true|false}` — перезапуск бота не требуется (флаг читается из БД на каждое сообщение).

## Сценарий диалога

| Состояние (`BotDialog.state`) | Что делает бот |
|---|---|
| `awaiting_address` | Просит адрес. Геокодит через `njt25.naliv.kz/api/addresses/search`. Несколько совпадений → нумерованный список. |
| `awaiting_store_confirm` | Показывает ближайший магазин (гаверсинус по `lat/lon` из `njt25.naliv.kz/api/businesses`). «да» → дальше, «нет» → выбор из 3 ближайших. |
| `awaiting_phone` | Просит телефон: кнопка «Поделиться номером» (request_contact) или текстом. «позже» → пропустить (спросит при оформлении). |
| `shopping` | Поиск товаров (`/api/items/search?name=...&business_id=...`), добавление в корзину, акции учитываются в цене. Команды: «корзина», «оформить», «оператор». |
| `confirming_order` | Сводка заказа (магазин, адрес, позиции, доставка, итого). «да» → `BotOrder` в БД, «нет» → назад в корзину. |

### Выбор товаров — инлайн-кнопками

Результаты поиска бот показывает **списком с инлайн-кнопками**: один тап = +1 штука в корзину (с учётом `quantity_step`). Выбор позиции кнопкой исключает путаницу «номер из списка = количество». Под списком и корзиной — кнопки:

| Кнопка | callback | Действие |
|---|---|---|
| `1. Corona Extra · 990 ₸` | `add:<item_id>` | Добавить 1 шт в корзину |
| `🛒 Корзина` | `cart` | Показать корзину |
| `✅ Оформить` | `checkout` | К оформлению (спросит телефон, если нет) |
| `✅ Да, оформляем` / `❌ Нет` | `confirm_order` / `cancel_order` | Подтверждение заказа |

### AI-протокол (состояние `shopping`)

Модель обязана отвечать строго JSON-объектом (Ollama `format: "json"` + системный промт):

```json
{"action": "search_items", "query": "хайнекен"}
{"action": "add_to_cart", "item_id": 31117, "qty": 2}
{"action": "remove_from_cart", "item_id": 31117}
{"action": "clear_cart"}
{"action": "show_cart"}
{"action": "checkout"}
{"action": "handoff"}
{"action": "reply", "reply_text": "Что-нибудь ещё?"}
```

Бэкенд исполняет действия. Список товаров после `search_items` рендерит **сам бэкенд** (кнопки), модель его не описывает. Товар для `add_to_cart` валидируется по кэшу результатов поиска (`BotDialog.lastSearchItems`, до 50 позиций) и остаткам на складе. Если модель ответила не-JSON — текст отправляется клиенту как есть (fallback).

### Переход на оператора

Ключевые слова («оператор», «менеджер», «живой человек», …) в **любом** состоянии:
- `BotDialog.handedOff = true` — AI больше не отвечает;
- чат получает `status: new`, `priority: high` + запись в `TicketHistory` — операторы видят его в очереди.

## API

| Метод и путь | Описание |
|---|---|
| `GET /api/telegram/ai/models` | Список моделей AI-сервера (`/api/tags`) |
| `GET /api/telegram/bots/:botId/orders?status=new&limit=50` | Заказы, собранные AI-ботом |
| `POST /api/telegram/organizations/:orgId/bots` | Создать бота (принимает `aiEnabled`, `aiModel`, `aiSystemPrompt`) |
| `PUT /api/telegram/bots/:botId` | Обновить бота (в т.ч. AI-поля) |

## Модель данных

- **`TelegramBot`**: `aiEnabled`, `aiModel` (переопределение модели для бота), `aiSystemPrompt` (кастомный промт).
- **`BotDialog`** (1:1 с `Chat`): состояние сценария, адрес (`addressLabel/Lat/Lon`), телефон (`phone`), магазин (`businessId/Name`), кандидаты для выбора, кэш поиска, корзина (`cart` JSON), `handedOff`.
- **`BotOrder`**: организация, чат, магазин, адрес, телефон клиента (`phone`), позиции (`items` JSON), `totalPrice`, `deliveryFee`, `status` (`new` → `sent` → `confirmed`/`cancelled`), `telegramChatId`.

## Отправка заказов наружу (TODO)

Сейчас заказ хранится в БД (`BotOrder.status = 'new'`) и операторы получают уведомление `bot_order_created` по Socket.IO. Когда будет известен целевой сервис «Налив» для передачи заказов — добавить форвардер: статус `new` → `sent` с ретраями.

## Структура кода

```
src/config/aiBotConfig.ts               — env-конфиг (AI + Naliv)
src/integrations/naliv/nalivClient.ts   — геокодинг, магазины, товары, haversine
src/integrations/naliv/types.ts         — типы Naliv API
src/services/aiChatClient.ts            — Ollama /api/chat, /api/tags
src/services/botDialogService.ts        — state machine сценария + корзина + AI-протокол
src/services/telegramService.ts         — маршрутизация aiEnabled, persist сообщений
prisma/migrations/20261016090000_telegram_ai_bots/
```

Тесты: `npx jest src/integrations/naliv src/services/__tests__/botDialogService.test.ts`
