# Уведомление о возрастном ограничении 21+ - Шпаргалка

## Что реализовано

✅ Автоматическое уведомление клиентам при закрытии заказа (тикета)  
✅ Поддержка WhatsApp и Telegram  
✅ Интеграция с AI-помощником  

## Когда отправляется

Автоматически при изменении статуса тикета на:
- `closed` (закрыт)
- `resolved` (решён)

## Текст уведомления

```
⚠️ Напоминаем: доставка алкогольной продукции осуществляется лицам старше 21 года. 
При получении заказа необходимо предъявить документ, удостоверяющий личность и возраст 
(паспорт, водительское удостоверение). Спасибо за понимание!
```

## Как использовать

### Через API

```bash
# Закрыть тикет (уведомление отправится автоматически)
curl -X PUT http://localhost:3000/api/tickets/12345/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "closed",
    "reason": "Заказ доставлен"
  }'
```

### Через фронтенд

```typescript
async function closeTicket(ticketNumber: number) {
  await fetch(`/api/tickets/${ticketNumber}/status`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'closed'
    })
  });
  // Уведомление отправится автоматически!
}
```

## Изменённые файлы

1. **src/controllers/ticketController.ts**
   - Добавлена функция `sendAgeVerificationNotice()`
   - Обновлена функция `changeTicketStatus()`

2. **src/services/aiService.ts**
   - Добавлен пункт в AI-промпт о напоминании про документы

3. **AGE_VERIFICATION_NOTICE.md** (новый)
   - Полная документация

## Логи

```
[INFO] [sendAgeVerificationNotice] Уведомление отправлено в WhatsApp чат #12345
[INFO] [sendAgeVerificationNotice] Уведомление отправлено в Telegram чат #12345
```

## Важные детали

- ✅ Уведомление отправляется **асинхронно** (не блокирует закрытие тикета)
- ✅ Работает для **WhatsApp (Baileys)** и **Telegram**
- ✅ Ошибки отправки **не прерывают** закрытие тикета
- ✅ AI теперь может предлагать варианты с напоминанием о документах

## Настройка

### Изменить текст уведомления

Отредактируйте `src/controllers/ticketController.ts`:

```typescript
const notificationText = 'Ваш новый текст...';
```

### Отключить автоматическую отправку

Закомментируйте в `changeTicketStatus()`:

```typescript
// if ((status === 'closed' || status === 'resolved') && oldStatus !== status) {
//   sendAgeVerificationNotice(ticket.id).catch(...);
// }
```

## Тестирование

```bash
# 1. Создайте тикет через WhatsApp/Telegram
# 2. Смените статус на "closed"
# 3. Проверьте, что клиент получил уведомление
```

## Поддержка

- Документация: `AGE_VERIFICATION_NOTICE.md`
- Код: `src/controllers/ticketController.ts`
- AI интеграция: `src/services/aiService.ts`
