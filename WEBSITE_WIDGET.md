# Виджет чата для сайта

Виджет позволяет посетителю сайта написать оператору прямо со страницы. Каждая новая
сессия посетителя создаёт в messenger отдельный чат с каналом `website` и новый тикет.
Тикет автоматически получает приоритет `urgent`.

Поддерживается:

- готовый подключаемый скрипт `widget.js`;
- текстовая переписка посетителя и оператора;
- доставка ответов через Socket.IO;
- автоматический переход на HTTP polling, если Socket.IO недоступен;
- сохранение сессии посетителя в `localStorage`;
- стандартное назначение ответственного, статусы, приоритеты и аналитика тикетов.
- автоматический приоритет `urgent` для новых и переоткрытых обращений.

Сейчас канал `website` поддерживает только сообщения типа `text`.

## Требования

- backend доступен по HTTPS из браузера посетителя;
- выполнена Prisma-миграция;
- статический файл `/widget.js` доступен с backend;
- reverse proxy пропускает обычные HTTP-запросы и WebSocket для `/socket.io/`.

## 1. Подготовка backend

Примените миграции и соберите приложение:

```bash
npx prisma migrate deploy
npm run build
```

После запуска проверьте:

```bash
curl https://messenger.example.com/health
curl -I https://messenger.example.com/widget.js
```

Ожидается `200 OK` для обоих запросов.

## 2. Создание виджета

Маршруты управления виджетами не требуют авторизации. При создании необходимо явно
передать `organizationId`.

```bash
curl -X POST https://messenger.example.com/api/website-widgets \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": 1,
    "name": "Поддержка сайта",
    "welcomeMessage": "Здравствуйте! Чем можем помочь?",
    "primaryColor": "#2563eb"
  }'
```

Поля:

| Поле | Обязательное | Описание |
| --- | --- | --- |
| `organizationId` | да | ID организации, которой принадлежит виджет |
| `name` | да | Заголовок окна, максимум 160 символов |
| `welcomeMessage` | нет | Локальное приветствие, максимум 1000 символов |
| `primaryColor` | нет | Цвет в формате `#RRGGBB`, по умолчанию `#2563eb` |

Пример ответа:

```json
{
  "widget": {
    "id": 7,
    "organizationId": 1,
    "publicKey": "wgt_xxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "Поддержка сайта",
    "status": "active",
    "welcomeMessage": "Здравствуйте! Чем можем помочь?",
    "primaryColor": "#2563eb"
  }
}
```

`publicKey` используется в HTML сайта. Это публичный идентификатор, а не пароль.

Виджет разрешено подключать с любого домена.

## 3. Установка на сайт

Добавьте скрипт перед закрывающим тегом `</body>`:

```html
<script
  src="https://messenger.example.com/widget.js"
  data-widget-key="wgt_xxxxxxxxxxxxxxxxxxxxxxxx"
  data-api-url="https://messenger.example.com"
  async
></script>
```

Атрибуты:

| Атрибут | Обязательный | Описание |
| --- | --- | --- |
| `src` | да | URL файла `widget.js` на backend |
| `data-widget-key` | да | Значение `publicKey` созданного виджета |
| `data-api-url` | нет | Базовый URL API; без него используется origin из `src` |

После загрузки скрипт создаёт плавающую кнопку в правом нижнем углу. Стили изолированы
через Shadow DOM и не должны конфликтовать со стилями сайта.

## 4. Проверка полного сценария

1. Откройте страницу сайта и нажмите кнопку чата.
2. Отправьте тестовое сообщение.
3. Получите новые чаты операторским API:

```bash
curl "https://messenger.example.com/api/chats?channel=website" \
  -H "Authorization: Bearer OPERATOR_JWT"
```

4. Найдите `chatId` созданного чата.
5. Назначьте чат текущему оператору:

```bash
curl -X POST https://messenger.example.com/api/chat-assignment/assign \
  -H "Authorization: Bearer OPERATOR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "operatorId": 0
  }'
```

`operatorId: 0` означает текущего авторизованного сотрудника.
При назначении website-чат сохраняет приоритет `urgent`.

6. Отправьте ответ посетителю:

```bash
curl -X POST https://messenger.example.com/api/messages/send-by-chat \
  -H "Authorization: Bearer OPERATOR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "type": "text",
    "text": "Здравствуйте! Ответ оператора."
  }'
```

Ответ появится в открытом виджете через Socket.IO либо не позднее следующего polling
запроса. Polling выполняется раз в 4 секунды.

Без назначенного ответственного `/api/messages/send-by-chat` вернёт ошибку `400`.

## 5. Управление виджетами

### Получить список

```http
GET /api/website-widgets?organizationId=1
```

### Изменить настройки

```bash
curl -X PATCH https://messenger.example.com/api/website-widgets/7 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Служба поддержки",
    "welcomeMessage": "Напишите нам",
    "primaryColor": "#111827",
    "status": "active"
  }'
```

Допустимые значения `status`:

- `active` — виджет работает;
- `inactive` — публичный API возвращает `404`, виджет на сайте скрывается.

### Перевыпустить публичный ключ

```http
POST /api/website-widgets/:widgetId/rotate-key
```

После ротации обновите `data-widget-key` на сайте. Старый ключ перестанет работать.

## 6. Публичный API

Готовый `widget.js` использует эти маршруты автоматически. Они нужны при разработке
собственного интерфейса.

Полная инструкция для прямой REST-интеграции без готового `widget.js` находится в
[`WEBSITE_WIDGET_API.md`](./WEBSITE_WIDGET_API.md).

### Получить конфигурацию

```http
GET /api/widget/:publicKey/config
```

```json
{
  "widget": {
    "name": "Поддержка сайта",
    "welcomeMessage": "Здравствуйте! Чем можем помочь?",
    "primaryColor": "#2563eb"
  }
}
```

### Создать сессию посетителя

```http
POST /api/widget/:publicKey/sessions
Content-Type: application/json

{
  "name": "Иван",
  "email": "ivan@example.com",
  "phone": "+77001234567"
}
```

Все поля тела необязательны. Если контактные данные переданы, backend также создаст
карточку клиента с источником `website`.

```json
{
  "session": {
    "id": "3d66aa36-05d2-4aa6-a75a-f991bdd60b11",
    "token": "SESSION_TOKEN"
  }
}
```

Токен показывается один раз. В базе хранится только его SHA-256 хеш.

### Отправить сообщение посетителя

```http
POST /api/widget/:publicKey/sessions/:sessionId/messages
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "content": "Здравствуйте! Нужна помощь."
}
```

Текст обязателен, максимальная длина — 5000 символов.

### Передать или обновить данные посетителя

```http
PATCH /api/widget/:publicKey/sessions/:sessionId/profile
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "name": "Иван Иванов",
  "email": "ivan@example.com",
  "phone": "+77001234567"
}
```

Можно передавать только изменившиеся поля. `null` или пустая строка очищают поле.
Данные синхронизируются с сессией, названием чата и карточкой клиента.
В `GET /api/chats` они возвращаются в поле `websiteVisitor`.

### Получить историю

```http
GET /api/widget/:publicKey/sessions/:sessionId/messages?limit=100
Authorization: Bearer <session-token>
```

Максимальный `limit` — 200. Для последующих запросов рекомендуется передавать ID
последнего полученного сообщения:

```http
GET /api/widget/:publicKey/sessions/:sessionId/messages?afterId=456
Authorization: Bearer <session-token>
```

Также поддерживается ISO-курсор `after`, но `afterId` надёжнее:

```text
?after=2026-06-14T12:30:00.000Z
```

## 7. Socket.IO

Namespace: `/widget`.

Подключение собственного клиента:

```js
const socket = io('https://messenger.example.com/widget', {
  transports: ['websocket', 'polling'],
  auth: {
    publicKey: 'wgt_xxxxxxxxxxxxxxxxxxxxxxxx',
    sessionId: '3d66aa36-05d2-4aa6-a75a-f991bdd60b11',
    token: 'SESSION_TOKEN'
  }
});

socket.on('message:new', (message) => {
  console.log('Новое сообщение:', message);
});
```

События:

- `connected` — сессия Socket.IO успешно авторизована;
- `message:new` — новое сообщение посетителя или оператора.

## 8. Хранение и безопасность

- `publicKey` является публичным и находится в HTML страницы.
- Доступ к истории защищён парой `sessionId` + `token`.
- Готовый виджет хранит эту пару в `localStorage` под ключом
  `messenger_widget_session_<publicKey>`.
- Не логируйте session token и не передавайте его в query string.
- Публичные маршруты имеют in-memory rate limit. При запуске нескольких экземпляров
  backend лимит применяется отдельно на каждом экземпляре.
- Виджет доступен с любого домена; ограничение по origin не применяется.
- Маршруты `/api/website-widgets` публичны: клиент может создавать, просматривать и
  изменять виджеты, зная `organizationId` или `widgetId`.

Текущие лимиты:

| Операция | Лимит |
| --- | --- |
| Создание сессии | 120 запросов в минуту на IP и ключ виджета |
| Получение истории | 120 запросов в минуту на IP и сессию |
| Отправка сообщения | 30 запросов в минуту на IP и сессию |

## 9. Reverse proxy

Для Nginx важно разрешить WebSocket upgrade:

```nginx
location / {
    proxy_pass http://messenger_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /socket.io/ {
    proxy_pass http://messenger_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Если WebSocket не настроен, готовый виджет продолжит работать через polling.

## 10. Диагностика

### Кнопка не появилась

- проверьте доступность `/widget.js`;
- проверьте наличие `data-widget-key`;
- откройте Console браузера и найдите `[Messenger Widget]`;
- убедитесь, что виджет имеет статус `active`.

### Виджет пишет «Чат временно недоступен»

- проверьте `data-api-url`;
- проверьте `GET /api/widget/:publicKey/config`;
- убедитесь, что миграция применена;
- проверьте HTTPS и отсутствие mixed content.

### Оператор не может ответить

- чат должен быть назначен ответственному;
- используйте `type: "text"`;
- проверьте, что JWT оператора относится к той же организации;
- проверьте существование сессии сайта у чата.

### Ответ приходит только через несколько секунд

WebSocket недоступен, поэтому включился polling. Проверьте проксирование `/socket.io/`
и WebSocket upgrade-заголовки.

### Создаётся новый чат после очистки браузера

Это ожидаемо: сессия хранится в `localStorage`. После его очистки следующий запуск
виджета создаст новую сессию и новый тикет.
