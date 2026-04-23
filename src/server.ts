import http from 'http';
import app from './app';
import { startWaSession } from './services/waService'; // Импортируйте startWaSession
import { startAllTelegramBots, stopAllTelegramBots } from './services/telegramService'; // <-- НОВОЕ
import { initializeSocketIO } from './services/socketService'; // <-- Socket.IO
import pino from 'pino'; // Добавьте импорт pino
import { prisma } from './config/authStorage'; // Импортируйте prisma

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const logger = pino({ level: process.env.APP_LOG_LEVEL || 'silent' }); // Инициализируйте logger

// Инициализируем Socket.IO
initializeSocketIO(server);
logger.info('[ServerInit] Socket.IO инициализирован');
async function initializeConnectedSessions() {
  logger.info('[ServerInit] Начинаем инициализацию ранее подключенных WhatsApp сессий...');
  try {
    const connectedPhones = await prisma.organizationPhone.findMany({
      where: {
        // Запускаем Baileys только для номеров, подключенных через Web (не WABA)
        connectionType: 'baileys',
        // КРИТИЧЕСКИ ВАЖНОЕ УСЛОВИЕ:
        // Убедитесь, что здесь перечислены ВСЕ статусы, при которых вы хотите инициализировать сессию.
        // 'connected': если сессия была активна и должна быть восстановлена.
        // 'disconnected': если сессия временно отключилась и нужно переподключиться (обычно без QR).
        // 'logged_out': если auth сброшен и нужно автоматически поднять новую сессию с QR.
        // 'pending': если приложение перезапустилось во время ожидания QR.
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
      logger.info('[ServerInit] Нет ранее подключенных WhatsApp аккаунтов со статусами "connected", "disconnected", "logged_out" или "pending" для инициализации.');
      return;
    }

    for (const phone of connectedPhones) {
      logger.info(`[ServerInit] Обрабатываем OrganizationPhone. ID: ${phone.id}, JID: ${phone.phoneJid}, Тип: ${phone.connectionType}, Текущий статус: ${phone.status}, Org ID: ${phone.organizationId}`);
      try {
        // Убедитесь, что phone.organizationId, phone.phoneJid, phone.id передаются правильно
        await startWaSession(phone.organizationId, phone.phoneJid, phone.id);
        logger.info(`[ServerInit] startWaSession вызвана для ${phone.phoneJid}.`);
      } catch (e: any) {
        logger.error({ err: e }, `[ServerInit] Ошибка инициализации сессии для phoneId=${phone.id}, jid=${phone.phoneJid}`);
        // продолжаем инициализацию остальных сессий
      }
    }
    logger.info(`[ServerInit] Инициализация всех найденных сессий завершена.`);
  } catch (error: any) {
    logger.error(`[ServerInit] КРИТИЧЕСКАЯ ОШИБКА при инициализации подключенных сессий: ${error.message}`, error); // Выводим и объект ошибки
  }
}

server.listen(PORT, async () => {
  logger.info(`[ServerInit] HTTP сервер запущен на порту ${PORT}`);
  logger.info(`[ServerInit] Socket.IO доступен на ws://localhost:${PORT}`);
  
  // Вызываем функцию инициализации WhatsApp сессий после старта сервера
  await initializeConnectedSessions();
  
  // Запускаем все активные Telegram боты
  logger.info('[ServerInit] Запуск Telegram ботов...');
  await startAllTelegramBots();
  logger.info('[ServerInit] Telegram боты запущены');
});

// Graceful shutdown - останавливаем ботов при выключении сервера
process.on('SIGINT', async () => {
  logger.info('[ServerShutdown] Получен сигнал SIGINT, останавливаем Telegram ботов...');
  await stopAllTelegramBots();
  logger.info('[ServerShutdown] Telegram боты остановлены');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('[ServerShutdown] Получен сигнал SIGTERM, останавливаем Telegram ботов...');
  await stopAllTelegramBots();
  logger.info('[ServerShutdown] Telegram боты остановлены');
  process.exit(0);
});

// Логи для неожиданных ошибок (например, таймауты внутри Baileys на init query).
// В окружениях с strict unhandled-rejections это часто выглядит как падение процесса.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, '[Process] unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, '[Process] uncaughtException');
  // Лучше завершить процесс и дать оркестратору/pm2/docker перезапустить.
  process.exit(1);
});
