# Быстрая справка: API сообщений через тикеты

## 🎯 Для чего это нужно
Новые эндпоинты позволяют работать с сообщениями напрямую через номер тикета:
- **Чтение**: `GET /api/tickets/:ticketNumber/messages`
- **Отправка**: `POST /api/messages/send-by-ticket`

---

## 📥 Получить сообщения тикета

```bash
GET /api/tickets/:ticketNumber/messages
```

**Пример:**
```bash
curl -X GET "http://localhost:4000/api/tickets/299/messages" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Ответ:**
```json
{
  "messages": [
    {
      "id": 6512,
      "content": "Привет!",
      "fromMe": false,
      "timestamp": "2025-01-16T12:30:00.000Z",
      "messageType": "text",
      "senderUser": null
    }
  ]
}
```

---

## 📤 Отправить сообщение по номеру тикета

```bash
POST /api/messages/send-by-ticket
```

**Пример:**
```bash
curl -X POST "http://localhost:4000/api/messages/send-by-ticket" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticketNumber": "299", "text": "Здравствуйте! Ваш заказ готов."}'
```

**Ответ:**
```json
{
  "success": true,
  "messageId": "3EB098A93ABB79187DD9CE",
  "ticketNumber": 299
}
```

---

## ⚡ Примеры на JavaScript

### Получить сообщения
```javascript
const response = await fetch(`/api/tickets/${ticketNumber}/messages`, {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const { messages } = await response.json();
```

### Отправить сообщение
```javascript
const response = await fetch('/api/messages/send-by-ticket', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ 
    ticketNumber: 299,
    text: 'Привет!' 
  })
});
const { success, messageId, ticketNumber } = await response.json();
```

---

## 🔒 Требования
- **Авторизация**: Обязателен JWT токен в заголовке `Authorization`
- **ticketNumber**: Должен быть числом (можно передать как строку или число)
- **text**: Обязателен при отправке сообщения, не должен быть пустым

---

## ❌ Коды ошибок
- `400` - Некорректный ticketNumber или пустой text
- `401` - Отсутствует или недействительный токен
- `404` - Тикет не найден
- `500` - Ошибка сервера
- `503` - WhatsApp аккаунт не готов

---

## 📚 Полная документация
См. файл `TICKET_MESSAGES_API.md`
