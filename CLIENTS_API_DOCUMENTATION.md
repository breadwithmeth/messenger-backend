# API для управления клиентами организации

## Обзор

API для полного управления клиентами организации (физическими и юридическими лицами). Включает CRUD операции, фильтрацию, поиск, статистику, импорт и экспорт данных, а также систему тегов для гибкой категоризации клиентов.

**Base URL:** `/api/clients`

**Авторизация:** Все эндпоинты требуют JWT токен в заголовке `Authorization: Bearer <token>`

**Документация по тегам:** См. [CLIENT_TAGS_API.md](./CLIENT_TAGS_API.md) для подробной информации об API управления тегами.

---

## 🔗 Интеграция с чатами

Клиенты **автоматически** создаются и связываются с чатами при получении первых сообщений из WhatsApp или Telegram.

### Информация о клиентах в списке чатов

При запросе `/api/chats` в ответе теперь включается массив `organizationClients` для каждого чата:

```json
{
  "chats": [
    {
      "id": 42,
      "name": "Иван Петров",
      "channel": "whatsapp",
      "status": "open",
      "unreadCount": 3,
      "organizationClients": [
        {
          "id": 15,
          "name": "Иван Петров",
          "clientType": "individual",
          "segment": "VIP",
          "status": "active",
          "whatsappJid": "79001234567@s.whatsapp.net",
          "telegramUserId": null,
          "tags": [
            {
              "id": 1,
              "name": "VIP",
              "color": "#FFD700"
            }
          ]
        }
      ],
      "lastMessage": { ... }
    }
  ]
}
```

**Поля клиента в чате:**
- `id` - ID клиента для использования в других API запросах
- `name` - Имя клиента
- `clientType` - Тип: `individual` или `company`
- `tags` - Массив тегов клиента
- `segment` - Сегмент: `VIP`, `regular`, `wholesale`, `retail`
- `status` - Статус: `active`, `inactive`, `blocked`, `potential`
- `whatsappJid` - JID в WhatsApp (если есть)
- `telegramUserId` - ID в Telegram (если есть)

---

## Эндпоинты

### 1. Получить список клиентов

**GET** `/api/clients`

Получить список клиентов с фильтрацией, поиском и пагинацией.

#### Query параметры

| Параметр | Тип | Обязательный | По умолчанию | Описание |
|----------|-----|--------------|--------------|----------|
| `page` | number | Нет | 1 | Номер страницы |
| `limit` | number | Нет | 20 | Количество записей на странице |
| `status` | string | Нет | - | Фильтр по статусу: `active`, `inactive`, `blocked`, `potential` |
| `segment` | string | Нет | - | Фильтр по сегменту: `VIP`, `regular`, `wholesale`, `retail` |
| `clientType` | string | Нет | - | Фильтр по типу: `individual`, `company` |
| `assignedUserId` | number | Нет | - | Фильтр по ID ответственного менеджера |
| `tags` | string/number | Нет | - | Фильтр по тегам (ID тега или несколько через запятую) |
| `search` | string | Нет | - | Поиск по имени, email, телефону, названию компании |
| `sortBy` | string | Нет | createdAt | Поле для сортировки |
| `sortOrder` | string | Нет | desc | Порядок: `asc`, `desc` |

#### Пример запроса

```bash
# Поиск активных клиентов с тегом VIP (ID=1)
curl -X GET "http://localhost:3000/api/clients?page=1&limit=10&status=active&tags=1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Поиск клиентов с несколькими тегами
curl -X GET "http://localhost:3000/api/clients?tags=1,2&search=Иван" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Пример ответа

```json
{
  "clients": [
    {
      "id": 1,
      "organizationId": 1,
      "clientType": "individual",
      "name": "Иван Петров",
      "email": "ivan@example.com",
      "phone": "+79001234567",
      "secondaryPhone": null,
      "website": null,
      "address": "ул. Ленина, 10",
      "city": "Москва",
      "country": "Россия",
      "postalCode": "123456",
      "companyName": null,
      "taxId": null,
      "registrationNumber": null,
      "legalAddress": null,
      "contactPerson": null,
      "contactPosition": null,
      "contactPhone": null,
      "contactEmail": null,
      "status": "active",
      "source": "whatsapp",
      "segment": "VIP",
      "assignedUserId": 5,
      "totalRevenue": "150000.00",
      "lastPurchaseDate": "2025-11-15T10:00:00.000Z",
      "purchaseCount": 25,
      "averageCheck": "6000.00",
      "discount": "10.00",
      "notes": "Постоянный клиент, предпочитает доставку",
      "birthday": "1985-05-20T00:00:00.000Z",
      "whatsappJid": "79001234567@s.whatsapp.net",
      "telegramUserId": null,
      "emailSubscribed": true,
      "smsSubscribed": true,
      "createdAt": "2025-01-15T08:30:00.000Z",
      "updatedAt": "2025-11-20T12:00:00.000Z",
      "assignedUser": {
        "id": 5,
        "name": "Анна Менеджер",
        "email": "anna@company.com"
      },
      "tags": [
        {
          "id": 1,
          "name": "VIP",
          "color": "#FFD700"
        },
        {
          "id": 3,
          "name": "Постоянный",
          "color": "#4CAF50"
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 150,
    "totalPages": 15
  }
}
```

---

### 2. Получить клиента по ID

**GET** `/api/clients/:id`

Получить детальную информацию о конкретном клиенте.

#### Пример запроса

```bash
curl -X GET "http://localhost:3000/api/clients/1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Пример ответа

```json
{
  "id": 1,
  "organizationId": 1,
  "clientType": "individual",
  "name": "Иван Петров",
  "email": "ivan@example.com",
  "phone": "+79001234567",
  "status": "active",
  "segment": "VIP",
  "totalRevenue": "150000.00",
  "assignedUser": {
    "id": 5,
    "name": "Анна Менеджер",
    "email": "anna@company.com"
  },
  "createdAt": "2025-01-15T08:30:00.000Z",
  "updatedAt": "2025-11-20T12:00:00.000Z"
}
```

---

### 3. Создать клиента

**POST** `/api/clients`

Создать нового клиента (физическое или юридическое лицо).

#### Тело запроса

```json
{
  "clientType": "individual",
  "name": "Иван Петров",
  "email": "ivan@example.com",
  "phone": "+79001234567",
  "secondaryPhone": "+79007654321",
  "website": null,
  "address": "ул. Ленина, 10",
  "city": "Москва",
  "country": "Россия",
  "postalCode": "123456",
  "status": "active",
  "source": "whatsapp",
  "tags": "[\"VIP\", \"постоянный\"]",
  "segment": "VIP",
  "assignedUserId": 5,
  "discount": 10.00,
  "notes": "Постоянный клиент",
  "birthday": "1985-05-20",
  "whatsappJid": "79001234567@s.whatsapp.net",
  "emailSubscribed": true,
  "smsSubscribed": true
}
```

#### Для юридического лица

```json
{
  "clientType": "company",
  "name": "ООО Ромашка",
  "companyName": "Общество с ограниченной ответственностью Ромашка",
  "email": "info@romashka.ru",
  "phone": "+74951234567",
  "website": "https://romashka.ru",
  "address": "Бизнес-центр Альфа, офис 301",
  "city": "Москва",
  "country": "Россия",
  "postalCode": "101000",
  "taxId": "7707123456",
  "registrationNumber": "1027700123456",
  "legalAddress": "г. Москва, ул. Тверская, д. 1",
  "contactPerson": "Сергей Иванов",
  "contactPosition": "Директор по закупкам",
  "contactPhone": "+79161234567",
  "contactEmail": "ivanov@romashka.ru",
  "status": "active",
  "source": "website",
  "segment": "wholesale",
  "assignedUserId": 7,
  "discount": 15.00,
  "notes": "Оптовый клиент, ежемесячные заказы"
}
```

#### Пример запроса

```bash
curl -X POST "http://localhost:3000/api/clients" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientType": "individual",
    "name": "Иван Петров",
    "email": "ivan@example.com",
    "phone": "+79001234567",
    "status": "active"
  }'
```

#### Пример ответа

```json
{
  "id": 15,
  "organizationId": 1,
  "clientType": "individual",
  "name": "Иван Петров",
  "email": "ivan@example.com",
  "phone": "+79001234567",
  "status": "active",
  "createdAt": "2025-12-01T10:30:00.000Z",
  "updatedAt": "2025-12-01T10:30:00.000Z",
  "assignedUser": null
}
```

---

### 4. Обновить клиента

**PUT** `/api/clients/:id`

Обновить данные клиента. Можно обновлять только нужные поля.

#### Тело запроса

```json
{
  "name": "Иван Петрович Петров",
  "phone": "+79009999999",
  "segment": "VIP",
  "discount": 15.00,
  "totalRevenue": 200000.00,
  "purchaseCount": 30,
  "lastPurchaseDate": "2025-11-30"
}
```

#### Пример запроса

```bash
curl -X PUT "http://localhost:3000/api/clients/15" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "segment": "VIP",
    "discount": 15.00,
    "notes": "Обновлен статус до VIP"
  }'
```

#### Пример ответа

```json
{
  "id": 15,
  "organizationId": 1,
  "clientType": "individual",
  "name": "Иван Петров",
  "email": "ivan@example.com",
  "phone": "+79001234567",
  "segment": "VIP",
  "discount": "15.00",
  "notes": "Обновлен статус до VIP",
  "status": "active",
  "updatedAt": "2025-12-01T11:00:00.000Z"
}
```

---

### 5. Удалить клиента

**DELETE** `/api/clients/:id`

Удалить клиента из базы данных.

#### Пример запроса

```bash
curl -X DELETE "http://localhost:3000/api/clients/15" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Пример ответа

```json
{
  "message": "Client deleted successfully"
}
```

---

### 6. Получить статистику по клиентам

**GET** `/api/clients/stats`

Получить общую статистику по клиентам организации.

#### Пример запроса

```bash
curl -X GET "http://localhost:3000/api/clients/stats" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Пример ответа

```json
{
  "total": 245,
  "byStatus": {
    "active": 180,
    "inactive": 45,
    "blocked": 5,
    "potential": 15
  },
  "byType": {
    "individual": 200,
    "company": 45
  },
  "revenue": {
    "total": 15000000.00,
    "average": 61224.49
  },
  "topClients": [
    {
      "id": 45,
      "name": "ООО Альфа",
      "email": "alpha@company.ru",
      "totalRevenue": "2500000.00",
      "segment": "wholesale"
    },
    {
      "id": 12,
      "name": "ИП Сидоров",
      "email": "sidorov@mail.ru",
      "totalRevenue": "1800000.00",
      "segment": "VIP"
    }
  ],
  "segmentDistribution": [
    { "segment": "regular", "count": 120 },
    { "segment": "VIP", "count": 45 },
    { "segment": "wholesale", "count": 30 },
    { "segment": "retail", "count": 50 }
  ]
}
```

---

### 7. Импорт клиентов

**POST** `/api/clients/import`

Массовый импорт клиентов из массива JSON.

#### Тело запроса

```json
{
  "clients": [
    {
      "clientType": "individual",
      "name": "Алексей Смирнов",
      "email": "smirnov@example.com",
      "phone": "+79111111111",
      "status": "active"
    },
    {
      "clientType": "company",
      "name": "ООО Бета",
      "companyName": "Общество с ограниченной ответственностью Бета",
      "email": "info@beta.ru",
      "phone": "+74952222222",
      "taxId": "7707654321",
      "status": "active"
    }
  ]
}
```

#### Пример запроса

```bash
curl -X POST "http://localhost:3000/api/clients/import" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clients": [
      {
        "name": "Тест Клиент 1",
        "email": "test1@example.com",
        "phone": "+79001111111"
      },
      {
        "name": "Тест Клиент 2",
        "email": "test2@example.com",
        "phone": "+79002222222"
      }
    ]
  }'
```

#### Пример ответа

```json
{
  "message": "Import completed",
  "results": {
    "success": 2,
    "failed": 0,
    "errors": []
  }
}
```

#### При ошибках

```json
{
  "message": "Import completed",
  "results": {
    "success": 1,
    "failed": 1,
    "errors": [
      {
        "client": {
          "name": "Тест Клиент 3",
          "email": "existing@example.com"
        },
        "error": "Client with this email already exists"
      }
    ]
  }
}
```

---

### 8. Экспорт клиентов

**GET** `/api/clients/export`

Экспортировать всех клиентов в JSON или CSV формате.

#### Query параметры

| Параметр | Тип | Обязательный | По умолчанию | Описание |
|----------|-----|--------------|--------------|----------|
| `format` | string | Нет | json | Формат экспорта: `json`, `csv` |

#### Пример запроса (JSON)

```bash
curl -X GET "http://localhost:3000/api/clients/export?format=json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -o clients.json
```

#### Пример запроса (CSV)

```bash
curl -X GET "http://localhost:3000/api/clients/export?format=csv" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -o clients.csv
```

#### Пример CSV

```csv
"ID","Type","Name","Email","Phone","Company","Status","Segment","Source","Total Revenue","Assigned User","Created At"
"1","individual","Иван Петров","ivan@example.com","+79001234567","","active","VIP","whatsapp","150000","Анна Менеджер","2025-01-15T08:30:00.000Z"
"2","company","ООО Альфа","alpha@company.ru","+74951234567","ООО Альфа","active","wholesale","website","2500000","Сергей Продажник","2025-02-10T10:00:00.000Z"
```

---

## Модель данных

### OrganizationClient

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | number | ID клиента |
| `organizationId` | number | ID организации |
| `clientType` | string | Тип: `individual`, `company` |
| `name` | string | Имя/название (обязательно) |
| `email` | string | Email |
| `phone` | string | Основной телефон |
| `secondaryPhone` | string | Дополнительный телефон |
| `website` | string | Веб-сайт |
| `address` | string | Адрес |
| `city` | string | Город |
| `country` | string | Страна |
| `postalCode` | string | Почтовый индекс |
| `companyName` | string | Полное название компании (для юр.лиц) |
| `taxId` | string | ИНН |
| `registrationNumber` | string | ОГРН |
| `legalAddress` | string | Юридический адрес |
| `contactPerson` | string | Контактное лицо |
| `contactPosition` | string | Должность контактного лица |
| `contactPhone` | string | Телефон контактного лица |
| `contactEmail` | string | Email контактного лица |
| `status` | string | Статус: `active`, `inactive`, `blocked`, `potential` |
| `source` | string | Источник клиента |
| `tags` | string | JSON массив тегов |
| `segment` | string | Сегмент: `VIP`, `regular`, `wholesale`, `retail` |
| `assignedUserId` | number | ID ответственного менеджера |
| `totalRevenue` | decimal | Общая выручка от клиента |
| `lastPurchaseDate` | datetime | Дата последней покупки |
| `purchaseCount` | number | Количество покупок |
| `averageCheck` | decimal | Средний чек |
| `discount` | decimal | Персональная скидка (%) |
| `notes` | string | Заметки о клиенте |
| `birthday` | datetime | День рождения |
| `whatsappJid` | string | JID в WhatsApp |
| `telegramUserId` | string | ID в Telegram |
| `emailSubscribed` | boolean | Согласие на email-рассылку |
| `smsSubscribed` | boolean | Согласие на SMS-рассылку |
| `createdAt` | datetime | Дата создания |
| `updatedAt` | datetime | Дата обновления |

---

## Примеры использования

### Создание физического лица

```javascript
const createIndividualClient = async () => {
  const response = await fetch('http://localhost:3000/api/clients', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      clientType: 'individual',
      name: 'Мария Иванова',
      email: 'maria@example.com',
      phone: '+79165551234',
      address: 'ул. Пушкина, 15',
      city: 'Санкт-Петербург',
      status: 'active',
      source: 'telegram',
      segment: 'regular',
      emailSubscribed: true
    })
  });
  
  return await response.json();
};
```

### Создание юридического лица

```javascript
const createCompanyClient = async () => {
  const response = await fetch('http://localhost:3000/api/clients', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      clientType: 'company',
      name: 'ООО Техносервис',
      companyName: 'Общество с ограниченной ответственностью Техносервис',
      email: 'info@technoservice.ru',
      phone: '+74959876543',
      website: 'https://technoservice.ru',
      taxId: '7728123456',
      registrationNumber: '1027700987654',
      legalAddress: 'г. Москва, ул. Ленина, д. 50',
      contactPerson: 'Петр Сидоров',
      contactPosition: 'Генеральный директор',
      contactPhone: '+79261234567',
      contactEmail: 'sidorov@technoservice.ru',
      status: 'active',
      segment: 'wholesale',
      discount: 20.00
    })
  });
  
  return await response.json();
};
```

### Поиск клиентов

```javascript
const searchClients = async (searchQuery) => {
  const params = new URLSearchParams({
    search: searchQuery,
    page: '1',
    limit: '20',
    sortBy: 'name',
    sortOrder: 'asc'
  });
  
  const response = await fetch(`http://localhost:3000/api/clients?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};
```

### Обновление финансовых данных

```javascript
const updateClientRevenue = async (clientId, purchaseAmount) => {
  // Сначала получаем текущие данные
  const client = await fetch(`http://localhost:3000/api/clients/${clientId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json());
  
  // Обновляем финансовые показатели
  const response = await fetch(`http://localhost:3000/api/clients/${clientId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      totalRevenue: parseFloat(client.totalRevenue || 0) + purchaseAmount,
      purchaseCount: (client.purchaseCount || 0) + 1,
      lastPurchaseDate: new Date().toISOString(),
      averageCheck: (parseFloat(client.totalRevenue || 0) + purchaseAmount) / ((client.purchaseCount || 0) + 1)
    })
  });
  
  return await response.json();
};
```

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| 200 | OK - Запрос выполнен успешно |
| 201 | Created - Клиент создан |
| 400 | Bad Request - Неверные параметры запроса |
| 401 | Unauthorized - Требуется авторизация |
| 404 | Not Found - Клиент не найден |
| 500 | Internal Server Error - Внутренняя ошибка сервера |

---

## Индексы для оптимизации

В таблице `OrganizationClient` созданы следующие индексы для быстрого поиска:

- `organizationId` - поиск по организации
- `email` - поиск по email
- `phone` - поиск по телефону
- `status` - фильтрация по статусу
- `segment` - фильтрация по сегменту
- `assignedUserId` - поиск по менеджеру
- `clientType` - фильтрация по типу
- `whatsappJid` - связь с WhatsApp
- `telegramUserId` - связь с Telegram

---

## Интеграция с мессенджерами

API автоматически связывает клиентов с их контактами в WhatsApp и Telegram через поля:
- `whatsappJid` - для привязки к чатам WhatsApp
- `telegramUserId` - для привязки к чатам Telegram

Это позволяет отслеживать всю историю коммуникаций с клиентом в едином CRM-интерфейсе.
