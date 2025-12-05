-- Найти одинаковые сообщения (по тексту) отправленные операторами
-- Игнорируются пробелы и регистр
SELECT 
    MIN(content) as original_content,
    LOWER(TRIM(REGEXP_REPLACE(content, '\s+', ' ', 'g'))) as normalized_content,
    COUNT(*) as message_count,
    MIN("createdAt") as first_sent,
    MAX("createdAt") as last_sent,
    COUNT(DISTINCT "chatId") as unique_chats
FROM "Message"
WHERE content IS NOT NULL 
  AND content != ''
  AND "fromMe" = true  -- Только сообщения от операторов
GROUP BY LOWER(TRIM(REGEXP_REPLACE(content, '\s+', ' ', 'g')))
HAVING COUNT(*) > 1
ORDER BY message_count DESC
LIMIT 50;

-- Найти одинаковые сообщения с деталями (только от операторов)
SELECT 
    MIN(m.content) as original_content,
    LOWER(TRIM(REGEXP_REPLACE(m.content, '\s+', ' ', 'g'))) as normalized_content,
    COUNT(*) as total_count,
    json_agg(
        json_build_object(
            'messageId', m.id,
            'chatId', m."chatId",
            'chatName', c.name,
            'content', m.content,
            'createdAt', m."createdAt"
        ) ORDER BY m."createdAt"
    ) as messages
FROM "Message" m
LEFT JOIN "Chat" c ON c.id = m."chatId"
WHERE m.content IS NOT NULL 
  AND m.content != ''
  AND m."fromMe" = true  -- Только сообщения от операторов
GROUP BY LOWER(TRIM(REGEXP_REPLACE(m.content, '\s+', ' ', 'g')))
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;

-- Статистика по дубликатам (только сообщения от операторов)
SELECT 
    'Всего сообщений от операторов' as metric,
    COUNT(*) as value
FROM "Message"
WHERE "fromMe" = true
UNION ALL
SELECT 
    'Уникальных текстов (нормализованных)' as metric,
    COUNT(DISTINCT LOWER(TRIM(REGEXP_REPLACE(content, '\s+', ' ', 'g')))) as value
FROM "Message"
WHERE content IS NOT NULL
  AND "fromMe" = true
UNION ALL
SELECT 
    'Дубликатов (более 1 раза)' as metric,
    COUNT(*) as value
FROM (
    SELECT LOWER(TRIM(REGEXP_REPLACE(content, '\s+', ' ', 'g'))) as normalized
    FROM "Message"
    WHERE content IS NOT NULL
      AND "fromMe" = true
    GROUP BY LOWER(TRIM(REGEXP_REPLACE(content, '\s+', ' ', 'g')))
    HAVING COUNT(*) > 1
) as duplicates;
