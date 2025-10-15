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
  - Описание: список чатов организации с фильтрами.
  - Query:
    - status: open | pending | closed (опц.)
    - assigned: 'true' | 'false' (опц.) — только назначенные/неназначенные
    - priority: low | normal | high | urgent (опц.)
  - Сортировка: по unreadCount desc, затем lastMessageAt desc
  - Ответ: { chats: [...], total: number }

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
  - Эффект: снимает назначение (assignedUserId = null, status -> 'pending')
  - Ответ: { success, chat, message }

- GET /api/chat-assignment/my-assigned
  - Описание: возвращает чаты организации за период с последним сообщением в диапазоне.
  - Важно: фильтр по назначенному пользователю отключён (assignedUserId закомментирован) по требованиям аналитики — возвращаются ВСЕ чаты организации в периоде. Можно дополнительно сузить по статусу.
  - Query:
    - from: ISO 8601 (опц.) — нижняя граница по lastMessageAt
    - to: ISO 8601 (опц., по умолчанию now) — верхняя граница
    - status: open | pending | closed (опц.)
  - Ответ: { chats: [...], total, filters: { from, to } }

- GET /api/chat-assignment/unassigned
  - Описание: неназначенные чаты организации со статусами open|pending
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

9) WhatsApp сессии (/api/wa)

- POST /api/wa/start — запуск новой WA-сессии (см. waSessionController)

---

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

2) Мои чаты за вчера (все статусы):
curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=2025-07-18T00:00:00Z&to=2025-07-18T23:59:59Z" \
  -H "Authorization: Bearer $TOKEN"

3) Неназначенные чаты за сегодня:
curl -X GET "http://localhost:3000/api/chat-assignment/unassigned?from=$(date -u +%Y-%m-%d)T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN"

4) Отправка текста:
curl -X POST http://localhost:3000/api/messages/send-text \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"organizationPhoneId":1,"receiverJid":"79001234567@s.whatsapp.net","text":"Привет!"}'

5) Медиа: upload+send по chatId:
curl -X POST http://localhost:3000/api/media/send \
  -H "Authorization: Bearer $TOKEN" \
  -F "media=@/path/to/file.jpg" \
  -F "chatId=123" \
  -F "mediaType=image" \
  -F "caption=Фото"

