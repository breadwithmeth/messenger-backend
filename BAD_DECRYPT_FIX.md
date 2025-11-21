# 🔧 Исправление ошибок шифрования Baileys (Bad Decrypt & Bad MAC)

## 📋 Описание проблем

### 1. Bad Decrypt Error

#### Симптомы
```
{"level":30,"time":1763571681736,"pid":68054,"hostname":"Sergeys-MacBook-Air.local","msg":"resyncing critical_unblock_low from v0"}
{"level":30,"time":1763571682379,"pid":68054,"hostname":"Sergeys-MacBook-Air.local","name":"critical_unblock_low","error":"Error: error:1C800064:Provider routines::bad decrypt
    at Decipheriv.final (node:internal/crypto/cipher:170:29)
    at aesDecryptWithIV (...baileys/src/Utils/crypto.ts:93:48)
    at aesDecrypt (...baileys/src/Utils/crypto.ts:87:9)
    at decodeSyncdMutations (...baileys/src/Utils/chat-utils.ts:242:18)
```

#### Причины
1. **Поврежденные данные синхронизации** - Ключи шифрования для app state были повреждены или созданы в несовместимой версии
2. **Конфликт версий Baileys** - Миграция между версиями может привести к несовместимости данных
3. **Множественные сессии** - Один аккаунт подключен к нескольким серверам, что вызывает конфликт ключей
4. **Прерывание процесса синхронизации** - Сервер был остановлен во время синхронизации app state

### 2. Bad MAC Error

#### Симптомы
```
Session error:Error: Bad MAC Error: Bad MAC
    at Object.verifyMAC (/node_modules/libsignal/src/crypto.js:87:15)
    at SessionCipher.doDecryptWhisperMessage (/node_modules/libsignal/src/session_cipher.js:250:16)
    at async SessionCipher.decryptWithSessions (/node_modules/libsignal/src/session_cipher.js:147:29)
```

#### Причины
1. **Поврежденные сессии Signal Protocol** - Ключи шифрования сессий повреждены
2. **Несоответствие MAC** - Message Authentication Code не совпадает (попытка расшифровать с неверными ключами)
3. **Устаревшие pre-keys** - Предварительные ключи устарели или были удалены
4. **Проблемы с sender-keys** - В групповых чатах ключи отправителя не синхронизированы

---

## 📊 Сравнение ошибок

| Характеристика | Bad Decrypt | Bad MAC |
|----------------|-------------|---------|
| **Источник** | Baileys crypto (AES) | libsignal (Signal Protocol) |
| **Когда возникает** | При синхронизации app state | При расшифровке сообщений |
| **Влияние** | Проблемы с синхронизацией истории | Невозможность прочитать сообщения |
| **Что удалять** | Ключи `app-state-sync-*` | Ключи `session-*`, `pre-key-*`, `sender-key-*` |
| **Требуется повторная авторизация** | Нет | Только после 3+ ошибок |
| **Автовосстановление** | Да, после очистки | Да, сессии пересоздаются |

---

## ✅ Решение 1: Автоматическое (Рекомендуется)

### Что было сделано:

#### 1. Отключена автоматическая синхронизация истории
В `src/config/baileys.ts` добавлены параметры:
```typescript
const currentSock = makeWASocket({ 
  version,
  auth: state,
  browser: ['Ubuntu', 'Chrome', '22.04.4'],
  logger: logger,
  // ИСПРАВЛЕНИЕ: Отключаем автоматическую синхронизацию app state
  syncFullHistory: false, // Отключаем полную синхронизацию истории
  shouldSyncHistoryMessage: () => false, // Отключаем синхронизацию сообщений
  getMessage: async (key) => { ... }
});
```

**Эффект**: 
- ✅ Предотвращает ошибки дешифрования
- ✅ Соединение остается стабильным
- ⚠️ История чатов не синхронизируется автоматически (но новые сообщения приходят нормально)

#### 2. Добавлен обработчик ошибок дешифрования
```typescript
// Перехватываем ошибки синхронизации app state
currentSock.ev.on('connection.update', async (update) => {
  if (update.lastDisconnect?.error) {
    const error = update.lastDisconnect.error as any;
    
    // Проверяем на ошибки дешифрования в app state
    if (error?.message?.includes('bad decrypt') || 
        error?.message?.includes('error:1C800064')) {
      logger.warn(`⚠️ Обнаружена ошибка дешифрования app state. Очистка...`);
      
      // Удаляем поврежденные данные
      await prisma.baileysAuth.deleteMany({
        where: {
          organizationId,
          phoneJid: key,
          key: { startsWith: 'app-state-sync-' }
        }
      });
      
      logger.info(`✅ Поврежденные данные удалены`);
    }
  }
});
```

**Эффект**:
- ✅ Автоматически обнаруживает и удаляет поврежденные данные
- ✅ Соединение не прерывается
- ✅ Основные учетные данные (creds, keys) остаются нетронутыми

#### 3. Добавлен обработчик ошибок Bad MAC

```typescript
// Map для отслеживания ошибок Bad MAC по organizationPhoneId
const badMacErrorCount = new Map<number, number>();
const MAX_BAD_MAC_ERRORS = 3; // Максимум ошибок перед сбросом сессии

// Функция обработки Bad MAC ошибок
async function handleBadMacError(
  organizationId: number,
  organizationPhoneId: number,
  phoneJid: string
): Promise<boolean> {
  const key = phoneJid.split('@')[0].split(':')[0];
  
  // Увеличиваем счетчик ошибок
  const currentCount = badMacErrorCount.get(organizationPhoneId) || 0;
  badMacErrorCount.set(organizationPhoneId, currentCount + 1);
  
  if (currentCount + 1 >= MAX_BAD_MAC_ERRORS) {
    // Полный сброс сессии - требуется повторное QR-сканирование
    await prisma.baileysAuth.deleteMany({
      where: { organizationId, phoneJid: key }
    });
    return false;
  }
  
  // Очищаем только поврежденные ключи сессий
  await prisma.baileysAuth.deleteMany({
    where: {
      organizationId,
      phoneJid: key,
      OR: [
        { key: { startsWith: 'session-' } },
        { key: { startsWith: 'pre-key-' } },
        { key: { startsWith: 'sender-key-' } }
      ]
    }
  });
  
  return true;
}

// Обработчик в connection.update
if (error?.message?.includes('Bad MAC')) {
  await handleBadMacError(organizationId, organizationPhoneId, phoneJid);
}

// Обработчик в messages.upsert
currentSock.ev.on('messages.upsert', async ({ messages, type }) => {
  for (const msg of messages) {
    try {
      // ... обработка сообщения ...
    } catch (error: any) {
      if (error?.message?.includes('Bad MAC')) {
        const recovered = await handleBadMacError(
          organizationId, 
          organizationPhoneId, 
          phoneJid
        );
        if (!recovered) {
          logger.error('Требуется повторная авторизация');
        }
        continue; // Пропускаем сообщение
      }
    }
  }
});
```

**Эффект**:
- ✅ Автоматически обнаруживает ошибки Bad MAC
- ✅ Очищает только поврежденные ключи сессий (не затрагивает creds)
- ✅ Отслеживает повторяющиеся ошибки (макс. 3)
- ✅ После 3 ошибок - корректное закрытие сессии и полный выход
- ✅ Обновление статуса телефона в БД на 'logged_out'
- ✅ Продолжает работу даже если одно сообщение не расшифровалось

#### 4. Добавлена функция корректного закрытия сессии

```typescript
async function closeSession(
  organizationPhoneId: number,
  phoneJid: string,
  reason: string
): Promise<void> {
  // 1. Закрываем WebSocket соединение
  const sock = socks.get(organizationPhoneId);
  if (sock && (sock.ws as any).readyState === 1) {
    await sock.end(new Error(reason));
  }
  
  // 2. Удаляем сокет из Map
  socks.delete(organizationPhoneId);
  
  // 3. Очищаем счетчики ошибок
  badMacErrorCount.delete(organizationPhoneId);
  badDecryptErrorCount.delete(organizationPhoneId);
}
```

**Эффект**:
- ✅ Корректное закрытие WebSocket соединения
- ✅ Освобождение ресурсов
- ✅ Очистка счетчиков ошибок
- ✅ Предотвращение утечек памяти

#### 5. Добавлен обработчик Bad Decrypt с лимитом ошибок

```typescript
const badDecryptErrorCount = new Map<number, number>();
const MAX_BAD_DECRYPT_ERRORS = 5;

async function handleBadDecryptError(...) {
  const currentCount = badDecryptErrorCount.get(organizationPhoneId) || 0;
  badDecryptErrorCount.set(organizationPhoneId, currentCount + 1);
  
  if (currentCount + 1 >= MAX_BAD_DECRYPT_ERRORS) {
    // Полный выход из сессии
    await closeSession(organizationPhoneId, phoneJid, reason);
    await prisma.baileysAuth.deleteMany({ ... });
    await prisma.organizationPhone.update({ status: 'logged_out' });
    return false;
  }
  
  // Очистка только app-state-sync ключей
  await prisma.baileysAuth.deleteMany({ key: { startsWith: 'app-state-sync-' } });
  return true;
}
```

**Эффект**:
- ✅ Терпимость к единичным ошибкам (макс. 5)
- ✅ Автоматическое закрытие сессии при критическом количестве ошибок
- ✅ Обновление статуса в БД
- ✅ Требование нового QR-сканирования только в критических случаях

---

## ✅ Решение 2: Ручная очистка

### Когда использовать:
- Ошибка уже произошла и соединение нестабильно
- Нужно превентивно очистить данные перед обновлением
- Проблема возникает постоянно

### Шаги:

#### 1. Остановите сервер
```bash
# Нажмите Ctrl+C в терминале или
pm2 stop messenger-backend
```

#### 2. Запустите скрипт очистки

**Для очистки App State (Bad Decrypt):**
```bash
# Для конкретного номера:
node scripts/clean-app-state.js 77051234567 1

# Для всех номеров организации:
node scripts/clean-app-state.js all 1

# Для всех номеров всех организаций:
node scripts/clean-app-state.js all
```

**Для очистки сессий Signal Protocol (Bad MAC):**
```sql
-- Подключитесь к базе данных
psql -U postgres -d messenger_db

-- Очистите сессии для конкретного номера
DELETE FROM "BaileysAuth"
WHERE "phoneJid" = '77051234567'
  AND "organizationId" = 1
  AND ("key" LIKE 'session-%' 
    OR "key" LIKE 'pre-key-%' 
    OR "key" LIKE 'sender-key-%');

-- Проверьте результат
SELECT COUNT(*) as "Удалено сессий" FROM "BaileysAuth"
WHERE "phoneJid" = '77051234567'
  AND "organizationId" = 1
  AND ("key" LIKE 'session-%' 
    OR "key" LIKE 'pre-key-%' 
    OR "key" LIKE 'sender-key-%');
```

#### 3. Проверьте результат
```
🧹 Очистка app state данных...
Номер: 77051234567
Организация: 1

📊 Статистика ПЕРЕД очисткой:
   Всего записей: 156
   App state записей: 23

📊 Статистика ПОСЛЕ очистки:
   Удалено записей: 23
   Осталось записей: 133

✅ Очистка завершена успешно!

💡 Важно: Основные данные авторизации (creds, keys) сохранены.
   Переподключение к WhatsApp не требуется.
   App state будет синхронизирован заново при следующем подключении.
```

#### 4. Запустите сервер
```bash
npm start
# или
pm2 start messenger-backend
```

---

## ✅ Решение 3: Полная пересоздание сессии (Крайний случай)

### ⚠️ Внимание: Требует повторного сканирования QR-кода!

Используйте только если предыдущие решения не помогли.

### Шаги:

#### 1. Удалите ВСЕ данные авторизации для номера
```bash
# Подключитесь к базе данных
psql -U postgres -d messenger_db

# Удалите данные для конкретного номера
DELETE FROM "BaileysAuth" 
WHERE "organizationId" = 1 
  AND "phoneJid" = '77051234567';

# Проверьте
SELECT COUNT(*) FROM "BaileysAuth" WHERE "phoneJid" = '77051234567';
-- Должно быть: 0
```

#### 2. Обновите статус телефона
```sql
UPDATE "OrganizationPhone" 
SET status = 'logged_out', 
    "qrCode" = NULL,
    "phoneJid" = NULL
WHERE id = 1; -- ID вашего телефона
```

#### 3. Перезапустите сервер
```bash
npm start
```

#### 4. Отсканируйте новый QR-код
- Откройте WhatsApp на телефоне
- Настройки → Связанные устройства → Привязка устройства
- Отсканируйте QR-код из терминала или вашего фронтенда

---

## 🔍 Диагностика

### Проверка наличия поврежденных данных
```sql
-- Показать количество app state записей по номерам
SELECT 
  "phoneJid",
  COUNT(*) as total_keys,
  COUNT(CASE WHEN "key" LIKE 'app-state-sync-%' THEN 1 END) as app_state_keys,
  COUNT(CASE WHEN "key" = 'creds' THEN 1 END) as has_creds
FROM "BaileysAuth"
GROUP BY "phoneJid"
ORDER BY total_keys DESC;
```

### Проверка логов на ошибки
```bash
# Последние 100 строк логов
tail -n 100 logs/app.log | grep -i "bad decrypt"

# Мониторинг в реальном времени
tail -f logs/app.log | grep -E "decrypt|critical_unblock"
```

### Проверка статуса соединений
```sql
SELECT 
  op.id,
  op."phoneNumber",
  op.status,
  op."lastConnectedAt",
  COUNT(ba.id) as auth_keys_count
FROM "OrganizationPhone" op
LEFT JOIN "BaileysAuth" ba ON ba."phoneJid" = SPLIT_PART(op."phoneJid", '@', 1)
WHERE op."organizationId" = 1
GROUP BY op.id, op."phoneNumber", op.status, op."lastConnectedAt"
ORDER BY op.id;
```

---

## 🛡️ Превентивные меры

### 1. Регулярное резервное копирование
```bash
# Создайте скрипт backup-baileys-auth.sh
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -U postgres -d messenger_db -t "BaileysAuth" > backup_baileys_${DATE}.sql
echo "✅ Backup created: backup_baileys_${DATE}.sql"
```

### 2. Мониторинг ошибок
Добавьте алерты на ошибки дешифрования:
```typescript
currentSock.ev.on('connection.update', async (update) => {
  if (update.lastDisconnect?.error?.message?.includes('bad decrypt')) {
    // Отправить уведомление админу
    await sendAlert('Baileys decrypt error detected', {
      phoneJid,
      error: update.lastDisconnect.error
    });
  }
});
```

### 3. Graceful shutdown
Убедитесь, что при остановке сервера все сессии корректно закрываются:
```typescript
process.on('SIGTERM', async () => {
  console.log('📴 Получен SIGTERM, закрываем сессии...');
  
  // Закрыть все активные сокеты
  for (const [phoneId, sock] of socks.entries()) {
    try {
      await sock.end();
      console.log(`✅ Сессия ${phoneId} закрыта`);
    } catch (e) {
      console.error(`❌ Ошибка закрытия сессии ${phoneId}:`, e);
    }
  }
  
  process.exit(0);
});
```

### 4. Версионность Baileys
Закрепите версию Baileys в `package.json`:
```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "6.7.21"
  }
}
```
Не используйте `^` или `~` для автообновления.

---

## 📚 Дополнительная информация

### Что такое App State Sync?
App State Sync - это механизм WhatsApp для синхронизации:
- Списка чатов
- Настроек чатов (закреплено, архивировано, заблокировано)
- Контактов
- Меток сообщений

### Типы app state:
- `critical_block` - Критические данные (контакты, настройки)
- `critical_unblock_low` - Некритические настройки
- `regular` - Обычные данные чатов
- `regular_low` / `regular_high` - Приоритизация синхронизации

### Почему отключение безопасно?
- ✅ Новые сообщения приходят нормально
- ✅ Отправка сообщений работает
- ✅ Медиафайлы обрабатываются
- ⚠️ История не синхронизируется (но хранится в вашей БД)

---

## 🆘 Если ничего не помогло

1. **Проверьте версию Baileys**
   ```bash
   npm list @whiskeysockets/baileys
   ```

2. **Откройте issue на GitHub**
   - Репозиторий: https://github.com/WhiskeySockets/Baileys
   - Приложите логи и версию Baileys

3. **Проверьте журналы на наличие других ошибок**
   ```bash
   pm2 logs messenger-backend --lines 100
   ```

---

## ⚡ Быстрая справка - Команды для экстренного реагирования

### Bad Decrypt Error
```bash
# 1. Автоматическая очистка (рекомендуется)
node scripts/clean-app-state.js <номер> <orgId>

# 2. Ручная очистка через SQL
psql -U postgres -d messenger_db -c "DELETE FROM \"BaileysAuth\" WHERE \"phoneJid\" = '<номер>' AND \"key\" LIKE 'app-state-sync-%';"

# 3. Перезапуск (если автоматика включена)
pm2 restart messenger-backend
```

### Bad MAC Error
```bash
# 1. Очистка сессий Signal Protocol
psql -U postgres -d messenger_db -c "DELETE FROM \"BaileysAuth\" WHERE \"phoneJid\" = '<номер>' AND (\"key\" LIKE 'session-%' OR \"key\" LIKE 'pre-key-%' OR \"key\" LIKE 'sender-key-%');"

# 2. Проверка счетчика ошибок в логах
pm2 logs messenger-backend | grep "Bad MAC error #"

# 3. Если ошибок >= 3 - полный сброс
psql -U postgres -d messenger_db -c "DELETE FROM \"BaileysAuth\" WHERE \"phoneJid\" = '<номер>';"
# После этого требуется повторное QR-сканирование
```

### Проверка состояния
```bash
# Количество записей авторизации
psql -U postgres -d messenger_db -c "SELECT COUNT(*) FROM \"BaileysAuth\" WHERE \"phoneJid\" = '<номер>';"

# Типы ключей
psql -U postgres -d messenger_db -c "SELECT SUBSTRING(\"key\", 1, 20) as key_prefix, COUNT(*) FROM \"BaileysAuth\" WHERE \"phoneJid\" = '<номер>' GROUP BY key_prefix ORDER BY COUNT(*) DESC;"

# Последние логи с ошибками
pm2 logs messenger-backend --lines 200 | grep -E "(Bad MAC|bad decrypt|Session error)"

# Проверка счетчиков ошибок в логах
pm2 logs messenger-backend --lines 100 | grep -E "(Bad MAC error #|Bad Decrypt error #)"

# Проверка статуса сессии
psql -U postgres -d messenger_db -c "SELECT id, \"phoneJid\", status, \"lastConnectedAt\" FROM \"OrganizationPhone\" WHERE \"phoneJid\" LIKE '<номер>%';"
```

### Мониторинг здоровья сессий
```bash
# Просмотр всех активных сессий и их статусов
psql -U postgres -d messenger_db -c "SELECT op.id, op.\"phoneJid\", op.status, op.\"lastConnectedAt\", COUNT(ba.id) as auth_keys FROM \"OrganizationPhone\" op LEFT JOIN \"BaileysAuth\" ba ON SPLIT_PART(op.\"phoneJid\", '@', 1) = ba.\"phoneJid\" WHERE op.status = 'connected' GROUP BY op.id ORDER BY op.\"lastConnectedAt\" DESC;"

# Поиск сессий с малым количеством ключей (возможно повреждены)
psql -U postgres -d messenger_db -c "SELECT op.\"phoneJid\", COUNT(ba.id) as key_count FROM \"OrganizationPhone\" op LEFT JOIN \"BaileysAuth\" ba ON SPLIT_PART(op.\"phoneJid\", '@', 1) = ba.\"phoneJid\" WHERE op.status = 'connected' GROUP BY op.\"phoneJid\" HAVING COUNT(ba.id) < 10;"
```

---

## 📝 Changelog

- **2025-11-22 (v2)**: Добавлена корректная остановка и выход из сессии при критических ошибках
- **2025-11-22 (v2)**: Добавлена функция `closeSession()` для корректного закрытия WebSocket
- **2025-11-22 (v2)**: Добавлен счетчик Bad Decrypt ошибок (макс. 5)
- **2025-11-22 (v2)**: Обновление статуса в БД при выходе из сессии
- **2025-11-22 (v2)**: Добавлены утилиты `getSessionErrorStats()` и `forceCloseSession()`
- **2025-11-22**: Добавлена обработка Bad MAC ошибок из libsignal
- **2025-11-22**: Добавлен счетчик повторяющихся Bad MAC ошибок (макс. 3)
- **2025-11-22**: Добавлена автоматическая очистка поврежденных сессий
- **Initial**: Реализована обработка Bad Decrypt ошибок app state

---

**Документ обновлен**: 22 ноября 2025 (версия 2)  
**Версия Baileys**: 6.7.x  
**Тестировано**: ✅

2. **Откатитесь на предыдущую версию**
   ```bash
   npm install @whiskeysockets/baileys@6.7.20
   ```

3. **Создайте issue в GitHub Baileys**
   https://github.com/WhiskeySockets/Baileys/issues

4. **Свяжитесь с поддержкой**
   - Предоставьте логи (без чувствительных данных)
   - Укажите версию Baileys и Node.js
   - Опишите шаги воспроизведения

---

## ✅ Checklist после исправления

- [ ] Ошибки "bad decrypt" больше не появляются в логах
- [ ] Соединение стабильно более 24 часов
- [ ] Новые сообщения приходят и отправляются
- [ ] Медиафайлы обрабатываются корректно
- [ ] Статус соединения в БД = 'connected'
- [ ] Нет повторных генераций QR-кода
- [ ] Создано резервное копирование auth данных

---

**Дата создания**: 19 ноября 2025  
**Версия Baileys**: 6.7.21  
**Статус**: ✅ Исправлено
