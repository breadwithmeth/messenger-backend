import http from 'http';
import app from './app';
import { startWaSession } from './services/waService'; // Импортируйте startWaSession
import pino from 'pino'; // Добавьте импорт pino
import { prisma } from './config/authStorage'; // Импортируйте prisma

const PORT = process.env.PORT || 4000;

const server = http.createServer(app);
const logger = pino({ level: 'info' }); // Инициализируйте logger
async function initializeConnectedSessions() {
  logger.info('[ServerInit] Начинаем инициализацию ранее подключенных WhatsApp сессий...');
  try {
    const connectedPhones = await prisma.organizationPhone.findMany({
      where: {
        // КРИТИЧЕСКИ ВАЖНОЕ УСЛОВИЕ:
        // Убедитесь, что здесь перечислены ВСЕ статусы, при которых вы хотите инициализировать сессию.
        // 'connected': если сессия была активна и должна быть восстановлена.
        // 'disconnected': если сессия временно отключилась и нужно переподключиться (обычно без QR).
        // 'logged_out': если сессия вышла из системы и нужен НОВЫЙ QR-код (после удаления auth файлов).
        // null: если статус еще не был установлен (например, новая запись в БД).
        status: {
          in: ['connected', 'disconnected', 'logged_out', 'pending']
        },
        // Если у вас несколько организаций и вы хотите инициализировать только определенные,
        // раскомментируйте и установите organizationId, иначе оставьте закомментированным.
        // organizationId: 1 // Пример: для тестирования с конкретной организацией
      },
    });

    logger.info(`[ServerInit] Запрос к БД завершен. Найдено ${connectedPhones.length} аккаунтов для инициализации.`);

    if (connectedPhones.length === 0) {
      logger.info('[ServerInit] Нет ранее подключенных WhatsApp аккаунтов со статусами "connected", "disconnected", "logged_out" или null для инициализации.');
      return;
    }

    for (const phone of connectedPhones) {
      logger.info(`[ServerInit] Обрабатываем OrganizationPhone. ID: ${phone.id}, JID: ${phone.phoneJid}, Текущий статус: ${phone.status}, Org ID: ${phone.organizationId}`);
      // Убедитесь, что phone.organizationId, phone.phoneJid, phone.id передаются правильно
      await startWaSession(phone.organizationId, phone.phoneJid, phone.id);
      logger.info(`[ServerInit] startWaSession вызвана для ${phone.phoneJid}.`);
    }
    logger.info(`[ServerInit] Инициализация всех найденных сессий завершена.`);
  } catch (error: any) {
    logger.error(`[ServerInit] КРИТИЧЕСКАЯ ОШИБКА при инициализации подключенных сессий: ${error.message}`, error); // Выводим и объект ошибки
  }
}

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  // Вызываем функцию инициализации сессий после старта сервера
  
  await initializeConnectedSessions();
});
