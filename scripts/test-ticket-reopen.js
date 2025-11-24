#!/usr/bin/env node

/**
 * Тестовый скрипт для проверки переоткрытия тикетов
 * Проверяет, что при получении нового сообщения в закрытый чат создается новый тикет
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testTicketReopen() {
  console.log('🧪 Тест переоткрытия тикетов\n');

  try {
    // 1. Найдем любой закрытый чат для теста
    const closedChat = await prisma.chat.findFirst({
      where: {
        status: 'closed',
        ticketNumber: { not: null },
      },
      orderBy: { closedAt: 'desc' },
    });

    if (!closedChat) {
      console.log('❌ Не найдено закрытых чатов для теста');
      console.log('💡 Создайте и закройте тикет вручную, затем запустите тест снова\n');
      return;
    }

    console.log('📋 Найден закрытый чат для теста:');
    console.log(`   ID чата: ${closedChat.id}`);
    console.log(`   Номер тикета: ${closedChat.ticketNumber}`);
    console.log(`   Статус: ${closedChat.status}`);
    console.log(`   JID клиента: ${closedChat.remoteJid}`);
    console.log(`   Закрыт: ${closedChat.closedAt}`);
    console.log(`   Назначен на: ${closedChat.assignedUserId || 'не назначен'}\n`);

    // 2. Сохраним данные "до"
    const beforeTicketNumber = closedChat.ticketNumber;
    const beforeStatus = closedChat.status;
    const beforeAssignedUserId = closedChat.assignedUserId;
    const beforeClosedAt = closedChat.closedAt;

    // 3. Симулируем получение нового сообщения (обновление как в ensureChat)
    console.log('📨 Симулируем получение нового сообщения...\n');

    // Найдем максимальный номер тикета для организации
    const lastTicket = await prisma.chat.findFirst({
      where: {
        organizationId: closedChat.organizationId,
        ticketNumber: { not: null },
      },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    });

    const nextTicketNumber = (lastTicket?.ticketNumber || 0) + 1;

    // Применяем ту же логику, что и в ensureChat()
    const updateData = {
      lastMessageAt: new Date(),
    };

    if (closedChat.status === 'closed') {
      updateData.ticketNumber = nextTicketNumber;
      updateData.status = 'new';
      updateData.priority = 'medium';
      updateData.assignedUserId = null;
      updateData.closedAt = null;

      console.log(`🔄 Чат был закрыт - создаем новый тикет:`);
      console.log(`   Старый тикет: #${beforeTicketNumber}`);
      console.log(`   Новый тикет: #${nextTicketNumber}`);
      console.log(`   Статус: ${beforeStatus} → new\n`);
    }

    // Обновляем чат
    const updatedChat = await prisma.chat.update({
      where: { id: closedChat.id },
      data: updateData,
    });

    // 4. Проверяем результат
    console.log('✅ Результат обновления:');
    console.log(`   ID чата: ${updatedChat.id}`);
    console.log(`   Номер тикета: ${beforeTicketNumber} → ${updatedChat.ticketNumber}`);
    console.log(`   Статус: ${beforeStatus} → ${updatedChat.status}`);
    console.log(`   Назначен на: ${beforeAssignedUserId || 'не назначен'} → ${updatedChat.assignedUserId || 'не назначен'}`);
    console.log(`   Закрыт: ${beforeClosedAt ? beforeClosedAt.toISOString() : 'нет'} → ${updatedChat.closedAt || 'нет'}`);
    console.log(`   Последнее сообщение: ${updatedChat.lastMessageAt.toISOString()}\n`);

    // 5. Проверяем корректность
    const checks = {
      ticketNumberIncremented: updatedChat.ticketNumber === nextTicketNumber,
      statusIsNew: updatedChat.status === 'new',
      priorityIsMedium: updatedChat.priority === 'medium',
      assignedUserIdIsNull: updatedChat.assignedUserId === null,
      closedAtIsNull: updatedChat.closedAt === null,
      lastMessageAtUpdated: updatedChat.lastMessageAt > closedChat.lastMessageAt,
    };

    console.log('🔍 Проверки:');
    console.log(`   ✓ Номер тикета увеличен: ${checks.ticketNumberIncremented ? '✅' : '❌'}`);
    console.log(`   ✓ Статус установлен в "new": ${checks.statusIsNew ? '✅' : '❌'}`);
    console.log(`   ✓ Приоритет установлен в "medium": ${checks.priorityIsMedium ? '✅' : '❌'}`);
    console.log(`   ✓ Назначение сброшено: ${checks.assignedUserIdIsNull ? '✅' : '❌'}`);
    console.log(`   ✓ Время закрытия сброшено: ${checks.closedAtIsNull ? '✅' : '❌'}`);
    console.log(`   ✓ Время последнего сообщения обновлено: ${checks.lastMessageAtUpdated ? '✅' : '❌'}\n`);

    const allChecksPassed = Object.values(checks).every(check => check === true);

    if (allChecksPassed) {
      console.log('🎉 Все проверки пройдены успешно!\n');
      console.log('💡 Теперь можно проверить через API:');
      console.log(`   curl "http://localhost:4000/api/tickets/${updatedChat.ticketNumber}" | jq\n`);
    } else {
      console.log('❌ Некоторые проверки не пройдены\n');
    }

    // 6. Статистика
    const allTicketsForJid = await prisma.chat.findMany({
      where: {
        remoteJid: closedChat.remoteJid,
        organizationId: closedChat.organizationId,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ticketNumber: true,
        status: true,
        createdAt: true,
        closedAt: true,
      },
    });

    console.log('📊 История всех тикетов этого клиента:');
    allTicketsForJid.forEach((ticket, index) => {
      const duration = ticket.closedAt
        ? ((ticket.closedAt - ticket.createdAt) / 1000 / 3600).toFixed(1)
        : 'в работе';
      
      console.log(`   ${index + 1}. Тикет #${ticket.ticketNumber} (чат #${ticket.id})`);
      console.log(`      Статус: ${ticket.status}`);
      console.log(`      Создан: ${ticket.createdAt.toISOString()}`);
      console.log(`      Длительность: ${duration}${typeof duration === 'string' ? '' : ' часов'}`);
    });

    console.log(`\n📈 Всего обращений клиента: ${allTicketsForJid.length}\n`);

  } catch (error) {
    console.error('❌ Ошибка при выполнении теста:', error);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Запуск теста
testTicketReopen();
