# ✅ Исправление: Добавлены receivingPhoneJid и имя контакта в API тикетов

## 🐛 Проблема

При получении списка тикетов и деталей конкретного тикета **не передавались** важные поля:
- `receivingPhoneJid` - JID номера, который принял сообщение
- `remoteJid` - JID контакта (отправителя)
- `name` - Имя чата/контакта

Это приводило к проблемам на frontend:
- Невозможно определить, на какой номер пришло сообщение
- Не отображается имя контакта
- Нет данных для корректного отображения чата

## ✅ Решение

### Изменения в `listTickets` (GET /api/tickets)

**Файл**: `src/controllers/ticketController.ts`  
**Строки**: ~88-106

Добавлены поля в форматированный ответ:

```typescript
return {
  id: ticket.id,
  ticketNumber: ticket.ticketNumber,
  status: ticket.status,
  priority: ticket.priority,
  subject: ticket.subject,
  category: ticket.category,
  tags: ticket.tags ? JSON.parse(ticket.tags) : [],
  assignedUser: assignedUser ? {
    id: assignedUser.id,
    name: assignedUser.name
  } : null,
  client,
  unreadCount: ticket.unreadCount,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  lastMessageAt: ticket.lastMessageAt,
  lastMessage,
  // ✅ ДОБАВЛЕНО
  name: ticket.name,
  remoteJid: ticket.remoteJid,
  receivingPhoneJid: ticket.receivingPhoneJid
};
```

### Изменения в `getTicketByNumber` (GET /api/tickets/:ticketNumber)

**Файл**: `src/controllers/ticketController.ts`  
**Строки**: ~169-177

Явно добавлены поля в ответ:

```typescript
res.json({
  ...ticket,
  tags: ticket.tags ? JSON.parse(ticket.tags) : [],
  client: ticket.clients[0] || null,
  // ✅ ДОБАВЛЕНО (явно для ясности)
  name: ticket.name,
  remoteJid: ticket.remoteJid,
  receivingPhoneJid: ticket.receivingPhoneJid
});
```

## 📊 Результат

Теперь оба API endpoint возвращают полную информацию о тикете:

### GET /api/tickets - Список тикетов
```json
{
  "tickets": [
    {
      "id": 296,
      "ticketNumber": 299,
      "status": "new",
      "name": "Имя контакта",
      "remoteJid": "142558671953967@lid",
      "receivingPhoneJid": "77054810862:92@s.whatsapp.net",
      ...
    }
  ]
}
```

### GET /api/tickets/299 - Детали тикета
```json
{
  "id": 296,
  "ticketNumber": 299,
  "name": "Имя контакта",
  "remoteJid": "142558671953967@lid",
  "receivingPhoneJid": "77054810862:92@s.whatsapp.net",
  ...
}
```

## 🎯 Использование

Frontend теперь может:
1. **Определить принимающий номер**: `receivingPhoneJid` → 77054810862
2. **Получить контакт**: `remoteJid` → 142558671953967@lid
3. **Отобразить имя**: `name` → "Имя контакта"

---

**Дата исправления**: 18 января 2025  
**Версия Baileys**: 6.7.21  
**Статус**: ✅ Исправлено и развернуто
