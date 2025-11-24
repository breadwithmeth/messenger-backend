#!/usr/bin/env node

/**
 * Скрипт для удаления всех чатов и сообщений из базы данных
 * 
 * ВНИМАНИЕ: Это действие НЕОБРАТИМО!
 * Все чаты и сообщения будут удалены безвозвратно.
 * 
 * Использование:
 *   node scripts/clear-all-chats-messages.js
 *   node scripts/clear-all-chats-messages.js --confirm
 *   node scripts/clear-all-chats-messages.js --organization=1
 *   node scripts/clear-all-chats-messages.js --organization=1 --confirm
 * 
 * Параметры:
 *   --confirm          Пропустить подтверждение (осторожно!)
 *   --organization=N   Удалить только для указанной организации
 *   --dry-run          Показать что будет удалено, но не удалять
 */

const { PrismaClient } = require('@prisma/client');
const readline = require('readline');

const prisma = new PrismaClient();

// Парсинг аргументов командной строки
const args = process.argv.slice(2);
const hasConfirm = args.includes('--confirm');
const isDryRun = args.includes('--dry-run');
const orgArg = args.find(arg => arg.startsWith('--organization='));
const organizationId = orgArg ? parseInt(orgArg.split('=')[1]) : null;

// Создание интерфейса для ввода
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Запрашивает подтверждение у пользователя
 */
function askConfirmation(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Получает статистику перед удалением
 */
async function getStats() {
  const where = organizationId ? { organizationId } : {};
  
  const [messageCount, chatCount, organizations] = await Promise.all([
    prisma.message.count({ where }),
    prisma.chat.count({ where }),
    organizationId 
      ? prisma.organization.findUnique({ 
          where: { id: organizationId },
          select: { id: true, name: true }
        })
      : prisma.organization.findMany({
          select: { id: true, name: true }
        })
  ]);

  return { messageCount, chatCount, organizations };
}

/**
 * Удаляет все сообщения и чаты
 */
async function clearAll() {
  const where = organizationId ? { organizationId } : {};
  
  console.log('\n🗑️  Удаление данных...\n');
  
  // 1. Удаляем все сообщения
  console.log('📨 Удаление сообщений...');
  const deletedMessages = await prisma.message.deleteMany({ where });
  console.log(`   ✅ Удалено сообщений: ${deletedMessages.count}`);
  
  // 2. Удаляем все чаты
  console.log('💬 Удаление чатов...');
  const deletedChats = await prisma.chat.deleteMany({ where });
  console.log(`   ✅ Удалено чатов: ${deletedChats.count}`);
  
  return { deletedMessages: deletedMessages.count, deletedChats: deletedChats.count };
}

/**
 * Основная функция
 */
async function main() {
  try {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   🗑️  УДАЛЕНИЕ ВСЕХ ЧАТОВ И СООБЩЕНИЙ                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    if (isDryRun) {
      console.log('🔍 Режим DRY RUN - данные НЕ будут удалены\n');
    }

    // Получаем статистику
    console.log('📊 Получение статистики...\n');
    const stats = await getStats();

    // Показываем что будет удалено
    console.log('📋 Текущее состояние базы данных:\n');
    
    if (organizationId) {
      if (!stats.organizations) {
        console.error(`❌ Организация с ID ${organizationId} не найдена!`);
        process.exit(1);
      }
      console.log(`   Организация: ${stats.organizations.name} (ID: ${stats.organizations.id})`);
    } else {
      console.log(`   Организаций: ${stats.organizations.length}`);
      stats.organizations.forEach(org => {
        console.log(`   - ${org.name} (ID: ${org.id})`);
      });
    }
    
    console.log(`   Сообщений: ${stats.messageCount}`);
    console.log(`   Чатов: ${stats.chatCount}`);
    console.log('');

    if (stats.messageCount === 0 && stats.chatCount === 0) {
      console.log('ℹ️  База данных уже пуста. Нечего удалять.');
      rl.close();
      await prisma.$disconnect();
      return;
    }

    // Предупреждение
    console.log('⚠️  ВНИМАНИЕ! Это действие НЕОБРАТИМО!\n');
    console.log('Будет удалено:');
    console.log(`   • ${stats.messageCount} сообщений`);
    console.log(`   • ${stats.chatCount} чатов`);
    if (organizationId) {
      console.log(`   • Только для организации ID: ${organizationId}`);
    } else {
      console.log(`   • Для ВСЕХ ${stats.organizations.length} организаций`);
    }
    console.log('');

    if (isDryRun) {
      console.log('✅ DRY RUN завершен. Данные НЕ были удалены.\n');
      rl.close();
      await prisma.$disconnect();
      return;
    }

    // Запрос подтверждения
    if (!hasConfirm) {
      const confirmed = await askConfirmation('❓ Вы уверены? Введите "yes" или "y" для подтверждения: ');
      
      if (!confirmed) {
        console.log('\n❌ Операция отменена пользователем.\n');
        rl.close();
        await prisma.$disconnect();
        return;
      }

      // Дополнительное подтверждение для полного удаления
      if (!organizationId) {
        const doubleConfirmed = await askConfirmation('⚠️  ЭТО УДАЛИТ ВСЕ ДАННЫЕ ВСЕХ ОРГАНИЗАЦИЙ! Подтвердите еще раз (yes/y): ');
        
        if (!doubleConfirmed) {
          console.log('\n❌ Операция отменена пользователем.\n');
          rl.close();
          await prisma.$disconnect();
          return;
        }
      }
    }

    // Закрываем интерфейс ввода
    rl.close();

    // Выполняем удаление
    const result = await clearAll();

    // Итоговый отчет
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   ✅ УДАЛЕНИЕ ЗАВЕРШЕНО УСПЕШНО                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    console.log('📊 Итоговая статистика:\n');
    console.log(`   Удалено сообщений: ${result.deletedMessages}`);
    console.log(`   Удалено чатов: ${result.deletedChats}`);
    
    if (organizationId) {
      console.log(`   Организация: ID ${organizationId}`);
    } else {
      console.log(`   Охвачено организаций: ${stats.organizations.length}`);
    }
    
    console.log('\n💡 Совет: Для проверки запустите:');
    console.log('   psql -U postgres -d messenger_db -c "SELECT COUNT(*) FROM \\"Message\\";"');
    console.log('   psql -U postgres -d messenger_db -c "SELECT COUNT(*) FROM \\"Chat\\";"');
    console.log('');

  } catch (error) {
    console.error('\n❌ Ошибка при удалении данных:\n');
    console.error(error);
    
    if (error.code === 'P2003') {
      console.error('\n💡 Возможно, существуют связанные записи в других таблицах.');
      console.error('   Проверьте внешние ключи и зависимости.');
    }
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Запуск
main();
