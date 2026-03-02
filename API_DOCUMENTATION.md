# Полная документация API

Эта документация описывает все доступные REST-эндпоинты бэкенда. Все защищенные маршруты требуют заголовок Authorization с JWT.

Базовый URL: http://localhost:3000

Версия Node/Express: Express 5, TypeScript. БД: PostgreSQL (Prisma ORM).

Авторизация: Bearer JWT (содержит userId и organizationId, срок жизни 7 дней).

Пример заголовка:
Authorization: Bearer YOUR_JWT_TOKEN

Получить токен:
- POST /api/auth/login
  - Body: { "email": "user@example.com", "password": "secret" }
  - Response: { "token": "...", "user": { "id": 1, "email": "..." } }

---

Разделы:
- Чаты: /api/chats
- Назначение чатов: /api/chat-assignment
- Непрочитанные/статистика: /api/unread и /api/message-read
- Сообщения: /api/messages
- Медиа: /api/media
- Организации: /api/organizations
- Пользователи: /api/users
- Аккаунты и номера: /api/accounts, /api/organization-phones
- WhatsApp сессии: /api/wa

---

1) Чаты (/api/chats)

- GET /api/chats
  - Описание: список чатов организации с фильтрами и поиском.
  - Query:
    - status: open | closed или несколько через запятую: open,closed (опц.)
    - assigned: 'true' | 'false' (опц.) — только назначенные/неназначенные
    - assignedUserId: number (опц.) — фильтр по конкретному оператору (по умолчанию текущий пользователь, если assigned='true')
    - priority: low | normal | high | urgent (опц.)
    - channel: whatsapp | telegram (опц.)
    - includeProfile: true|false (опц.) — добавляет displayName из Chat.name
    - search: string (опц.) — поиск по тексту сообщения, номеру телефона или имени чата
    - searchType: 'message' | 'phone' | 'all' (опц., по умолчанию 'all') — тип поиска:
      - 'message' — поиск только по тексту сообщений
      - 'phone' — поиск по номеру телефона, remoteJid или имени чата
      - 'all' — поиск по обоим критериям
    - limit: number (опц., по умолчанию 50, максимум 100)
    - offset: number (опц., по умолчанию 0) — для пагинации
    - sortBy: lastMessageAt | createdAt | priority | unreadCount | status | name (опц.)
    - sortOrder: asc | desc (опц., по умолчанию desc)
  - Сортировка: по умолчанию по priority DESC, затем unreadCount DESC, затем lastMessageAt DESC
  - Ответ: { chats: [...], pagination: { total, limit, offset, hasMore } }
- GET /api/chats/:remoteJid/profile?organizationPhoneId=ID
  - Описание: вернуть фото профиля для собеседника (если доступно по приватности)
  - Ответ: { jid, photoUrl|null }


- GET /api/chats/:chatId/messages
  - Описание: сообщения конкретного чата (хронологически по возрастанию timestamp)
  - Ответ: { messages: [...] } (включает senderUser при наличии)

2) Назначение чатов (/api/chat-assignment) — требуется JWT

- POST /api/chat-assignment/assign
  - Body: { chatId: number, operatorId: number, priority?: 'low'|'normal'|'high'|'urgent' }
  - Эффект: назначает чат оператору, status -> 'open', assignedAt = now
  - Ответ: { success, chat, message }

- POST /api/chat-assignment/unassign
  - Body: { chatId: number }
  - Эффект: снимает назначение (assignedUserId = null, status остаётся 'open')
  - Ответ: { success, chat, message }

- GET /api/chat-assignment/my-assigned
  - Описание: возвращает чаты организации за период с последним сообщением в диапазоне.
  - Важно: фильтр по назначенному пользователю отключён (assignedUserId закомментирован) по требованиям аналитики — возвращаются ВСЕ чаты организации в периоде. Можно дополнительно сузить по статусу.
  - Query:
    - from: ISO 8601 (опц.) — нижняя граница по lastMessageAt
    - to: ISO 8601 (опц., по умолчанию now) — верхняя граница
    - status: open | closed (опц.)
  - Ответ: { chats: [...], total, filters: { from, to } }

- GET /api/chat-assignment/unassigned
  - Описание: неназначенные чаты организации со статусом open
  - Query: from, to (как выше)
  - Ответ: { chats: [...], total, filters }

- POST /api/chat-assignment/priority
  - Body: { chatId: number, priority: 'low'|'normal'|'high'|'urgent' }
  - Эффект: меняет приоритет чата
  - Ответ: { success, chat, message }

- POST /api/chat-assignment/close
  - Body: { chatId: number, reason?: string }
  - Эффект: закрывает чат (status -> 'closed', unreadCount = 0)
  - Ответ: { success, chat, message }

3) Непрочитанные и статистика

Маршруты /api/unread (JWT):
- POST /api/unread/:chatId/mark-read
  - Body (опц.): { messageIds: number[] } — если не указано, отметит все входящие непрочитанные
  - Эффект: помечает сообщения как прочитанные, обновляет unreadCount в чате
  - Ответ: { success, markedCount, unreadCount }

- POST /api/unread/:chatId/mark-chat-read
  - Эффект: весь чат как прочитанный (все входящие)
  - Ответ: { success, markedCount }

- GET /api/unread/counts
  - Описание: агрегированная статистика непрочитанных по организации
  - Ответ: { total: { unreadMessages, chatsWithUnread }, assigned: { unreadMessages, chatsWithUnread } }

- GET /api/unread/chats?assignedOnly=true|false
  - Возвращает чаты с unreadCount > 0

Маршруты /api/message-read (JWT):
- POST /api/message-read/:chatId/read (и /:chatId/mark-read)
- GET /api/message-read/unread-count
- GET /api/message-read/stats

4) Сообщения (/api/messages)

- POST /api/messages/send-text (JWT)
  - Body: { organizationPhoneId: number, receiverJid: string, text: string }
  - Ответ: { success: true, messageId }

- POST /api/messages/send-media (JWT)
  - Body: { organizationPhoneId: number, receiverJid: string, mediaType: 'image'|'video'|'document'|'audio', mediaPath: string, caption?: string, filename?: string }
  - Ответ: { success, messageId, mediaType, caption }

5) Медиа (/api/media) — JWT, multipart где нужно

- POST /api/media/send
  - Описание: загрузить файл и отправить в чат по chatId
  - FormData: media: <file>, chatId: number, mediaType: image|video|document|audio, caption?: string
  - Ответ: { success, messageId, chatId, mediaType, fileName, fileUrl, size, caption }

- POST /api/media/upload
  - Описание: просто загрузить файл (без отправки)
  - FormData: media: <file>, mediaType: image|video|document|audio
  - Ответ: { success, fileName, fileUrl, filePath, mediaType, size, mimeType }

- POST /api/media/send-by-chat
  - Описание: отправить медиа по chatId, используя mediaPath (URL или путь)
  - Body: { chatId: number, mediaType: 'image'|'video'|'document'|'audio', mediaPath: string, caption?: string, filename?: string }
  - Ответ: { success, messageId, chatId, mediaType, caption }

Заметка про fileUrl: статическая раздача настроена на /public; по умолчанию пути вида /media/... доступны с корня сервера. Убедитесь, что public доступен в рантайме.

6) Организации (/api/organizations) — JWT

- POST /api/organizations
  - Body: { name: string }
  - Ответ: созданная организация

- GET /api/organizations
  - Ответ: список организаций

7) Пользователи (/api/users) — JWT

- POST /api/users
  - Body: { email, password, name, role? }
  - Ответ: созданный пользователь (без passwordHash)

- GET /api/users/all
  - Ответ: пользователи организации

- GET /api/users/me
  - Ответ: текущий пользователь (id, email, role, organizationId, createdAt)

8) Аккаунты и номера WhatsApp

- /api/accounts (JWT)
  - POST /api/accounts — создать запись номера (phoneJid, displayName)

- /api/organization-phones (JWT)
  - POST / — создать номер (phoneJid, displayName)
  - GET /all — список номеров с полями и статусом
  - POST /:organizationPhoneId/connect — инициировать подключение (Baileys, QR сохраняется в БД)
  - DELETE /:organizationPhoneId/disconnect — выход из сессии

Подробная документация: см. ORGANIZATION_PHONES_API.md

9) WhatsApp сессии (/api/wa)

- POST /api/wa/start — запуск новой WA-сессии (см. waSessionController)

10) Комментарии к контактам (/api/clients/:id/comments) — JWT

- GET /api/clients/:id/comments
  - Описание: вернуть список комментариев к контакту (клиенту) организации.
  - Ответ: { comments: [{ id, content, createdAt, user: { id, name, email } }] }
  - Коды ошибок: 401 (нет org), 404 (контакт не найден), 500.

- POST /api/clients/:id/comments
  - Описание: добавить комментарий к контакту. Автор — текущий пользователь.
  - Body: { content: string } — обязателен, непустая строка.
  - Ответ 201: { id, content, createdAt, user: { id, name, email } }
  - Коды ошибок: 400 (пустой content или неверный id), 401 (нет user/org), 404 (контакт не найден), 500.

11) Комментарии к чатам (/api/chats/:chatId/comments) — JWT

- GET /api/chats/:chatId/comments
  - Описание: получить комментарии чата организации.
  - Query: limit (опц., по умолчанию 50), offset (опц.).
  - Ответ: { comments: [{ id, content, createdAt, user: { id, name, email } }], pagination }
  - Коды ошибок: 401 (нет org), 404 (чат не найден), 500.

- POST /api/chats/:chatId/comments
  - Описание: добавить комментарий к чату. Автор — текущий пользователь.
  - Body: { content: string } — обязателен, непустая строка.
  - Ответ 201: { id, content, createdAt, user: { id, name, email } }
  - Коды ошибок: 400 (пустой content или неверный chatId), 401 (нет user/org), 404 (чат не найден), 500.

12) Workforce presence (internal)

- PATCH /api/workforce/internal/employees/:id/presence
  - Авторизация: Bearer service token (Keycloak client_credentials) с ролью employee-service-access.
  - Body: { status: string }
  - Ответ 200: presence объект от naliv-emp.
  - Коды ошибок: 400 (нет status или некорректный), 401 (нет/невалидный токен или нет роли), 404/409/503 проксируются как 502/503 в зависимости от naliv-emp.

13) Workforce presence heartbeat (JWT)

- POST /api/workforce/presence/heartbeat
  - Авторизация: Bearer user JWT (тот же, что в приложении).
  - Эффект: ставит сотрудника ONLINE в naliv-emp и планирует OFFLINE через PRESENCE_INACTIVITY_MS (по умолчанию 300000 мс), если не придёт следующий heartbeat.
  - Ответ 200: { success: true, status: 'online', employeeId, ttlMs }
  - Коды ошибок: 400 (нет ключевых данных), 401 (нет/невалидный JWT), 404/409/503 мапятся из naliv-emp.

---

Деплой и запуск

Вариант A: Docker Compose (локально/сервер)
- Требования: Docker, Docker Compose
- Файлы: Dockerfile, docker-compose.yml, .dockerignore
- Шаги:
  1) Собрать и поднять всё: docker compose up -d --build
  2) API будет доступен на http://localhost:3000
  3) Prisma применит миграции автоматически на старте контейнера

Вариант B: Docker (только образ API)
- Собрать: docker build -t messenger-backend:latest .
- Запустить с внешним Postgres:
  docker run -p 3000:3000 \
    -e DATABASE_URL="postgresql://USER:PASS@HOST:5432/DB?schema=public" \
    -e JWT_SECRET="your-secret" \
    messenger-backend:latest

Примечания по окружению
- PORT (дефолт 3000)
- DATABASE_URL (PostgreSQL)
- JWT_SECRET (обязателен для прод)


Ошибки (общие коды)
- 400 — некорректные параметры
- 401 — неавторизовано (или не заполнен res.locals, отсутствует JWT)
- 403 — недостаточно прав
- 404 — ресурс не найден
- 413 — файл слишком большой
- 415 — неподдерживаемый тип медиа
- 500 — внутренняя ошибка
- 503 — WhatsApp сокет не готов / не подключен

Ограничения по файлам (проверяются валидацией):
- Изображения: до ~10 МБ
- Видео: до ~50 МБ
- Документы: до ~20 МБ
- Аудио: до ~15 МБ

Поддерживаемые форматы:
- Изображения: JPEG, PNG, GIF, WebP
- Видео: MP4, AVI, MOV, WMV, WebM
- Документы: PDF, DOC, DOCX, XLS, XLSX, TXT, CSV
- Аудио: MP3, WAV, OGG, M4A

Примеры запросов (curl)

1) Логин:
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"secret"}'

2) Получить все чаты организации:
curl -X GET "http://localhost:3000/api/chats" \
  -H "Authorization: Bearer $TOKEN"

3) Получить чаты только со статусом "open":
curl -X GET "http://localhost:3000/api/chats?status=open" \
  -H "Authorization: Bearer $TOKEN"

4) Получить чаты со статусами "open" или "closed":
curl -X GET "http://localhost:3000/api/chats?status=open,closed" \
  -H "Authorization: Bearer $TOKEN"

5) Поиск чатов по номеру телефона:
curl -X GET "http://localhost:3000/api/chats?search=79001234567&searchType=phone" \
  -H "Authorization: Bearer $TOKEN"

6) Поиск чатов по тексту сообщения:
curl -X GET "http://localhost:3000/api/chats?search=привет&searchType=message" \
  -H "Authorization: Bearer $TOKEN"

7) Поиск по номеру телефона И тексту:
curl -X GET "http://localhost:3000/api/chats?search=hello&searchType=all" \
  -H "Authorization: Bearer $TOKEN"

8) Мои чаты за вчера (все статусы):
curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=2025-07-18T00:00:00Z&to=2025-07-18T23:59:59Z" \
  -H "Authorization: Bearer $TOKEN"

9) Неназначенные чаты за сегодня:
curl -X GET "http://localhost:3000/api/chat-assignment/unassigned?from=$(date -u +%Y-%m-%d)T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN"

10) Отправка текста:
curl -X POST http://localhost:3000/api/messages/send-text \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"organizationPhoneId":1,"receiverJid":"79001234567@s.whatsapp.net","text":"Привет!"}'

11) Медиа: upload+send по chatId:
curl -X POST http://localhost:3000/api/media/send \
  -H "Authorization: Bearer $TOKEN" \
  -F "media=@/path/to/file.jpg" \
  -F "chatId=123" \
  -F "mediaType=image" \
  -F "caption=Фото"

