// scripts/migrate-ticket-numbers.js
// Скрипт для присвоения номеров тикетов существующим чатам

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrateTicketNumbers() {
  console.log('🚀 Начинаем миграцию номеров тикетов...\n');

  try {
    // Получаем все чаты без ticketNumber, сгруппированные по организациям
    const organizations = await prisma.chat.findMany({
      where: { ticketNumber: null },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });

    console.log(`📊 Найдено организаций с чатами без номеров: ${organizations.length}\n`);

    let totalUpdated = 0;

    // Обрабатываем каждую организацию отдельно
    for (const org of organizations) {
      const orgId = org.organizationId;
      
      // Находим максимальный существующий номер тикета для организации
      const lastTicket = await prisma.chat.findFirst({
        where: { 
          organizationId: orgId,
          ticketNumber: { not: null }
        },
        orderBy: { ticketNumber: 'desc' },
        select: { ticketNumber: true },
      });

      let nextTicketNumber = (lastTicket?.ticketNumber || 0) + 1;

      // Получаем все чаты без номеров для этой организации
      const chatsToUpdate = await prisma.chat.findMany({
        where: {
          organizationId: orgId,
          ticketNumber: null
        },
        orderBy: { createdAt: 'asc' }, // Сортируем по дате создания
        select: { id: true }
      });

      console.log(`📋 Организация ID ${orgId}:`);
      console.log(`   - Чатов без номеров: ${chatsToUpdate.length}`);
      console.log(`   - Начальный номер тикета: ${nextTicketNumber}`);

      // Обновляем каждый чат
      for (const chat of chatsToUpdate) {
        await prisma.chat.update({
          where: { id: chat.id },
          data: {
            ticketNumber: nextTicketNumber,
            status: 'new', // Устанавливаем статус для новых тикетов
            priority: 'medium', // Приоритет по умолчанию
          },
        });
        
        nextTicketNumber++;
        totalUpdated++;
      }

      console.log(`   ✅ Обновлено: ${chatsToUpdate.length} чатов\n`);
    }

    console.log(`\n✨ Миграция завершена успешно!`);
    console.log(`   Всего обновлено чатов: ${totalUpdated}\n`);

    // Проверяем результат
    const remaining = await prisma.chat.count({
      where: { ticketNumber: null }
    });

    const withTickets = await prisma.chat.count({
      where: { ticketNumber: { not: null } }
    });

    console.log(`📊 Финальная статистика:`);
    console.log(`   Чатов С номерами: ${withTickets}`);
    console.log(`   Чатов БЕЗ номеров: ${remaining}`);

    if (remaining > 0) {
      console.log(`\n⚠️  Внимание: Остались чаты без номеров! Проверьте логи.`);
    }

  } catch (error) {
    console.error('\n❌ Ошибка при миграции:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Запускаем миграцию
migrateTicketNumbers().catch(console.error);
