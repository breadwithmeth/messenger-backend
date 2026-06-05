# WhatsApp Business API (WABA) Integration

Интеграция официального WhatsApp Business API в систему messenger-backend.

## Возможности

- ✅ Получение входящих сообщений через webhook
- ✅ Отправка текстовых сообщений
- ✅ Отправка шаблонных сообщений (templates)
- ✅ Отправка интерактивных сообщений с кнопками
- ✅ Отправка медиафайлов (изображения, документы, видео, аудио)
- ✅ Отслеживание статусов доставки (sent, delivered, read)
- ✅ Поддержка нескольких номеров в одной организации
- ✅ Параллельная работа с Baileys (неофициальный API)

## Архитектура

### База данных

В модель `OrganizationPhone` добавлены поля для WABA:

```prisma
model OrganizationPhone {
  // ... существующие поля
  
  // Тип подключения
  connectionType    String  @default("baileys") // "baileys" | "waba"
  
  // WABA конфигурация
  wabaAccessToken   String? // Access Token от Meta
  wabaPhoneNumberId String? // Phone Number ID
  wabaId            String? // WhatsApp Business Account ID
  wabaApiVersion    String? @default("v21.0") // Версия API
  wabaVerifyToken   String? // Token для webhook verification
}
```

### Сервисы

**`src/services/wabaService.ts`** - основной сервис для работы с WABA API:
- `WABAService` класс с методами отправки сообщений
- `createWABAService()` - фабрика для создания экземпляра сервиса
- `getWABAConfig()` - получение конфигурации из БД

**`src/controllers/wabaController.ts`** - контроллеры для обработки webhook и API:
- `verifyWebhook()` - верификация webhook от Meta
- `handleWebhook()` - обработка входящих событий
- `sendMessage()` - отправка сообщений через API
- `getTemplates()` - получение списка шаблонов

## Настройка

### 1. Регистрация в Meta for Developers

1. Перейдите на https://developers.facebook.com/
2. Создайте новое приложение (App)
3. Добавьте продукт WhatsApp Business Platform
4. Получите:
   - **App ID** и **App Secret**
   - **System User Access Token** (долгосрочный)
   - **WhatsApp Business Account ID (WABA ID)**
   - **Phone Number ID**

### 2. Конфигурация в БД

Обновите запись `OrganizationPhone`:

```sql
UPDATE "OrganizationPhone"
SET 
  "connectionType" = 'waba',
  "wabaAccessToken" = 'YOUR_ACCESS_TOKEN',
  "wabaPhoneNumberId" = 'YOUR_PHONE_NUMBER_ID',
  "wabaId" = 'YOUR_WABA_ID',
  "wabaApiVersion" = 'v21.0',
  "wabaVerifyToken" = 'your_custom_verify_token_12345'
WHERE id = 1;
```

### 3. Настройка Webhook

1. В Meta App Dashboard перейдите в WhatsApp → Configuration
2. Укажите Webhook URL: `https://your-domain.com/api/waba/webhook`
3. Укажите Verify Token (такой же, как `wabaVerifyToken` в БД)
4. Подпишитесь на события:
   - `messages` - входящие сообщения
   - `message_status` - статусы доставки

### 4. Переменные окружения

Добавьте в `.env`:

```env
# WABA Configuration
WABA_VERIFY_TOKEN=your_custom_verify_token_12345
```

> Примечание: `WABA_VERIFY_TOKEN` остаётся доступным как глобальный резервный вариант, но предпочтительно сохранять `wabaVerifyToken` в таблице `OrganizationPhone` для каждого номера WABA отдельно.

## API Endpoints

### Webhook (для Meta)

**Верификация webhook**
```
GET /api/waba/webhook
Query params:
  - hub.mode=subscribe
  - hub.verify_token=your_verify_token
  - hub.challenge=random_string
```

**Получение событий**
```
POST /api/waba/webhook
Body: webhook payload от Meta
```

### Отправка сообщений

**Текстовое сообщение**
```http
POST /api/waba/send
Authorization: Bearer <token>
Content-Type: application/json

{
  "organizationPhoneId": 1,
  "to": "79001234567",
  "type": "text",
  "message": "Здравствуйте! Ваш заказ готов."
}
```

**Шаблонное сообщение**
```http
POST /api/waba/send
Authorization: Bearer <token>
Content-Type: application/json

{
  "organizationPhoneId": 1,
  "to": "79001234567",
  "type": "template",
  "message": {
    "name": "order_confirmation",
    "language": "ru",
    "components": [
      {
        "type": "body",
        "parameters": [
          {"type": "text", "text": "12345"}
        ]
      }
    ]
  }
}
```

**Получение шаблонов**
```http
GET /api/waba/templates?organizationPhoneId=1
Authorization: Bearer <token>
```

## Использование в коде

### Отправка текстового сообщения

```typescript
import { createWABAService } from './services/wabaService';

const wabaService = await createWABAService(organizationPhoneId);
if (wabaService) {
  const result = await wabaService.sendTextMessage(
    '79001234567',
    'Привет! Это сообщение через WABA'
  );
  console.log('Message ID:', result.messages[0].id);
}
```

### Отправка изображения

```typescript
await wabaService.sendImage(
  '79001234567',
  'https://example.com/image.jpg',
  'Описание изображения'
);
```

### Отправка интерактивного сообщения

```typescript
await wabaService.sendInteractiveMessage(
  '79001234567',
  'Выберите действие:',
  [
    { id: 'btn_1', title: 'Заказать' },
    { id: 'btn_2', title: 'Отменить' },
    { id: 'btn_3', title: 'Справка' }
  ]
);
```

## Обработка входящих сообщений

Входящие сообщения автоматически:
1. Сохраняются в таблицу `Message`
2. Привязываются к `Chat` (создаётся если не существует)
3. Увеличивают счётчик непрочитанных `unreadCount`
4. Логируются с префиксом `📥 WABA:`

## Типы сообщений

WABA поддерживает следующие типы:

- **text** - обычный текст
- **image** - изображение с опциональной подписью
- **document** - документ (PDF, DOCX, etc.)
- **audio** - аудиофайл
- **video** - видео с опциональной подписью
- **template** - предварительно одобренный шаблон
- **interactive** - кнопки или списки
- **button** - ответ на кнопку
- **location** - геолокация
- **contacts** - контактная карточка

## Шаблоны сообщений

Создание шаблонов:
1. Перейдите в WhatsApp Manager: https://business.facebook.com/latest/whatsapp_manager/message_templates
2. Создайте новый шаблон
3. Дождитесь одобрения Meta (обычно 24-48 часов)
4. Используйте в API с параметром `type: "template"`

Пример шаблона:
```
Название: order_confirmation
Категория: UTILITY
Язык: Russian (ru)
Текст: Здравствуйте! Ваш заказ №{{1}} подтверждён.
```

## Лимиты и ограничения

### Ценообразование
- **Бесплатные беседы**: 1000 в месяц
- **Платные беседы**: зависит от страны (~$0.0042 за беседу в России)
- **Беседа** = 24 часа с момента первого сообщения

### Лимиты отправки
- **Tier 1** (новый): 250 уникальных пользователей/день
- **Tier 2**: 1,000 пользователей/день
- **Tier 3**: 10,000 пользователей/день
- **Tier 4**: 100,000 пользователей/день

Повышение tier происходит автоматически при хорошей репутации.

### Ограничения контента
- Шаблоны должны быть одобрены Meta
- Нельзя отправлять маркетинг без согласия
- Запрещён спам и нежелательный контент
- Качество обслуживания влияет на репутацию

## Отличия от Baileys

| Функция | WABA (Official) | Baileys (Unofficial) |
|---------|-----------------|----------------------|
| **Стоимость** | Платно (после 1000/мес) | Бесплатно |
| **Надёжность** | Высокая (99.9% uptime) | Средняя (блокировки) |
| **Webhook** | Официальный | Эмуляция через polling |
| **Шаблоны** | Требуют одобрения | Не требуются |
| **Мультиустройство** | Да | Да |
| **API** | Graph API | WhatsApp Web Protocol |
| **Риск бана** | Минимальный | Средний |
| **QR-код** | Не требуется | Требуется |

## Мониторинг и логи

Все события логируются с префиксами:
- `📤 WABA:` - исходящие сообщения
- `📥 WABA:` - входящие сообщения
- `📊 WABA:` - обновления статусов
- `❌ WABA:` - ошибки
- `✅ WABA:` - успешные операции
- `⚠️ WABA:` - предупреждения

## Миграция с Baileys на WABA

Для существующей организации:

1. Сохраните резервную копию БД
2. Обновите `connectionType` на `'waba'`
3. Заполните WABA credentials
4. Настройте webhook в Meta Dashboard
5. Протестируйте отправку/получение
6. Остановите Baileys сессию для этого номера

```sql
-- Переключение на WABA
UPDATE "OrganizationPhone"
SET "connectionType" = 'waba',
    "wabaAccessToken" = 'EAA...',
    "wabaPhoneNumberId" = '123...',
    "wabaId" = '456...'
WHERE id = 1;
```

## Troubleshooting

### Webhook не получает сообщения
1. Проверьте URL доступен из интернета (используйте ngrok для dev)
2. Убедитесь, что подписка активна в Meta Dashboard
3. Проверьте логи сервера на ошибки
4. Проверьте `wabaVerifyToken` совпадает с настройками

### Ошибка 401 Unauthorized
- Проверьте `wabaAccessToken` актуален
- System User token должен иметь права на WABA

### Сообщения не доставляются
- Проверьте номер телефона в правильном формате (без +)
- Убедитесь, что пользователь начал диалог первым
- Для маркетинга используйте только одобренные шаблоны

### Входящие сообщения дублируются
- Убедитесь, что webhook endpoint идемпотентен
- Проверьте нет ли нескольких подписок в Meta Dashboard

## Полезные ссылки

- [WhatsApp Business Platform Docs](https://developers.facebook.com/docs/whatsapp)
- [Cloud API Reference](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Message Templates](https://developers.facebook.com/docs/whatsapp/message-templates)
- [Webhook Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
- [Meta Business Suite](https://business.facebook.com/)
- [Pricing](https://developers.facebook.com/docs/whatsapp/pricing)

## Дата создания

**2025-12-09** - Интеграция WABA добавлена в проект
