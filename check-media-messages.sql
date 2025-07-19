-- SQL запросы для проверки сохранения медиафайлов

-- 1. Посмотреть все медиафайлы в базе данных
SELECT 
    id,
    chatId,
    type,
    content,
    mediaUrl,
    filename,
    mimeType,
    size,
    timestamp,
    fromMe,
    senderJid
FROM "Message" 
WHERE type IN ('image', 'video', 'document', 'audio')
ORDER BY timestamp DESC
LIMIT 20;

-- 2. Посмотреть медиафайлы для конкретного чата
SELECT 
    id,
    type,
    content,
    mediaUrl,
    filename,
    mimeType,
    size,
    timestamp,
    fromMe
FROM "Message" 
WHERE chatId = 1 -- Замените на нужный ID чата
  AND type IN ('image', 'video', 'document', 'audio')
ORDER BY timestamp DESC;

-- 3. Статистика медиафайлов по типам
SELECT 
    type,
    COUNT(*) as count,
    AVG(size) as avg_size,
    SUM(size) as total_size
FROM "Message" 
WHERE type IN ('image', 'video', 'document', 'audio')
  AND size IS NOT NULL
GROUP BY type;

-- 4. Найти медиафайлы без сохраненного URL (потенциальные проблемы)
SELECT 
    id,
    chatId,
    type,
    filename,
    timestamp
FROM "Message" 
WHERE type IN ('image', 'video', 'document', 'audio')
  AND (mediaUrl IS NULL OR mediaUrl = '');

-- 5. Последние 10 отправленных медиафайлов с информацией о пользователях
SELECT 
    m.id,
    m.type,
    m.filename,
    m.mediaUrl,
    m.timestamp,
    u.name as sender_name,
    c.name as chat_name
FROM "Message" m
LEFT JOIN "User" u ON m.senderUserId = u.id
LEFT JOIN "Chat" c ON m.chatId = c.id
WHERE m.type IN ('image', 'video', 'document', 'audio')
  AND m.fromMe = true
ORDER BY m.timestamp DESC
LIMIT 10;
