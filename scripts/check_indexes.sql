-- ============================================================================
-- Скрипт для проверки и анализа индексов производительности
-- ============================================================================
-- 
-- Использование:
--   psql -U shrvse -d messenger_local -f check_indexes.sql
--
-- ============================================================================

\set ON_ERROR_STOP on

\echo ''
\echo '═══════════════════════════════════════════════════════════'
\echo '  📊 АНАЛИЗ ИНДЕКСОВ БАЗЫ ДАННЫХ'
\echo '═══════════════════════════════════════════════════════════'
\echo ''

-- ============================================================
-- 1. СПИСОК ВСЕХ ИНДЕКСОВ
-- ============================================================

\echo '1️⃣  Список всех индексов:'
\echo ''

SELECT 
    schemaname AS "Схема",
    tablename AS "Таблица",
    indexname AS "Индекс",
    CASE 
        WHEN idx_scan = 0 THEN '❌ Не используется'
        WHEN idx_scan < 100 THEN '⚠️  Редко'
        WHEN idx_scan < 1000 THEN '✅ Средне'
        ELSE '🔥 Часто'
    END AS "Использование",
    idx_scan AS "Кол-во сканирований",
    idx_tup_read AS "Строк прочитано",
    pg_size_pretty(pg_relation_size(indexrelid)) AS "Размер"
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC, tablename, indexname;

\echo ''
\echo '─────────────────────────────────────────────────────────────'
\echo ''

-- ============================================================
-- 2. НЕИСПОЛЬЗУЕМЫЕ ИНДЕКСЫ
-- ============================================================

\echo '2️⃣  Неиспользуемые индексы (кандидаты на удаление):'
\echo ''

SELECT 
    schemaname AS "Схема",
    tablename AS "Таблица",
    indexname AS "Индекс",
    pg_size_pretty(pg_relation_size(indexrelid)) AS "Размер (потери)",
    'DROP INDEX ' || indexname || ';' AS "Команда удаления"
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0
  AND indexname NOT LIKE '%_pkey'
  AND indexname NOT LIKE '%_key'
ORDER BY pg_relation_size(indexrelid) DESC;

\echo ''
\echo '⚠️  ВНИМАНИЕ: Проверьте эти индексы - они не использовались!'
\echo ''
\echo '─────────────────────────────────────────────────────────────'
\echo ''

-- ============================================================
-- 3. РАЗМЕР ТАБЛИЦ И ИНДЕКСОВ
-- ============================================================

\echo '3️⃣  Размер таблиц и их индексов:'
\echo ''

SELECT 
    schemaname AS "Схема",
    tablename AS "Таблица",
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS "Общий размер",
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS "Размер таблицы",
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS "Размер индексов"
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

\echo ''
\echo '─────────────────────────────────────────────────────────────'
\echo ''

-- ============================================================
-- 4. СТАТИСТИКА ТАБЛИЦ
-- ============================================================

\echo '4️⃣  Статистика таблиц:'
\echo ''

SELECT 
    schemaname AS "Схема",
    relname AS "Таблица",
    n_tup_ins AS "Вставок",
    n_tup_upd AS "Обновлений",
    n_tup_del AS "Удалений",
    n_live_tup AS "Живых строк",
    n_dead_tup AS "Мертвых строк",
    CASE 
        WHEN n_live_tup > 0 THEN 
            ROUND(100.0 * n_dead_tup / n_live_tup, 2)
        ELSE 0
    END AS "% мертвых",
    last_vacuum AS "Последний VACUUM",
    last_autovacuum AS "Последний AUTOVACUUM"
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;

\echo ''
\echo '💡 Если "% мертвых" > 10% - рекомендуется VACUUM'
\echo ''
\echo '─────────────────────────────────────────────────────────────'
\echo ''

-- ============================================================
-- 5. ПРОВЕРКА СПЕЦИФИЧНЫХ ИНДЕКСОВ ПРОИЗВОДИТЕЛЬНОСТИ
-- ============================================================

\echo '5️⃣  Проверка индексов производительности (добавленных в миграции):'
\echo ''

SELECT 
    indexname AS "Индекс",
    tablename AS "Таблица",
    CASE 
        WHEN idx_scan > 0 THEN '✅ Работает (' || idx_scan || ' сканирований)'
        ELSE '❌ Не используется'
    END AS "Статус"
FROM pg_stat_user_indexes
WHERE indexname IN (
    'idx_message_chatId_timestamp',
    'idx_message_organizationId_timestamp',
    'idx_message_senderJid',
    'idx_message_receivingPhoneJid',
    'idx_message_isReadByOperator_chatId',
    'idx_message_whatsappMessageId',
    'idx_chat_organizationId_lastMessageAt',
    'idx_chat_organizationId_status',
    'idx_chat_organizationId_priority',
    'idx_chat_ticketNumber_organizationId',
    'idx_chat_unreadCount',
    'idx_chat_remoteJid',
    'idx_chat_receivingPhoneJid',
    'idx_organizationPhone_organizationId',
    'idx_organizationPhone_status',
    'idx_user_organizationId',
    'idx_user_email'
)
ORDER BY tablename, indexname;

\echo ''
\echo '─────────────────────────────────────────────────────────────'
\echo ''

-- ============================================================
-- 6. CACHE HIT RATIO
-- ============================================================

\echo '6️⃣  Cache Hit Ratio (эффективность кэша):'
\echo ''

SELECT 
    CASE 
        WHEN sum(blks_hit) + sum(blks_read) = 0 THEN 'N/A'
        ELSE ROUND(100.0 * sum(blks_hit) / (sum(blks_hit) + sum(blks_read)), 2)::text || '%'
    END AS "Cache Hit Ratio",
    CASE 
        WHEN sum(blks_hit) + sum(blks_read) > 0 THEN
            CASE 
                WHEN 100.0 * sum(blks_hit) / (sum(blks_hit) + sum(blks_read)) > 99 THEN '🔥 Отлично'
                WHEN 100.0 * sum(blks_hit) / (sum(blks_hit) + sum(blks_read)) > 90 THEN '✅ Хорошо'
                WHEN 100.0 * sum(blks_hit) / (sum(blks_hit) + sum(blks_read)) > 80 THEN '⚠️  Приемлемо'
                ELSE '❌ Плохо - увеличьте shared_buffers'
            END
        ELSE 'N/A'
    END AS "Оценка"
FROM pg_stat_database
WHERE datname = current_database();

\echo ''
\echo '💡 Cache Hit Ratio должен быть > 99% для оптимальной производительности'
\echo ''
\echo '─────────────────────────────────────────────────────────────'
\echo ''

-- ============================================================
-- 7. АКТИВНЫЕ СОЕДИНЕНИЯ
-- ============================================================

\echo '7️⃣  Активные соединения к базе данных:'
\echo ''

SELECT 
    COUNT(*) AS "Всего соединений",
    COUNT(*) FILTER (WHERE state = 'active') AS "Активных",
    COUNT(*) FILTER (WHERE state = 'idle') AS "Idle",
    COUNT(*) FILTER (WHERE state = 'idle in transaction') AS "Idle in transaction",
    COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL) AS "Ожидающих"
FROM pg_stat_activity
WHERE datname = current_database();

\echo ''

-- Детали активных запросов
SELECT 
    pid AS "PID",
    usename AS "Пользователь",
    application_name AS "Приложение",
    state AS "Состояние",
    wait_event_type AS "Ожидание",
    EXTRACT(EPOCH FROM (now() - query_start))::int AS "Время (сек)",
    LEFT(query, 80) AS "Запрос"
FROM pg_stat_activity
WHERE datname = current_database()
  AND state != 'idle'
  AND pid != pg_backend_pid()
ORDER BY query_start;

\echo ''
\echo '─────────────────────────────────────────────────────────────'
\echo ''

-- ============================================================
-- 8. РЕКОМЕНДАЦИИ ПО ОПТИМИЗАЦИИ
-- ============================================================

\echo '8️⃣  Рекомендации по оптимизации:'
\echo ''

WITH stats AS (
    SELECT 
        schemaname,
        tablename,
        n_live_tup,
        n_dead_tup,
        last_vacuum,
        last_autovacuum
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
)
SELECT 
    '⚠️  Таблица ' || tablename || ' требует VACUUM' AS "Рекомендация",
    'VACUUM ANALYZE ' || tablename || ';' AS "Команда"
FROM stats
WHERE n_live_tup > 0 
  AND (100.0 * n_dead_tup / n_live_tup) > 10
UNION ALL
SELECT 
    '💡 Таблица ' || tablename || ' не имеет статистики' AS "Рекомендация",
    'ANALYZE ' || tablename || ';' AS "Команда"
FROM stats
WHERE last_vacuum IS NULL AND last_autovacuum IS NULL AND n_live_tup > 100;

\echo ''
\echo '═══════════════════════════════════════════════════════════'
\echo '  ✅ АНАЛИЗ ЗАВЕРШЕН'
\echo '═══════════════════════════════════════════════════════════'
\echo ''
