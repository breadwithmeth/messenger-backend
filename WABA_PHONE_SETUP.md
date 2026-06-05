# Пошаговая инструкция: Добавление номера WhatsApp Business API (WABA)

## Шаг 1: Получите данные от Meta

1. **Перейдите в Meta for Developers:**
   - https://developers.facebook.com/apps/

2. **Откройте ваше приложение** или создайте новое:
   - Тип: Business
   - Добавьте продукт: WhatsApp → WhatsApp Business Platform

3. **Получите следующие данные:**

### A. WhatsApp Business Account ID (WABA ID)
   - WhatsApp → Getting Started
   - Скопируйте "WhatsApp Business Account ID"
   - Пример: `123456789012345`

### B. Phone Number ID
   - WhatsApp → Getting Started → Phone numbers
   - Нажмите на номер телефона
   - Скопируйте "Phone number ID"
   - Пример: `987654321098765`

### C. Access Token (Постоянный System User Token)
   - **Важно:** Не используйте временный токен!
   
   **Создание постоянного токена:**
   1. Перейдите в Meta Business Suite: https://business.facebook.com/
   2. Настройки бизнеса → Пользователи → Системные пользователи
   3. Нажмите "Добавить" → создайте System User (роль: Admin)
   4. Нажмите "Создать токен"
   5. Выберите приложение
   6. Permissions: `whatsapp_business_management`, `whatsapp_business_messaging`
   7. Срок действия: **Never expires** (Никогда не истекает)
   8. Сохраните токен в безопасном месте!
   
   Пример: `EAAaBbCcDdEeFfGg...` (очень длинная строка)

### D. Verify Token (для webhook)
   - Это токен, который вы сами придумываете
   - Для каждого WABA номера лучше хранить отдельный `wabaVerifyToken` в таблице `OrganizationPhone`
   - `WABA_VERIFY_TOKEN` в `.env` остаётся поддержкой для старых настроек и массовой проверки
   - Пример: `FSbvxs92mCKoBz3kL1tv5IprRJP3GVl2uJVjt4JRzysuoa4cTWzfBpXoQoZffPsS`

## Шаг 2: Добавьте номер в базу данных

### Вариант A: Обновить существующий номер

```sql
UPDATE "OrganizationPhone"
SET 
  "connectionType" = 'waba',
  "wabaAccessToken" = 'EAAaBbCcDdEeFfGg...',  -- Ваш System User Token
  "wabaPhoneNumberId" = '987654321098765',     -- Phone Number ID
  "wabaId" = '123456789012345',                -- WABA ID
  "wabaApiVersion" = 'v21.0',
  "wabaVerifyToken" = 'FSbvxs92mCKoBz3kL1tv5IprRJP3GVl2uJVjt4JRzysuoa4cTWzfBpXoQoZffPsS'
WHERE id = 1; -- ID вашего номера
```

### Вариант B: Добавить новый номер

```sql
INSERT INTO "OrganizationPhone" (
  "organizationId",
  "name",
  "phoneNumber",
  "connectionType",
  "wabaAccessToken",
  "wabaPhoneNumberId",
  "wabaId",
  "wabaApiVersion",
  "wabaVerifyToken",
  "createdAt",
  "updatedAt"
) VALUES (
  1,                                  -- ID организации
  'WhatsApp Business Official',
  '79001234567',                     -- Номер в формате без +
  'waba',
  'EAAaBbCcDdEeFfGg...',            -- System User Token
  '987654321098765',                 -- Phone Number ID
  '123456789012345',                 -- WABA ID
  'v21.0',
  'FSbvxs92mCKoBz3kL1tv5IprRJP3GVl2uJVjt4JRzysuoa4cTWzfBpXoQoZffPsS',
  NOW(),
  NOW()
);
```

### Выполните SQL:

```bash
# Подключитесь к базе
psql -h 88.218.70.119 -U shrvse -d mob

# Выполните UPDATE или INSERT запрос
# Проверьте результат
SELECT id, name, "phoneNumber", "connectionType", "wabaPhoneNumberId" 
FROM "OrganizationPhone" 
WHERE "connectionType" = 'waba';
```

## Шаг 3: Настройте Webhook в Meta

1. **Перейдите в Meta App Dashboard:**
   - https://developers.facebook.com/apps/YOUR_APP_ID/whatsapp-business/wa-settings/

2. **Configuration → Webhook:**
   - **Callback URL:** `https://bm.drawbridge.kz/api/waba/webhook`
   - **Verify Token:** `FSbvxs92mCKoBz3kL1tv5IprRJP3GVl2uJVjt4JRzysuoa4cTWzfBpXoQoZffPsS`
   - Нажмите "Verify and save"

3. **Webhook fields (подписки):**
   - ✅ `messages` - входящие сообщения
   - ✅ `message_template_status_update` - статусы шаблонов (опционально)

4. **Проверьте статус:**
   - Должно показать "Webhook verified successfully"

## Шаг 4: Тестирование

### 1. Проверка webhook verification:
```bash
curl "https://bm.drawbridge.kz/api/waba/webhook?hub.mode=subscribe&hub.verify_token=FSbvxs92mCKoBz3kL1tv5IprRJP3GVl2uJVjt4JRzysuoa4cTWzfBpXoQoZffPsS&hub.challenge=test123"
```
Ожидаемый ответ: `test123`

### 2. Отправка тестового сообщения:
```bash
# Получите JWT токен авторизации
TOKEN="your_jwt_token_here"

curl -X POST https://bm.drawbridge.kz/api/waba/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationPhoneId": 1,
    "to": "79009876543",
    "type": "text",
    "message": "Привет! Это тестовое сообщение через WABA"
  }'
```

### 3. Отправьте сообщение на ваш WABA номер:
   - С любого WhatsApp отправьте "Привет"
   - Проверьте логи сервера: должен появиться `📥 WABA: Incoming message`
   - Сообщение должно сохраниться в таблице `Message`

### 4. Проверьте базу данных:
```sql
SELECT 
  id,
  "chatId",
  body,
  "fromMe",
  "messageType",
  "createdAt"
FROM "Message"
WHERE "chatId" IN (
  SELECT id FROM "Chat" 
  WHERE "organizationPhoneId" = 1 -- ID вашего WABA номера
)
ORDER BY "createdAt" DESC
LIMIT 10;
```

## Шаг 5: Мониторинг

### Логи сервера:
```bash
# На сервере смотрите логи
tail -f /path/to/logs/app.log | grep "WABA:"
```

### Проверка в Meta Dashboard:
- WhatsApp → Insights → Messages
- Должны отображаться отправленные/полученные сообщения

## Типичные проблемы

### Ошибка: "Invalid access token"
- **Причина:** Токен истёк или неправильный
- **Решение:** Создайте новый System User Token с "Never expires"

### Ошибка: "Phone number not found"
- **Причина:** Неверный Phone Number ID
- **Решение:** Проверьте ID в Meta Dashboard → Phone numbers

### Webhook не получает сообщения
- **Причина:** Webhook не настроен или URL недоступен
- **Решение:** 
  1. Проверьте URL доступен из интернета
  2. Убедитесь webhook подписан на "messages"
  3. Проверьте логи сервера

### Сообщения не отправляются
- **Причина:** Пользователь не начал диалог первым
- **Решение:** Для первого сообщения используйте template message

## Полезные ссылки

- Meta Business Manager: https://business.facebook.com/
- Meta for Developers: https://developers.facebook.com/
- WhatsApp Cloud API Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
- Message Templates: https://business.facebook.com/latest/whatsapp_manager/message_templates

## Безопасность

⚠️ **Важно:**
- **Никогда** не коммитьте Access Token в Git!
- Храните токен в переменных окружения (.env)
- Используйте HTTPS для webhook URL
- Регулярно проверяйте активные токены в Meta Business Manager
- Отзывайте старые токены при создании новых
