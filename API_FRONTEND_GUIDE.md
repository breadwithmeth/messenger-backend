# 🎯 API для работы с тикетами - Frontend Guide

## 📋 Содержание

- [Базовая конфигурация](#базовая-конфигурация)
- [Аутентификация](#аутентификация)
- [API Endpoints](#api-endpoints)
- [Типы данных](#типы-данных)
- [Примеры использования](#примеры-использования)
- [Обработка ошибок](#обработка-ошибок)

---

## Базовая конфигурация

### Base URL
```
http://localhost:4000/api
```

### Headers
Все запросы требуют авторизационный заголовок:
```javascript
{
  'Authorization': 'Bearer YOUR_JWT_TOKEN',
  'Content-Type': 'application/json'
}
```

---

## Аутентификация

### Получить токен
```http
POST /api/auth/login
```

**Тело запроса:**
```json
{
  "email": "operator@example.com",
  "password": "password123"
}
```

**Ответ:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "name": "Иван Иванов",
    "email": "operator@example.com",
    "role": "operator",
    "organizationId": 1
  }
}
```

---

## API Endpoints

### 1. Получить список тикетов

```http
GET /api/tickets
```

**Query параметры:**

| Параметр | Тип | Описание | Значения |
|----------|-----|----------|----------|
| `status` | string | Фильтр по статусу | `new`, `open`, `in_progress`, `pending`, `resolved`, `closed` |
| `priority` | string | Фильтр по приоритету | `low`, `normal`, `high`, `urgent` |
| `assignedUserId` | number | Фильтр по оператору | ID пользователя |
| `category` | string | Фильтр по категории | Любая строка |
| `page` | number | Номер страницы | По умолчанию: 1 |
| `limit` | number | Количество на странице | По умолчанию: 20 |
| `sortBy` | string | Поле для сортировки | `createdAt`, `updatedAt`, `priority`, `status` |
| `sortOrder` | string | Порядок сортировки | `asc`, `desc` |

**Пример запроса:**
```javascript
const response = await fetch('http://localhost:4000/api/tickets?status=open&priority=high&page=1&limit=10', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
const data = await response.json();
```

**Ответ:**
```json
{
  "tickets": [
    {
      "id": 51,
      "ticketNumber": 1234,
      "status": "open",
      "priority": "high",
      "subject": "Проблема с оплатой",
      "category": "техподдержка",
      "tags": ["оплата", "срочно"],
      "assignedUser": {
        "id": 1,
        "name": "Иван Иванов"
      },
      "client": {
        "phoneJid": "79001234567@s.whatsapp.net",
        "name": "Петр Петров"
      },
      "unreadCount": 3,
      "createdAt": "2025-01-16T10:00:00Z",
      "updatedAt": "2025-01-16T12:30:00Z",
      "lastMessageAt": "2025-01-16T12:30:00Z",
      "lastMessage": {
        "id": 1001,
        "content": "Последнее сообщение...",
        "timestamp": "2025-01-16T12:30:00Z"
      }
    }
  ],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "pages": 10
  }
}
```

---

### 2. Получить тикет по номеру

```http
GET /api/tickets/:ticketNumber
```

**Параметры URL:**
- `ticketNumber` - номер тикета (число)

**Пример запроса:**
```javascript
const response = await fetch(`http://localhost:4000/api/tickets/1234`, {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const ticket = await response.json();
```

**Ответ:**
```json
{
  "id": 51,
  "ticketNumber": 1234,
  "status": "open",
  "priority": "high",
  "subject": "Проблема с оплатой",
  "category": "техподдержка",
  "tags": ["оплата", "срочно"],
  "assignedUser": {
    "id": 1,
    "name": "Иван Иванов",
    "email": "ivan@example.com"
  },
  "assignedAt": "2025-01-16T10:30:00Z",
  "internalNotes": "Клиент звонил в банк, ждём ответа",
  "unreadCount": 3,
  "firstResponseAt": "2025-01-16T10:15:00Z",
  "resolvedAt": null,
  "closedAt": null,
  "closeReason": null,
  "customerRating": null,
  "createdAt": "2025-01-16T10:00:00Z",
  "updatedAt": "2025-01-16T12:30:00Z",
  "lastMessageAt": "2025-01-16T12:30:00Z",
  "client": {
    "phoneJid": "79001234567@s.whatsapp.net",
    "name": "Петр Петров"
  },
  "messages": [
    {
      "id": 1001,
      "content": "Здравствуйте! Помогите с оплатой",
      "timestamp": "2025-01-16T10:00:00Z",
      "senderUser": null
    },
    {
      "id": 1002,
      "content": "Здравствуйте! Чем могу помочь?",
      "timestamp": "2025-01-16T10:15:00Z",
      "senderUser": {
        "id": 1,
        "name": "Иван Иванов"
      }
    }
  ]
}
```

---

### 3. Назначить тикет оператору

```http
POST /api/tickets/:ticketNumber/assign
```

**Тело запроса:**
```json
{
  "userId": 1
}
```

**Пример запроса:**
```javascript
const response = await fetch(`http://localhost:4000/api/tickets/1234/assign`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    userId: 1
  })
});
const result = await response.json();
```

**Ответ:**
```json
{
  "success": true,
  "ticket": {
    "id": 51,
    "ticketNumber": 1234,
    "assignedUserId": 1,
    "assignedAt": "2025-01-16T13:00:00Z"
  },
  "history": {
    "id": 10,
    "changeType": "assigned",
    "description": "Тикет назначен пользователю Иван Иванов",
    "createdAt": "2025-01-16T13:00:00Z"
  }
}
```

---

### 4. Изменить статус тикета

```http
POST /api/tickets/:ticketNumber/status
```

**Тело запроса:**
```json
{
  "status": "resolved",
  "reason": "Проблема решена после консультации с банком"
}
```

**Возможные статусы:**
- `new` - Новый тикет
- `open` - Открыт
- `in_progress` - В работе
- `pending` - Ожидание
- `resolved` - Решён
- `closed` - Закрыт

**Пример запроса:**
```javascript
const response = await fetch(`http://localhost:4000/api/tickets/1234/status`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    status: 'resolved',
    reason: 'Проблема решена'
  })
});
const result = await response.json();
```

**Ответ:**
```json
{
  "success": true,
  "ticket": {
    "id": 51,
    "status": "resolved",
    "resolvedAt": "2025-01-16T14:00:00Z"
  },
  "history": {
    "id": 11,
    "changeType": "status_changed",
    "oldValue": "in_progress",
    "newValue": "resolved",
    "description": "Статус изменён с in_progress на resolved: Проблема решена",
    "createdAt": "2025-01-16T14:00:00Z"
  }
}
```

---

### 5. Изменить приоритет тикета

```http
POST /api/tickets/:ticketNumber/priority
```

**Тело запроса:**
```json
{
  "priority": "urgent"
}
```

**Возможные приоритеты:**
- `low` - Низкий
- `normal` - Обычный
- `high` - Высокий
- `urgent` - Срочный

**Пример запроса:**
```javascript
const response = await fetch(`http://localhost:4000/api/tickets/1234/priority`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    priority: 'urgent'
  })
});
```

---

### 6. Добавить тег к тикету

```http
POST /api/tickets/:ticketNumber/tags
```

**Тело запроса:**
```json
{
  "tag": "vip"
}
```

**Пример запроса:**
```javascript
const response = await fetch(`http://localhost:4000/api/tickets/1234/tags`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    tag: 'vip'
  })
});
const result = await response.json();
```

**Ответ:**
```json
{
  "success": true,
  "ticket": {
    "id": 51,
    "tags": ["оплата", "срочно", "vip"]
  },
  "history": {
    "id": 12,
    "changeType": "tag_added",
    "newValue": "vip",
    "description": "Добавлен тег: vip"
  }
}
```

---

### 7. Удалить тег из тикета

```http
DELETE /api/tickets/:ticketNumber/tags/:tag
```

**Параметры URL:**
- `ticketNumber` - номер тикета
- `tag` - тег для удаления

**Пример запроса:**
```javascript
const response = await fetch(`http://localhost:4000/api/tickets/1234/tags/vip`, {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

---

### 8. Получить историю изменений тикета

```http
GET /api/tickets/:ticketNumber/history
```

**Пример запроса:**
```javascript
const response = await fetch(`http://localhost:4000/api/tickets/1234/history`, {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const { history } = await response.json();
```

**Ответ:**
```json
{
  "history": [
    {
      "id": 1,
      "changeType": "status_changed",
      "oldValue": "new",
      "newValue": "open",
      "description": "Статус изменён с new на open",
      "user": {
        "id": 1,
        "name": "Иван Иванов"
      },
      "createdAt": "2025-01-16T10:15:00Z"
    },
    {
      "id": 2,
      "changeType": "assigned",
      "newValue": "1",
      "description": "Тикет назначен пользователю Иван Иванов",
      "user": {
        "id": 2,
        "name": "Администратор"
      },
      "createdAt": "2025-01-16T10:30:00Z"
    }
  ]
}
```

**Типы изменений (`changeType`):**
- `status_changed` - изменение статуса
- `assigned` - назначение оператора
- `unassigned` - снятие назначения
- `priority_changed` - изменение приоритета
- `tag_added` - добавлен тег
- `tag_removed` - удален тег
- `note_added` - добавлена заметка
- `category_changed` - изменена категория

---

### 9. Добавить внутреннюю заметку

```http
POST /api/tickets/:ticketNumber/notes
```

**Тело запроса:**
```json
{
  "note": "Клиент звонил в банк, ждём ответа в течение часа"
}
```

**Пример запроса:**
```javascript
const response = await fetch(`http://localhost:4000/api/tickets/1234/notes`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    note: 'Клиент звонил в банк'
  })
});
```

**Ответ:**
```json
{
  "success": true,
  "ticket": {
    "id": 51,
    "internalNotes": "Клиент звонил в банк"
  },
  "history": {
    "id": 13,
    "changeType": "note_added",
    "description": "Добавлена внутренняя заметка"
  }
}
```

---

### 10. Получить статистику по тикетам

```http
GET /api/tickets/stats
```

**Пример запроса:**
```javascript
const response = await fetch(`http://localhost:4000/api/tickets/stats`, {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const stats = await response.json();
```

**Ответ:**
```json
{
  "total": 1500,
  "byStatus": {
    "new": 50,
    "open": 200,
    "in_progress": 150,
    "pending": 30,
    "resolved": 70,
    "closed": 1000
  },
  "byPriority": {
    "low": 300,
    "normal": 900,
    "high": 250,
    "urgent": 50
  }
}
```

---

## Типы данных

### TypeScript Interfaces

```typescript
// Тикет
interface Ticket {
  id: number;
  ticketNumber: number;
  status: 'new' | 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  subject: string | null;
  category: string | null;
  tags: string[];
  assignedUser: {
    id: number;
    name: string;
    email?: string;
  } | null;
  client: {
    phoneJid: string;
    name: string | null;
  } | null;
  unreadCount: number;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  customerRating: number | null;
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessage?: Message;
  messages?: Message[];
}

// Сообщение
interface Message {
  id: number;
  content: string;
  timestamp: string;
  senderUser: {
    id: number;
    name: string;
  } | null;
}

// История изменений
interface TicketHistory {
  id: number;
  changeType: string;
  oldValue: string | null;
  newValue: string | null;
  description: string | null;
  user: {
    id: number;
    name: string;
  } | null;
  createdAt: string;
}

// Список тикетов (ответ)
interface TicketsListResponse {
  tickets: Ticket[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

// Статистика
interface TicketStats {
  total: number;
  byStatus: {
    [key: string]: number;
  };
  byPriority: {
    [key: string]: number;
  };
}
```

---

## Примеры использования

### React Hook для работы с тикетами

```typescript
import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:4000/api';

// Хук для получения списка тикетов
export function useTickets(filters = {}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    pages: 0
  });

  useEffect(() => {
    fetchTickets();
  }, [filters]);

  const fetchTickets = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams(filters as any);
      
      const response = await axios.get(`${API_BASE_URL}/tickets?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setTickets(response.data.tickets);
      setPagination(response.data.pagination);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка загрузки тикетов');
    } finally {
      setLoading(false);
    }
  };

  return { tickets, loading, error, pagination, refetch: fetchTickets };
}

// Хук для работы с одним тикетом
export function useTicket(ticketNumber: number) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ticketNumber) {
      fetchTicket();
    }
  }, [ticketNumber]);

  const fetchTicket = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await axios.get(
        `${API_BASE_URL}/tickets/${ticketNumber}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setTicket(response.data);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка загрузки тикета');
    } finally {
      setLoading(false);
    }
  };

  const assignTicket = async (userId: number) => {
    const token = localStorage.getItem('token');
    await axios.post(
      `${API_BASE_URL}/tickets/${ticketNumber}/assign`,
      { userId },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    await fetchTicket();
  };

  const changeStatus = async (status: string, reason?: string) => {
    const token = localStorage.getItem('token');
    await axios.post(
      `${API_BASE_URL}/tickets/${ticketNumber}/status`,
      { status, reason },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    await fetchTicket();
  };

  const changePriority = async (priority: string) => {
    const token = localStorage.getItem('token');
    await axios.post(
      `${API_BASE_URL}/tickets/${ticketNumber}/priority`,
      { priority },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    await fetchTicket();
  };

  const addTag = async (tag: string) => {
    const token = localStorage.getItem('token');
    await axios.post(
      `${API_BASE_URL}/tickets/${ticketNumber}/tags`,
      { tag },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    await fetchTicket();
  };

  const removeTag = async (tag: string) => {
    const token = localStorage.getItem('token');
    await axios.delete(
      `${API_BASE_URL}/tickets/${ticketNumber}/tags/${tag}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    await fetchTicket();
  };

  const addNote = async (note: string) => {
    const token = localStorage.getItem('token');
    await axios.post(
      `${API_BASE_URL}/tickets/${ticketNumber}/notes`,
      { note },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    await fetchTicket();
  };

  return {
    ticket,
    loading,
    error,
    refetch: fetchTicket,
    assignTicket,
    changeStatus,
    changePriority,
    addTag,
    removeTag,
    addNote
  };
}
```

---

### Компонент списка тикетов

```tsx
import React, { useState } from 'react';
import { useTickets } from './hooks/useTickets';

export function TicketList() {
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    page: 1,
    limit: 20
  });

  const { tickets, loading, error, pagination, refetch } = useTickets(filters);

  if (loading) return <div>Загрузка...</div>;
  if (error) return <div>Ошибка: {error}</div>;

  return (
    <div className="ticket-list">
      {/* Фильтры */}
      <div className="filters">
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">Все статусы</option>
          <option value="new">Новые</option>
          <option value="open">Открытые</option>
          <option value="in_progress">В работе</option>
          <option value="pending">Ожидание</option>
          <option value="resolved">Решённые</option>
          <option value="closed">Закрытые</option>
        </select>

        <select
          value={filters.priority}
          onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
        >
          <option value="">Все приоритеты</option>
          <option value="low">Низкий</option>
          <option value="normal">Обычный</option>
          <option value="high">Высокий</option>
          <option value="urgent">Срочный</option>
        </select>
      </div>

      {/* Список тикетов */}
      <div className="tickets">
        {tickets.map(ticket => (
          <div key={ticket.id} className="ticket-card">
            <div className="ticket-header">
              <h3>#{ticket.ticketNumber}</h3>
              <span className={`status status-${ticket.status}`}>
                {ticket.status}
              </span>
              <span className={`priority priority-${ticket.priority}`}>
                {ticket.priority}
              </span>
            </div>

            <div className="ticket-body">
              <p className="subject">{ticket.subject || 'Без темы'}</p>
              {ticket.client && (
                <p className="client">Клиент: {ticket.client.name}</p>
              )}
              {ticket.assignedUser && (
                <p className="assigned">
                  Назначен: {ticket.assignedUser.name}
                </p>
              )}
            </div>

            <div className="ticket-footer">
              {ticket.unreadCount > 0 && (
                <span className="unread-badge">{ticket.unreadCount}</span>
              )}
              {ticket.tags.length > 0 && (
                <div className="tags">
                  {ticket.tags.map(tag => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              )}
              <span className="time">
                {new Date(ticket.updatedAt).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Пагинация */}
      <div className="pagination">
        <button
          disabled={pagination.page === 1}
          onClick={() => setFilters({ ...filters, page: pagination.page - 1 })}
        >
          Предыдущая
        </button>
        <span>
          Страница {pagination.page} из {pagination.pages}
        </span>
        <button
          disabled={pagination.page === pagination.pages}
          onClick={() => setFilters({ ...filters, page: pagination.page + 1 })}
        >
          Следующая
        </button>
      </div>
    </div>
  );
}
```

---

### Компонент детального просмотра тикета

```tsx
import React from 'react';
import { useTicket } from './hooks/useTickets';

export function TicketDetail({ ticketNumber }: { ticketNumber: number }) {
  const {
    ticket,
    loading,
    error,
    changeStatus,
    changePriority,
    addTag,
    addNote
  } = useTicket(ticketNumber);

  if (loading) return <div>Загрузка...</div>;
  if (error) return <div>Ошибка: {error}</div>;
  if (!ticket) return <div>Тикет не найден</div>;

  return (
    <div className="ticket-detail">
      <div className="ticket-header">
        <h1>Тикет #{ticket.ticketNumber}</h1>
        <div className="actions">
          <select
            value={ticket.status}
            onChange={(e) => changeStatus(e.target.value)}
          >
            <option value="new">Новый</option>
            <option value="open">Открыт</option>
            <option value="in_progress">В работе</option>
            <option value="pending">Ожидание</option>
            <option value="resolved">Решён</option>
            <option value="closed">Закрыт</option>
          </select>

          <select
            value={ticket.priority}
            onChange={(e) => changePriority(e.target.value)}
          >
            <option value="low">Низкий</option>
            <option value="normal">Обычный</option>
            <option value="high">Высокий</option>
            <option value="urgent">Срочный</option>
          </select>
        </div>
      </div>

      <div className="ticket-info">
        <p><strong>Тема:</strong> {ticket.subject || 'Без темы'}</p>
        <p><strong>Категория:</strong> {ticket.category || 'Не указана'}</p>
        <p><strong>Клиент:</strong> {ticket.client?.name}</p>
        <p><strong>Назначен:</strong> {ticket.assignedUser?.name || 'Не назначен'}</p>
        <p><strong>Создан:</strong> {new Date(ticket.createdAt).toLocaleString()}</p>
        {ticket.firstResponseAt && (
          <p><strong>Первый ответ:</strong> {new Date(ticket.firstResponseAt).toLocaleString()}</p>
        )}
      </div>

      <div className="ticket-tags">
        <strong>Теги:</strong>
        {ticket.tags.map(tag => (
          <span key={tag} className="tag">{tag}</span>
        ))}
      </div>

      {ticket.internalNotes && (
        <div className="internal-notes">
          <strong>Внутренние заметки:</strong>
          <p>{ticket.internalNotes}</p>
        </div>
      )}

      <div className="ticket-messages">
        <h2>Сообщения</h2>
        {ticket.messages?.map(message => (
          <div
            key={message.id}
            className={`message ${message.senderUser ? 'operator' : 'client'}`}
          >
            <div className="message-header">
              <strong>
                {message.senderUser?.name || ticket.client?.name}
              </strong>
              <span>{new Date(message.timestamp).toLocaleString()}</span>
            </div>
            <div className="message-body">{message.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Обработка ошибок

### Типичные ошибки

**400 Bad Request**
```json
{
  "error": "status обязателен"
}
```

**401 Unauthorized**
```json
{
  "error": "Токен недействителен"
}
```

**404 Not Found**
```json
{
  "error": "Тикет не найден"
}
```

**500 Internal Server Error**
```json
{
  "error": "Ошибка сервера"
}
```

### Пример обработки ошибок

```typescript
async function handleTicketAction(action: () => Promise<any>) {
  try {
    const result = await action();
    return { success: true, data: result };
  } catch (error: any) {
    if (error.response) {
      // Ошибка от сервера
      const status = error.response.status;
      const message = error.response.data?.error || 'Неизвестная ошибка';
      
      switch (status) {
        case 400:
          return { success: false, error: `Неверные данные: ${message}` };
        case 401:
          // Перенаправить на страницу входа
          window.location.href = '/login';
          return { success: false, error: 'Требуется авторизация' };
        case 404:
          return { success: false, error: 'Ресурс не найден' };
        case 500:
          return { success: false, error: 'Ошибка сервера' };
        default:
          return { success: false, error: message };
      }
    } else if (error.request) {
      // Запрос был отправлен, но ответа не получено
      return { success: false, error: 'Нет связи с сервером' };
    } else {
      // Ошибка при настройке запроса
      return { success: false, error: error.message };
    }
  }
}

// Использование
const result = await handleTicketAction(() =>
  changeTicketStatus(1234, 'resolved')
);

if (result.success) {
  console.log('Статус изменён');
} else {
  console.error(result.error);
}
```

---

## Полезные утилиты

### Форматирование статусов и приоритетов

```typescript
// Словари для отображения
export const STATUS_LABELS = {
  new: 'Новый',
  open: 'Открыт',
  in_progress: 'В работе',
  pending: 'Ожидание',
  resolved: 'Решён',
  closed: 'Закрыт'
};

export const PRIORITY_LABELS = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  urgent: 'Срочный'
};

// Цвета для статусов
export const STATUS_COLORS = {
  new: '#2196F3',      // Синий
  open: '#4CAF50',     // Зелёный
  in_progress: '#FF9800', // Оранжевый
  pending: '#9C27B0',  // Фиолетовый
  resolved: '#00BCD4', // Голубой
  closed: '#757575'    // Серый
};

// Цвета для приоритетов
export const PRIORITY_COLORS = {
  low: '#4CAF50',      // Зелёный
  normal: '#2196F3',   // Синий
  high: '#FF9800',     // Оранжевый
  urgent: '#F44336'    // Красный
};
```

---

## Axios Instance (рекомендуется)

```typescript
import axios from 'axios';

// Создать экземпляр axios с базовой конфигурацией
export const api = axios.create({
  baseURL: 'http://localhost:4000/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Добавить токен к каждому запросу
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Обработка ответов
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Токен истёк - перенаправить на вход
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Использование
export const ticketAPI = {
  getAll: (params: any) => api.get('/tickets', { params }),
  getByNumber: (ticketNumber: number) => api.get(`/tickets/${ticketNumber}`),
  assign: (ticketNumber: number, userId: number) =>
    api.post(`/tickets/${ticketNumber}/assign`, { userId }),
  changeStatus: (ticketNumber: number, status: string, reason?: string) =>
    api.post(`/tickets/${ticketNumber}/status`, { status, reason }),
  changePriority: (ticketNumber: number, priority: string) =>
    api.post(`/tickets/${ticketNumber}/priority`, { priority }),
  addTag: (ticketNumber: number, tag: string) =>
    api.post(`/tickets/${ticketNumber}/tags`, { tag }),
  removeTag: (ticketNumber: number, tag: string) =>
    api.delete(`/tickets/${ticketNumber}/tags/${tag}`),
  getHistory: (ticketNumber: number) =>
    api.get(`/tickets/${ticketNumber}/history`),
  addNote: (ticketNumber: number, note: string) =>
    api.post(`/tickets/${ticketNumber}/notes`, { note }),
  getStats: () => api.get('/tickets/stats')
};
```

---

**Дата создания:** 16 ноября 2025  
**Версия API:** 1.0  
**Base URL:** http://localhost:4000/api
