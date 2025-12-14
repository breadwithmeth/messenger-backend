# AI Suggestions - Quick Start

## 🚀 Быстрый старт

### 1. Базовый запрос

```bash
curl -X GET "http://localhost:3000/api/ai/suggestions/123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Ответ:**
```json
{
  "success": true,
  "chatId": 123,
  "suggestions": [
    "Конечно, я помогу вам с этим вопросом.",
    "Понимаю вашу ситуацию. Что именно вас беспокоит?",
    "Спасибо за обращение! Решим ваш вопрос в ближайшее время."
  ],
  "count": 3
}
```

---

## 📝 Примеры

### JavaScript

```javascript
async function getSuggestions(chatId) {
  const response = await fetch(
    `http://localhost:3000/api/ai/suggestions/${chatId}?limit=3`,
    {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    }
  );
  
  const data = await response.json();
  return data.suggestions;
}

// Использование
const suggestions = await getSuggestions(123);
console.log(suggestions);
```

### React

```typescript
function AIButton({ chatId, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchSuggestions = async () => {
    setLoading(true);
    const response = await fetch(
      `http://localhost:3000/api/ai/suggestions/${chatId}`,
      {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      }
    );
    const data = await response.json();
    setSuggestions(data.suggestions);
    setLoading(false);
  };

  return (
    <div>
      <button onClick={fetchSuggestions} disabled={loading}>
        {loading ? '⏳' : '🤖'} Предложить ответы
      </button>
      
      {suggestions.map((text, i) => (
        <button key={i} onClick={() => onSelect(text)}>
          {text}
        </button>
      ))}
    </div>
  );
}
```

---

## ⚙️ Параметры

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|--------------|----------|
| `chatId` | number | - | ID чата (обязательный) |
| `limit` | number | 3 | Количество предложений (1-10) |

---

## 🔍 Как это работает

1. **Анализ истории** - последние сообщения за 1 час
2. **AI генерация** - DeepSeek создаёт варианты ответов
3. **Форматирование** - чистый список без нумерации

---

## ✅ Health Check

Проверка работоспособности AI:

```bash
curl -X GET "http://localhost:3000/api/ai/health" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Ответ:**
```json
{
  "status": "healthy",
  "service": "DeepSeek AI"
}
```

---

## 🎯 Use Cases

### 1. Быстрые ответы в чате

```typescript
// При открытии чата автоматически загружаем предложения
useEffect(() => {
  if (chatId) {
    fetchSuggestions(chatId);
  }
}, [chatId]);
```

### 2. Кнопка "Предложить ответы"

```typescript
<button onClick={() => fetchSuggestions()}>
  🤖 Предложить ответы
</button>
```

### 3. Автодополнение в textarea

```typescript
<textarea
  value={message}
  onChange={(e) => setMessage(e.target.value)}
/>

{suggestions.map(s => (
  <div onClick={() => setMessage(s)}>{s}</div>
))}
```

---

## 📖 Полная документация

Подробное руководство: [AI_SUGGESTIONS_API.md](./AI_SUGGESTIONS_API.md)

---

## 🐛 Troubleshooting

**Пустой массив?**
- Проверьте, есть ли сообщения за последний час
- Убедитесь, что есть текстовые сообщения от клиента

**Ошибка 503?**
- DeepSeek API недоступен
- Проверьте `/api/ai/health`

**Долгий ответ?**
- AI запросы занимают 2-5 секунд
- Используйте loading состояние
