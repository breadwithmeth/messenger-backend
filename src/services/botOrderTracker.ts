// src/services/botOrderTracker.ts
//
// Периодический опрос активных заказов привязанных клиентов «Налив»
// (GET /api/telegram-bot/orders/active?telegram_id=...) и уведомления
// в Telegram о смене статуса: UNPAID(66) → NEW(0) → ACCEPTED(1) → READY(2) → ON_THE_WAY(3).
//
// Запускается при старте сервера (server.ts). Интервал: BOT_ORDER_POLL_INTERVAL_MS (по умолчанию 60 сек).

import { prisma } from '../config/authStorage.js';
import { createLogger } from '../config/logging.js';
import { getAiBotConfig } from '../config/aiBotConfig.js';
import { getActiveOrders, orderStatusLabel } from '../integrations/naliv/telegramBotClient.js';

const logger = createLogger();

let timer: ReturnType<typeof setInterval> | null = null;
let polling = false; // защита от наложения опросов

export function startBotOrderTracker(): void {
  const cfg = getAiBotConfig();

  if (!cfg.nalivBotApiKey) {
    logger.warn('[BotOrderTracker] TELEGRAM_BOT_API_KEY не задан — отслеживание заказов выключено');
    return;
  }

  stopBotOrderTracker();

  // Первый опрос через 15 секунд после старта, затем по интервалу
  setTimeout(() => void pollOnce().catch(() => {}), 15000).unref?.();

  timer = setInterval(() => {
    void pollOnce().catch(() => {});
  }, cfg.orderPollIntervalMs);
  timer.unref?.();

  logger.info(`[BotOrderTracker] Запущен, интервал ${cfg.orderPollIntervalMs} мс`);
}

export function stopBotOrderTracker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Один проход: все привязанные клиенты -> активные заказы -> уведомления о смене статуса */
export async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;

  try {
    const botUsers = await prisma.botUser.findMany({
      where: { nalivUserId: { not: null } },
    });

    if (botUsers.length === 0) return;

    let notifications = 0;

    for (const botUser of botUsers) {
      // Без бота/чата уведомление не отправить
      if (!botUser.telegramBotId || !botUser.telegramChatId) continue;

      let orders;
      try {
        orders = await getActiveOrders(botUser.telegramUserId);
      } catch (error) {
        logger.warn(`[BotOrderTracker] Не удалось получить заказы telegram_id=${botUser.telegramUserId}:`, error);
        continue;
      }

      for (const order of orders) {
        const status = String(order.current_status);
        const statusAt = order.status_updated_at ? new Date(order.status_updated_at) : null;

        const tracking = await prisma.botOrderTracking.upsert({
          where: { botUserId_orderId: { botUserId: botUser.id, orderId: order.id } },
          create: {
            botUserId: botUser.id,
            orderId: order.id,
            lastStatus: status,
            lastStatusAt: statusAt,
            lastNotifiedAt: new Date(), // первое обнаружение без уведомления — заказ уже был
          },
          update: {},
        });

        // Статус не изменился (или первое обнаружение) — молчим
        if (tracking.lastStatus === status && tracking.lastNotifiedAt) {
          if (tracking.lastStatusAt !== statusAt && statusAt) {
            await prisma.botOrderTracking.update({
              where: { id: tracking.id },
              data: { lastStatusAt: statusAt },
            });
          }
          continue;
        }

        // Смена статуса -> уведомление клиенту
        const label = orderStatusLabel(status);
        const businessName = order.business?.name ? ` («${order.business.name}»)` : '';
        const text = `📦 Обновление по заказу #${order.id}${businessName}:\n${label}`;

        try {
          const { sendTelegramMessage } = await import('./telegramService.js');
          await sendTelegramMessage(botUser.telegramBotId, botUser.telegramChatId, text);
          notifications += 1;
        } catch (error) {
          logger.warn(`[BotOrderTracker] Не удалось отправить уведомление (чат ${botUser.telegramChatId}):`, error);
          continue; // не обновляем lastNotifiedAt — попробуем в следующий проход
        }

        await prisma.botOrderTracking.update({
          where: { id: tracking.id },
          data: { lastStatus: status, lastStatusAt: statusAt, lastNotifiedAt: new Date() },
        });

        // Операторам тоже полезно знать
        try {
          const { broadcastToOrganization } = await import('./socketService.js');
          broadcastToOrganization(botUser.organizationId, 'bot_order_status_changed', {
            orderId: order.id,
            telegramUserId: botUser.telegramUserId,
            status,
            statusLabel: label,
          });
        } catch {
          // некритично
        }
      }
    }

    if (notifications > 0) {
      logger.info(`[BotOrderTracker] Отправлено уведомлений о статусах: ${notifications}`);
    }
  } catch (error) {
    logger.error('[BotOrderTracker] Ошибка опроса заказов:', error);
  } finally {
    polling = false;
  }
}
