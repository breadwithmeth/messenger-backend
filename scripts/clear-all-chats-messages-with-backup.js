#!/usr/bin/env node

/**
 * Скрипт для удаления всех чатов и сообщений с созданием резервной копии
 * 
 * ВНИМАНИЕ: Создает резервную копию перед удалением
 * 
 * Использование:
 *   node scripts/clear-all-chats-messages-with-backup.js
 *   node scripts/clear-all-chats-messages-with-backup.js --no-backup
 *   node scripts/clear-all-chats-messages-with-backup.js --organization=1
 * 
 * Параметры:
 *   --no-backup        Не создавать резервную копию (не рекомендуется!)
 *   --organization=N   Удалить только для указанной организации
 *   --backup-dir=PATH  Путь для сохранения бэкапа (по умолчанию ./backups)
 */

const { PrismaClient } = require('@prisma/client');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

const execAsync = promisify(exec);
const prisma = new PrismaClient();

// Парсинг аргументов
const args = process.argv.slice(2);
const noBackup = args.includes('--no-backup');
const orgArg = args.find(arg => arg.startsWith('--organization='));
const organizationId = orgArg ? parseInt(orgArg.split('=')[1]) : null;
const backupDirArg = args.find(arg => arg.startsWith('--backup-dir='));
const backupDir = backupDirArg ? backupDirArg.split('=')[1] : './backups';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askConfirmation(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Создает резервную копию базы данных
 */
async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
  const backupFileName = `backup-before-clear-${timestamp}-${timeStr}.sql`;
  const backupPath = path.join(backupDir, backupFileName);

  console.log('\n📦 Создание резервной копии...\n');
  
  // Создаем директорию для бэкапов если её нет
  try {
    await fs.mkdir(backupDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  // Получаем настройки подключения из DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL не найден в переменных окружения');
  }

  // Парсим DATABASE_URL
  const url = new URL(databaseUrl);
  const user = url.username;
  const password = url.password;
  const host = url.hostname;
  const port = url.port || '5432';
  const database = url.pathname.slice(1);

  console.log(`   База данных: ${database}`);
  console.log(`   Хост: ${host}:${port}`);
  console.log(`   Файл: ${backupPath}`);
  console.log('');

  // Создаем бэкап с помощью pg_dump
  const pgDumpCmd = `PGPASSWORD="${password}" pg_dump -h ${host} -p ${port} -U ${user} -d ${database} -F p -f "${backupPath}"`;
  
  try {
    await execAsync(pgDumpCmd);
    console.log('   ✅ Резервная копия создана успешно');
    
    // Проверяем размер файла
    const stats = await fs.stat(backupPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`   📁 Размер файла: ${fileSizeMB} MB`);
    
    return backupPath;
  } catch (error) {
    console.error('   ❌ Ошибка при создании резервной копии:');
    throw error;
  }
}

/**
 * Получает статистику
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
 * Экспортирует данные в JSON (дополнительная копия)
 */
async function exportToJson() {
  const where = organizationId ? { organizationId } : {};
  
  console.log('\n💾 Экспорт данных в JSON...\n');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
  
  // Экспортируем чаты
  const chats = await prisma.chat.findMany({ where });
  const chatsFile = path.join(backupDir, `chats-${timestamp}-${timeStr}.json`);
  await fs.writeFile(chatsFile, JSON.stringify(chats, null, 2));
  console.log(`   ✅ Чаты экспортированы: ${chatsFile}`);
  console.log(`   📊 Количество: ${chats.length}`);
  
  // Экспортируем сообщения порциями (чтобы не переполнить память)
  const batchSize = 1000;
  let skip = 0;
  let total = 0;
  const messagesFile = path.join(backupDir, `messages-${timestamp}-${timeStr}.json`);
  
  // Открываем файл для записи
  await fs.writeFile(messagesFile, '[\n');
  
  while (true) {
    const messages = await prisma.message.findMany({
      where,
      skip,
      take: batchSize,
      orderBy: { id: 'asc' }
    });
    
    if (messages.length === 0) break;
    
    for (let i = 0; i < messages.length; i++) {
      const isLast = skip + i === total + messages.length - 1;
      await fs.appendFile(
        messagesFile, 
        JSON.stringify(messages[i], null, 2) + (isLast ? '\n' : ',\n')
      );
    }
    
    total += messages.length;
    skip += batchSize;
    
    process.stdout.write(`\r   📨 Экспортировано сообщений: ${total}`);
  }
  
  await fs.appendFile(messagesFile, ']');
  console.log('\n   ✅ Сообщения экспортированы: ' + messagesFile);
  
  return { chatsFile, messagesFile, totalMessages: total };
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
  let backupPath = null;
  let jsonExport = null;
  
  try {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   🗑️  УДАЛЕНИЕ ВСЕХ ЧАТОВ И СООБЩЕНИЙ (С БЭКАПОМ)        ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Получаем статистику
    console.log('📊 Получение статистики...\n');
    const stats = await getStats();

    // Показываем информацию
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

    // Создание резервной копии
    if (!noBackup) {
      backupPath = await createBackup();
      jsonExport = await exportToJson();
      
      console.log('\n✅ Резервные копии созданы:');
      console.log(`   SQL: ${backupPath}`);
      console.log(`   JSON чаты: ${jsonExport.chatsFile}`);
      console.log(`   JSON сообщения: ${jsonExport.messagesFile}`);
      console.log('');
    } else {
      console.log('\n⚠️  ВНИМАНИЕ: Резервная копия НЕ будет создана (--no-backup)\n');
    }

    // Запрос подтверждения
    console.log('⚠️  Будет удалено:');
    console.log(`   • ${stats.messageCount} сообщений`);
    console.log(`   • ${stats.chatCount} чатов`);
    if (organizationId) {
      console.log(`   • Только для организации ID: ${organizationId}`);
    } else {
      console.log(`   • Для ВСЕХ ${stats.organizations.length} организаций`);
    }
    console.log('');

    const confirmed = await askConfirmation('❓ Продолжить удаление? (yes/y): ');
    
    if (!confirmed) {
      console.log('\n❌ Операция отменена пользователем.\n');
      rl.close();
      await prisma.$disconnect();
      return;
    }

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
    
    if (!noBackup) {
      console.log('\n📦 Резервные копии сохранены в:');
      console.log(`   ${backupDir}/`);
      console.log('\n💡 Для восстановления из SQL бэкапа:');
      console.log(`   psql -U postgres -d messenger_db -f "${backupPath}"`);
    }
    
    console.log('');

  } catch (error) {
    console.error('\n❌ Ошибка:\n');
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Запуск
main();
