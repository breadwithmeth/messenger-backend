-- Добавление нового номера телефона с WABA конфигурацией
-- Или обновление существующего номера для использования WABA

-- ВАРИАНТ 1: Обновить существующий номер (переключить с Baileys на WABA)
UPDATE "OrganizationPhone"
SET 
  "connectionType" = 'waba',
  "wabaAccessToken" = 'YOUR_PERMANENT_ACCESS_TOKEN',
  "wabaPhoneNumberId" = 'YOUR_PHONE_NUMBER_ID',
  "wabaId" = 'YOUR_WABA_ID',
  "wabaApiVersion" = 'v21.0',
  "wabaVerifyToken" = 'FSbvxs92mCKoBz3kL1tv5IprRJP3GVl2uJVjt4JRzysuoa4cTWzfBpXoQoZffPsS'
WHERE id = 1; -- Укажите ID вашего номера

-- ВАРИАНТ 2: Добавить новый номер с WABA
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
  1, -- ID вашей организации
  'WhatsApp Business',
  '79001234567', -- Номер телефона
  'waba',
  'YOUR_PERMANENT_ACCESS_TOKEN',
  'YOUR_PHONE_NUMBER_ID',
  'YOUR_WABA_ID',
  'v21.0',
  'FSbvxs92mCKoBz3kL1tv5IprRJP3GVl2uJVjt4JRzysuoa4cTWzfBpXoQoZffPsS',
  NOW(),
  NOW()
);

-- Проверить добавленный номер
SELECT 
  id,
  "organizationId",
  name,
  "phoneNumber",
  "connectionType",
  "wabaPhoneNumberId",
  "wabaId"
FROM "OrganizationPhone"
WHERE "connectionType" = 'waba';
