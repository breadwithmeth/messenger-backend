# API для работы с сообщениями через тикеты

## Обзор
Добавлены эндпоинты для упрощенной работы с сообщениями через номер тикета:
- **Чтение сообщений** - через `/api/tickets/:ticketNumber/messages` (GET)
- **Отправка сообщений** - через `/api/messages/send-by-ticket` (POST)

## Преимущества
- **Упрощение frontend**: Не нужно делать дополнительные запросы для получения `chatId` по номеру тикета
- **Единообразие API**: Все операции с тикетами используют один идентификатор - `ticketNumber`
- **Безопасность**: Автоматическая проверка принадлежности тикета организации
- **Правильная архитектура**: Чтение через `/tickets`, отправка через `/messages`

## Эндпоинты

### 1. Получить сообщения тикета

**Endpoint**: `GET /api/tickets/:ticketNumber/messages`

**Описание**: Получает все сообщения для указанного тикета.

**Параметры**:
- `ticketNumber` (в URL) - номер тикета

**Headers**:
```
Authorization: Bearer <JWT_TOKEN>
```

**Ответ** (200 OK):
```json
{
  "messages": [
    {
      "id": 6512,
      "chatId": 296,
      "content": "Привет!",
      "fromMe": false,
      "timestamp": "2025-01-16T12:30:00.000Z",
      "messageType": "text",
      "organizationId": 1,
      "senderUserId": null,
      "senderUser": null
    },
    {
      "id": 6513,
      "chatId": 296,
      "content": "Здравствуйте, чем могу помочь?",
      "fromMe": true,
      "timestamp": "2025-01-16T12:31:00.000Z",
      "messageType": "text",
      "organizationId": 1,
      "senderUserId": 1,
      "senderUser": {
        "id": 1,
        "name": "Оператор Сергей",
        "email": "operator@example.com"
      }
    }
  ]
}
```

**Ошибки**:
- `400` - Некорректный ticketNumber (не число)
- `401` - Отсутствует или недействительный токен авторизации
- `404` - Тикет не найден или не принадлежит организации
- `500` - Внутренняя ошибка сервера

**Пример запроса**:
```bash
curl -X GET "http://localhost:4000/api/tickets/299/messages" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 2. Отправить сообщение по номеру тикета

**Endpoint**: `POST /api/messages/send-by-ticket`

**Описание**: Отправляет текстовое сообщение в WhatsApp чат, связанный с тикетом.

**Headers**:
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Тело запроса**:
```json
{
  "ticketNumber": "299",
  "text": "Ваш заказ готов к выдаче"
}
```

**Параметры тела**:
- `ticketNumber` (строка или число, обязательный) - номер тикета
- `text` (строка, обязательный) - текст сообщения для отправки

**Ответ** (200 OK):
```json
{
  "success": true,
  "messageId": "3EB098A93ABB79187DD9CE",
  "ticketNumber": 299
}
```

**Ошибки**:
- `400` - Некорректный ticketNumber или отсутствует параметр `text`
- `401` - Отсутствует или недействительный токен авторизации
- `404` - Тикет не найден или не принадлежит организации
- `500` - Внутренняя ошибка (например, некорректный remoteJid в базе)
- `503` - WhatsApp аккаунт не готов к отправке сообщений

**Пример запроса**:
```bash
curl -X POST "http://localhost:4000/api/messages/send-by-ticket" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"ticketNumber": "299", "text": "Здравствуйте! Ваш заказ готов к выдаче."}'
```

---

## Внутренняя логика

### getTicketMessages
1. Получает `ticketNumber` из параметров URL
2. Валидирует, что это число
3. Ищет чат по `ticketNumber` и `organizationId` (из JWT токена)
4. Возвращает 404, если чат не найден
5. Загружает все сообщения чата, включая информацию об отправителе
6. Сортирует сообщения по времени (от старых к новым)
7. Возвращает массив сообщений

### sendTicketMessage
1. Получает `ticketNumber` из параметров URL и `text` из тела запроса
2. Валидирует параметры
3. Ищет чат по `ticketNumber` и `organizationId`
4. Возвращает 404, если чат не найден
5. Проверяет наличие обязательных полей: `remoteJid`, `receivingPhoneJid`, `organizationPhoneId`
6. Получает Baileys сокет для WhatsApp аккаунта
7. Проверяет, что сокет готов (аутентифицирован)
8. Нормализует JID получателя
9. Отправляет сообщение через Baileys
10. Автоматически сохраняет сообщение в базу данных (через обработчик events)
11. Возвращает `messageId` отправленного сообщения

---

## Сравнение старого и нового подходов

### Старый подход (через chatId):
```javascript
// Шаг 1: Получить детали тикета
const ticketResponse = await fetch(`/api/tickets/299`);
const ticket = await ticketResponse.json();
const chatId = ticket.id; // 296

// Шаг 2: Получить сообщения
const messagesResponse = await fetch(`/api/chats/${chatId}/messages`);
const messages = await messagesResponse.json();

// Шаг 3: Отправить сообщение
await fetch(`/api/messages/send-text`, {
  method: 'POST',
  body: JSON.stringify({
    organizationPhoneId: ticket.organizationPhoneId,
    receiverJid: ticket.remoteJid,
    text: 'Здравствуйте!'
  })
});
```

### Новый подход (через ticketNumber):
```javascript
// Шаг 1: Получить сообщения
const messagesResponse = await fetch(`/api/tickets/299/messages`);
const messages = await messagesResponse.json();

// Шаг 2: Отправить сообщение
await fetch(`/api/tickets/299/messages`, {
  method: 'POST',
  body: JSON.stringify({ text: 'Здравствуйте!' })
});
```

**Выгода**: 
- На 50% меньше запросов к API
- Не нужно знать `chatId`, `organizationPhoneId`, `remoteJid`
- Более простой и понятный код на frontend

---

## Примеры использования на Frontend

### React Hook для работы с сообщениями тикета
```javascript
import { useState, useEffect } from 'react';

export function useTicketMessages(ticketNumber) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Загрузка сообщений
  useEffect(() => {
    async function fetchMessages() {
      setLoading(true);
      try {
        const response = await fetch(
          `http://localhost:4000/api/tickets/${ticketNumber}/messages`,
          {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
          }
        );
        
        if (!response.ok) {
          throw new Error('Не удалось загрузить сообщения');
        }
        
        const data = await response.json();
        setMessages(data.messages);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    if (ticketNumber) {
      fetchMessages();
    }
  }, [ticketNumber]);

  // Отправка сообщения
  const sendMessage = async (text) => {
    try {
      const response = await fetch(
        `http://localhost:4000/api/tickets/${ticketNumber}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text })
        }
      );
      
      if (!response.ok) {
        throw new Error('Не удалось отправить сообщение');
      }
      
      const result = await response.json();
      
      // Перезагрузить сообщения после отправки
      // (в реальном приложении лучше использовать WebSocket для real-time обновлений)
      setTimeout(() => {
        window.location.reload(); // Или вызвать fetchMessages()
      }, 1000);
      
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return { messages, loading, error, sendMessage };
}
```

### Использование хука в компоненте
```javascript
function TicketChat({ ticketNumber }) {
  const { messages, loading, error, sendMessage } = useTicketMessages(ticketNumber);
  const [newMessage, setNewMessage] = useState('');

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    
    await sendMessage(newMessage);
    setNewMessage('');
  };

  if (loading) return <div>Загрузка...</div>;
  if (error) return <div>Ошибка: {error}</div>;

  return (
    <div>
      <h2>Тикет #{ticketNumber}</h2>
      
      <div className="messages">
        {messages.map(msg => (
          <div key={msg.id} className={msg.fromMe ? 'my-message' : 'their-message'}>
            <strong>{msg.senderUser?.name || 'Клиент'}:</strong>
            <p>{msg.content}</p>
            <small>{new Date(msg.timestamp).toLocaleString()}</small>
          </div>
        ))}
      </div>

      <form onSubmit={handleSend}>
        <input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Введите сообщение..."
        />
        <button type="submit">Отправить</button>
      </form>
    </div>
  );
}
```

---

## Безопасность

### Защита данных организации
- Все запросы проверяются через `authMiddleware`
- `organizationId` извлекается из JWT токена
- Доступ только к тикетам своей организации
- Проверка принадлежности тикета перед любой операцией

### Валидация
- Проверка типа `ticketNumber` (должен быть числом)
- Проверка наличия и непустоты параметра `text`
- Проверка существования тикета в базе
- Проверка наличия обязательных полей (remoteJid, receivingPhoneJid)
- Проверка готовности WhatsApp сокета

---

## Логирование

Все операции логируются с уровнем детализации:
- `INFO` - успешные операции (количество загруженных сообщений, отправленные сообщения)
- `WARN` - попытки несанкционированного доступа, некорректные параметры
- `ERROR` - критические ошибки (отсутствие данных в БД, ошибки отправки)

Примеры логов:
```
[INFO] [getTicketMessages] Успешно получено 15 сообщений для тикета 299 (чат 296) организации 1.
[INFO] [sendTicketMessage] Сообщение отправлено в тикет 299. WhatsApp Message ID: 3EB07D3E89F8ACC5E8B0
[WARN] [getTicketMessages] Тикет с номером 999 не найден или не принадлежит организации 1.
[ERROR] [sendTicketMessage] У тикета 299 отсутствуют необходимые данные (remoteJid, receivingPhoneJid или organizationPhoneId).
```

---

## Технические детали

### Файлы изменений
1. **src/controllers/ticketController.ts**: Добавлены функции `getTicketMessages` и `sendTicketMessage`
2. **src/routes/ticketRoutes.ts**: Добавлены маршруты GET/POST `/:ticketNumber/messages`

### Зависимости
- `prisma` - для работы с базой данных
- `pino` - для логирования
- `@whiskeysockets/baileys` - для отправки WhatsApp сообщений
- `../config/baileys` - импорт `getBaileysSock` и `sendMessage`

### База данных
Используемые таблицы:
- `Chat` - связь ticketNumber → chatId, хранение remoteJid, receivingPhoneJid
- `Message` - хранение всех сообщений с привязкой к chatId
- `User` - информация об операторах (senderUser)

---

## Дата обновления
16 января 2025 г.

## Версия Baileys
6.7.21
