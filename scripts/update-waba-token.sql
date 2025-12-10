-- Проверить автоматически созданные WABA номера
SELECT 
  id,
  "organizationId",
  "displayName",
  "phoneJid",
  "connectionType",
  "wabaPhoneNumberId",
  "wabaAccessToken",
  "status"
FROM "OrganizationPhone"
WHERE "connectionType" = 'waba';

-- Обновить wabaAccessToken для существующего номера
-- ЗАМЕНИТЕ значения на ваши данные!
UPDATE "OrganizationPhone"
SET 
  "wabaAccessToken" = 'YOUR_PERMANENT_ACCESS_TOKEN_HERE',
  "wabaId" = 'YOUR_WABA_ID_HERE'
WHERE 
  "connectionType" = 'waba' 
  AND id = 1; -- Укажите правильный ID

-- Проверить результат
SELECT 
  id,
  "displayName",
  "wabaPhoneNumberId",
  LENGTH("wabaAccessToken") as token_length,
  "wabaId"
FROM "OrganizationPhone"
WHERE "connectionType" = 'waba';
