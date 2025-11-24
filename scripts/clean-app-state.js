/**
 * Утилита для очистки поврежденных данных app state синхронизации Baileys
 * Используется для исправления ошибок "bad decrypt" при синхронизации critical_unblock_low
 * 
 * Использование:
 * node scripts/clean-app-state.js [phoneJid] [organizationId]
 * 
 * Примеры:
 * node scripts/clean-app-state.js 77051234567 1  # Очистить для конкретного номера
 * node scripts/clean-app-state.js all            # Очистить для всех номеров
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanAppState(phoneJid, organizationId) {
  console.log(`\n🧹 Очистка app state данных...`);
  console.log(`Номер: ${phoneJid || 'ВСЕ'}`);
  console.log(`Организация: ${organizationId || 'ВСЕ'}\n`);

  try {
    const where = {};
    
    if (phoneJid && phoneJid !== 'all') {
      // Извлекаем только номер из JID (убираем @s.whatsapp.net если есть)
      const key = phoneJid.split('@')[0].split(':')[0];
      where.phoneJid = key;
    }
    
    if (organizationId) {
      where.organizationId = parseInt(organizationId);
    }

    // Получаем статистику перед удалением
    const totalBefore = await prisma.baileysAuth.count({ where });
    const appStateCount = await prisma.baileysAuth.count({
      where: {
        ...where,
        OR: [
          { key: { startsWith: 'app-state-sync-' } },
          { key: { startsWith: 'critical_unblock_low' } },
          { key: { startsWith: 'critical_block' } },
          { key: { startsWith: 'regular_low' } },
          { key: { startsWith: 'regular_high' } },
          { key: { startsWith: 'regular' } }
        ]
      }
    });

    console.log(`📊 Статистика ПЕРЕД очисткой:`);
    console.log(`   Всего записей: ${totalBefore}`);
    console.log(`   App state записей: ${appStateCount}`);

    if (appStateCount === 0) {
      console.log(`\n✅ Нет app state данных для удаления.`);
      return;
    }

    // Удаляем app state данные
    const deleted = await prisma.baileysAuth.deleteMany({
      where: {
        ...where,
        OR: [
          { key: { startsWith: 'app-state-sync-' } },
          { key: { startsWith: 'critical_unblock_low' } },
          { key: { startsWith: 'critical_block' } },
          { key: { startsWith: 'regular_low' } },
          { key: { startsWith: 'regular_high' } },
          { key: { startsWith: 'regular' } }
        ]
      }
    });

    const totalAfter = await prisma.baileysAuth.count({ where });

    console.log(`\n📊 Статистика ПОСЛЕ очистки:`);
    console.log(`   Удалено записей: ${deleted.count}`);
    console.log(`   Осталось записей: ${totalAfter}`);
    console.log(`\n✅ Очистка завершена успешно!`);
    console.log(`\n💡 Важно: Основные данные авторизации (creds, keys) сохранены.`);
    console.log(`   Переподключение к WhatsApp не требуется.`);
    console.log(`   App state будет синхронизирован заново при следующем подключении.`);

  } catch (error) {
    console.error(`\n❌ Ошибка при очистке app state:`, error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Обработка аргументов командной строки
const args = process.argv.slice(2);
const phoneJid = args[0];
const organizationId = args[1];

if (!phoneJid) {
  console.error(`\n❌ Ошибка: Не указан номер телефона`);
  console.log(`\nИспользование:`);
  console.log(`  node scripts/clean-app-state.js <phoneJid> [organizationId]`);
  console.log(`\nПримеры:`);
  console.log(`  node scripts/clean-app-state.js 77051234567 1`);
  console.log(`  node scripts/clean-app-state.js all`);
  console.log(`  node scripts/clean-app-state.js all 1`);
  process.exit(1);
}

cleanAppState(phoneJid, organizationId)
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
