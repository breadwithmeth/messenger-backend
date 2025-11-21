# 🔌 API управления сессиями WhatsApp

## Обзор

Новые функции для управления сессиями WhatsApp и мониторинга их здоровья.

---

## 📊 Получение статистики ошибок сессии

### `getSessionErrorStats(organizationPhoneId: number)`

Возвращает текущую статистику ошибок для указанной сессии.

**Пример использования:**

```typescript
import { getSessionErrorStats } from './config/baileys';

// В контроллере или роуте
app.get('/api/session/:phoneId/stats', (req, res) => {
  const phoneId = parseInt(req.params.phoneId);
  const stats = getSessionErrorStats(phoneId);
  
  res.json(stats);
});
```

**Ответ:**
```json
{
  "badMacErrors": 2,
  "badDecryptErrors": 1,
  "maxBadMacErrors": 3,
  "maxBadDecryptErrors": 5,
  "isHealthy": true
}
```

**Поля:**
- `badMacErrors` - текущее количество ошибок Bad MAC
- `badDecryptErrors` - текущее количество ошибок Bad Decrypt
- `maxBadMacErrors` - максимально допустимое количество Bad MAC (3)
- `maxBadDecryptErrors` - максимально допустимое количество Bad Decrypt (5)
- `isHealthy` - `true` если сессия в порядке, `false` если близка к автоматическому закрытию

**Использование для мониторинга:**
```typescript
const stats = getSessionErrorStats(phoneId);

if (!stats.isHealthy) {
  console.warn(`⚠️ Сессия ${phoneId} имеет проблемы!`);
  console.warn(`Bad MAC: ${stats.badMacErrors}/${stats.maxBadMacErrors}`);
  console.warn(`Bad Decrypt: ${stats.badDecryptErrors}/${stats.maxBadDecryptErrors}`);
  
  // Отправить уведомление администратору
  await notifyAdmin(`Session ${phoneId} health warning`);
}

// Предупреждение если близко к лимиту
if (stats.badMacErrors >= stats.maxBadMacErrors - 1) {
  console.error(`🚨 Сессия ${phoneId} будет закрыта при следующей Bad MAC ошибке!`);
}
```

---

## 🔌 Принудительное закрытие сессии

### `forceCloseSession(organizationPhoneId: number, reason?: string)`

Принудительно закрывает активную сессию WhatsApp.

**Когда использовать:**
- Переключение на другое устройство
- Обновление конфигурации
- Устранение проблем вручную
- Административное управление

**Пример использования:**

```typescript
import { forceCloseSession } from './config/baileys';

// В контроллере или роуте
app.post('/api/session/:phoneId/close', async (req, res) => {
  const phoneId = parseInt(req.params.phoneId);
  const reason = req.body.reason || 'Manual close via API';
  
  try {
    await forceCloseSession(phoneId, reason);
    
    res.json({
      success: true,
      message: `Session ${phoneId} closed successfully`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

**Что происходит при закрытии:**
1. Закрывается WebSocket соединение
2. Сокет удаляется из памяти
3. Очищаются счетчики ошибок
4. Освобождаются ресурсы

**Примечание:** После принудительного закрытия сессия НЕ переподключается автоматически. Для повторного подключения нужно вызвать `startBaileys()`.

---

## 🔄 Полный цикл управления сессией

### Пример: Перезапуск сессии

```typescript
import { forceCloseSession, startBaileys } from './config/baileys';

async function restartSession(organizationPhoneId: number, phoneJid: string, organizationId: number) {
  console.log(`🔄 Перезапуск сессии ${phoneJid}...`);
  
  // 1. Закрываем текущую сессию
  await forceCloseSession(organizationPhoneId, 'Session restart requested');
  
  // 2. Ждем немного для полного закрытия
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // 3. Запускаем новую сессию
  await startBaileys(organizationId, organizationPhoneId, phoneJid);
  
  console.log(`✅ Сессия ${phoneJid} перезапущена`);
}
```

### Пример: Мониторинг здоровья всех сессий

```typescript
import { getSessionErrorStats, getBaileysSock } from './config/baileys';

async function checkAllSessions() {
  // Получаем все активные телефоны из БД
  const phones = await prisma.organizationPhone.findMany({
    where: { status: 'connected' }
  });
  
  const report = [];
  
  for (const phone of phones) {
    const sock = getBaileysSock(phone.id);
    const stats = getSessionErrorStats(phone.id);
    
    report.push({
      phoneId: phone.id,
      phoneJid: phone.phoneJid,
      isConnected: sock !== null,
      ...stats,
      status: stats.isHealthy ? 'healthy' : 'warning'
    });
  }
  
  // Фильтруем проблемные сессии
  const warnings = report.filter(r => !r.isHealthy);
  
  if (warnings.length > 0) {
    console.warn(`⚠️ Обнаружено ${warnings.length} проблемных сессий:`);
    warnings.forEach(w => {
      console.warn(`  - Phone ${w.phoneId}: Bad MAC ${w.badMacErrors}/${w.maxBadMacErrors}, Bad Decrypt ${w.badDecryptErrors}/${w.maxBadDecryptErrors}`);
    });
  }
  
  return report;
}

// Запускать каждые 5 минут
setInterval(checkAllSessions, 5 * 60 * 1000);
```

---

## 📡 Webhook уведомления

### Пример: Отправка уведомлений при критических ошибках

```typescript
// В baileys.ts, после handleBadMacError или handleBadDecryptError

async function sendErrorNotification(phoneId: number, errorType: string, count: number, max: number) {
  const webhookUrl = process.env.ERROR_WEBHOOK_URL;
  if (!webhookUrl) return;
  
  const payload = {
    type: 'session_error_warning',
    phoneId,
    errorType,
    currentCount: count,
    maxAllowed: max,
    severity: count >= max - 1 ? 'critical' : 'warning',
    timestamp: new Date().toISOString()
  };
  
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    logger.error('Failed to send error notification:', error);
  }
}

// Вызывать в handleBadMacError
if (currentCount + 1 >= MAX_BAD_MAC_ERRORS - 1) {
  await sendErrorNotification(organizationPhoneId, 'Bad MAC', currentCount + 1, MAX_BAD_MAC_ERRORS);
}
```

---

## 🎯 REST API endpoints (рекомендуемые)

### GET /api/sessions
Список всех сессий со статусами

```typescript
app.get('/api/sessions', async (req, res) => {
  const phones = await prisma.organizationPhone.findMany({
    select: {
      id: true,
      phoneJid: true,
      status: true,
      lastConnectedAt: true
    }
  });
  
  const sessions = phones.map(phone => ({
    ...phone,
    stats: getSessionErrorStats(phone.id),
    isActive: getBaileysSock(phone.id) !== null
  }));
  
  res.json(sessions);
});
```

### GET /api/sessions/:id/stats
Статистика конкретной сессии

```typescript
app.get('/api/sessions/:id/stats', (req, res) => {
  const phoneId = parseInt(req.params.id);
  const stats = getSessionErrorStats(phoneId);
  const sock = getBaileysSock(phoneId);
  
  res.json({
    phoneId,
    isConnected: sock !== null,
    ...stats
  });
});
```

### POST /api/sessions/:id/restart
Перезапуск сессии

```typescript
app.post('/api/sessions/:id/restart', async (req, res) => {
  const phoneId = parseInt(req.params.id);
  
  const phone = await prisma.organizationPhone.findUnique({
    where: { id: phoneId }
  });
  
  if (!phone) {
    return res.status(404).json({ error: 'Phone not found' });
  }
  
  await restartSession(phoneId, phone.phoneJid, phone.organizationId);
  
  res.json({ success: true, message: 'Session restarted' });
});
```

### POST /api/sessions/:id/close
Закрытие сессии

```typescript
app.post('/api/sessions/:id/close', async (req, res) => {
  const phoneId = parseInt(req.params.id);
  const reason = req.body.reason || 'Manual close';
  
  await forceCloseSession(phoneId, reason);
  
  res.json({ success: true, message: 'Session closed' });
});
```

---

## 🔐 Безопасность

**Важно:** Все эти endpoints должны быть защищены аутентификацией!

```typescript
import { authenticateAdmin } from './middleware/auth';

app.use('/api/sessions', authenticateAdmin);
```

---

## 📝 Логирование

Все функции автоматически логируют свои действия через `pino logger`:

```
✅ Подключено к WhatsApp для 77051234567@s.whatsapp.net
⚠️ Bad MAC error #1 для 77051234567@s.whatsapp.net
✅ Удалено 45 поврежденных ключей сессий для 77051234567
🔄 Счетчики ошибок сброшены для organizationPhoneId: 1
🚪 Закрытие сессии для 77051234567@s.whatsapp.net. Причина: Manual close
✅ WebSocket соединение закрыто для 77051234567@s.whatsapp.net
```

---

**Версия API**: 1.0  
**Совместимость**: Baileys 6.7.x  
**Обновлено**: 22 ноября 2025
