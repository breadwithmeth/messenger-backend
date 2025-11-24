# Обновление: Гибкая сортировка чатов

## Что изменилось?

Добавлена возможность **гибкой сортировки** списка чатов через query параметры вместо жёстко заданной (hardcoded) сортировки.

## Новые параметры API

### `GET /api/chats`

Добавлено 2 новых опциональных параметра:

| Параметр | Тип | Значение по умолчанию | Описание |
|----------|-----|----------------------|----------|
| `sortBy` | string | - | Поле для сортировки: `lastMessageAt`, `createdAt`, `priority`, `unreadCount`, `ticketNumber`, `status`, `name` |
| `sortOrder` | string | `desc` | Направление сортировки: `desc` (убывание) или `asc` (возрастание) |

## Логика работы

### Режим 1: Умная сортировка (по умолчанию)

**Когда:** параметр `sortBy` **НЕ указан**

**Поведение:** Применяется многоуровневая сортировка (как раньше):
1. По приоритету (desc)
2. По количеству непрочитанных (desc)
3. По времени последнего сообщения (desc)

**Пример:**
```bash
GET /api/chats
# или
GET /api/chats?status=open
```

### Режим 2: Кастомная сортировка

**Когда:** параметр `sortBy` **указан**

**Поведение:** Сортировка по одному полю с указанным направлением

**Примеры:**
```bash
# По количеству непрочитанных (сначала больше)
GET /api/chats?sortBy=unreadCount&sortOrder=desc

# По дате создания (сначала старые)
GET /api/chats?sortBy=createdAt&sortOrder=asc

# По имени (алфавитный порядок A-Z)
GET /api/chats?sortBy=name&sortOrder=asc

# По номеру тикета
GET /api/chats?sortBy=ticketNumber&sortOrder=desc
```

## Безопасность

✅ **Whitelist валидация:** Используются только разрешённые поля для сортировки  
✅ **Защита от SQL-инъекций:** Невозможно передать произвольные поля  

Разрешённые поля: `lastMessageAt`, `createdAt`, `priority`, `unreadCount`, `ticketNumber`, `status`, `name`

## Файлы изменены

1. **`src/controllers/chatController.ts`**
   - Добавлены параметры `sortBy` и `sortOrder`
   - Добавлена валидация через whitelist
   - Реализована условная логика сортировки

2. **`CHATS_API_DOCUMENTATION.md`**
   - Обновлена таблица параметров
   - Добавлена подробная документация по сортировке
   - Расширены примеры использования
   - Обновлены React/Vue примеры с UI для выбора сортировки

## Примеры использования

### cURL
```bash
# Сортировка по непрочитанным сообщениям
curl -X GET "http://localhost:3000/api/chats?sortBy=unreadCount&sortOrder=desc" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### JavaScript/TypeScript
```typescript
const params = new URLSearchParams({
  sortBy: 'unreadCount',
  sortOrder: 'desc',
  status: 'open'
});

const response = await fetch(`/api/chats?${params}`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### React Hook
```typescript
const [sortBy, setSortBy] = useState('');
const [sortOrder, setSortOrder] = useState('desc');

// В компоненте:
<select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
  <option value="">Умная сортировка (по умолчанию)</option>
  <option value="lastMessageAt">По времени последнего сообщения</option>
  <option value="unreadCount">По количеству непрочитанных</option>
  <option value="createdAt">По дате создания</option>
  <option value="name">По имени</option>
</select>

{sortBy && (
  <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
    <option value="desc">По убыванию ↓</option>
    <option value="asc">По возрастанию ↑</option>
  </select>
)}
```

## Обратная совместимость

✅ **Полная совместимость:** Все существующие запросы без параметров `sortBy` продолжают работать с умной сортировкой  
✅ **Без breaking changes:** API остаётся неизменным для текущих клиентов  

## Использование на фронтенде

Теперь можно:
- Создавать разные представления (виджеты) с различной сортировкой
- Давать пользователю выбирать способ сортировки
- Создавать кастомные дашборды (например, "Самые старые непрочитанные")

## Дата обновления

**25 января 2025**
