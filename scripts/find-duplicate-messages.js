const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function findDuplicateMessages() {
  console.log('🔍 Поиск одинаковых сообщений от операторов...\n');
  console.log('📝 Игнорируются: пробелы, регистр\n');

  try {
    // Получаем все сообщения с группировкой по нормализованному тексту
    const duplicates = await prisma.$queryRaw`
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
        AND "fromMe" = true
      GROUP BY LOWER(TRIM(REGEXP_REPLACE(content, '\s+', ' ', 'g')))
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `;

    console.log(`📊 Найдено ${duplicates.length} уникальных шаблонов, которые повторялись\n`);

    duplicates.forEach((dup, index) => {
      console.log(`${index + 1}. Отправлено ${dup.message_count} раз в ${dup.unique_chats} чатах:`);
      console.log(`   Текст: "${dup.original_content.substring(0, 1000)}${dup.original_content.length > 1000 ? '...' : ''}"`);
      console.log(`   Первое: ${dup.first_sent}`);
      console.log(`   Последнее: ${dup.last_sent}`);
      console.log('');
    });

    // Общая статистика
    const stats = await prisma.$queryRaw`
      SELECT 
        'Всего сообщений от операторов' as metric,
        COUNT(*) as value
      FROM "Message"
      WHERE "fromMe" = true
      UNION ALL
      SELECT 
        'Уникальных шаблонов' as metric,
        COUNT(DISTINCT LOWER(TRIM(REGEXP_REPLACE(content, '\s+', ' ', 'g')))) as value
      FROM "Message"
      WHERE content IS NOT NULL
        AND "fromMe" = true
    `;

    console.log('\n📈 Общая статистика:');
    stats.forEach(stat => {
      console.log(`   ${stat.metric}: ${stat.value}`);
    });
    console.log(`   Шаблонов с дубликатами: ${duplicates.length}`);

    // Топ-10 самых частых сообщений
    console.log('\n🔥 Топ-10 самых частых шаблонных сообщений операторов:');
    duplicates.slice(0, 10).forEach((dup, index) => {
      console.log(`${index + 1}. "${dup.original_content.substring(0, 50)}..." - ${dup.message_count} раз в ${dup.unique_chats} чатах`);
    });

  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    await prisma.$disconnect();
  }
}

findDuplicateMessages();
