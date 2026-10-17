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
import {
  linkTelegramAccount,
  checkDelivery,
  createNalivOrder,
  NalivCreateOrderPayload,
  NalivCreatedOrder,
} from '../integrations/naliv/telegramBotClient.js';
import {
  CartItem,
  CartItemPromo,
  NalivAddress,
  NalivBusinessWithDistance,
  NalivItem,
  NalivOption,
  NalivOptionVariant,
} from '../integrations/naliv/types.js';
import { aiChat, AiChatMessage } from './aiChatClient.js';

const logger = createLogger();

// === Состояния ===
export const DIALOG_STATES = {
  AWAITING_AGE_CONFIRM: 'awaiting_age_confirm',
  AWAITING_ADDRESS: 'awaiting_address',
  AWAITING_STORE_CONFIRM: 'awaiting_store_confirm',
  AWAITING_PHONE: 'awaiting_phone',
  SHOPPING: 'shopping',
  CONFIRMING_ORDER: 'confirming_order',
} as const;

const MAX_CANDIDATES = 3;
const MAX_SEARCH_CACHE = 50;
const MAX_AI_ROUNDS = 3;
const MAX_HISTORY_MESSAGES = 8;
const FAR_DISTANCE_M = 25000; // предупреждение, если магазин дальше 25 км

/** Кнопка инлайн-клавиатуры (преобразуется в Telegram inline_keyboard) */
export type BotInlineButton = { text: string; callbackData: string };

/** Опции отправки: requestContact — клавиатура «Поделиться номером», inlineKeyboard — кнопки выбора */
export type BotSendOptions = {
  requestContact?: boolean;
  inlineKeyboard?: BotInlineButton[][];
};

/** Колбэк отправки сообщения клиенту (реализуется в telegramService через sendTelegramMessage) */
export type BotReplySender = (text: string, opts?: BotSendOptions) => Promise<unknown>;

/** Колбэк подтверждения нажатия inline-кнопки (answerCallbackQuery) */
export type BotCallbackAcker = (text?: string) => Promise<unknown>;

export type DialogContext = {
  botId: number;
  botAiModel?: string | null;
  botAiSystemPrompt?: string | null;
  botWelcomeMessage?: string | null;
  organizationId: number;
  chatId: number;
  telegramChatId: string;
  /** Telegram user_id (для привязки аккаунта «Налив») */
  telegramUserId?: string | null;
  telegramUsername?: string | null;
  clientName?: string | null;
  telegramLastName?: string | null;
  send: BotReplySender;
  answerCallback?: BotCallbackAcker;
};

// ============================================================
// Чистые функции (экспортированы для юнит-тестов)
// ============================================================

/** Нормализует цену товара с учётом скидок (минимальный discount из promotions) */
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

/** Главная акция товара для отображения: сначала SUBTRACT (2+1), затем максимальная скидка */
export function pickPromo(item: NalivItem): CartItemPromo | null {
  const promos = Array.isArray(item.promotions) ? item.promotions : [];
  const subtract = promos.find((p) => p?.type === 'SUBTRACT' && Number(p.base_amount) > 0 && Number(p.add_amount) > 0);
  if (subtract) {
    return {
      type: subtract.type,
      base_amount: Number(subtract.base_amount),
      add_amount: Number(subtract.add_amount),
      name: subtract.name,
    };
  }
  const bestDiscount = promos
    .filter((p) => Number(p?.discount) > 0)
    .sort((a, b) => Number(b.discount) - Number(a.discount))[0];
  if (bestDiscount) {
    return { type: bestDiscount.type, discount: Number(bestDiscount.discount), name: bestDiscount.name };
  }
  return null;
}

/** Бейдж акции для кнопок и списков: « 🔥2+1», « −11%» */
export function promoBadge(item: NalivItem): string {
  const promo = pickPromo(item);
  if (!promo) return '';
  if (promo.type === 'SUBTRACT') return ` 🔥${promo.base_amount}+${promo.add_amount}`;
  if (Number(promo.discount) > 0) return ` −${Math.round(Number(promo.discount))}%`;
  return '';
}

/** Цена одной порции с учётом опции: цена родителя × размер порции + наценка тары */
export function portionPrice(line: { price: number; portionSize?: number; optionSurcharge?: number }): number {
  return line.price * (line.portionSize && line.portionSize !== 1 ? line.portionSize : 1) + (line.optionSurcharge || 0);
}

/** Число порций в позиции (для розлива — бутылок, для весовых — упаковок) */
export function linePortions(line: CartItem): number {
  return line.portionSize && line.portionSize !== 1 ? Math.round(line.qty / line.portionSize) : line.qty;
}

/** Итог по позиции с учётом акции 2+1 (клиент платит за base из base+add порций) */
export function lineTotal(line: CartItem): number {
  const portions = Math.max(0, linePortions(line));
  const unit = portionPrice(line);
  const promo = line.promo;
  if (promo?.type === 'SUBTRACT' && Number(promo.base_amount) > 0 && Number(promo.add_amount) > 0) {
    const group = promo.base_amount + promo.add_amount;
    const free = Math.floor(portions / group) * promo.add_amount;
    return Math.max(0, portions - free) * unit;
  }
  return portions * unit;
}

/** Ключ позиции корзины: товар + выбранная тара */
function cartLineKey(itemId: number, relationId?: number | null): string {
  return `${itemId}:${relationId ?? 0}`;
}

function findCartLine(cart: CartItem[], itemId: number, relationId?: number | null): CartItem | undefined {
  return cart.find((c) => cartLineKey(c.itemId, c.option?.relationId) === cartLineKey(itemId, relationId));
}

/** Обязательная одиночная опция товара (например тара для розлива) */
export function requiredSingleOption(item: NalivItem): NalivOption | null {
  const options = Array.isArray(item.options) ? item.options : [];
  return options.find((o) => o?.required === 1 && o?.selection === 'SINGLE' && (o.variants?.length ?? 0) > 0) || null;
}

/**
 * Выбор варианта тары: переданный, иначе первая обязательная (защита от
 * добавления розлива без тары, если какая-то ветка не спросила клиента).
 */
export function resolveVariant(item: NalivItem, variant?: NalivOptionVariant | null): NalivOptionVariant | null {
  if (variant) return variant;
  const req = requiredSingleOption(item);
  return req?.variants?.[0] ?? null;
}

/**
 * Добавляет к корзине `portions` порций товара (с выбранной опцией-тарой, если есть).
 * Размер одной порции: для тары — parent_item_amount (литры розлива), иначе quantity_step.
 * Позиции различаются по паре (товар + тара).
 * Предохранитель: товар с обязательной тарой без выбора получает первую тару по умолчанию.
 */
export function addToCart(
  cart: CartItem[],
  item: NalivItem,
  portions: number,
  option?: { variant: NalivOptionVariant } | null
): CartItem[] {
  const variant = resolveVariant(item, option?.variant);
  const portionSize = variant
    ? Math.max(1, Number(variant.parent_item_amount) || 1)
    : item.quantity_step > 0
      ? item.quantity_step
      : 1;
  const relationId = variant?.relation_id ?? null;
  const normalizedPortions = Math.max(1, Math.round(portions));
  const qtyDelta = normalizedPortions * portionSize;
  const price = effectivePrice(item);
  const optionSurcharge = variant && variant.price_type === 'ADD' ? Number(variant.price) || 0 : 0;
  const promo = pickPromo(item);

  const existing = findCartLine(cart, item.item_id, relationId);
  if (existing) {
    return cart.map((c) =>
      cartLineKey(c.itemId, c.option?.relationId) === cartLineKey(item.item_id, relationId)
        ? { ...c, qty: c.qty + qtyDelta, price, portionSize, optionSurcharge, promo }
        : c
    );
  }

  return [
    ...cart,
    {
      itemId: item.item_id,
      name: item.name,
      price,
      qty: qtyDelta,
      unit: item.unit || 'шт',
      portionSize,
      optionSurcharge: optionSurcharge || undefined,
      option: variant
        ? { relationId: variant.relation_id, label: variant.item_name || `Вариант ${variant.relation_id}` }
        : null,
      promo: promo || null,
    },
  ];
}

/** Убирает товар из корзины по item_id (все варианты) */
export function removeFromCart(cart: CartItem[], itemId: number): CartItem[] {
  return cart.filter((c) => c.itemId !== itemId);
}

/**
 * Устанавливает ТОЧНОЕ количество в порциях (не прибавляет):
 * «два ягеря» = 2 порции. portions <= 0 — удалить позицию.
 * Ограничивается остатком на складе (amount — в единицах родителя).
 */
export function setCartQty(
  cart: CartItem[],
  item: NalivItem,
  portions: number,
  option?: { variant: NalivOptionVariant } | null
): CartItem[] {
  const variant = resolveVariant(item, option?.variant);
  const portionSize = variant
    ? Math.max(1, Number(variant.parent_item_amount) || 1)
    : item.quantity_step > 0
      ? item.quantity_step
      : 1;
  const relationId = variant?.relation_id ?? null;
  const normalizedPortions = Math.round(portions);

  if (normalizedPortions <= 0) {
    return cart.filter((c) => cartLineKey(c.itemId, c.option?.relationId) !== cartLineKey(item.item_id, relationId));
  }

  // Не больше остатка, но минимум одна порция
  const maxPortions = item.amount > 0 ? Math.floor(item.amount / portionSize) : normalizedPortions;
  const clampedPortions = Math.min(normalizedPortions, Math.max(maxPortions, 1));
  const price = effectivePrice(item);
  const optionSurcharge = variant && variant.price_type === 'ADD' ? Number(variant.price) || 0 : 0;
  const promo = pickPromo(item);

  const existing = findCartLine(cart, item.item_id, relationId);
  if (existing) {
    return cart.map((c) =>
      cartLineKey(c.itemId, c.option?.relationId) === cartLineKey(item.item_id, relationId)
        ? { ...c, qty: clampedPortions * portionSize, price, portionSize, optionSurcharge, promo }
        : c
    );
  }

  return [
    ...cart,
    {
      itemId: item.item_id,
      name: item.name,
      price,
      qty: clampedPortions * portionSize,
      unit: item.unit || 'шт',
      portionSize,
      optionSurcharge: optionSurcharge || undefined,
      option: variant
        ? { relationId: variant.relation_id, label: variant.item_name || `Вариант ${variant.relation_id}` }
        : null,
      promo: promo || null,
    },
  ];
}

/** Сумма позиций без доставки (с учётом опций и акций 2+1) */
export function cartSubtotal(cart: CartItem[]): number {
  return cart.reduce((sum, c) => sum + lineTotal(c), 0);
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

  const lines = cart.map((c) => {
    const portions = linePortions(c);
    const unit = c.unit || 'шт';
    const isPortioned = !!c.portionSize && c.portionSize !== 1;
    const per = isPortioned
      ? `${formatMoney(portionPrice(c))} ₸/порц. (${c.portionSize} ${unit})`
      : `${formatMoney(c.price)} ₸/${unit}`;
    const optionSuffix = c.option ? `\n   ↳ ${c.option.label}` : '';
    const promoSuffix =
      c.promo?.type === 'SUBTRACT'
        ? `\n   ↳ 🔥 Акция ${c.promo.base_amount}+${c.promo.add_amount}: платите за ${c.promo.base_amount}`
        : '';
    return `• ${c.name}${optionSuffix} — ${per} × ${portions} = ${formatMoney(lineTotal(c))} ₸${promoSuffix}`;
  });
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
    cart.map((c) => ({
      item_id: c.itemId,
      name: c.name,
      ...(c.option ? { option: c.option.label } : {}),
      price: c.price,
      qty: c.qty,
      unit: c.unit,
      ...(c.promo?.type === 'SUBTRACT' ? { promo: `${c.promo.base_amount}+${c.promo.add_amount}` } : {}),
      ...(c.portionSize && c.portionSize > 1 ? { portion_size: c.portionSize } : {}),
    }))
  );
}

/** Расстояние в человекочитаемом виде */
export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM)} м`;
  return `${(distanceM / 1000).toFixed(1)} км`;
}

// === Инлайн-кнопки ===

const MAX_SEARCH_BUTTONS = 8;
const MAX_BUTTON_NAME_LEN = 32;

/** Разбивает список на строки по `size` элементов */
export function chunkRows<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

/** Короткое имя товара для кнопки */
export function shortenItemName(name: string, maxLen = MAX_BUTTON_NAME_LEN): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean.length <= maxLen ? clean : `${clean.slice(0, maxLen - 1)}…`;
}

/** Варианты количества на кнопках */
export const QTY_CHOICES = [1, 2, 3, 4, 5, 6];

/** Цена порции с минимальной тарой («от X ₸») — для товаров с обязательной тарой */
export function minPortionPrice(item: NalivItem): number | null {
  const option = requiredSingleOption(item);
  if (!option) return null;
  const prices = (option.variants || []).map((v) => {
    const pAmount = Math.max(1, Number(v.parent_item_amount) || 1);
    return effectivePrice(item) * pAmount + (v.price_type === 'ADD' ? Number(v.price) || 0 : 0);
  });
  return prices.length ? Math.min(...prices) : null;
}

/**
 * Сообщение с результатами поиска + кнопка на каждый товар.
 * Воронка выбора: товар (pick:<item_id>) -> тара, если есть (tara:...) -> количество (qty:...).
 * limit — сколько вариантов показать.
 */
export function buildSearchOffer(query: string, items: NalivItem[], limit: number = MAX_SEARCH_BUTTONS): {
  text: string;
  inlineKeyboard: BotInlineButton[][];
} {
  const shown = items.slice(0, Math.max(1, Math.min(limit, MAX_SEARCH_BUTTONS)));

  const listText = shown
    .map((i) => {
      const option = requiredSingleOption(i);
      const promo = pickPromo(i);
      const promoText =
        promo?.type === 'SUBTRACT'
          ? ` 🔥 акция ${promo.base_amount}+${promo.add_amount}`
          : Number(promo?.discount) > 0
            ? ` −${Math.round(Number(promo.discount))}%`
            : '';
      const hint = option ? ` — выберите тару (${option.name})` : '';
      return `• ${i.name} — ${formatMoney(effectivePrice(i))} ₸/${i.unit || 'шт'}${promoText}${hint}`;
    })
    .join('\n');

  const text =
    `🔍 Нашёл по запросу «${query}»:\n\n${listText}\n\n` +
    `Выберите товар кнопкой 👇`;

  const rows = chunkRows(
    shown.map((i) => {
      const badge = promoBadge(i);
      const fromPrice = minPortionPrice(i);
      const priceLabel = fromPrice !== null ? `от ${formatMoney(fromPrice)} ₸` : `${formatMoney(effectivePrice(i))} ₸`;
      return {
        text: `${shortenItemName(i.name)} · ${priceLabel}${badge}`,
        callbackData: `pick:${i.item_id}`,
      };
    }),
    2
  );
  rows.push([
    { text: '🛒 Корзина', callbackData: 'cart' },
    { text: '✅ Оформить', callbackData: 'checkout' },
  ]);

  return { text, inlineKeyboard: rows };
}

/** Шаг 2 воронки: выбор тары (если у товара она обязательна) */
export function buildTaraOffer(item: NalivItem): { text: string; inlineKeyboard: BotInlineButton[][] } | null {
  const option = requiredSingleOption(item);
  if (!option) return null;

  const badge = promoBadge(item);
  const rows = chunkRows(
    (option.variants || []).map((v) => {
      const pAmount = Math.max(1, Number(v.parent_item_amount) || 1);
      const portion = effectivePrice(item) * pAmount + (v.price_type === 'ADD' ? Number(v.price) || 0 : 0);
      return {
        text: `${shortenItemName(v.item_name || option.name, 30)} · ${formatMoney(portion)} ₸${badge}`,
        callbackData: `tara:${item.item_id}:${v.relation_id}`,
      };
    }),
    2
  );

  return {
    text: `🫗 «${item.name}» — выберите тару (${option.name}):`,
    inlineKeyboard: rows,
  };
}

/** Шаг 3 воронки: выбор количества кнопками 1–6 */
export function buildQtyOffer(item: NalivItem, variant: NalivOptionVariant | null): { text: string; inlineKeyboard: BotInlineButton[][] } {  const pAmount = variant ? Math.max(1, Number(variant.parent_item_amount) || 1) : item.quantity_step > 0 ? item.quantity_step : 1;
  const surcharge = variant && variant.price_type === 'ADD' ? Number(variant.price) || 0 : 0;
  const portion = effectivePrice(item) * pAmount + surcharge;
  const unit = item.unit || 'шт';

  const perPortion =
    pAmount !== 1
      ? `${formatMoney(portion)} ₸ за порцию (${pAmount} ${unit})`
      : `${formatMoney(portion)} ₸ за порцию`;
  const variantLine = variant ? `\n↳ ${variant.item_name}` : '';
  const promo = pickPromo(item);
  const promoLine =
    promo?.type === 'SUBTRACT'
      ? `\n🔥 Акция ${promo.base_amount}+${promo.add_amount}: за каждые ${promo.base_amount + promo.add_amount} шт платите за ${promo.base_amount}`
      : '';

  const rows = chunkRows(
    QTY_CHOICES.map((n) => ({
      text: `${n}`,
      callbackData: `qty:${item.item_id}:${variant?.relation_id ?? 0}:${n}`,
    })),
    3
  );
  rows.push([
    { text: '🛒 Корзина', callbackData: 'cart' },
    { text: '↩️ Назад к таре', callbackData: variant ? `tara:${item.item_id}:${variant.relation_id}` : `pick:${item.item_id}` },
  ]);

  return {
    text: `🔢 «${item.name}»${variantLine} — ${perPortion} за порцию${promoLine}\n\nСколько берём?`,
    inlineKeyboard: rows,
  };
}

/**
 * Результаты мультипоиска: клиент попросил несколько разных товаров
 * («чечил, вино и шампанское») — группы «запрос → товары» с кнопками на каждую группу.
 */
export function buildMultiSearchOffer(groups: { query: string; items: NalivItem[] }[]): {
  text: string;
  inlineKeyboard: BotInlineButton[][];
} {
  const sections: string[] = [];
  const buttons: BotInlineButton[] = [];

  for (const g of groups) {
    if (g.items.length === 0) {
      sections.push(`😔 По «${g.query}» ничего не нашлось`);
      continue;
    }
    sections.push(
      `🔎 «${g.query}»:\n` +
        g.items
          .map((i) => {
            const promo = pickPromo(i);
            const promoText =
              promo?.type === 'SUBTRACT'
                ? ` 🔥 акция ${promo.base_amount}+${promo.add_amount}`
                : Number(promo?.discount) > 0
                  ? ` −${Math.round(Number(promo.discount))}%`
                  : '';
            const hint = requiredSingleOption(i) ? ' — есть тара' : '';
            return `• ${i.name} — ${formatMoney(effectivePrice(i))} ₸/${i.unit || 'шт'}${promoText}${hint}`;
          })
          .join('\n')
    );
    for (const i of g.items) {
      const fromPrice = minPortionPrice(i);
      const priceLabel = fromPrice !== null ? `от ${formatMoney(fromPrice)} ₸` : `${formatMoney(effectivePrice(i))} ₸`;
      buttons.push({
        text: `${shortenItemName(i.name)} · ${priceLabel}${promoBadge(i)}`,
        callbackData: `pick:${i.item_id}`,
      });
    }
  }

  const text = `🔍 Нашёл по вашим запросам:\n\n${sections.join('\n\n')}\n\nВыберите товар кнопкой 👇`;

  const rows = chunkRows(buttons.slice(0, 14), 2);
  rows.push([
    { text: '🛒 Корзина', callbackData: 'cart' },
    { text: '✅ Оформить', callbackData: 'checkout' },
  ]);

  return { text, inlineKeyboard: rows };
}

/** Кнопки под корзиной/подтверждением добавления */
export function cartActionsKeyboard(): BotInlineButton[][] {
  return [[{ text: '🛒 Корзина', callbackData: 'cart' }, { text: '✅ Оформить', callbackData: 'checkout' }]];
}

/** Кнопки под сводкой заказа */
export function confirmOrderKeyboard(): BotInlineButton[][] {
  return [[{ text: '✅ Да, оформляем', callbackData: 'confirm_order' }, { text: '❌ Нет', callbackData: 'cancel_order' }]];
}

/** Кнопки под пустой корзиной */
export function emptyCartKeyboard(): BotInlineButton[][] {
  return [[{ text: '✅ Оформить', callbackData: 'checkout' }]];
}

/** Кнопки подтверждения возраста 21+ */
export function ageConfirmKeyboard(): BotInlineButton[][] {
  return [[{ text: '✅ Да, мне 21+', callbackData: 'age_yes' }, { text: '❌ Нет', callbackData: 'age_no' }]];
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

/** Просьба отложить вопрос про телефон */
const SKIP_PHONE_PATTERN = /^(позже|потом|пропустить|скип|не сейчас|не хочу|не буду|не давай|skip|later)(?!\p{L})/iu;

export function isSkipPhoneRequest(text: string): boolean {
  return SKIP_PHONE_PATTERN.test(text.trim());
}

/**
 * Нормализует телефон из текста или Telegram contact.
 * Поддерживает +7 7XX XXX XXXX, 8 7XX..., 77XXXXXXXXX и т.п.
 * @returns '+7XXXXXXXXXX' или null, если похоже не на телефон
 */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');

  // 8XXXXXXXXXX -> 7XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }
  // 10 цифр, начиная с 7 (без кода страны) -> 7XXXXXXXXXX
  if (digits.length === 10 && digits.startsWith('7')) {
    digits = `7${digits}`;
  }

  if (digits.length !== 11 || !digits.startsWith('7')) return null;

  return `+7${digits.slice(1)}`;
}

/** Случайная фраза из списка — чтобы бот не повторялся */
export function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// === Рекомендации «в пару к заказу» ===

/** Категория -> поисковые запросы дополнений (выбирается случайный) */
export const PAIRINGS: { pattern: RegExp; keywords: string[] }[] = [
  // Пиво/сидр -> снеки
  { pattern: /пиво|лагер|эль\b|ipa|apa|lager|ale|сидр/i, keywords: ['чипсы', 'снеки', 'сухарики', 'рыбка', 'сырные палочки'] },
  // Вино -> сыр, шоколад
  { pattern: /вин[оа]|кагор| просекко|шампан/i, keywords: ['сыр', 'шоколад'] },
  // Крепкое -> миксеры
  { pattern: /виски|коньяк|водка|джин|ром|текила|настойка|абсент|бренди|самогон/i, keywords: ['кола', 'сок', 'тоник'] },
];

/**
 * Подбирает поисковый запрос для рекомендации «в пару» к товару.
 * Возвращает null, если для товара нет пары (снеки к снекам не предлагаем).
 */
export function getRecommendationQuery(itemName: string): string | null {
  for (const rule of PAIRINGS) {
    if (rule.pattern.test(itemName)) {
      return pick(rule.keywords);
    }
  }
  return null;
}

/** Есть ли в корзине уже товар этой пары (чтобы не предлагать повторно) */
export function cartHasPairing(cart: CartItem[], keyword: string): boolean {
  const root = keyword.toLowerCase().slice(0, 4);
  return cart.some((c) => c.name.toLowerCase().includes(root));
}

/** Вариативные «живые» реакции */
const PHONE_ACKS = [
  'Отлично, номер записал ✅',
  'Супер, спасибо! Номер у меня 📞',
  'Принято! Без номера никуда 😉',
];

const PHONE_SKIP_ACKS = [
  'Хорошо, вернёмся к этому позже 👌',
  'Без проблем! Спрошу ещё раз при оформлении.',
];

const PHONE_ASKS = [
  'Чтобы курьер мог позвонить при доставке, поделитесь номером телефона — нажмите кнопку ниже 📱',
  'Остался один момент: нужен ваш номер телефона, чтобы курьер мог связаться. Жмите кнопку ниже 📱',
];

/**
 * Разбор ответа модели. Ожидается строгий JSON вида
 * {"action": "...", ...}. Возвращает null, если распарсить не удалось.
 */
export type AiAction = {
  action: string;
  query?: string;
  /** Мультипоиск: несколько запросов одним действием */
  queries?: string[];
  item_id?: number;
  qty?: number;
  limit?: number;
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

    // query может быть строкой или массивом строк (мультипоиск)
    let queries: string[] | undefined;
    if (Array.isArray(parsed.query)) {
      queries = parsed.query
        .filter((q: unknown) => typeof q === 'string')
        .map((q: string) => q.trim())
        .filter(Boolean)
        .slice(0, 4);
    }

    return {
      action: parsed.action.toLowerCase().trim(),
      query: typeof parsed.query === 'string' ? parsed.query : undefined,
      queries,
      item_id: Number.isFinite(Number(parsed.item_id)) ? Number(parsed.item_id) : undefined,
      qty: Number.isFinite(Number(parsed.qty)) ? Number(parsed.qty) : undefined,
      limit: Number.isFinite(Number(parsed.limit)) ? Number(parsed.limit) : undefined,
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
  clientName?: string | null;
  phone?: string | null;
  customPrompt?: string | null;
}): string {
  const nameLine = ctx.clientName ? `Клиента зовут ${ctx.clientName} — обращайся по имени.` : '';
  const phoneLine = ctx.phone
    ? `Телефон клиента уже известен (${ctx.phone}) — дополнительно не спрашивай.`
    : 'Телефона клиента пока нет — он будет запрошен отдельно, сам не спрашивай.';

  const base = `Ты — Гоша, живой и дружелюбный AI-ассистент доставки алкоголя "Налив/Градусы24" в Telegram. Ты не робот-справка, а отличный продавец-консультант: помогаешь собрать заказ и радуешься, когда клиент доволен. Общайся на русском языке.

ЛИЧНОСТЬ:
- Живой, лёгкий, с юмором; уместные эмодзи (🍺 🍿 🔥 ✅) — без перебора
- Отвечай коротко: 1–3 предложения. Никаких простыней
- Реагируй на выбор клиента: «Отличный выбор!», «Классика!», «Хороший кус»
- Проявляй инициативу как продавец: предложи похожий товар или закуску к напиткам — но одно предложение за раз, не навязывайся
- После добавления товара бот АВТОМАТИЧЕСКИ покажет кнопки «часто берут в пару» (закуски/миксеры) — не дублируй их списком в reply
- Если клиент пошутил — поддержи шутку. Если недоволен — разберись и помоги

ВОЗРАСТ: подтверждение возраста 21+ уже пройдено — про возраст не спрашивай.

ОБЩИЕ ЗАПРОСЫ («красное вино к ужину», «что-нибудь лёгкое», «на компанию»):
- Задай НЕ БОЛЬШЕ 2–3 коротких уточняющих вопросов, по ОДНОМУ за раз через reply (например: сухое или полусладкое? какой бюджет? какая страна?)
- Ответы клиент набирает текстом — не предлагай кнопки для этого, только текстом
- После ответов вызови search_items с уточнённым запросом и "limit": 3 — клиент получит 2–3 подходящих варианта кнопками выбора

${nameLine}
${phoneLine}

КОНТЕКСТ:
- Адрес доставки: ${ctx.address || 'не указан'}
- Магазин: ${ctx.businessName || 'не выбран'} (business_id: ${ctx.businessId || '-'})
- Стоимость доставки: ${ctx.deliveryFee} ₸
- Текущая корзина (JSON): ${cartForPrompt(ctx.cart)}
- Найденные ранее товары (JSON, свежие в конце; доступны для add_to_cart): ${JSON.stringify(
    ctx.searchCache.slice(-15).map((i) => ({ item_id: i.item_id, name: i.name, price: i.price, unit: i.unit }))
  )}

ПРАВИЛА:
1. Ты отвечаешь СТРОГО одним JSON-объектом, без пояснений и markdown.
2. Цены только из результатов поиска. НИКОГДА не выдумывай товары и цены.
3. Если клиент называет товар, которого нет в "Найденных ранее товарах" — сначала вызови search_items.
4. КАТЕГОРИИ И ТИПЫ («розлив», «пиво», «вино», «закуски», «на компанию») — ВСЕГДА search_items, даже если похожие товары уже есть в "Найденных ранее товарах". Клиент должен увидеть весь выбор кнопками.
5. НЕСКОЛЬКО РАЗНЫХ ТОВАРОВ одним сообщением («чечил, вино и шампанское») — передай МАССИВ запросов: {"action": "search_items", "query": ["чечил", "вино", "шампанское"]} (максимум 4). Результаты покажутся сгруппированно.
6. add_to_cart/set_qty — только когда клиент явно просит добавить или изменить КОНКРЕТНЫЙ товар.
7. Напитки продаются только лицам 18+. Не помогай покупать алкоголь несовершеннолетним.
8. Когда клиент выбирает товар из списка по номеру, используй item_id соответствующего товара из последнего результата поиска.

Формат ответа (выбери ОДНО действие):
{"action": "search_items", "query": "<запрос или массив запросов>", "limit": <сколько показать, опционально>}
{"action": "add_to_cart", "item_id": <id>, "qty": <порции>} — ДОБАВИТЬ к имеющемуся
{"action": "set_qty", "item_id": <id>, "qty": <порции>} — УСТАНОВИТЬ точное количество
{"action": "remove_from_cart", "item_id": <id>}
{"action": "clear_cart"}
{"action": "show_cart"}
{"action": "checkout"} — клиент хочет оформить заказ
{"action": "handoff"} — клиент просит живого оператора
{"action": "reply", "reply_text": "<текст для клиента>"}

ПОРЦИИ: qty указывается в ПОРЦИЯХ. Размер одной порции — quantity_step шт товара (у большинства товаров 1 порция = 1 шт). Клиент называет порциями: «два ягеря» = 2 порции, «упаковку воды» = 1 порция.

РАЗЛИЧАЙ add_to_cart и set_qty (смотри текущую корзину):
- add_to_cart («ещё», «плюс», «добавь», «кинь ещё») — прибавить к тому, что уже в корзине: «ещё два ягеря» при 1 шт в корзине = 3 шт
- set_qty («два ягеря», «хочу 3 короны», «сделай 2», «не 2, а 4») — клиент называет ИТОГОВОЕ количество: «два ягеря» = ровно 2 порции, независимо от того, сколько уже лежит

search_items — вызывай, когда клиент называет товар, которого нет в "Найденных ранее товарах". Результаты клиент увидит автоматически списком с кнопками выбора — САМ список не пиши и не перечисляй товары в reply.
add_to_cart/set_qty — только для товаров из "Найденных ранее товаров" (когда выбор однозначен).
После add_to_cart/set_qty/remove_from_cart/clear_cart ты получишь обновлённую корзину — подтверди через reply живой фразой и предложи, что-нибудь ещё.
Если клиент пишет «корзина» — вызови show_cart. Если готов заказывать — checkout. Если просто болтает — поддержи беседу через reply и мягко верни к выбору.`;

  return ctx.customPrompt ? `${base}\n\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ВЛАДЕЛЬЦА БОТА:\n${ctx.customPrompt}` : base;
}

// ============================================================
// Основные обработчики
// ============================================================

/** Обработка /start у AI-бота: сброс диалога и приветствие */
export async function handleBotStart(ctx: DialogContext): Promise<void> {
  const existing = await prisma.botDialog.findUnique({ where: { chatId: ctx.chatId } });
  const ageConfirmed = existing?.ageConfirmed ?? false;

  await prisma.botDialog.upsert({
    where: { chatId: ctx.chatId },
    create: {
      chatId: ctx.chatId,
      state: ageConfirmed ? DIALOG_STATES.AWAITING_ADDRESS : DIALOG_STATES.AWAITING_AGE_CONFIRM,
      ageConfirmed,
    },
    update: {
      state: ageConfirmed ? DIALOG_STATES.AWAITING_ADDRESS : DIALOG_STATES.AWAITING_AGE_CONFIRM,
      addressLabel: null,
      addressLat: null,
      addressLon: null,
      businessId: null,
      businessName: null,
      candidateAddresses: null,
      candidateBusinesses: null,
      lastSearchItems: null,
      cart: null,
      // Телефон и подтверждение возраста сохраняем между сессиями
      handedOff: false,
      handedOffAt: null,
    },
  });

  const name = ctx.clientName ? `, ${ctx.clientName}` : '';
  const greeting =
    ctx.botWelcomeMessage?.trim() ||
    `Привет${name}! 👋 Я Гоша — ассистент доставки Градусы24 🍻\n\nНайду ближайший магазин, помогу выбрать и оформлю доставку прямо здесь, в чате.`;

  if (!ageConfirmed) {
    // Первый диалог: сначала подтверждение возраста 21+, без него заказ не принимается
    await ctx.send(`${greeting}\n\nПрежде чем начнём — проверка возраста 🪪 Вам уже есть 21 год?`, {
      inlineKeyboard: ageConfirmKeyboard(),
    });
    return;
  }

  await ctx.send(`${greeting}\n\n📍 С какого адреса привезти? Напишите улицу, дом и город.`);
}

// === Шаг 0: подтверждение возраста 21+ ===

/** Обработка ответа на вопрос о возрасте (текст или кнопка) */
async function handleAgeConfirm(ctx: DialogContext, dialog: { id: number; ageConfirmed: boolean; addressLabel: string | null; cart: unknown }, text: string): Promise<void> {
  const yn = parseYesNo(text);

  if (yn === 'no') {
    await ctx.send(
      'Понял 🙏 К сожалению, заказы можно принимать только от лиц 21+.\n\nЕсли нажали нечаянно — нажмите «✅ Да, мне 21+» выше или напишите «да».',
      { inlineKeyboard: ageConfirmKeyboard() }
    );
    return;
  }

  if (yn === 'yes') {
    await saveAgeAndContinue(ctx, dialog);
    return;
  }

  await ctx.send('🪪 Подтвердите, пожалуйста: вам есть 21 год? Нажмите кнопку или напишите «да» / «нет».', {
    inlineKeyboard: ageConfirmKeyboard(),
  });
}

/** Возраст подтверждён — ведём клиента дальше по сценарию */
async function saveAgeAndContinue(ctx: DialogContext, dialog: { id: number; addressLabel: string | null; cart: unknown }): Promise<void> {
  await prisma.botDialog.update({
    where: { id: dialog.id },
    data: { ageConfirmed: true, state: DIALOG_STATES.AWAITING_ADDRESS },
  });

  await ctx.send('Отлично, спасибо! 🤝');

  const cart = (dialog.cart as unknown as CartItem[]) || [];
  if (cart.length > 0) {
    // Возраст спросили при оформлении — возвращаемся к подтверждению заказа
    await beginOrderConfirmationWithCart(ctx, dialog.id, cart);
    return;
  }

  await ctx.send('📍 С какого адреса привезти? Напишите улицу, дом и город — найду ближайший магазин.');
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
    case DIALOG_STATES.AWAITING_AGE_CONFIRM:
      await handleAgeConfirm(ctx, dialog, text);
      break;
    case DIALOG_STATES.AWAITING_ADDRESS:
      await handleAwaitingAddress(ctx, dialog, text);
      break;
    case DIALOG_STATES.AWAITING_STORE_CONFIRM:
      await handleAwaitingStoreConfirm(ctx, dialog, text);
      break;
    case DIALOG_STATES.AWAITING_PHONE:
      await handleAwaitingPhone(ctx, dialog, text);
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

/**
 * Клиент поделился контактом (кнопка Telegram) — сохраняем телефон.
 * Вызывается из telegramService для AI-ботов.
 */
export async function handleBotContact(ctx: DialogContext, phoneRaw: string): Promise<void> {
  const dialog = await prisma.botDialog.findUnique({ where: { chatId: ctx.chatId } });

  if (!dialog) {
    await handleBotStart(ctx);
    return;
  }

  if (dialog.handedOff) {
    return;
  }

  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    await ctx.send(
      'Хм, этот номер выглядит странно 🤔 Попробуйте ещё раз кнопкой ниже или напишите номер сообщением.',
      { requestContact: true }
    );
    return;
  }

  await savePhoneAndContinue(ctx, dialog, phone);
}

/**
 * Сохраняет телефон и ведёт клиента дальше.
 * Из состояния awaiting_phone: в корзину или к оформлению заказа.
 * Из любого другого (контакт прислали раньше времени): просто благодарим и остаёмся в текущем шаге.
 */
async function savePhoneAndContinue(
  ctx: DialogContext,
  dialog: { id: number; state: string; cart: unknown },
  phone: string
): Promise<void> {
  await prisma.botDialog.update({
    where: { id: dialog.id },
    data: { phone },
  });

  const ack = pick(PHONE_ACKS);
  await ctx.send(`${ack}\n📞 ${phone}`);

  // Параллельно привязываем аккаунт «Налив» (не блокирует сценарий):
  // клиент получит JWT и уведомления о статусах заказов
  if (ctx.telegramUserId) {
    void linkNalivAccount(ctx, phone).catch(() => {});
  }

  if (dialog.state !== DIALOG_STATES.AWAITING_PHONE) {
    // Контакт прислали не по запросу — продолжаем текущий шаг сценария
    return;
  }

  const cart = (dialog.cart as unknown as CartItem[]) || [];
  if (cart.length > 0) {
    // Телефон запросили при оформлении — переходим к подтверждению заказа
    await beginOrderConfirmationWithCart(ctx, dialog.id, cart);
  } else {
    await startShopping(ctx, dialog.id);
  }
}

/**
 * Привязывает Telegram-клиента к аккаунту «Налив» по номеру телефона
 * (POST /api/telegram-bot/auth/link) и сохраняет JWT в BotUser.
 * Ошибки не ломают диалог — только логируются.
 */
export async function linkNalivAccount(ctx: DialogContext, phone: string): Promise<void> {
  if (!ctx.telegramUserId) return;

  try {
    const linked = await linkTelegramAccount({
      telegram_id: ctx.telegramUserId,
      phone,
      telegram_username: ctx.telegramUsername || undefined,
      first_name: ctx.clientName || undefined,
      last_name: ctx.telegramLastName || undefined,
    });

    const user = linked.user;
    await prisma.botUser.upsert({
      where: { telegramUserId: ctx.telegramUserId },
      create: {
        organizationId: ctx.organizationId,
        telegramUserId: ctx.telegramUserId,
        telegramBotId: ctx.botId,
        telegramChatId: ctx.telegramChatId,
        nalivUserId: user.user_id ?? null,
        name: user.name ?? null,
        login: user.login ?? phone,
        token: linked.token,
        sessionToken: linked.sessionToken ?? null,
        linkedAt: new Date(),
      },
      update: {
        telegramBotId: ctx.botId,
        telegramChatId: ctx.telegramChatId,
        nalivUserId: user.user_id ?? null,
        name: user.name ?? null,
        login: user.login ?? phone,
        token: linked.token,
        sessionToken: linked.sessionToken ?? null,
        linkedAt: new Date(),
      },
    });

    logger.info(
      `[BotDialog] Аккаунт «Налив» привязан: telegram_id=${ctx.telegramUserId} → user_id=${user.user_id}${linked.created ? ' (создан)' : ''}`
    );

    await ctx.send(
      linked.created
        ? '🎁 Бонус: заводим карту лояльности «Налив» — скидки и бонусы будут копиться здесь!'
        : '🔗 Ваш Telegram связан с аккаунтом «Налив» — о статусе заказа сообщу прямо сюда.'
    );
  } catch (error: any) {
    if (error?.status === 409) {
      logger.warn(`[BotDialog] telegram_id=${ctx.telegramUserId} уже привязан к другому аккаунту «Налив»`);
      await ctx.send(
        'ℹ️ Этот Telegram уже привязан к другому номеру «Налив». Если нужно перевязать — напишите оператору.'
      );
      return;
    }

    logger.error(`[BotDialog] Ошибка привязки аккаунта «Налив» (telegram_id=${ctx.telegramUserId}):`, error);
  }
}

/** Отправляет корзину текстом + кнопки действий */
async function sendCartMessage(ctx: DialogContext, cart: CartItem[], deliveryFee: number): Promise<void> {
  const keyboard = cart.length > 0 ? cartActionsKeyboard() : emptyCartKeyboard();
  await ctx.send(formatCart(cart, deliveryFee), { inlineKeyboard: keyboard });
}

// === Нажатия инлайн-кнопок ===

/**
 * Обработка callback_query от инлайн-кнопок:
 *   add:<item_id> — добавить 1 шт товара в корзину
 *   cart — показать корзину; checkout — оформить; clear — очистить
 *   confirm_order / cancel_order — подтверждение заказа
 */
export async function handleBotCallback(ctx: DialogContext, data: string): Promise<void> {
  const dialog = await prisma.botDialog.findUnique({ where: { chatId: ctx.chatId } });

  if (!dialog || dialog.handedOff) {
    await ctx.answerCallback?.();
    return;
  }

  // Снимаем «часики» на кнопке сразу
  await ctx.answerCallback?.();

  const [cmd, arg, arg2, arg3] = (data || '').split(':');

  switch (cmd) {
    case 'pick':
      await handlePickCallback(ctx, dialog, Number(arg));
      return;
    case 'tara':
      await handleTaraCallback(ctx, dialog, Number(arg), Number(arg2));
      return;
    case 'qty':
      await handleQtyCallback(ctx, dialog, Number(arg), arg2 ? Number(arg2) : 0, Number(arg3) || 1);
      return;
    case 'add':
      // Совместимость со старыми кнопками: add:<id> = выбор товара, add:<id>:<rel> = тара
      if (arg2) {
        await handleTaraCallback(ctx, dialog, Number(arg), Number(arg2));
      } else {
        await handlePickCallback(ctx, dialog, Number(arg));
      }
      return;
    case 'cart': {
      const business = await findBusinessFee(dialog.businessId);
      await sendCartMessage(
        ctx,
        (dialog.cart as unknown as CartItem[]) || [],
        dialog.deliveryPrice ?? business?.delivery_service_fee ?? 0
      );
      return;
    }
    case 'checkout': {
      const cart = (dialog.cart as unknown as CartItem[]) || [];
      if (cart.length === 0) {
        await ctx.send('🛒 Корзина пока пуста. Напишите название товара — например «пиво Heineken» — и я всё найду.');
        return;
      }
      await beginOrderConfirmationWithCart(ctx, dialog.id, cart);
      return;
    }
    case 'clear': {
      await prisma.botDialog.update({
        where: { id: dialog.id },
        data: { cart: [] as unknown as any },
      });
      await ctx.send('🗑 Корзину очистил. Начинаем заново — напишите название товара 🔍');
      return;
    }
    case 'confirm_order':
      await handleConfirmingOrder(ctx, dialog, 'да');
      return;
    case 'cancel_order':
      await handleConfirmingOrder(ctx, dialog, 'нет');
      return;
    case 'age_yes':
      if (!dialog.ageConfirmed) {
        await saveAgeAndContinue(ctx, dialog);
      }
      return;
    case 'age_no':
      if (!dialog.ageConfirmed) {
        await handleAgeConfirm(ctx, dialog, 'нет');
      }
      return;
    default:
      logger.warn(`[BotDialog] Неизвестный callback: ${data} (chat #${ctx.chatId})`);
  }
}

type PickDialog = {
  id: number;
  businessId: number | null;
  businessName: string | null;
  lastSearchItems: unknown;
  cart: unknown;
  deliveryPrice?: number | null;
};

/** Общий диалог для воронки выбора (товар -> тара -> количество) */
type PickCallbackDialog = PickDialog;

/** Находит товар в кэше поиска или сообщает, что он устарел */
async function findCachedItemOrApologize(ctx: DialogContext, dialog: PickCallbackDialog, itemId: number): Promise<NalivItem | null> {
  const searchCache = (dialog.lastSearchItems as unknown as NalivItem[] | null) || [];
  const item = searchCache.find((i) => i.item_id === itemId) || null;

  if (!item) {
    await ctx.send('🤔 Этот товар уже не в текущем поиске. Напишите название ещё раз — покажу актуальные варианты 🔍');
    return null;
  }
  if (item.amount <= 0) {
    await ctx.send(`😔 «${item.name}» закончился. Выберите что-нибудь другое 🔍`);
    return null;
  }
  return item;
}

/** Шаг 1 воронки: выбор товара -> тара (если есть) или сразу количество */
async function handlePickCallback(ctx: DialogContext, dialog: PickCallbackDialog, itemId: number): Promise<void> {
  const item = await findCachedItemOrApologize(ctx, dialog, itemId);
  if (!item) return;

  const taraOffer = buildTaraOffer(item);
  if (taraOffer) {
    await ctx.send(taraOffer.text, { inlineKeyboard: taraOffer.inlineKeyboard });
    return;
  }

  const qtyOffer = buildQtyOffer(item, null);
  await ctx.send(qtyOffer.text, { inlineKeyboard: qtyOffer.inlineKeyboard });
}

/** Шаг 2 воронки: выбрана тара -> выбор количества */
async function handleTaraCallback(ctx: DialogContext, dialog: PickCallbackDialog, itemId: number, relationId: number): Promise<void> {
  const item = await findCachedItemOrApologize(ctx, dialog, itemId);
  if (!item) return;

  const option = requiredSingleOption(item);
  const variant = option?.variants?.find((v) => v.relation_id === relationId) || null;
  if (!variant) {
    await ctx.send('🤔 Такой вариант тары уже не в текущем поиске. Напишите название товара ещё раз 🔍');
    return;
  }

  const qtyOffer = buildQtyOffer(item, variant);
  await ctx.send(qtyOffer.text, { inlineKeyboard: qtyOffer.inlineKeyboard });
}

/** Шаг 3 воронки: выбрано количество -> добавляем в корзину */
async function handleQtyCallback(ctx: DialogContext, dialog: PickCallbackDialog, itemId: number, relationId: number, portions: number): Promise<void> {
  const item = await findCachedItemOrApologize(ctx, dialog, itemId);
  if (!item) return;

  let variant: NalivOptionVariant | null = null;
  if (relationId) {
    const option = requiredSingleOption(item);
    variant = option?.variants?.find((v) => v.relation_id === relationId) || null;
    if (!variant) {
      await ctx.send('🤔 Такой вариант тары уже не в текущем поиске. Напишите название товара ещё раз 🔍');
      return;
    }
  }

  const safePortions = Math.max(1, Math.min(Math.round(portions) || 1, 99));
  const cart = addToCart((dialog.cart as unknown as CartItem[]) || [], item, safePortions, variant ? { variant } : null);
  await prisma.botDialog.update({
    where: { id: dialog.id },
    data: { cart: cart as unknown as any },
  });

  await sendAddedConfirmation(ctx, dialog, item, cart, variant?.relation_id ?? null, safePortions);

  logger.info(
    `[BotDialog] Воронка qty=${safePortions} (${item.item_id}${relationId ? `:${relationId}` : ''}) → корзина чата #${ctx.chatId}: ${cart.length} позиций`
  );
}

/** Подтверждение добавления + рекомендации «в пару» */
async function sendAddedConfirmation(
  ctx: DialogContext,
  dialog: PickCallbackDialog,
  item: NalivItem,
  cart: CartItem[],
  relationId: number | null,
  portions: number
): Promise<void> {
  const business = await findBusinessFee(dialog.businessId);
  const deliveryFee = dialog.deliveryPrice ?? business?.delivery_service_fee ?? 0;
  const line = cart.find((c) => c.itemId === item.item_id && (c.option?.relationId ?? null) === (relationId ?? null))!;
  const lineLabel = line.option ? `${item.name} — ${line.option.label}` : item.name;

  // Рекомендации «в пару» — в то же сообщение, кнопками
  const recs = await buildRecommendations(ctx, dialog, item, cart);
  const text = [
    `✅ ${lineLabel}`,
    `🛒 В корзине: ${portions} порц. = ${line.qty} ${line.unit} — ${formatMoney(lineTotal(line))} ₸`,
    `📦 Итого с доставкой: ${formatMoney(cartSubtotal(cart) + deliveryFee)} ₸`,
  ].join('\n');

  const keyboard: BotInlineButton[][] = [];
  if (recs) {
    keyboard.push(...recs.inlineKeyboard);
  }
  keyboard.push(...cartActionsKeyboard());

  await ctx.send(recs ? `${text}\n\n${recs.text}` : text, { inlineKeyboard: keyboard });
}

/**
 * Подбирает 2–3 товара «в пару» из наличия выбранного магазина.
 * Возвращает null, если пара не подходит / ничего не нашлось.
 * Найденные товары мержатся в кэш поиска, чтобы кнопки add:<item_id> работали.
 */
export async function buildRecommendations(
  ctx: DialogContext,
  dialog: { id: number; businessId: number | null; lastSearchItems: unknown; cart: unknown },
  addedItem: NalivItem,
  cart: CartItem[]
): Promise<{ text: string; inlineKeyboard: BotInlineButton[][] } | null> {
  const keyword = getRecommendationQuery(addedItem.name);
  if (!keyword || !dialog.businessId) return null;

  // Уже есть пара в корзине — не навязываемся
  if (cartHasPairing(cart, keyword)) return null;

  let found: NalivItem[];
  try {
    const result = await searchItems(keyword, dialog.businessId, 1, 10);
    const inCart = new Set(cart.map((c) => c.itemId));
    found = result.items.filter((i) => i.amount > 0 && i.item_id !== addedItem.item_id && !inCart.has(i.item_id)).slice(0, 3);
  } catch (error) {
    // Рекомендации не критичны — молча пропускаем
    logger.warn(`[BotDialog] Не удалось подобрать рекомендации («${keyword}»):`, error);
    return null;
  }

  if (found.length === 0) return null;

  // Мержим в кэш поиска, чтобы кнопки добавления работали
  const searchCache = (dialog.lastSearchItems as unknown as NalivItem[] | null) || [];
  const merged = mergeSearchCache(searchCache, found);
  await prisma.botDialog.update({
    where: { id: dialog.id },
    data: { lastSearchItems: merged.slice(0, MAX_SEARCH_CACHE) as unknown as any },
  });

  return {
    text: `🧀 К «${shortenItemName(addedItem.name, 24)}» часто берут:`,
    inlineKeyboard: chunkRows(
      found.map((i) => ({
        text: `${shortenItemName(i.name, 28)} · ${formatMoney(effectivePrice(i))} ₸`,
        callbackData: `add:${i.item_id}`,
      })),
      2
    ),
  };
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
/**
 * Проверяет зону и сохраняет реальную цену доставки в диалог.
 * @returns цена (₸) или null — вне зоны / сервис недоступен
 */
async function checkAndSaveDeliveryPrice(dialogId: number, lat: number, lon: number, businessId: number): Promise<number | null> {
  try {
    const check = await checkDelivery(lat, lon, businessId);
    if (!check.inZone) {
      await prisma.botDialog.update({ where: { id: dialogId }, data: { deliveryPrice: null } });
      return null;
    }
    await prisma.botDialog.update({
      where: { id: dialogId },
      data: { deliveryPrice: check.deliveryPrice ?? null },
    });
    return check.deliveryPrice ?? null;
  } catch (error) {
    logger.warn('[BotDialog] Не удалось проверить доставку:', error);
    return null;
  }
}

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
      addressStreet: normalizeStreet(address.street) || normalizeStreet(address.label) || address.label,
      addressHouse: address.housenumber || '',
      deliveryPrice: null,
      candidateAddresses: null,
      candidateBusinesses: nearest as unknown as any,
      businessId: top.id,
      businessName: top.name,
      state: DIALOG_STATES.AWAITING_STORE_CONFIRM,
    },
  });

  // Сразу считаем реальную стоимость доставки по зоне
  const deliveryPrice = await checkAndSaveDeliveryPrice(dialogId, address.lat, address.lon, top.id);
  const deliveryLine = deliveryPrice !== null ? `\n🚗 Доставка: ~${formatMoney(deliveryPrice)} ₸` : '';
  const zoneWarning =
    deliveryPrice === null
      ? '\n⚠️ Не удалось подтвердить зону доставки для этого магазина — если при оформлении не получится, выберем другой.'
      : '';

  const farWarning = top.distanceM > FAR_DISTANCE_M ? '\n\n⚠️ Магазин довольно далеко — доставка может занять больше времени.' : '';
  const alternatives =
    nearest.length > 1
      ? `\n\nРядом также: ${nearest
          .slice(1)
          .map((b) => `${b.name} (${formatDistance(b.distanceM)})`)
          .join(', ')}. Напишите «нет», чтобы выбрать другой магазин.`
      : '';

  await ctx.send(
    `📍 Записал: ${address.label}\n\n🏪 Ближайший магазин — ${top.name} (${top.address}), всего ${formatDistance(top.distanceM)} 🚗${deliveryLine}${farWarning}${zoneWarning}${alternatives}\n\nОтсюда и повезём? (да/нет)`
  );
}

// === Шаг 2: подтверждение магазина ===

async function handleAwaitingStoreConfirm(ctx: DialogContext, dialog: { id: number; phone?: string | null; candidateBusinesses: unknown; addressLabel: string | null; addressLat: number | null; addressLon: number | null }, text: string): Promise<void> {
  const yn = parseYesNo(text);
  const candidates = (dialog.candidateBusinesses as unknown as NalivBusinessWithDistance[] | null) || [];

  if (yn === 'yes') {
    if (dialog.phone) {
      await startShopping(ctx, dialog.id);
    } else {
      await askForPhone(ctx, dialog.id);
    }
    return;
  }

  // Выбор магазина по номеру из кандидатов
  if (candidates.length > 1) {
    const choice = parseNumberChoice(text, candidates.length);
    if (choice) {
      const picked = candidates[choice - 1];
      await prisma.botDialog.update({
        where: { id: dialog.id },
        data: { businessId: picked.id, businessName: picked.name, deliveryPrice: null },
      });

      // Пересчитываем доставку для выбранного магазина
      let deliveryNote = '';
      if (dialog.addressLat !== null && dialog.addressLon !== null) {
        const price = await checkAndSaveDeliveryPrice(dialog.id, dialog.addressLat, dialog.addressLon, picked.id);
        deliveryNote = price !== null ? `\n🚗 Доставка: ~${formatMoney(price)} ₸` : '\n⚠️ Зону доставки проверим при оформлении.';
      }

      await ctx.send(`🏪 Договорились — доставка из «${picked.name}»!${deliveryNote}`);

      if (dialog.phone) {
        await startShopping(ctx, dialog.id);
      } else {
        await askForPhone(ctx, dialog.id);
      }
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

// === Шаг 3: телефон, затем корзина через AI ===

/** Просит телефон: нативная Telegram-кнопка «Поделиться номером» + опция «позже» */
async function askForPhone(ctx: DialogContext, dialogId: number): Promise<void> {
  await prisma.botDialog.update({
    where: { id: dialogId },
    data: { state: DIALOG_STATES.AWAITING_PHONE },
  });

  await ctx.send(`${pick(PHONE_ASKS)}\n\nНе хотите сейчас — напишите «позже».`, {
    requestContact: true,
  });
}

/** Обработка ответа в состоянии ожидания телефона */
async function handleAwaitingPhone(ctx: DialogContext, dialog: { id: number; state: string; cart: unknown }, text: string): Promise<void> {
  // «позже» — пропускаем: клиент явно отказался, оформляем без телефона
  if (isSkipPhoneRequest(text)) {
    await ctx.send(pick(PHONE_SKIP_ACKS));
    const cart = (dialog.cart as unknown as CartItem[]) || [];
    if (cart.length > 0) {
      await beginOrderConfirmationWithCart(ctx, dialog.id, cart, { skipPhoneGate: true });
    } else {
      await startShopping(ctx, dialog.id);
    }
    return;
  }

  // Телефон текстом
  const phone = normalizePhone(text);
  if (phone) {
    await savePhoneAndContinue(ctx, dialog, phone);
    return;
  }

  await ctx.send(
    'Так не получится 🙈 Нажмите кнопку «Поделиться номером» ниже, напишите номер текстом (например +7 705 123 45 67) или «позже».',
    { requestContact: true }
  );
}

async function startShopping(ctx: DialogContext, dialogId: number): Promise<void> {
  await prisma.botDialog.update({
    where: { id: dialogId },
    data: { state: DIALOG_STATES.SHOPPING, candidateAddresses: null, candidateBusinesses: null },
  });

  const hints = pick([
    'Напишите, что ищете — например «пиво Heineken» — а я всё найду 🔍',
    'Просто назовите напиток — например «корона» — и покажу, что есть в магазине 🍺',
  ]);

  await ctx.send(
    `Отлично, переходим к самому вкусному! 🛒\n\n${hints}\n\nВ любой момент: «корзина» — что набрали, «оформить» — завершить заказ.`
  );
}

async function handleShopping(ctx: DialogContext, dialog: any, text: string): Promise<void> {
  // Быстрые команды без AI
  if (isCartCommand(text)) {
    const business = await findBusinessFee(dialog.businessId);
    await sendCartMessage(
      ctx,
      (dialog.cart as unknown as CartItem[]) || [],
      dialog.deliveryPrice ?? business?.delivery_service_fee ?? 0
    );
    return;
  }

  if (/^(оформить|оформление|оформи заказ|завершить|checkout)\b/i.test(text.trim()) && ((dialog.cart as unknown as CartItem[]) || []).length > 0) {
    await beginOrderConfirmation(ctx, dialog);
    return;
  }

  const searchCache = (dialog.lastSearchItems as unknown as NalivItem[] | null) || [];
  const cart = (dialog.cart as unknown as CartItem[]) || [];
  const business = await findBusinessFee(dialog.businessId);
  const deliveryFee = dialog.deliveryPrice ?? business?.delivery_service_fee ?? 0;

  // История диалога для контекста
  const history = await loadChatHistory(ctx.chatId);

  const systemPrompt = buildShoppingSystemPrompt({
    address: dialog.addressLabel,
    businessName: dialog.businessName,
    businessId: dialog.businessId,
    cart,
    searchCache,
    deliveryFee,
    clientName: ctx.clientName,
    phone: dialog.phone,
    customPrompt: ctx.botAiSystemPrompt,
  });

  const messages: AiChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: text },
  ];

  let currentCart = cart;
  let currentSearchCache = searchCache;
  let lastAddedItem: NalivItem | null = null; // для рекомендаций «в пару»

  try {
    for (let round = 0; round < MAX_AI_ROUNDS; round++) {
      const raw = await aiChat(messages, { model: ctx.botAiModel || undefined, formatJson: true });
      const action = parseAiAction(raw);

      if (!action) {
        // Модель ответила вне протокола (например {}). Сырой JSON клиенту НЕ отправляем —
        // переспрашиваем с явной ошибкой (лимит раундов защищает от цикла)
        logger.warn(`[BotDialog] AI ответил вне протокола (chat #${ctx.chatId}): ${raw.slice(0, 200)}`);
        messages.push({ role: 'assistant', content: raw.slice(0, 500) });
        messages.push({
          role: 'user',
          content:
            'Ошибка: ответ должен быть СТРОГО JSON-объектом с полем "action". Если хочешь что-то сказать клиенту — используй {"action": "reply", "reply_text": "<текст>"}. Ответь сейчас одним JSON-объектом.',
        });
        continue;
      }

      logger.info(`[BotDialog] AI action: ${action.action} (chat #${ctx.chatId}, раунд ${round + 1})`);

      switch (action.action) {
        case 'search_items': {
          // query может быть строкой или массивом («чечил, вино и шампанское»)
          const queries = (action.queries?.length ? action.queries : [(action.query || '').trim()]).filter(Boolean);
          if (!queries.length || !dialog.businessId) {
            messages.push({ role: 'assistant', content: JSON.stringify({ action: 'search_items' }) });
            messages.push({ role: 'user', content: 'Ошибка: пустой поисковый запрос. Уточни запрос и вызови search_items снова.' });
            continue;
          }

          // Мультипоиск: несколько разных товаров одним ходом
          if (queries.length > 1) {
            const groups: { query: string; items: NalivItem[] }[] = [];
            let merged = currentSearchCache;
            for (const q of queries.slice(0, 4)) {
              try {
                const r = await searchItems(q, dialog.businessId, 1, 10);
                merged = mergeSearchCache(merged, r.items);
                groups.push({ query: q, items: r.items.slice(0, 3) });
              } catch (error) {
                logger.warn(`[BotDialog] Мультипоиск «${q}» не удался:`, error);
                groups.push({ query: q, items: [] });
              }
            }
            currentSearchCache = merged;
            await prisma.botDialog.update({
              where: { id: dialog.id },
              data: { lastSearchItems: merged.slice(0, MAX_SEARCH_CACHE) as unknown as any },
            });

            const multiOffer = buildMultiSearchOffer(groups);
            await ctx.send(multiOffer.text, { inlineKeyboard: multiOffer.inlineKeyboard });
            return;
          }

          const query = queries[0];
          const result = await searchItems(query, dialog.businessId);
          // Накапливаем кэш найденных товаров
          const merged = mergeSearchCache(currentSearchCache, result.items);
          currentSearchCache = merged;
          await prisma.botDialog.update({
            where: { id: dialog.id },
            data: { lastSearchItems: merged.slice(0, MAX_SEARCH_CACHE) as unknown as any },
          });

          // Результаты показываем детерминированно: список + инлайн-кнопки выбора.
          // Клиент выбирает позицию кнопкой (add:<item_id>) — исключаем путаницу
          // «номер из списка = количество». Модель может ограничить выдачу (limit) —
          // для общих запросов («красное вино к ужину») показываем 2–3 варианта.
          if (result.items.length === 0) {
            await ctx.send(
              `😔 По запросу «${query}» ничего не нашлось в «${dialog.businessName || 'магазине'}».\n\nПопробуем другое название? Например «пиво светлое» или бренд без размера.`
            );
            return;
          }

          const limit =
            action.limit && action.limit >= 1
              ? Math.min(Math.floor(action.limit), MAX_SEARCH_BUTTONS)
              : undefined;
          const offer = buildSearchOffer(query, result.items, limit);
          await ctx.send(offer.text, { inlineKeyboard: offer.inlineKeyboard });
          return;
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

          // Товар с обязательной тарой (розлив) — выбор тары, затем количества
          const taraOffer = buildTaraOffer(item);
          if (taraOffer) {
            await ctx.send(taraOffer.text, { inlineKeyboard: taraOffer.inlineKeyboard });
            return;
          }

          const qty = action.qty && action.qty > 0 ? action.qty : 1;
          currentCart = addToCart(currentCart, item, qty);
          await prisma.botDialog.update({
            where: { id: dialog.id },
            data: { cart: currentCart as unknown as any },
          });
          lastAddedItem = item;

          const step = item.quantity_step > 0 ? item.quantity_step : 1;
          const lineAfter = currentCart.find((c) => c.itemId === item.item_id)!;
          const portionInfo = step > 1 ? `${Math.round(lineAfter.qty / step)} порц. × ${step} шт` : `${lineAfter.qty} шт`;

          messages.push({ role: 'assistant', content: raw });
          messages.push({
            role: 'user',
            content: `Корзина обновлена: «${item.name}» теперь ${portionInfo}. Корзина целиком: ${cartForPrompt(currentCart)}. Подтверди добавление через reply (товар, количество, цена) и спроси, что-нибудь ещё.`,
          });
          break;
        }

        case 'set_qty': {
          const item = currentSearchCache.find((i) => i.item_id === action.item_id);
          if (!item) {
            messages.push({ role: 'assistant', content: raw });
            messages.push({
              role: 'user',
              content: 'Ошибка: товар не найден среди найденных ранее. Сначала вызови search_items, затем set_qty с item_id из результатов.',
            });
            continue;
          }

          // Товар с обязательной тарой (розлив) — выбор тары, затем количества
          const taraOfferQty = buildTaraOffer(item);
          if (taraOfferQty) {
            await ctx.send(taraOfferQty.text, { inlineKeyboard: taraOfferQty.inlineKeyboard });
            return;
          }

          const wantedQty = action.qty && action.qty > 0 ? action.qty : 1;
          const beforeQty = currentCart.find((c) => c.itemId === item.item_id)?.qty ?? 0;
          currentCart = setCartQty(currentCart, item, wantedQty);
          await prisma.botDialog.update({
            where: { id: dialog.id },
            data: { cart: currentCart as unknown as any },
          });
          lastAddedItem = item;

          const afterQty = currentCart.find((c) => c.itemId === item.item_id)?.qty ?? 0;
          const step = item.quantity_step > 0 ? item.quantity_step : 1;
          const clampedNote =
            afterQty < wantedQty * step
              ? ` Клиент просил ${wantedQty} порц., но на складе только ${item.amount} шт — положил ${Math.round(afterQty / step)} порц.`
              : '';
          const portionInfo = step > 1 ? `${Math.round(afterQty / step)} порц. × ${step} шт` : `${afterQty} шт`;

          messages.push({ role: 'assistant', content: raw });
          messages.push({
            role: 'user',
            content: `Количество установлено: «${item.name}» теперь ${portionInfo}.${clampedNote} Корзина: ${cartForPrompt(currentCart)}. Подтверди через reply и спроси, что-нибудь ещё.`,
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
          await sendCartMessage(ctx, currentCart, deliveryFee);
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
          await sendRecommendationsAfterAi(ctx, dialog, lastAddedItem, currentCart);
          return;
        }
      }
    }

    // Исчерпали раунды без валидного ответа — не оставляем клиента без ответа
    const confusion =
      '🙈 Что-то я запутался. Напишите ещё раз: название товара, «корзина» или «оформить» — а я всё сделаю.';
    await ctx.send(
      currentCart.length > 0 ? `${formatCart(currentCart, deliveryFee)}\n\n${confusion}` : confusion
    );
    await sendRecommendationsAfterAi(ctx, dialog, lastAddedItem, currentCart);
  } catch (error) {
    logger.error(`[BotDialog] Ошибка AI-обработки (chat #${ctx.chatId}):`, error);
    await ctx.send('😔 Техническая ошибка, попробуйте ещё раз. Если повторится — напишите «оператор».');
  }
}

/** Рекомендации «в пару» после добавления товара через AI (короткое сообщение с кнопками) */
async function sendRecommendationsAfterAi(
  ctx: DialogContext,
  dialog: { id: number; businessId: number | null; lastSearchItems: unknown; cart: unknown },
  addedItem: NalivItem | null,
  cart: CartItem[]
): Promise<void> {
  if (!addedItem) return;

  try {
    const recs = await buildRecommendations(ctx, dialog, addedItem, cart);
    if (recs) {
      await ctx.send(recs.text, { inlineKeyboard: [...recs.inlineKeyboard, ...cartActionsKeyboard()] });
    }
  } catch (error) {
    logger.warn('[BotDialog] Ошибка отправки рекомендаций:', error);
  }
}

/** Объединяет кэш поиска с новой выдачей (без дублей, лимит MAX_SEARCH_CACHE) */
export function mergeSearchCache(cache: NalivItem[], fresh: NalivItem[]): NalivItem[] {
  const map = new Map<number, NalivItem>();
  for (const item of cache) map.set(item.item_id, item);
  for (const item of fresh) map.set(item.item_id, item);
  return Array.from(map.values()).slice(-MAX_SEARCH_CACHE);
}

/** Улица из метки геокодера: первый сегмент до запятой («улица Толстого, ...» -> «улица Толстого») */
export function normalizeStreet(street: string | null | undefined): string | null {
  if (!street) return null;
  const trimmed = street.trim();
  if (!trimmed) return null;
  const first = trimmed.split(',')[0].trim();
  return first || trimmed;
}

/**
 * Тело POST /api/telegram-bot/orders/create из диалога и корзины.
 * amount — штуки из корзины; цены берутся сервером.
 * null — данных недостаточно (нет пользователя/магазина/адреса).
 */
export function buildOrderCreatePayload(
  nalivUserId: number,
  dialog: {
    businessId: number | null;
    addressLat: number | null;
    addressLon: number | null;
    addressStreet: string | null;
    addressHouse: string | null;
  },
  cart: CartItem[]
): NalivCreateOrderPayload | null {
  const street = normalizeStreet(dialog.addressStreet);
  if (!dialog.businessId || !dialog.addressLat || !dialog.addressLon || !street || !dialog.addressHouse) {
    return null;
  }
  if (cart.length === 0) return null;

  return {
    user_id: nalivUserId,
    business_id: dialog.businessId,
    items: cart.map((c) => ({
      item_id: c.itemId,
      amount: c.qty,
      // Выбранная тара/модификаторы: option_item_relation_id
      ...(c.option ? { options: [{ option_item_relation_id: c.option.relationId }] } : {}),
    })),
    street,
    house: dialog.addressHouse,
    lat: dialog.addressLat,
    lon: dialog.addressLon,
    extra: 'Заказ из Telegram-бота',
  };
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

async function beginOrderConfirmationWithCart(
  ctx: DialogContext,
  dialogId: number,
  cart: CartItem[],
  opts: { skipPhoneGate?: boolean; skipDeliveryCheck?: boolean } = {}
): Promise<void> {
  let dialog = await prisma.botDialog.findUnique({ where: { id: dialogId } });

  // Без подтверждения возраста 21+ заказ не принимается
  if (dialog && !dialog.ageConfirmed) {
    await prisma.botDialog.update({
      where: { id: dialogId },
      data: { state: DIALOG_STATES.AWAITING_AGE_CONFIRM, cart: cart as unknown as any },
    });
    await ctx.send(
      'Прежде чем оформим заказ — проверка возраста 🪪 Вам уже есть 21 год?',
      { inlineKeyboard: ageConfirmKeyboard() }
    );
    return;
  }

  // Телефона нет — сначала спрашиваем его (корзина уже сохранена)
  if (!opts.skipPhoneGate && dialog && !dialog.phone && cart.length > 0) {
    await prisma.botDialog.update({
      where: { id: dialogId },
      data: { state: DIALOG_STATES.AWAITING_PHONE, cart: cart as unknown as any },
    });
    await askForPhone(ctx, dialogId);
    return;
  }

  const business = await findBusinessFee(dialog?.businessId ?? null);
  let deliveryFee = dialog?.deliveryPrice ?? business?.delivery_service_fee ?? 0;

  // Проверяем зону и реальную цену доставки (POST /api/delivery/check),
  // чтобы клиент не ждал заказ, который не примут
  if (!opts.skipDeliveryCheck && dialog?.addressLat && dialog.addressLon && dialog.businessId) {
    try {
      const check = await checkDelivery(dialog.addressLat, dialog.addressLon, dialog.businessId);
      if (!check.inZone) {
        await prisma.botDialog.update({
          where: { id: dialogId },
          data: { state: DIALOG_STATES.AWAITING_ADDRESS, deliveryPrice: null },
        });
        await ctx.send(
          `😔 Доставка из «${dialog.businessName || 'магазина'}» на этот адрес, к сожалению, недоступна.${check.message ? `\n\n${check.message}` : ''}\n\nПопробуем другой адрес? Напишите новый — найду ближайший магазин 🔍`
        );
        return;
      }
      if (check.deliveryPrice !== undefined) {
        deliveryFee = check.deliveryPrice;
      }
    } catch (error) {
      // Проверка не удалась — оставляем базовую стоимость, зону перепроверит создание заказа
      logger.warn('[BotDialog] Не удалось проверить зону доставки:', error);
    }
  }

  await prisma.botDialog.update({
    where: { id: dialogId },
    data: { state: DIALOG_STATES.CONFIRMING_ORDER, cart: cart as unknown as any, deliveryPrice: deliveryFee },
  });

  const phoneLine = dialog?.phone ? `📞 Телефон: ${dialog.phone}` : '📞 Телефон: не указан';
  const houseLine = dialog?.addressHouse ? '' : '\n\n🏠 Уточните номер дома — напишите его сообщением (например «45» или «45а»).';
  const summary = [
    '📋 Проверьте заказ:',
    '',
    `🏪 Магазин: ${dialog?.businessName || '-'}`,
    `📍 Адрес доставки: ${dialog?.addressLabel || '-'}`,
    phoneLine,
    '',
    formatCart(cart, deliveryFee),
    '',
    'Всё верно, оформляем?',
  ].join('\n');

  await ctx.send(`${summary}${houseLine}`, { inlineKeyboard: confirmOrderKeyboard() });
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

  // Уточнение номера дома, если геокодер его не вернул
  if (!dialog.addressHouse && yn === null && /^[\dа-яa-z\/\-\.]{1,7}$/i.test(text.trim())) {
    await prisma.botDialog.update({
      where: { id: dialog.id },
      data: { addressHouse: text.trim() },
    });
    const cart = (dialog.cart as unknown as CartItem[]) || [];
    if (cart.length > 0) {
      await beginOrderConfirmationWithCart(ctx, dialog.id, cart, { skipPhoneGate: true, skipDeliveryCheck: true });
    }
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
  const deliveryFee = dialog.deliveryPrice ?? business?.delivery_service_fee ?? 0;
  const subtotal = cartSubtotal(cart);

  // === Отправка заказа в «Налив» (POST /api/telegram-bot/orders/create) ===
  let telegramUserId = ctx.telegramUserId || null;
  if (!telegramUserId) {
    const chat = await prisma.chat.findUnique({ where: { id: ctx.chatId }, select: { telegramUserId: true } });
    telegramUserId = chat?.telegramUserId ?? null;
  }
  let botUser = telegramUserId ? await prisma.botUser.findUnique({ where: { telegramUserId } }) : null;

  // Клиент мог поделиться телефоном ДО выката привязки — привязываем сейчас,
  // чтобы заказ ушёл в «Налив», а не в локальный fallback
  if ((!botUser || !botUser.nalivUserId) && dialog.phone && telegramUserId) {
    logger.info(`[BotDialog] Привязка аккаунта «Налив» при оформлении заказа (telegram_id=${telegramUserId})`);
    await linkNalivAccount(ctx, dialog.phone);
    botUser = await prisma.botUser.findUnique({ where: { telegramUserId } });
  }

  // Дом обязателен для создания заказа — запрашиваем независимо от привязки
  if (!dialog.addressHouse) {
    await ctx.send('🏠 Для оформления нужен номер дома — напишите его сообщением (например «45» или «45а»).');
    return;
  }

  let nalivOrder: NalivCreatedOrder | null = null;
  if (botUser?.nalivUserId) {
    const payload = buildOrderCreatePayload(botUser.nalivUserId, dialog, cart);

    if (payload) {
      try {
        nalivOrder = await createNalivOrder(payload);
        logger.info(`[BotDialog] Заказ отправлен в «Налив»: naliv_order_id=${nalivOrder.order_id} (${formatMoney(nalivOrder.total_sum)} ₸)`);
      } catch (error: any) {
        const msg: string = error?.message || '';
        if (/Доставка недоступна/i.test(msg)) {
          // Вне зоны доставки — просим другой адрес
          const reason = msg.replace(/^.*Доставка недоступна:? */i, '').replace(/\(HTTP \d+\).*/s, '').trim();
          await prisma.botDialog.update({
            where: { id: dialog.id },
            data: { state: DIALOG_STATES.AWAITING_ADDRESS, deliveryPrice: null },
          });
          await ctx.send(`😔 Доставка на этот адрес недоступна${reason ? `: ${reason}` : ''}.\n\nНапишите другой адрес — найду ближайший магазин 🔍`);
          return;
        }
        // Прочие ошибки — не теряем заказ, сохраняем локально для оператора
        logger.warn(`[BotDialog] Не удалось создать заказ в «Налив», сохраняем локально:`, error);
      }
    }
  }

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
      phone: dialog.phone,
      items: cart as unknown as any,
      totalPrice: nalivOrder ? nalivOrder.total_sum : subtotal + deliveryFee,
      deliveryFee: nalivOrder ? nalivOrder.delivery_price : deliveryFee,
      status: nalivOrder ? 'sent' : 'new',
      nalivOrderId: nalivOrder?.order_id ?? null,
      nalivOrderUuid: nalivOrder?.order_uuid ?? null,
      telegramChatId: ctx.telegramChatId,
    },
  });

  const orderRef = nalivOrder ? `№${nalivOrder.order_id} в «Налив»` : `#${order.id} (локально)`;
  logger.info(`[BotDialog] Создан заказ ${orderRef} (${formatMoney(order.totalPrice)} ₸) из чата #${ctx.chatId}`);

  // Фиксируем заказ в истории тикета, чтобы операторы видели событие
  await prisma.ticketHistory.create({
    data: {
      chatId: ctx.chatId,
      changeType: 'bot_order_created',
      newValue: String(order.id),
      description: nalivOrder
        ? `AI-бот оформил заказ «Налив» #${nalivOrder.order_id} («${order.businessName}», ${formatMoney(order.totalPrice)} ₸${order.phone ? `, тел. ${order.phone}` : ''})`
        : `AI-бот оформил заказ #${order.id} («${order.businessName}», на сумму ${formatMoney(order.totalPrice)} ₸${order.phone ? `, тел. ${order.phone}` : ', без телефона'}) — НЕ отправлен в «Налив», нужен оператор`,
    },
  });

  // Уведомляем операторов
  const { broadcastToOrganization } = await import('./socketService.js');
  try {
    broadcastToOrganization(ctx.organizationId, 'bot_order_created', {
      orderId: order.id,
      nalivOrderId: nalivOrder?.order_id ?? null,
      sentToNaliv: Boolean(nalivOrder),
      chatId: ctx.chatId,
      businessName: order.businessName,
      address: order.address,
      phone: order.phone,
      totalPrice: order.totalPrice,
      itemsCount: cart.reduce((s, c) => s + c.qty, 0),
      telegramChatId: ctx.telegramChatId,
    });
  } catch (socketError) {
    logger.error('[BotDialog] Ошибка уведомления о заказе:', socketError);
  }

  // Новый заказ — начинаем новую корзину
  await prisma.botDialog.update({
    where: { id: dialog.id },
    data: {
      state: DIALOG_STATES.SHOPPING,
      cart: [],
      lastSearchItems: null,
    },
  });

  if (nalivOrder) {
    await ctx.send(
      `🎉 Заказ №${nalivOrder.order_id} передан в «${order.businessName}»!\n\n` +
      `💳 К оплате: ${formatMoney(nalivOrder.total_sum)} ₸ (вкл. доставку ${formatMoney(nalivOrder.delivery_price)} ₸)\n` +
      `💵 Оплата при получении — курьер примет наличные или карту.\n\n` +
      `Следить за статусом буду прямо здесь: 🆕 принят → 📦 готов → 🚗 в пути\n\nЗахотите что-то ещё — просто напишите!`
    );
  } else {
    await ctx.send(
      `🎉 Заказ #${order.id} оформлен!\n\n${formatCart(cart, deliveryFee)}\n\n${order.phone ? `Курьер позвонит на ${order.phone} 📞 ` : 'Оператор свяжется с вами здесь '}— всё привезём 🚗\n\nЗахотите что-то ещё — просто напишите!`
    );
  }
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
