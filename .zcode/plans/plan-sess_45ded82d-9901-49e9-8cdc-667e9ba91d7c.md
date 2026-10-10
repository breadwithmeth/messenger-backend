# WhatsApp Flow: сбор Имени, Города, Адреса, Типа оплаты

Проект уже имеет WABA-интеграцию (`src/services/wabaService.ts`, `src/controllers/wabaController.ts` с вебхуками), но поддержки Flows нет. Добавляем: создание Flow через Graph API, отправку формы клиенту, приём и сохранение ответов.

## 1. Prisma-схема (`prisma/schema.prisma`)
- `OrganizationPhone` — новое поле `wabaFlowId String?` (flow_id формы организации).
- Новая модель `FlowSubmission`: `id, organizationId, organizationPhoneId?, chatId, flowId?, flowToken?, remoteJid?, name?, city?, address?, paymentType?, rawData Json, whatsappMessageId?, createdAt` + индексы.
- Миграция: `npx prisma migrate dev --name add_whatsapp_flow`.

## 2. Новый сервис `src/services/whatsappFlowService.ts`
- **`COLLECTION_FLOW_JSON`** — Flow JSON (version 7.0), один экран `COLLECT_DATA` (SingleColumnLayout + Form):
  - `TextInput` name=`NameInput` — «Имя» (required)
  - `TextInput` name=`CityInput` — «Город» (required)
  - `TextInput` name=`AddressInput` — «Адрес» (required)
  - `RadioButtons` name=`PaymentType` — «Тип оплаты» с опциями id `cash|Наличные`, `halyk|Халык`, `kaspi|Каспи` (required)
  - `Footer` «Отправить» с `complete`
- **Graph API функции** (используют `getWABAConfig` из `wabaService.ts`):
  - `createFlow()` — `POST /{wabaId}/flows?name=...&categories=["other"]`
  - `uploadFlowJson()` — `POST /{flowId}/assets` (multipart, type=FLOW_JSON; axios 1.15 поддерживает нативный FormData — новых зависимостей не нужно)
  - `publishFlow()` — `POST /{flowId}/publish`
  - `getFlowStatus()` — `GET /{flowId}?fields=id,name,status,json_errors,validation_errors`
- **`parseFlowResponse(responseJson)`** — парсит `nfm_reply.response_json`: маппинг `screen_0_NameInput_0 → name`, `CityInput → city`, `AddressInput → address`, `PaymentType → paymentType` (устойчиво к смещению индексов, поиск по подстроке), извлекает `flow_token`, возвращает поля + человекочитаемый текст «Имя: …\nГород: …\nАдрес: …\nТип оплаты: Наличные/Халык/Каспи» (id опции → русский лейбл).

## 3. `WABAService` (`wabaService.ts`) — метод `sendFlowMessage()`
Собирает interactive-пейлоад `type: 'flow'` (`flow_message_version: '3'`, `flow_token`, `flow_id`, `flow_cta: 'Заполнить форму'`, `flow_action: 'navigate'`, `flow_action_payload: { screen: 'COLLECT_DATA', mode: 'published'|'draft' }`) с header/body/footer-текстами и отправляет через существующий `sendMessage({ type: 'interactive' })`.

## 4. Контроллер (`wabaController.ts`) — новые handlers
- **`createCollectionFlow`** — `POST /api/waba/flow/create`: body `{ organizationPhoneId, name?, publish? = true }`. Создаёт Flow в Meta, загружает JSON формы, публикует, сохраняет `wabaFlowId` в OrganizationPhone. Возвращает flowId, статус и ошибки валидации Meta (если есть).
- **`sendFlow`** — `POST /api/waba/flow/send`: body `{ organizationPhoneId, to, flowId?, mode? = 'published' }`. Проверка доступа к чату как в `sendMessage` (`canAccessExistingWabaChat`); flowId из body или `orgPhone.wabaFlowId` (иначе 400 с подсказкой вызвать `/flow/create`). Генерирует `flow_token`, отправляет форму, сохраняет Message (`fromMe`, тип `interactive_flow`, контент «📋 Форма: Имя, Город, Адрес, Тип оплаты») — по аналогии с существующим `sendMessage`.
- **`getFlowInfo`** — `GET /api/waba/flow?organizationPhoneId=` — сохранённый flowId + статус/ошибки из Meta.
- **`getFlowSubmissions`** — `GET /api/waba/flow/submissions?organizationPhoneId=&chatId=&limit=` — список заявок (scoped по `res.locals.organizationId`).
- **Вебхук** — в `handleIncomingMessage` (сейчас обрабатывает только `button_reply`/`list_reply`, ветка на строке ~919) добавить `message.interactive.type === 'nfm_reply'`:
  - тип сообщения `flow_response`, контент — человекочитаемый текст из `parseFlowResponse`
  - после сохранения Message — запись в `FlowSubmission` (rawData + поля + flow_token; flowId из `orgPhone.wabaFlowId`)
  - сокет-уведомление `notifyNewMessage` сработает автоматически в общем коде.

## 5. Роуты (`src/routes/wabaRoutes.ts`)
```
POST /api/waba/flow/create      (authMiddleware)
POST /api/waba/flow/send        (authMiddleware)
GET  /api/waba/flow             (authMiddleware)
GET  /api/waba/flow/submissions (authMiddleware)
```

## 6. Проверка
- `npx prisma migrate dev --name add_whatsapp_flow`
- `npx tsc --noEmit` — типы без ошибок.

## Использование
1. `POST /api/waba/flow/create { organizationPhoneId }` — создаёт и публикует форму в Meta, сохраняет flow_id.
2. `POST /api/waba/flow/send { organizationPhoneId, to: '7701...' }` — клиент получает форму.
3. Клиент заполняет → вебхук `nfm_reply` → в чате сообщение с Именем/Городом/Адресом/Типом оплаты + запись в `FlowSubmission`.
4. `GET /api/waba/flow/submissions` — список заявок.

**Нюансы:** токен WABA должен иметь права `whatsapp_business_management` + `whatsapp_business_messaging`; для теста черновика — `mode: 'draft'` (работает только на тест-номерах Meta); если Flow API потребует принять Terms of Service в Business Manager — ошибка придёт в ответе `/flow/create` с текстом от Meta.