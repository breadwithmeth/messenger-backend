import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import app from './app';
import { startWaSession } from './services/waService'; // Импортируйте startWaSession
import { startAllTelegramBots, stopAllTelegramBots } from './services/telegramService'; // <-- НОВОЕ
import { initializeSocketIO } from './services/socketService'; // <-- Socket.IO
import pino from 'pino'; // Добавьте импорт pino
import { prisma } from './config/authStorage'; // Импортируйте prisma
import { startBitrixWorker, stopBitrixWorker } from './modules/bitrix/bitrix.queue';
import { startBitrixConnectorWorker, stopBitrixConnectorWorker } from './modules/bitrix/bitrix.connector.queue';

const PORT = process.env.PORT || 3000;
const logger = pino({ level: 'info' }); // Инициализируйте logger

function createServer() {
  const httpsEnabled = String(process.env.HTTPS_ENABLED || '').toLowerCase() === 'true';
  if (!httpsEnabled) {
    return {
      server: http.createServer(app),
      protocol: 'http' as const,
    };
  }

  const certPath = process.env.SSL_CERT_PATH || path.resolve(process.cwd(), 'certs', 'localhost-cert.pem');
  const keyPath = process.env.SSL_KEY_PATH || path.resolve(process.cwd(), 'certs', 'localhost-key.pem');

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    logger.warn(
      { certPath, keyPath },
      '[ServerInit] HTTPS_ENABLED=true but SSL files not found. Falling back to HTTP.',
    );
    return {
      server: http.createServer(app),
      protocol: 'http' as const,
    };
  }

  const server = https.createServer(
    {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    },
    app,
  );

  logger.info({ certPath, keyPath }, '[ServerInit] HTTPS enabled');
  return {
    server,
    protocol: 'https' as const,
  };
}

const { server, protocol } = createServer();

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
  console.log(`Server is running on port ${PORT}`);
  logger.info(`[ServerInit] ${protocol.toUpperCase()} сервер запущен на порту ${PORT}`);
  logger.info(
    `[ServerInit] Socket.IO доступен на ${protocol === 'https' ? 'wss' : 'ws'}://localhost:${PORT}`,
  );
  
  // Вызываем функцию инициализации WhatsApp сессий после старта сервера
  await initializeConnectedSessions();
  
  // Запускаем все активные Telegram боты
  logger.info('[ServerInit] Запуск Telegram ботов...');
  await startAllTelegramBots();
  logger.info('[ServerInit] Telegram боты запущены');

  await startBitrixWorker();
  logger.info('[ServerInit] Bitrix worker initialized');
  await startBitrixConnectorWorker();
  logger.info('[ServerInit] Bitrix connector worker initialized');
});

// Graceful shutdown - останавливаем ботов при выключении сервера
process.on('SIGINT', async () => {
  logger.info('[ServerShutdown] Получен сигнал SIGINT, останавливаем Telegram ботов...');
  await stopAllTelegramBots();
  await stopBitrixWorker();
  await stopBitrixConnectorWorker();
  logger.info('[ServerShutdown] Telegram боты остановлены');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('[ServerShutdown] Получен сигнал SIGTERM, останавливаем Telegram ботов...');
  await stopAllTelegramBots();
  await stopBitrixWorker();
  await stopBitrixConnectorWorker();
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
