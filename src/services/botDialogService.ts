// src/services/botDialogService.ts
//
// AI-сценарий Telegram-бота "Налив":
//   приветствие -> адрес -> ближайший магазин -> корзина -> подтверждение -> заказ (BotOrder)
//
// Состояния диалога хранятся в BotDialog (1:1 с Chat). AI (Ollama-совместимый сервер)
// используется в состоянии "shopping" через строгий JSON-протокол действий:
// модель всегда отвечает только JSON-объектом {"action": "...", ...}, а бэкенд
// исполняет действия (поиск товаров, корзина, оформление) и скармливает результаты обратно.
//
// Отправка сообщений инжектируется снаружи (sendBotReply из telegramService),
// чтобы избежать циклических импортов.

import { prisma } from '../config/authStorage.js';
import { createLogger } from '../config/logging.js';
import {
  searchAddresses,
  findNearestBusinesses,
  searchItems,
  getBusinesses,
} from '../integrations/naliv/nalivClient.js';
import { CartItem, NalivAddress, NalivBusinessWithDistance, NalivItem } from '../integrations/naliv/types.js';
import { aiChat, AiChatMessage } from './aiChatClient.js';

const logger = createLogger();

// === Состояния ===
export const DIALOG_STATES = {
  AWAITING_ADDRESS: 'awaiting_address',
  AWAITING_STORE_CONFIRM: 'awaiting_store_confirm',
  SHOPPING: 'shopping',
  CONFIRMING_ORDER: 'confirming_order',
} as const;

const MAX_CANDIDATES = 3;
const MAX_SEARCH_CACHE = 50;
const MAX_AI_ROUNDS = 3;
const MAX_HISTORY_MESSAGES = 8;
const FAR_DISTANCE_M = 25000; // предупреждение, если магазин дальше 25 км

/** Колбэк отправки сообщения клиенту (реализуется в telegramService через sendTelegramMessage) */
export type BotReplySender = (text: string) => Promise<unknown>;

export type DialogContext = {
  botId: number;
  botAiModel?: string | null;
  botAiSystemPrompt?: string | null;
  botWelcomeMessage?: string | null;
  organizationId: number;
  chatId: number;
  telegramChatId: string;
  clientName?: string | null;
  send: BotReplySender;
};

// ============================================================
// Чистые функции (экспортированы для юнит-тестов)
// ============================================================

/** Нормализует цену товара с учётом акции (минимальный discount из promotions) */
export function effectivePrice(item: NalivItem): number {
  let price = item.price;
  const promos = Array.isArray(item.promotions) ? item.promotions : [];
  for (const promo of promos) {
    const discount = Number(promo?.discount);
    if (Number.isFinite(discount) && discount > 0) {
      price = Math.min(price, Math.round(item.price * (1 - discount / 100)));
    }
  }
  return price;
}

/** Добавляет товар в корзину (qty округляется вверх до quantity_step) */
export function addToCart(cart: CartItem[], item: NalivItem, qty: number): CartItem[] {
  const step = item.quantity_step > 0 ? item.quantity_step : 1;
  const normalizedQty = Math.max(step, Math.round(qty / step) * step);
  const price = effectivePrice(item);

  const existing = cart.find((c) => c.itemId === item.item_id);
  if (existing) {
    return cart.map((c) => (c.itemId === item.item_id ? { ...c, qty: c.qty + normalizedQty } : c));
  }

  return [
    ...cart,
    { itemId: item.item_id, name: item.name, price, qty: normalizedQty, unit: item.unit || 'шт' },
  ];
}

/** Убирает товар из корзины по item_id */
export function removeFromCart(cart: CartItem[], itemId: number): CartItem[] {
  return cart.filter((c) => c.itemId !== itemId);
}

/** Сумма позиций без доставки */
export function cartSubtotal(cart: CartItem[]): number {
  return cart.reduce((sum, c) => sum + c.price * c.qty, 0);
}

/** Форматирование числа: 1460 -> "1 460" */
export function formatMoney(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Текстовое представление корзины для клиента */
export function formatCart(cart: CartItem[], deliveryFee: number): string {
  if (cart.length === 0) {
    return '🛒 Корзина пуста. Напишите название товара — например «пиво Heineken».';
  }

  const lines = cart.map(
    (c) => `• ${c.name} — ${formatMoney(c.price)} ₸ × ${c.qty} ${c.unit} = ${formatMoney(c.price * c.qty)} ₸`
  );
  const subtotal = cartSubtotal(cart);

  return [
    '🛒 Ваша корзина:',
    ...lines,
    '',
    `Товары: ${formatMoney(subtotal)} ₸`,
    `Доставка: ${formatMoney(deliveryFee)} ₸`,
    `Итого: ${formatMoney(subtotal + deliveryFee)} ₸`,
  ].join('\n');
}

/** Краткое описание корзины для контекста AI */
export function cartForPrompt(cart: CartItem[]): string {
  if (cart.length === 0) return '[]';
  return JSON.stringify(
    cart.map((c) => ({ item_id: c.itemId, name: c.name, price: c.price, qty: c.qty, unit: c.unit }))
  );
}

/** Расстояние в человекочитаемом виде */
export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM)} м`;
  return `${(distanceM / 1000).toFixed(1)} км`;
}

/**
 * Распознаёт выбор кандидата по номеру: "1", "2.", "номер 3", "первый"...
 * @returns 1-based индекс или null
 */
export function parseNumberChoice(text: string, max: number): number | null {
  const trimmed = text.trim().toLowerCase();
  const digitMatch = trimmed.match(/^(?:номер\s*)?(\d+)[\.\),]?\s*$/);
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    return n >= 1 && n <= max ? n : null;
  }
  const words = ['первый', 'первое', 'второй', 'второе', 'третий', 'третье'];
  const idx = words.indexOf(trimmed);
  if (idx >= 0) {
    const n = idx < 2 ? 1 : idx < 4 ? 2 : 3;
    return n <= max ? n : null;
  }
  return null;
}

/** Согласие/отказ */
export function parseYesNo(text: string): 'yes' | 'no' | null {
  const t = text.trim().toLowerCase();
  // \b не работает с кириллицей — используем (?!\p{L})
  if (/^(да|давай|ага|верно|ок|окей|хорошо|подтверждаю|именно|все верно|всё верно|yes|y)(?!\p{L})/u.test(t)) {
    return 'yes';
  }
  if (/^(нет|неа|отмена|неверно|не верно|no|n)(?!\p{L})/u.test(t)) {
    return 'no';
  }
  return null;
}

/** Ключевые слова перехода на оператора (только целые слова: \b не работает с кириллицей) */
const HANDOFF_PATTERN = /(?<!\p{L})(оператор(?:а|у|е|ом|ами)?|менеджер(?:а|у|е|ом|ами)?|консультант(?:а|у|е|ом|ами)?|живой человек|позовите человека|реальный человек|живой оператор)(?!\p{L})/iu;

export function isHandoffRequest(text: string): boolean {
  return HANDOFF_PATTERN.test(text);
}

/** Команда показа корзины без обращения к AI */
export function isCartCommand(text: string): boolean {
  return /^(корзин[ауые]|моя корзина|покажи корзину|что в корзине|cart)(?!\p{L})/iu.test(text.trim());
}

/**
 * Разбор ответа модели. Ожидается строгий JSON вида
 * {"action": "...", ...}. Возвращает null, если распарсить не удалось.
 */
export type AiAction = {
  action: string;
  query?: string;
  item_id?: number;
  qty?: number;
  reply_text?: string;
};

export function parseAiAction(raw: string): AiAction | null {
  if (!raw) return null;

  let text = raw.trim();
  // Убираем markdown-ограждения ```json ... ```
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Вырезаем первый JSON-объект
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!parsed || typeof parsed.action !== 'string') return null;
    return {
      action: parsed.action.toLowerCase().trim(),
      query: typeof parsed.query === 'string' ? parsed.query : undefined,
      item_id: Number.isFinite(Number(parsed.item_id)) ? Number(parsed.item_id) : undefined,
      qty: Number.isFinite(Number(parsed.qty)) ? Number(parsed.qty) : undefined,
      reply_text: typeof parsed.reply_text === 'string' ? parsed.reply_text : undefined,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Системный промт для состояния "shopping"
// ============================================================

export function buildShoppingSystemPrompt(ctx: {
  address?: string | null;
  businessName?: string | null;
  businessId?: number | null;
  cart: CartItem[];
  searchCache: NalivItem[];
  deliveryFee: number;
  customPrompt?: string | null;
}): string {
  const base = `Ты — AI-ассистент сервиса доставки алкоголя "Налив/Градусы24" в Telegram. Помогаешь клиенту собрать заказ. Общайся на русском языке, дружелюбно и кратко.

КОНТЕКСТ:
- Адрес доставки: ${ctx.address || 'не указан'}
- Магазин: ${ctx.businessName || 'не выбран'} (business_id: ${ctx.businessId || '-'})
- Стоимость доставки: ${ctx.deliveryFee} ₸
- Текущая корзина (JSON): ${cartForPrompt(ctx.cart)}
- Найденные ранее товары (JSON, доступны для add_to_cart): ${JSON.stringify(
    ctx.searchCache.slice(0, 20).map((i) => ({ item_id: i.item_id, name: i.name, price: i.price, unit: i.unit }))
  )}

ПРАВИЛА:
1. Ты отвечаешь СТРОГО одним JSON-объектом, без пояснений и markdown.
2. Цены только из результатов поиска. НИКОГДА не выдумывай товары и цены.
3. Если клиент называет товар, которого нет в "Найденных ранее товарах" — сначала вызови search_items.
4. Для добавления в корзину используй item_id из результатов поиска.
5. Напитки продаются только лицам 18+. Не помогай покупать алкоголь несовершеннолетним.
6. Когда клиент выбирает товар из списка по номеру, используй item_id соответствующего товара из последнего результата поиска.

Формат ответа (выбери ОДНО действие):
{"action": "search_items", "query": "<поисковый запрос>"}
{"action": "add_to_cart", "item_id": <id>, "qty": <количество>}
{"action": "remove_from_cart", "item_id": <id>}
{"action": "clear_cart"}
{"action": "show_cart"}
{"action": "checkout"} — клиент хочет оформить заказ
{"action": "handoff"} — клиент просит живого оператора
{"action": "reply", "reply_text": "<текст для клиента>"}

После search_items ты получишь результаты поиска (JSON) — покажи их клиенту через reply коротким нумерованным списком "1. Название — цена ₸" и спроси, что добавить (клиент может ответить названием или номером).
После add_to_cart/remove_from_cart/clear_cart ты получишь обновлённую корзину — подтвердди через reply и спроси, что-нибудь ещё.
Если клиент пишет «корзина» — вызови show_cart. Если готов заказывать — checkout.`;

  return ctx.customPrompt ? `${base}\n\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ВЛАДЕЛЬЦА БОТА:\n${ctx.customPrompt}` : base;
}

// ============================================================
// Основные обработчики
// ============================================================

/** Обработка /start у AI-бота: сброс диалога и приветствие */
export async function handleBotStart(ctx: DialogContext): Promise<void> {
  await prisma.botDialog.upsert({
    where: { chatId: ctx.chatId },
    create: { chatId: ctx.chatId, state: DIALOG_STATES.AWAITING_ADDRESS },
    update: {
      state: DIALOG_STATES.AWAITING_ADDRESS,
      addressLabel: null,
      addressLat: null,
      addressLon: null,
      businessId: null,
      businessName: null,
      candidateAddresses: null,
      candidateBusinesses: null,
      lastSearchItems: null,
      cart: null,
      handedOff: false,
      handedOffAt: null,
    },
  });

  const greeting = ctx.botWelcomeMessage?.trim() ||
    `👋 Привет${ctx.clientName ? `, ${ctx.clientName}` : ''}! Я AI-ассистент доставки.\n\nПомогу собрать заказ и оформить доставку.\n\n📍 Напишите ваш адрес доставки (улица, дом, город) — я найду ближайший магазин.`;

  await ctx.send(greeting);
}

/** Обработка текстового сообщения от клиента AI-бота */
export async function handleBotUserMessage(ctx: DialogContext, text: string): Promise<void> {
  const dialog = await prisma.botDialog.findUnique({ where: { chatId: ctx.chatId } });

  if (!dialog) {
    // Диалог не создан (клиент не нажал /start) — создаём и продолжаем
    await handleBotStart(ctx);
    return;
  }

  if (dialog.handedOff) {
    // Диалог уже у оператора — AI молчит
    return;
  }

  // Переход на оператора работает в любом состоянии
  if (isHandoffRequest(text)) {
    await handoffToOperator(ctx, dialog.id);
    return;
  }

  switch (dialog.state) {
    case DIALOG_STATES.AWAITING_ADDRESS:
      await handleAwaitingAddress(ctx, dialog, text);
      break;
    case DIALOG_STATES.AWAITING_STORE_CONFIRM:
      await handleAwaitingStoreConfirm(ctx, dialog, text);
      break;
    case DIALOG_STATES.CONFIRMING_ORDER:
      await handleConfirmingOrder(ctx, dialog, text);
      break;
    case DIALOG_STATES.SHOPPING:
    default:
      await handleShopping(ctx, dialog, text);
      break;
  }
}

// === Шаг 1: адрес ===

async function handleAwaitingAddress(ctx: DialogContext, dialog: { id: number; candidateAddresses: unknown }, text: string): Promise<void> {
  // Выбор из ранее показанных кандидатов
  const candidates = (dialog.candidateAddresses as unknown as NalivAddress[] | null) || null;
  if (candidates && candidates.length > 0) {
    const choice = parseNumberChoice(text, candidates.length);
    if (choice) {
      await confirmAddressAndFindStore(ctx, dialog.id, candidates[choice - 1]);
      return;
    }
  }

  const query = text.trim();
  if (query.length < 3) {
    await ctx.send('📍 Не понял адрес. Напишите его подробнее — например: «Бухар-Жырау 70, Караганда».');
    return;
  }

  let addresses: NalivAddress[];
  try {
    addresses = await searchAddresses(query);
  } catch (error) {
    logger.error('[BotDialog] Ошибка геокодинга:', error);
    await ctx.send('😔 Сервис поиска адресов временно недоступен. Попробуйте ещё раз через минуту.');
    return;
  }

  if (addresses.length === 0) {
    await ctx.send('📍 Не смог найти такой адрес. Уточните: улица, номер дома и город. Например: «Анет-баба 7/2, Астана».');
    return;
  }

  if (addresses.length === 1) {
    await confirmAddressAndFindStore(ctx, dialog.id, addresses[0]);
    return;
  }

  // Несколько кандидатов — показываем список
  await prisma.botDialog.update({
    where: { id: dialog.id },
    data: {
      candidateAddresses: addresses.slice(0, MAX_CANDIDATES) as unknown as any,
      state: DIALOG_STATES.AWAITING_ADDRESS,
    },
  });

  const lines = addresses.slice(0, MAX_CANDIDATES).map((a, i) => `${i + 1}. ${a.label}`);
  await ctx.send(`📍 Нашёл несколько адресов. Какой ваш?\n\n${lines.join('\n')}\n\nНапишите номер или уточните адрес.`);
}

/** Адрес подтверждён — ищем ближайший магазин */
async function confirmAddressAndFindStore(ctx: DialogContext, dialogId: number, address: NalivAddress): Promise<void> {
  let nearest: NalivBusinessWithDistance[];
  try {
    nearest = await findNearestBusinesses(address.lat, address.lon, MAX_CANDIDATES);
  } catch (error) {
    logger.error('[BotDialog] Ошибка поиска магазинов:', error);
    await ctx.send('😔 Сервис магазинов временно недоступен. Попробуйте ещё раз через минуту.');
    return;
  }

  if (nearest.length === 0) {
    await ctx.send('😔 Пока не нашёл магазинов рядом с этим адресом. Попробуйте другой адрес.');
    return;
  }

  const top = nearest[0];
  await prisma.botDialog.update({
    where: { id: dialogId },
    data: {
      addressLabel: address.label,
      addressLat: address.lat,
      addressLon: address.lon,
      candidateAddresses: null,
      candidateBusinesses: nearest as unknown as any,
      businessId: top.id,
      businessName: top.name,
      state: DIALOG_STATES.AWAITING_STORE_CONFIRM,
    },
  });

  const farWarning = top.distanceM > FAR_DISTANCE_M ? '\n\n⚠️ Магазин довольно далеко — доставка может занять больше времени.' : '';
  const alternatives =
    nearest.length > 1
      ? `\n\nРядом также: ${nearest
          .slice(1)
          .map((b) => `${b.name} (${formatDistance(b.distanceM)})`)
          .join(', ')}. Напишите «нет», чтобы выбрать другой магазин.`
      : '';

  await ctx.send(
    `📍 Адрес: ${address.label}\n🏪 Ближайший магазин: ${top.name} (${top.address}, ${formatDistance(top.distanceM)})${farWarning}${alternatives}\n\nВсё верно? (да/нет)`
  );
}

// === Шаг 2: подтверждение магазина ===

async function handleAwaitingStoreConfirm(ctx: DialogContext, dialog: { id: number; candidateBusinesses: unknown; addressLabel: string | null; addressLat: number | null; addressLon: number | null }, text: string): Promise<void> {
  const yn = parseYesNo(text);
  const candidates = (dialog.candidateBusinesses as unknown as NalivBusinessWithDistance[] | null) || [];

  if (yn === 'yes') {
    await startShopping(ctx, dialog.id);
    return;
  }

  // Выбор магазина по номеру из кандидатов
  if (candidates.length > 1) {
    const choice = parseNumberChoice(text, candidates.length);
    if (choice) {
      const picked = candidates[choice - 1];
      await prisma.botDialog.update({
        where: { id: dialog.id },
        data: { businessId: picked.id, businessName: picked.name, state: DIALOG_STATES.SHOPPING },
      });
      await ctx.send(`🏪 Отлично! Доставка из «${picked.name}».\n\nЧто хотите заказать? Напишите название товара — например «пиво Heineken». В любой момент можно написать «корзина» или «оформить».`);
      return;
    }
  }

  if (yn === 'no' && candidates.length > 1) {
    const lines = candidates.map((b, i) => `${i + 1}. ${b.name} — ${b.address} (${formatDistance(b.distanceM)})`);
    await ctx.send(`🏪 Выберите магазин:\n\n${lines.join('\n')}\n\nНапишите номер. Или введите другой адрес доставки.`);
    return;
  }

  // Иначе — считаем, что клиент ввёл новый адрес
  const addresses = await searchAddresses(text).catch(() => []);
  if (addresses.length > 0) {
    if (addresses.length === 1) {
      await confirmAddressAndFindStore(ctx, dialog.id, addresses[0]);
    } else {
      await prisma.botDialog.update({
        where: { id: dialog.id },
        data: {
          candidateAddresses: addresses.slice(0, MAX_CANDIDATES) as unknown as any,
          state: DIALOG_STATES.AWAITING_ADDRESS,
        },
      });
      const lines = addresses.slice(0, MAX_CANDIDATES).map((a, i) => `${i + 1}. ${a.label}`);
      await ctx.send(`📍 Нашёл несколько адресов. Какой ваш?\n\n${lines.join('\n')}\n\nНапишите номер или уточните адрес.`);
    }
    return;
  }

  await ctx.send('🤔 Напишите «да», если магазин подходит, номер магазина из списка — чтобы выбрать другой, или новый адрес доставки.');
}

// === Шаг 3: корзина через AI ===

async function startShopping(ctx: DialogContext, dialogId: number): Promise<void> {
  await prisma.botDialog.update({
    where: { id: dialogId },
    data: { state: DIALOG_STATES.SHOPPING, candidateAddresses: null, candidateBusinesses: null },
  });

  await ctx.send(
    '🛒 Отлично! Что хотите заказать?\n\nНапишите название товара — например «пиво Heineken» — и я найду его в магазине. В любой момент можно написать «корзина», чтобы посмотреть заказ, или «оформить», чтобы завершить.'
  );
}

async function handleShopping(ctx: DialogContext, dialog: any, text: string): Promise<void> {
  // Быстрые команды без AI
  if (isCartCommand(text)) {
    const business = await findBusinessFee(dialog.businessId);
    await ctx.send(formatCart((dialog.cart as unknown as CartItem[]) || [], business?.delivery_service_fee ?? 0));
    return;
  }

  if (/^(оформить|оформление|оформи заказ|завершить|checkout)\b/i.test(text.trim()) && ((dialog.cart as unknown as CartItem[]) || []).length > 0) {
    await beginOrderConfirmation(ctx, dialog);
    return;
  }

  const searchCache = (dialog.lastSearchItems as unknown as NalivItem[] | null) || [];
  const cart = (dialog.cart as unknown as CartItem[]) || [];
  const business = await findBusinessFee(dialog.businessId);
  const deliveryFee = business?.delivery_service_fee ?? 0;

  // История диалога для контекста
  const history = await loadChatHistory(ctx.chatId);

  const systemPrompt = buildShoppingSystemPrompt({
    address: dialog.addressLabel,
    businessName: dialog.businessName,
    businessId: dialog.businessId,
    cart,
    searchCache,
    deliveryFee,
    customPrompt: ctx.botAiSystemPrompt,
  });

  const messages: AiChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: text },
  ];

  let currentCart = cart;
  let currentSearchCache = searchCache;

  try {
    for (let round = 0; round < MAX_AI_ROUNDS; round++) {
      const raw = await aiChat(messages, { model: ctx.botAiModel || undefined, formatJson: true });
      const action = parseAiAction(raw);

      if (!action) {
        // Модель ответила не по протоколу — отправляем как есть
        const fallback = raw.trim();
        if (fallback) await ctx.send(fallback.slice(0, 4000));
        return;
      }

      logger.info(`[BotDialog] AI action: ${action.action} (chat #${ctx.chatId}, раунд ${round + 1})`);

      switch (action.action) {
        case 'search_items': {
          const query = (action.query || '').trim();
          if (!query || !dialog.businessId) {
            messages.push({ role: 'assistant', content: JSON.stringify({ action: 'search_items' }) });
            messages.push({ role: 'user', content: 'Ошибка: пустой поисковый запрос. Уточни запрос и вызови search_items снова.' });
            continue;
          }

          const result = await searchItems(query, dialog.businessId);
          // Накапливаем кэш найденных товаров
          const merged = mergeSearchCache(currentSearchCache, result.items);
          currentSearchCache = merged;
          await prisma.botDialog.update({
            where: { id: dialog.id },
            data: { lastSearchItems: merged.slice(0, MAX_SEARCH_CACHE) as unknown as any },
          });

          messages.push({ role: 'assistant', content: JSON.stringify({ action: 'search_items', query }) });
          messages.push({
            role: 'user',
            content:
              result.items.length === 0
                ? `Результаты поиска по «${query}»: ничего не найдено. Скажи клиенту через reply, что товар не найден, и предложи поискать что-то другое.`
                : `Результаты поиска по «${query}» (JSON): ${JSON.stringify(
                    result.items.slice(0, 10).map((i) => ({
                      item_id: i.item_id,
                      name: i.name,
                      price: effectivePrice(i),
                      unit: i.unit,
                      amount: i.amount,
                    }))
                  )}. Покажи клиенту список через reply: "1. Название — цена ₸" и спроси, что добавить. Если клиент уже указал количество или товар однозначный — сразу вызови add_to_cart.`,
          });
          break;
        }

        case 'add_to_cart': {
          const item = currentSearchCache.find((i) => i.item_id === action.item_id);
          if (!item) {
            messages.push({ role: 'assistant', content: raw });
            messages.push({
              role: 'user',
              content: 'Ошибка: товар не найден среди найденных ранее. Сначала вызови search_items, затем add_to_cart с item_id из результатов.',
            });
            continue;
          }
          if (item.amount <= 0) {
            messages.push({ role: 'assistant', content: raw });
            messages.push({ role: 'user', content: `Товар «${item.name}» закончился (остаток 0). Предложи клиенту другой товар через reply.` });
            continue;
          }

          const qty = action.qty && action.qty > 0 ? action.qty : 1;
          currentCart = addToCart(currentCart, item, qty);
          await prisma.botDialog.update({
            where: { id: dialog.id },
            data: { cart: currentCart as unknown as any },
          });

          messages.push({ role: 'assistant', content: raw });
          messages.push({
            role: 'user',
            content: `Корзина обновлена: ${cartForPrompt(currentCart)}. Подтверди добавление через reply (товар, количество, цена) и спроси, что-нибудь ещё.`,
          });
          break;
        }

        case 'remove_from_cart': {
          const existed = currentCart.some((c) => c.itemId === action.item_id);
          currentCart = removeFromCart(currentCart, action.item_id || 0);
          await prisma.botDialog.update({
            where: { id: dialog.id },
            data: { cart: currentCart as unknown as any },
          });

          messages.push({ role: 'assistant', content: raw });
          messages.push({
            role: 'user',
            content: existed
              ? `Товар удалён. Корзина теперь: ${cartForPrompt(currentCart)}. Подтверди через reply.`
              : 'Такого товара не было в корзине. Сообщи клиенту через reply.',
          });
          break;
        }

        case 'clear_cart': {
          currentCart = [];
          await prisma.botDialog.update({
            where: { id: dialog.id },
            data: { cart: [] as unknown as any },
          });
          messages.push({ role: 'assistant', content: raw });
          messages.push({ role: 'user', content: 'Корзина очищена. Подтверди клиенту через reply и спроси, что добавить.' });
          break;
        }

        case 'show_cart': {
          await ctx.send(formatCart(currentCart, deliveryFee));
          return;
        }

        case 'checkout': {
          if (currentCart.length === 0) {
            messages.push({ role: 'assistant', content: raw });
            messages.push({ role: 'user', content: 'Корзина пуста — оформить нельзя. Скажи клиенту через reply, что сначала нужно добавить товары.' });
            continue;
          }
          await beginOrderConfirmationWithCart(ctx, dialog.id, currentCart);
          return;
        }

        case 'handoff': {
          await handoffToOperator(ctx, dialog.id);
          return;
        }

        case 'reply':
        default: {
          const replyText = (action.reply_text || '').trim();
          if (replyText) {
            await ctx.send(replyText.slice(0, 4000));
          } else {
            await ctx.send('🤔 Не совсем понял. Напишите название товара, «корзина» или «оператор».');
          }
          return;
        }
      }
    }

    // Исчерпали раунды без reply — показываем корзину как ориентир
    await ctx.send(formatCart(currentCart, deliveryFee));
  } catch (error) {
    logger.error(`[BotDialog] Ошибка AI-обработки (chat #${ctx.chatId}):`, error);
    await ctx.send('😔 Техническая ошибка, попробуйте ещё раз. Если повторится — напишите «оператор».');
  }
}

/** Объединяет кэш поиска с новой выдачей (без дублей, лимит MAX_SEARCH_CACHE) */
export function mergeSearchCache(cache: NalivItem[], fresh: NalivItem[]): NalivItem[] {
  const map = new Map<number, NalivItem>();
  for (const item of cache) map.set(item.item_id, item);
  for (const item of fresh) map.set(item.item_id, item);
  return Array.from(map.values()).slice(-MAX_SEARCH_CACHE);
}

// === Шаг 4: подтверждение заказа ===

async function findBusinessFee(businessId: number | null) {
  if (!businessId) return null;
  try {
    const businesses = await getBusinesses();
    return businesses.find((b) => b.id === businessId) || null;
  } catch {
    return null;
  }
}

async function beginOrderConfirmation(ctx: DialogContext, dialog: any): Promise<void> {
  await beginOrderConfirmationWithCart(ctx, dialog.id, (dialog.cart as unknown as CartItem[]) || []);
}

async function beginOrderConfirmationWithCart(ctx: DialogContext, dialogId: number, cart: CartItem[]): Promise<void> {
  const dialog = await prisma.botDialog.findUnique({ where: { id: dialogId } });
  const business = await findBusinessFee(dialog?.businessId ?? null);
  const deliveryFee = business?.delivery_service_fee ?? 0;

  await prisma.botDialog.update({
    where: { id: dialogId },
    data: { state: DIALOG_STATES.CONFIRMING_ORDER, cart: cart as unknown as any },
  });

  const summary = [
    '📋 Проверьте заказ:',
    '',
    `🏪 Магазин: ${dialog?.businessName || '-'}`,
    `📍 Адрес доставки: ${dialog?.addressLabel || '-'}`,
    '',
    formatCart(cart, deliveryFee),
    '',
    'Подтверждаете заказ? (да/нет)',
  ].join('\n');

  await ctx.send(summary);
}

async function handleConfirmingOrder(ctx: DialogContext, dialog: any, text: string): Promise<void> {
  const yn = parseYesNo(text);

  if (yn === 'no') {
    await prisma.botDialog.update({
      where: { id: dialog.id },
      data: { state: DIALOG_STATES.SHOPPING },
    });
    await ctx.send('👌 Хорошо, продолжаем собирать заказ. Напишите название товара или «корзина».');
    return;
  }

  if (yn !== 'yes') {
    // Возможно клиент вводит новый адрес — пробуем геокодинг
    const addresses = await searchAddresses(text).catch(() => []);
    if (addresses.length > 0) {
      await prisma.botDialog.update({
        where: { id: dialog.id },
        data: {
          state: DIALOG_STATES.AWAITING_ADDRESS,
          candidateAddresses: null,
          candidateBusinesses: null,
        },
      });
      if (addresses.length === 1) {
        await confirmAddressAndFindStore(ctx, dialog.id, addresses[0]);
      } else {
        await prisma.botDialog.update({
          where: { id: dialog.id },
          data: { candidateAddresses: addresses.slice(0, MAX_CANDIDATES) as unknown as any },
        });
        const lines = addresses.slice(0, MAX_CANDIDATES).map((a, i) => `${i + 1}. ${a.label}`);
        await ctx.send(`📍 Нашёл несколько адресов. Какой ваш?\n\n${lines.join('\n')}\n\nНапишите номер или уточните адрес.`);
      }
      return;
    }

    await ctx.send('🤔 Напишите «да» для подтверждения заказа или «нет», чтобы продолжить выбор товаров.');
    return;
  }

  const cart = (dialog.cart as unknown as CartItem[]) || [];
  if (cart.length === 0) {
    await prisma.botDialog.update({
      where: { id: dialog.id },
      data: { state: DIALOG_STATES.SHOPPING },
    });
    await ctx.send('🛒 Корзина пуста. Напишите название товара.');
    return;
  }

  const business = await findBusinessFee(dialog.businessId);
  const deliveryFee = business?.delivery_service_fee ?? 0;
  const subtotal = cartSubtotal(cart);

  const order = await prisma.botOrder.create({
    data: {
      organizationId: ctx.organizationId,
      chatId: ctx.chatId,
      dialogId: dialog.id,
      businessId: dialog.businessId || 0,
      businessName: dialog.businessName || 'Неизвестный магазин',
      address: dialog.addressLabel || '-',
      addressLat: dialog.addressLat,
      addressLon: dialog.addressLon,
      items: cart as unknown as any,
      totalPrice: subtotal + deliveryFee,
      deliveryFee,
      status: 'new',
      telegramChatId: ctx.telegramChatId,
    },
  });

  // Фиксируем заказ в истории тикета, чтобы операторы видели событие
  await prisma.ticketHistory.create({
    data: {
      chatId: ctx.chatId,
      changeType: 'bot_order_created',
      newValue: String(order.id),
      description: `AI-бот оформил заказ #${order.id} («${order.businessName}», на сумму ${formatMoney(order.totalPrice)} ₸)`,
    },
  });

  // Уведомляем операторов
  const { broadcastToOrganization } = await import('./socketService.js');
  try {
    broadcastToOrganization(ctx.organizationId, 'bot_order_created', {
      orderId: order.id,
      chatId: ctx.chatId,
      businessName: order.businessName,
      address: order.address,
      totalPrice: order.totalPrice,
      itemsCount: cart.reduce((s, c) => s + c.qty, 0),
      telegramChatId: ctx.telegramChatId,
    });
  } catch (socketError) {
    logger.error('[BotDialog] Ошибка уведомления о заказе:', socketError);
  }

  logger.info(`[BotDialog] Создан заказ #${order.id} (${formatMoney(order.totalPrice)} ₸) из чата #${ctx.chatId}`);

  // Новый заказ — начинаем новую корзину
  await prisma.botDialog.update({
    where: { id: dialog.id },
    data: {
      state: DIALOG_STATES.SHOPPING,
      cart: [],
      lastSearchItems: null,
    },
  });

  await ctx.send(
    `✅ Заказ #${order.id} оформлен!\n\n${formatCart(cart, deliveryFee)}\n\nОператор свяжется с вами для подтверждения. Если хотите что-то добавить — напишите название товара.`
  );
}

// === Переход на оператора ===

async function handoffToOperator(ctx: DialogContext, dialogId: number): Promise<void> {
  await prisma.botDialog.update({
    where: { id: dialogId },
    data: { handedOff: true, handedOffAt: new Date() },
  });

  // Чат становится заметным для операторов
  const chat = await prisma.chat.update({
    where: { id: ctx.chatId },
    data: { status: 'new', priority: 'high' },
  });

  await prisma.ticketHistory.create({
    data: {
      chatId: ctx.chatId,
      changeType: 'handoff_to_operator',
      description: 'Клиент запросил живого оператора — AI-бот передал диалог',
    },
  });

  const { notifyChatsUpdated } = await import('./socketService.js');
  try {
    notifyChatsUpdated(ctx.organizationId, {
      id: chat.id,
      status: chat.status,
      priority: chat.priority,
      handedOff: true,
    });
  } catch (socketError) {
    logger.error('[BotDialog] Ошибка уведомления о handoff:', socketError);
  }

  await ctx.send(
    '👨‍💼 Передаю диалог живому оператору — он ответит вам здесь в ближайшее время.'
  );

  logger.info(`[BotDialog] Диалог чата #${ctx.chatId} передан оператору`);
}

// === История диалога для AI-контекста ===

async function loadChatHistory(chatId: number): Promise<AiChatMessage[]> {
  const messages = await prisma.message.findMany({
    where: { chatId, type: 'text', content: { not: '' } },
    orderBy: { timestamp: 'desc' },
    take: MAX_HISTORY_MESSAGES,
    select: { content: true, fromMe: true },
  });

  return messages
    .reverse()
    .map((m): AiChatMessage => ({
      role: m.fromMe ? 'assistant' : 'user',
      content: m.content.slice(0, 500),
    }));
}
