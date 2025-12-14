# AI Suggestions API - Документация

## Обзор

API для генерации AI-предложений ответов на основе истории сообщений чата с использованием **DeepSeek AI**.

### Возможности

- 🤖 Генерация 1-10 вариантов ответов
- ⏰ Анализ сообщений за последний час
- 🎯 Контекстные ответы на основе истории диалога
- 🇷🇺 Ответы на русском языке
- 💼 Профессиональный тон

---

## Эндпоинты

### 1. Получить предложения ответов

```http
GET /api/ai/suggestions/:chatId
```

**Описание:** Генерирует AI-предложения ответов для чата на основе истории сообщений за последний час.

**Параметры пути:**
- `chatId` (number, обязательный) - ID чата

**Query параметры:**
- `limit` (number, опциональный) - Количество предложений (1-10, по умолчанию: 3)

**Авторизация:** Требуется JWT токен

**Пример запроса:**

```bash
curl -X GET "http://localhost:3000/api/ai/suggestions/123?limit=5" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Успешный ответ (200 OK):**

```json
{
  "success": true,
  "chatId": 123,
  "suggestions": [
    "Конечно, я помогу вам с этим вопросом. Давайте разберем подробнее.",
    "Понимаю вашу ситуацию. Какие детали вы можете уточнить?",
    "Спасибо за обращение! Мы решим этот вопрос в ближайшее время."
  ],
  "count": 3,
  "timestamp": "2025-12-14T12:00:00.000Z"
}
```

**Ошибки:**

| Код | Описание | Ответ |
|-----|----------|-------|
| 400 | Некорректный chatId | `{ "error": "Некорректный chatId" }` |
| 400 | Некорректный limit | `{ "error": "Параметр limit должен быть от 1 до 10" }` |
| 401 | Не авторизован | `{ "error": "Unauthorized" }` |
| 404 | Чат не найден | `{ "error": "Чат не найден" }` |
| 500 | Ошибка сервера/AI | `{ "error": "Не удалось получить предложения ответов", "details": "..." }` |

---

### 2. Health Check

```http
GET /api/ai/health
```

**Описание:** Проверяет работоспособность DeepSeek AI сервиса.

**Авторизация:** Требуется JWT токен

**Пример запроса:**

```bash
curl -X GET "http://localhost:3000/api/ai/health" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Успешный ответ (200 OK):**

```json
{
  "status": "healthy",
  "service": "DeepSeek AI",
  "timestamp": "2025-12-14T12:00:00.000Z"
}
```

**Ошибка (503 Service Unavailable):**

```json
{
  "status": "unhealthy",
  "service": "DeepSeek AI",
  "error": "Connection timeout",
  "timestamp": "2025-12-14T12:00:00.000Z"
}
```

---

## Как это работает

### 1. Сбор контекста

API анализирует:
- Последние сообщения чата за **последний час** (до 50 сообщений)
- Только **текстовые сообщения** (медиафайлы игнорируются)
- Роль отправителя (клиент или оператор)

### 2. Формирование промта

Система создаёт промт для DeepSeek AI:

```
История разговора:
Клиент: Здравствуйте, у меня проблема с заказом
Оператор (Иван): Здравствуйте! Какой номер заказа?
Клиент: #12345
Оператор (Иван): Проверяю информацию...
Клиент: Когда мне ждать ответа?

Последнее сообщение клиента: "Когда мне ждать ответа?"

Предложи 3 варианта ответа оператора.
```

### 3. Генерация ответов

DeepSeek AI генерирует несколько вариантов:
- **Утвердительный:** прямой ответ на вопрос
- **Уточняющий:** запрос дополнительной информации
- **Эмпатичный:** проявление понимания и заботы

### 4. Форматирование

API возвращает чистый список без нумерации:

```json
{
  "suggestions": [
    "Ваш запрос будет обработан в течение 10 минут.",
    "Можете уточнить, в какое время вам удобно получить ответ?",
    "Понимаю ваше беспокойство. Мы ускорим обработку вашего вопроса."
  ]
}
```

---

## Примеры использования

### React Hook

```typescript
import { useState } from 'react';

interface Suggestion {
  suggestions: string[];
  count: number;
}

export function useAISuggestions(chatId: number) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = async (limit: number = 3) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `http://localhost:3000/api/ai/suggestions/${chatId}?limit=${limit}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch suggestions');
      }

      const data: Suggestion = await response.json();
      setSuggestions(data.suggestions);
    } catch (err: any) {
      setError(err.message);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  return { suggestions, loading, error, fetchSuggestions };
}

// Использование в компоненте
function ChatWindow({ chatId }: { chatId: number }) {
  const { suggestions, loading, error, fetchSuggestions } = useAISuggestions(chatId);

  return (
    <div>
      <button onClick={() => fetchSuggestions(3)} disabled={loading}>
        {loading ? 'Генерация...' : '🤖 Предложить ответы'}
      </button>

      {error && <div className="error">{error}</div>}

      {suggestions.length > 0 && (
        <div className="suggestions">
          <h4>AI предложения:</h4>
          {suggestions.map((suggestion, index) => (
            <div key={index} className="suggestion-item">
              <button onClick={() => insertText(suggestion)}>
                {suggestion}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Vue.js Composable

```typescript
import { ref } from 'vue';

export function useAISuggestions(chatId: number) {
  const suggestions = ref<string[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const fetchSuggestions = async (limit: number = 3) => {
    loading.value = true;
    error.value = null;

    try {
      const response = await fetch(
        `http://localhost:3000/api/ai/suggestions/${chatId}?limit=${limit}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch suggestions');
      }

      const data = await response.json();
      suggestions.value = data.suggestions;
    } catch (err: any) {
      error.value = err.message;
      suggestions.value = [];
    } finally {
      loading.value = false;
    }
  };

  return { suggestions, loading, error, fetchSuggestions };
}
```

### Vanilla JavaScript

```javascript
async function getSuggestions(chatId, limit = 3) {
  const token = localStorage.getItem('token');
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/ai/suggestions/${chatId}?limit=${limit}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error);
    }

    const data = await response.json();
    return data.suggestions;
  } catch (error) {
    console.error('Ошибка получения предложений:', error);
    return [];
  }
}

// Использование
const suggestions = await getSuggestions(123, 5);
suggestions.forEach(suggestion => {
  console.log('💡', suggestion);
});
```

---

## UI Компоненты

### Кнопка с выпадающим списком

```typescript
function SuggestionsButton({ chatId, onSelect }: { 
  chatId: number; 
  onSelect: (text: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { suggestions, loading, fetchSuggestions } = useAISuggestions(chatId);

  const handleClick = async () => {
    if (!isOpen) {
      await fetchSuggestions(3);
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="suggestions-dropdown">
      <button onClick={handleClick} disabled={loading}>
        {loading ? '⏳' : '🤖'} AI Предложения
      </button>

      {isOpen && suggestions.length > 0 && (
        <div className="dropdown-menu">
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              className="dropdown-item"
              onClick={() => {
                onSelect(suggestion);
                setIsOpen(false);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Интеграция с textarea

```typescript
function MessageInput({ chatId }: { chatId: number }) {
  const [text, setText] = useState('');
  const { suggestions, loading, fetchSuggestions } = useAISuggestions(chatId);

  const handleSuggestionClick = (suggestion: string) => {
    setText(suggestion);
  };

  return (
    <div className="message-input">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Введите сообщение..."
      />

      <div className="actions">
        <button onClick={() => fetchSuggestions(3)}>
          🤖 Предложить
        </button>
        <button onClick={() => sendMessage(text)}>
          📤 Отправить
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="suggestions-list">
          {suggestions.map((suggestion, index) => (
            <div
              key={index}
              className="suggestion-chip"
              onClick={() => handleSuggestionClick(suggestion)}
            >
              {suggestion}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Ограничения и рекомендации

### Ограничения

- ⏰ **Временное окно:** Анализируются только сообщения за последний час
- 📊 **Объём контекста:** Максимум 50 последних сообщений
- 📝 **Тип сообщений:** Только текстовые сообщения (медиа игнорируется)
- 🔢 **Количество предложений:** От 1 до 10

### Рекомендации

1. **Частота запросов:**
   - Не делайте запросы на каждое сообщение
   - Используйте кнопку "Предложить ответы"
   - Кэшируйте результаты на клиенте

2. **UX:**
   - Показывайте loading состояние
   - Обрабатывайте ошибки gracefully
   - Позволяйте редактировать предложенный текст

3. **Производительность:**
   - Запросы к AI могут занимать 2-5 секунд
   - Используйте debounce для кнопок
   - Предупреждайте пользователей о времени ожидания

---

## Безопасность

### API Key

API ключ DeepSeek хранится на сервере и **никогда не передаётся клиенту**.

### Доступ

- Требуется JWT аутентификация
- Пользователь может получать предложения только для чатов **своей организации**

### Rate Limiting

Рекомендуется добавить rate limiting:

```typescript
// Пример middleware
const rateLimit = require('express-rate-limit');

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 10, // максимум 10 запросов в минуту
  message: 'Слишком много запросов к AI. Попробуйте позже.',
});

router.get('/suggestions/:chatId', aiLimiter, getSuggestions);
```

---

## Troubleshooting

### Проблема: Пустой массив suggestions

**Причины:**
- Нет сообщений за последний час
- Все сообщения - медиафайлы (нет текста)
- Нет сообщений от клиента

**Решение:** Проверьте историю чата. API требует хотя бы одно текстовое сообщение от клиента.

---

### Проблема: Ошибка 503 Service Unavailable

**Причины:**
- DeepSeek API недоступен
- Неверный API ключ
- Превышен лимит запросов

**Решение:**
1. Проверьте `/api/ai/health`
2. Проверьте API ключ DeepSeek
3. Проверьте лимиты аккаунта DeepSeek

---

### Проблема: Некачественные предложения

**Причины:**
- Недостаточно контекста (мало сообщений)
- Сложный или специфичный запрос

**Решение:**
- Увеличьте `limit` для большего выбора
- Используйте предложения как отправную точку, а не финальный текст
- Редактируйте предложения под конкретную ситуацию

---

## API Model Details

### DeepSeek Configuration

```typescript
{
  model: 'deepseek-chat',
  temperature: 0.7,  // Баланс между креативностью и точностью
  max_tokens: 500,   // Достаточно для 3-10 коротких ответов
}
```

### Оптимизация промта

Система промт оптимизирован для:
- ✅ Коротких ответов (1-2 предложения)
- ✅ Профессионального тона
- ✅ Разнообразия вариантов
- ✅ Русского языка

---

## См. также

- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - Полная документация API
- [MESSAGES_API_DOCUMENTATION.md](./MESSAGES_API_DOCUMENTATION.md) - Работа с сообщениями
- [DeepSeek API Docs](https://platform.deepseek.com/docs) - Официальная документация DeepSeek
