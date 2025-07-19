# Обновленные примеры API для getMyAssignedChats

Функция `getMyAssignedChats` теперь возвращает **все чаты** назначенные оператору за определенный промежуток времени, включая чаты со статусами `open`, `pending` и `closed`.

## 📋 Новые возможности

### 1. Все чаты за период (по умолчанию)
```bash
curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=2025-07-18T00:00:00Z&to=2025-07-19T23:59:59Z" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Результат:** Все назначенные чаты за указанный период, независимо от статуса

### 2. Фильтрация по конкретному статусу
```bash
curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=2025-07-19T00:00:00Z&status=open" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Результат:** Только открытые чаты за указанный период

### 3. Все чаты с сегодняшнего утра
```bash
curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=2025-07-19T06:00:00Z" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Результат:** Все чаты (open, pending, closed) с 6 утра до сейчас

### 4. Только закрытые чаты за последнюю неделю
```bash
curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=2025-07-12T00:00:00Z&to=2025-07-19T23:59:59Z&status=closed" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Результат:** Только закрытые чаты за неделю

### 5. Все чаты в ожидании за вчера
```bash
curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=2025-07-18T00:00:00Z&to=2025-07-18T23:59:59Z&status=pending" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Результат:** Только чаты в статусе "pending" за вчера

## 🔧 Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `from` | string (ISO 8601) | Нет | Дата начала периода |
| `to` | string (ISO 8601) | Нет | Дата окончания периода (по умолчанию: сейчас) |
| `status` | string | Нет | Фильтр по статусу: `open`, `pending`, `closed` |

## 📊 Примеры ответов

### Все чаты за период:
```json
{
  "chats": [
    {
      "id": 1,
      "status": "open",
      "priority": "high",
      "unreadCount": 5,
      "lastMessageAt": "2025-07-19T14:30:00.000Z",
      "assignedAt": "2025-07-19T08:00:00.000Z",
      "lastMessage": {
        "content": "Активный чат",
        "fromMe": false,
        "type": "text"
      }
    },
    {
      "id": 2,
      "status": "closed",
      "priority": "normal",
      "unreadCount": 0,
      "lastMessageAt": "2025-07-19T12:00:00.000Z",
      "assignedAt": "2025-07-19T09:00:00.000Z",
      "lastMessage": {
        "content": "Чат был закрыт",
        "fromMe": true,
        "type": "text"
      }
    }
  ],
  "total": 2,
  "filters": {
    "from": "2025-07-19T00:00:00.000Z",
    "to": "2025-07-19T23:59:59.000Z"
  }
}
```

### Только открытые чаты:
```json
{
  "chats": [
    {
      "id": 1,
      "status": "open",
      "priority": "high",
      "unreadCount": 5,
      "lastMessage": {
        "content": "Активный чат",
        "fromMe": false
      }
    }
  ],
  "total": 1,
  "filters": {
    "from": "2025-07-19T00:00:00.000Z",
    "to": "2025-07-19T23:59:59.000Z"
  }
}
```

## 🚀 JavaScript примеры

### Получить все чаты за сегодня:
```javascript
const today = new Date();
today.setHours(0, 0, 0, 0);
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);

const response = await fetch(`/api/chat-assignment/my-assigned?from=${today.toISOString()}&to=${tomorrow.toISOString()}`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### Получить только закрытые чаты:
```javascript
const response = await fetch(`/api/chat-assignment/my-assigned?from=2025-07-19T00:00:00Z&status=closed`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

## ⚡ Преимущества обновления

1. **Полная история**: Можно получить все чаты оператора за период, включая закрытые
2. **Гибкая фильтрация**: Опциональная фильтрация по статусу при необходимости
3. **Аналитика**: Возможность анализировать производительность оператора по всем чатам
4. **Отчетность**: Удобно для создания отчетов за определенные периоды

## 📈 Использование для аналитики

### Количество чатов оператора за день:
```bash
curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=2025-07-19T00:00:00Z&to=2025-07-19T23:59:59Z" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Количество закрытых чатов за неделю:
```bash
curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=2025-07-12T00:00:00Z&status=closed" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Теперь API предоставляет полную картину работы оператора за любой период времени!
