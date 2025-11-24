-- Миграция для добавления индексов производительности
-- Ускоряет запросы на получение и отправку сообщений

-- ============================================================
-- ИНДЕКСЫ ДЛЯ ТАБЛИЦЫ Message
-- ============================================================

-- Индекс для получения сообщений по chatId с сортировкой по времени (DESC)
-- Используется в: GET /api/chats/:chatId/messages
CREATE INDEX IF NOT EXISTS "idx_message_chatId_timestamp" ON "Message"("chatId", "timestamp" DESC);

-- Индекс для получения сообщений организации с сортировкой по времени
-- Используется для аналитики и общих запросов
CREATE INDEX IF NOT EXISTS "idx_message_organizationId_timestamp" ON "Message"("organizationId", "timestamp" DESC);

-- Индекс для поиска сообщений по номеру телефона отправителя
-- Используется для фильтрации сообщений от конкретного пользователя
CREATE INDEX IF NOT EXISTS "idx_message_senderJid" ON "Message"("senderJid");

-- Индекс для поиска сообщений по номеру телефона получателя
-- Используется для отслеживания входящих сообщений
CREATE INDEX IF NOT EXISTS "idx_message_receivingPhoneJid" ON "Message"("receivingPhoneJid");

-- Составной индекс для поиска непрочитанных сообщений оператором
-- Используется для подсчета непрочитанных сообщений
CREATE INDEX IF NOT EXISTS "idx_message_isReadByOperator_chatId" ON "Message"("isReadByOperator", "chatId") WHERE "isReadByOperator" = false;

-- Индекс для поиска по WhatsApp Message ID (для дедупликации)
CREATE INDEX IF NOT EXISTS "idx_message_whatsappMessageId" ON "Message"("whatsappMessageId");

-- ============================================================
-- ИНДЕКСЫ ДЛЯ ТАБЛИЦЫ Chat
-- ============================================================

-- Индекс для получения чатов организации с сортировкой по последнему сообщению
-- Используется в: GET /api/chats
CREATE INDEX IF NOT EXISTS "idx_chat_organizationId_lastMessageAt" ON "Chat"("organizationId", "lastMessageAt" DESC);

-- Индекс для получения чатов по статусу и организации
-- Используется для фильтрации активных/закрытых чатов
CREATE INDEX IF NOT EXISTS "idx_chat_organizationId_status" ON "Chat"("organizationId", "status");

-- Индекс для получения чатов по приоритету
-- Используется для сортировки чатов по важности
CREATE INDEX IF NOT EXISTS "idx_chat_organizationId_priority" ON "Chat"("organizationId", "priority", "lastMessageAt" DESC);

-- Индекс для поиска чатов по номеру тикета
-- Используется в: POST /api/messages/send-by-ticket
CREATE INDEX IF NOT EXISTS "idx_chat_ticketNumber_organizationId" ON "Chat"("ticketNumber", "organizationId") WHERE "ticketNumber" IS NOT NULL;

-- Индекс для поиска чатов с непрочитанными сообщениями
-- Используется для быстрого получения чатов с непрочитанными
CREATE INDEX IF NOT EXISTS "idx_chat_unreadCount" ON "Chat"("organizationId", "unreadCount" DESC) WHERE "unreadCount" > 0;

-- Индекс для поиска по remoteJid (JID собеседника)
CREATE INDEX IF NOT EXISTS "idx_chat_remoteJid" ON "Chat"("remoteJid");

-- Индекс для поиска по receivingPhoneJid (номер получателя)
CREATE INDEX IF NOT EXISTS "idx_chat_receivingPhoneJid" ON "Chat"("receivingPhoneJid");

-- ============================================================
-- ИНДЕКСЫ ДЛЯ ТАБЛИЦЫ OrganizationPhone
-- ============================================================

-- Индекс для поиска телефонов организации
CREATE INDEX IF NOT EXISTS "idx_organizationPhone_organizationId" ON "OrganizationPhone"("organizationId");

-- Индекс для поиска по статусу подключения
CREATE INDEX IF NOT EXISTS "idx_organizationPhone_status" ON "OrganizationPhone"("status");

-- ============================================================
-- ИНДЕКСЫ ДЛЯ ТАБЛИЦЫ User
-- ============================================================

-- Индекс для поиска пользователей организации
CREATE INDEX IF NOT EXISTS "idx_user_organizationId" ON "User"("organizationId");

-- Индекс для поиска по email (для авторизации)
CREATE INDEX IF NOT EXISTS "idx_user_email" ON "User"("email");

-- ============================================================
-- АНАЛИЗ ТАБЛИЦ ДЛЯ ОБНОВЛЕНИЯ СТАТИСТИКИ
-- ============================================================

-- Обновляем статистику для оптимизатора запросов PostgreSQL
ANALYZE "Message";
ANALYZE "Chat";
ANALYZE "OrganizationPhone";
ANALYZE "User";

