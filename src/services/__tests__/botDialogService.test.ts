// src/services/__tests__/botDialogService.test.ts

import {
  addToCart,
  setCartQty,
  removeFromCart,
  getRecommendationQuery,
  cartHasPairing,
  cartSubtotal,
  formatCart,
  formatMoney,
  cartForPrompt,
  formatDistance,
  parseNumberChoice,
  parseYesNo,
  isHandoffRequest,
  isCartCommand,
  isSkipPhoneRequest,
  normalizePhone,
  parseAiAction,
  mergeSearchCache,
  effectivePrice,
  buildShoppingSystemPrompt,
  buildSearchOffer,
  chunkRows,
  shortenItemName,
  cartActionsKeyboard,
  confirmOrderKeyboard,
} from '../botDialogService.js';
import { CartItem, NalivItem } from '../../integrations/naliv/types.js';

const item = (overrides: Partial<NalivItem> = {}): NalivItem => ({
  item_id: 1,
  name: 'Пиво Heineken 0.5',
  price: 1000,
  amount: 10,
  quantity_step: 1,
  unit: 'шт',
  visible: 1,
  ...overrides,
});

const cartItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  itemId: 1,
  name: 'Пиво Heineken 0.5',
  price: 1000,
  qty: 2,
  unit: 'шт',
  ...overrides,
});

describe('эффективная цена (акции)', () => {
  test('без акций — базовая цена', () => {
    expect(effectivePrice(item({ price: 1000 }))).toBe(1000);
  });

  test('со скидкой 11.11% округляется вниз', () => {
    const withPromo = item({
      price: 1000,
      promotions: [{ type: 'DISCOUNT', discount: 11.11 }],
    });
    expect(effectivePrice(withPromo)).toBe(889);
  });

  test('выбирает максимальную скидку из нескольких', () => {
    const withPromos = item({
      price: 1000,
      promotions: [
        { type: 'DISCOUNT', discount: 5 },
        { type: 'DISCOUNT', discount: 20 },
      ],
    });
    expect(effectivePrice(withPromos)).toBe(800);
  });
});

describe('корзина', () => {
  test('добавляет новый товар', () => {
    const cart = addToCart([], item({ item_id: 5, price: 730 }), 2);
    expect(cart[0]).toMatchObject({ itemId: 5, name: 'Пиво Heineken 0.5', price: 730, qty: 2, unit: 'шт' });
  });

  test('увеличивает количество существующего товара', () => {
    const cart = addToCart([cartItem({ itemId: 5, qty: 1 })], item({ item_id: 5 }), 2);
    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(3);
  });

  test('порции: qty — количество порций, 1 порция = quantity_step шт', () => {
    // 3 порции по 4 шт = 12 шт
    const cart = addToCart([], item({ item_id: 10, quantity_step: 4, amount: 100 }), 3);
    expect(cart[0].qty).toBe(12);
    expect(cart[0].portionSize).toBe(4);
  });

  test('использует цену с учётом акции', () => {
    const cart = addToCart([], item({ price: 1000, promotions: [{ type: 'DISCOUNT', discount: 50 }] }), 1);
    expect(cart[0].price).toBe(500);
  });

  test('удаляет товар по item_id', () => {
    const cart = removeFromCart([cartItem({ itemId: 1 }), cartItem({ itemId: 2 })], 1);
    expect(cart).toHaveLength(1);
    expect(cart[0].itemId).toBe(2);
  });

  test('считает сумму позиций', () => {
    const subtotal = cartSubtotal([
      cartItem({ price: 1000, qty: 2 }),
      cartItem({ itemId: 2, price: 730, qty: 3 }),
    ]);
    expect(subtotal).toBe(1000 * 2 + 730 * 3);
  });

  test('форматирует корзину с доставкой и итогом', () => {
    const text = formatCart([cartItem({ price: 1000, qty: 2 })], 30);
    expect(text).toContain('Пиво Heineken 0.5 — 1 000 ₸ × 2');
    expect(text).toContain('Товары: 2 000 ₸');
    expect(text).toContain('Доставка: 30 ₸');
    expect(text).toContain('Итого: 2 030 ₸');
  });

  test('показывает порции для товаров с шагом > 1', () => {
    const text = formatCart([cartItem({ name: 'Шот Ягер 0.04', qty: 8, portionSize: 4 })], 30);
    expect(text).toContain('× 8 шт (2 порц. × 4 шт)');
  });

  test('пустая корзина — подсказка', () => {
    expect(formatCart([], 30)).toContain('Корзина пуста');
  });

  test('cartForPrompt отдаёт JSON с item_id', () => {
    const json = cartForPrompt([cartItem({ itemId: 42 })]);
    expect(JSON.parse(json)[0]).toMatchObject({ item_id: 42, qty: 2 });
    expect(cartForPrompt([])).toBe('[]');
  });
});

describe('форматирование', () => {
  test('formatMoney разделяет тысячи', () => {
    expect(formatMoney(1460)).toBe('1 460');
    expect(formatMoney(1234567)).toBe('1 234 567');
    expect(formatMoney(999)).toBe('999');
  });

  test('formatDistance выбирает м/км', () => {
    expect(formatDistance(350)).toBe('350 м');
    expect(formatDistance(1234)).toBe('1.2 км');
  });
});

describe('распознавание ответов клиента', () => {
  test('parseNumberChoice: цифры и слова', () => {
    expect(parseNumberChoice('1', 3)).toBe(1);
    expect(parseNumberChoice('2.', 3)).toBe(2);
    expect(parseNumberChoice('Номер 3', 3)).toBe(3);
    expect(parseNumberChoice('первый', 3)).toBe(1);
    expect(parseNumberChoice('третий', 3)).toBe(3);
    expect(parseNumberChoice('4', 3)).toBeNull();
    expect(parseNumberChoice('пиво', 3)).toBeNull();
  });

  test('parseYesNo: да/нет с вариациями', () => {
    expect(parseYesNo('да')).toBe('yes');
    expect(parseYesNo('Да, верно')).toBe('yes');
    expect(parseYesNo('Подтверждаю')).toBe('yes');
    expect(parseYesNo('нет')).toBe('no');
    expect(parseYesNo('Отмена')).toBe('no');
    expect(parseYesNo('не знаю')).toBeNull();
    expect(parseYesNo('Бухар-Жырау 70')).toBeNull();
  });

  test('isHandoffRequest ловит просьбы об операторе', () => {
    expect(isHandoffRequest('позовите оператора')).toBe(true);
    expect(isHandoffRequest('Хочу поговорить с менеджером')).toBe(true);
    expect(isHandoffRequest('Мне нужен живой человек')).toBe(true);
    expect(isHandoffRequest('хочу пиво')).toBe(false);
    // Ложное срабатывание на слово внутри названия товара недопустимо —
    // проверяем только целые слова
    expect(isHandoffRequest('операторская связь')).toBe(false);
  });

  test('isCartCommand', () => {
    expect(isCartCommand('корзина')).toBe(true);
    expect(isCartCommand('  Моя корзина')).toBe(true);
    expect(isCartCommand('что в корзине?')).toBe(true);
    expect(isCartCommand('хочу корзину хлеба')).toBe(false);
  });
});

describe('parseAiAction (JSON-протокол модели)', () => {
  test('парсит чистый JSON', () => {
    expect(parseAiAction('{"action":"search_items","query":"хайнекен"}')).toEqual({
      action: 'search_items',
      query: 'хайнекен',
      item_id: undefined,
      qty: undefined,
      reply_text: undefined,
    });
  });

  test('парсит JSON в markdown-ограждении и мусором вокруг', () => {
    const raw = 'Вот ответ:\n```json\n{"action": "add_to_cart", "item_id": 31117, "qty": 2}\n```\nНадеюсь помог!';
    expect(parseAiAction(raw)).toMatchObject({ action: 'add_to_cart', item_id: 31117, qty: 2 });
  });

  test('вырезает JSON-объект из текста без ограждений', () => {
    const raw = 'Мой ответ: {"action": "reply", "reply_text": "Что-нибудь ещё?"} Спасибо!';
    expect(parseAiAction(raw)).toMatchObject({ action: 'reply', reply_text: 'Что-нибудь ещё?' });
  });

  test('битый JSON -> null', () => {
    expect(parseAiAction('{"action": "reply", "reply_text": ')).toBeNull();
    expect(parseAiAction('обычный текст без json')).toBeNull();
    expect(parseAiAction('')).toBeNull();
    expect(parseAiAction(null as any)).toBeNull();
  });

  test('объект без action -> null', () => {
    expect(parseAiAction('{"foo": "bar"}')).toBeNull();
  });

  test('парсит limit для общих запросов', () => {
    expect(parseAiAction('{"action": "search_items", "query": "красное вино", "limit": 3}'))
      .toMatchObject({ action: 'search_items', limit: 3 });
    expect(parseAiAction('{"action": "search_items", "query": "вино", "limit": "2"}')?.limit).toBe(2);
    expect(parseAiAction('{"action": "reply"}')?.limit).toBeUndefined();
  });

  test('приводит action к нижнему регистру', () => {
    expect(parseAiAction('{"action": "SHOW_CART"}')?.action).toBe('show_cart');
  });
});

describe('mergeSearchCache', () => {
  test('объединяет без дублей и хранит максимум 50', () => {
    const cache = [item({ item_id: 1 }), item({ item_id: 2 })];
    const fresh = [item({ item_id: 2, price: 999 }), item({ item_id: 3 })];

    const merged = mergeSearchCache(cache, fresh);
    expect(merged).toHaveLength(3);
    expect(merged.find((i) => i.item_id === 2)?.price).toBe(999);
  });

  test('ограничивает размер кэша (свежие важнее)', () => {
    const cache = Array.from({ length: 50 }, (_, i) => item({ item_id: i }));
    const fresh = [item({ item_id: 100 })];

    const merged = mergeSearchCache(cache, fresh);
    expect(merged).toHaveLength(50);
    expect(merged.some((i) => i.item_id === 100)).toBe(true);
  });
});

describe('нормализация телефона', () => {
  test('форматы из Telegram contact и текста', () => {
    expect(normalizePhone('+77051234567')).toBe('+77051234567');
    expect(normalizePhone('77051234567')).toBe('+77051234567');
    expect(normalizePhone('8 705 123 45 67')).toBe('+77051234567');
    expect(normalizePhone('87051234567')).toBe('+77051234567');
    expect(normalizePhone('705-123-45-67')).toBe('+77051234567');
    expect(normalizePhone('+7 (705) 123-45-67')).toBe('+77051234567');
  });

  test('не телефон -> null', () => {
    expect(normalizePhone('привет')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('2')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('+770512345678999')).toBeNull();
  });
});

describe('пропуск вопроса о телефоне', () => {
  test('isSkipPhoneRequest', () => {
    expect(isSkipPhoneRequest('позже')).toBe(true);
    expect(isSkipPhoneRequest('Потом')).toBe(true);
    expect(isSkipPhoneRequest('пропустить')).toBe(true);
    expect(isSkipPhoneRequest('не сейчас')).toBe(true);
    expect(isSkipPhoneRequest('+77051234567')).toBe(false);
    expect(isSkipPhoneRequest('хочу пиво')).toBe(false);
  });
});

describe('set_qty — точное количество вместо прибавления', () => {
  test('«два ягеря» при 1 шт в корзине = ровно 2, а не 3', () => {
    const cart = [cartItem({ itemId: 10, qty: 1 })];
    const result = setCartQty(cart, item({ item_id: 10 }), 2);
    expect(result[0].qty).toBe(2);
  });

  test('добавляет новую позицию, если товара не было', () => {
    const result = setCartQty([], item({ item_id: 10, price: 1500 }), 3);
    expect(result[0]).toMatchObject({ itemId: 10, name: 'Пиво Heineken 0.5', price: 1500, qty: 3, unit: 'шт' });
  });

  test('округляет до quantity_step', () => {
    const result = setCartQty([], item({ item_id: 10, quantity_step: 4, amount: 100 }), 3);
    expect(result[0].qty).toBe(12);
  });

  test('порции: «2 порции» при step 4 = 8 шт', () => {
    const result = setCartQty([], item({ item_id: 10, quantity_step: 4 }), 2);
    expect(result[0].qty).toBe(8);
    expect(result[0].portionSize).toBe(4);
  });

  test('не превышает остаток на складе', () => {
    const result = setCartQty([], item({ item_id: 10, amount: 3 }), 10);
    expect(result[0].qty).toBe(3);
  });

  test('остаток в штуках: клампит по целым порциям', () => {
    // на складе 10 шт, шаг 4 → целых порций 2 → 8 шт, а не 12
    const result = setCartQty([], item({ item_id: 10, quantity_step: 4, amount: 10 }), 5);
    expect(result[0].qty).toBe(8);
  });

  test('qty 0 или отрицательное — удаляет позицию', () => {
    const cart = [cartItem({ itemId: 10, qty: 2 }), cartItem({ itemId: 11, qty: 1 })];
    expect(setCartQty(cart, item({ item_id: 10 }), 0)).toEqual([cartItem({ itemId: 11, qty: 1 })]);
    expect(setCartQty(cart, item({ item_id: 10 }), -2)).toEqual([cartItem({ itemId: 11, qty: 1 })]);
  });

  test('обновляет цену по текущей акции', () => {
    const cart = [cartItem({ itemId: 10, qty: 2, price: 1000 })];
    const result = setCartQty(cart, item({ item_id: 10, price: 1000, promotions: [{ type: 'DISCOUNT', discount: 50 }] }), 4);
    expect(result[0].price).toBe(500);
    expect(result[0].qty).toBe(4);
  });

  test('add_to_cart по-прежнему прибавляет (кнопки и «ещё»)', () => {
    const cart = addToCart([cartItem({ itemId: 10, qty: 1 })], item({ item_id: 10 }), 2);
    expect(cart[0].qty).toBe(3);
  });
});

describe('рекомендации «в пару»', () => {
  test('пиво -> закуски', () => {
    for (const name of ['Пиво Heineken 0.5', 'Лагер Светлый 0.45', 'Сидр яблочный', 'IPA Kraut']) {
      expect(getRecommendationQuery(name)).not.toBeNull();
    }
  });

  test('вино -> сыр/шоколад', () => {
    const rec = getRecommendationQuery('Вино красное полусухое 0.75');
    expect(['сыр', 'шоколад']).toContain(rec);
  });

  test('крепкое -> миксеры', () => {
    const rec = getRecommendationQuery('Виски Jack Daniels 0.5');
    expect(['кола', 'сок', 'тоник']).toContain(rec);
  });

  test('снеки и нейтральные товары без пары -> null', () => {
    expect(getRecommendationQuery('Чипсы Pringles 150г')).toBeNull();
    expect(getRecommendationQuery('Вода минеральная 1л')).toBeNull();
  });

  test('cartHasPairing не предлагает пару дважды', () => {
    const cart = [cartItem({ name: 'Чипсы Lays 150г' })];
    expect(cartHasPairing(cart, 'чипсы')).toBe(true);
    expect(cartHasPairing(cart, 'сыр')).toBe(false);
    expect(cartHasPairing([], 'чипсы')).toBe(false);
  });
});

describe('инлайн-кнопки выбора товара', () => {
  test('chunkRows разбивает по N в строку', () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkRows([], 2)).toEqual([]);
  });

  test('shortenItemName обрезает длинные названия', () => {
    expect(shortenItemName('Короткое')).toBe('Короткое');
    const long = 'Пиво бут Волковская пивоварня Неправильный мед 0.45 6% (светлое,крафт)';
    const short = shortenItemName(long);
    expect(short.length).toBeLessThanOrEqual(32);
    expect(short.endsWith('…')).toBe(true);
  });

  test('buildSearchOffer: список + кнопка на каждый товар + ряд действий', () => {
    const items = [
      item({ item_id: 111, name: 'Corona Extra 0.45', price: 990 }),
      item({ item_id: 222, name: 'Корона Фрутзика 0.5', price: 1090 }),
    ];

    const offer = buildSearchOffer('корона', items);

    expect(offer.text).toContain('Нашёл по запросу «корона»');
    expect(offer.text).toContain('1. Corona Extra 0.45 — 990 ₸');
    expect(offer.text).toContain('2. Корона Фрутзика 0.5 — 1 090 ₸');

    // последний ряд — действия
    const actionRow = offer.inlineKeyboard[offer.inlineKeyboard.length - 1];
    expect(actionRow).toEqual([
      { text: '🛒 Корзина', callbackData: 'cart' },
      { text: '✅ Оформить', callbackData: 'checkout' },
    ]);

    // кнопки товаров: 2 в ряд, callback add:<item_id>
    const flat = offer.inlineKeyboard.flat();
    expect(flat).toContainEqual(expect.objectContaining({ callbackData: 'add:111' }));
    expect(flat).toContainEqual(expect.objectContaining({ callbackData: 'add:222' }));
    // callback_data короче лимита Telegram в 64 байта
    for (const btn of flat) {
      expect(btn.callbackData.length).toBeLessThanOrEqual(64);
    }
  });

  test('buildSearchOffer ограничивает 8 кнопками', () => {
    const items = Array.from({ length: 12 }, (_, i) => item({ item_id: i, name: `Пиво ${i}` }));
    const offer = buildSearchOffer('пиво', items);
    expect(offer.inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('add:'))).toHaveLength(8);
  });

  test('buildSearchOffer с limit: 2–3 варианта для общих запросов', () => {
    const items = Array.from({ length: 12 }, (_, i) => item({ item_id: i, name: `Вино ${i}` }));
    const offer3 = buildSearchOffer('красное вино', items, 3);
    expect(offer3.inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('add:'))).toHaveLength(3);

    const offer2 = buildSearchOffer('белое сухое', items, 2);
    expect(offer2.inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('add:'))).toHaveLength(2);

    // limit больше 8 обрезается до 8, меньше 1 — до 1
    expect(buildSearchOffer('пиво', items, 50).inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('add:'))).toHaveLength(8);
    expect(buildSearchOffer('пиво', items, 0).inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('add:'))).toHaveLength(1);
  });

  test('промт требует максимум 2–3 уточняющих вопроса и limit 3', () => {
    const prompt = buildShoppingSystemPrompt({ cart: [], searchCache: [], deliveryFee: 30 });
    expect(prompt).toContain('НЕ БОЛЬШЕ 2–3 коротких уточняющих');
    expect(prompt).toContain('"limit": 3');
    expect(prompt).toContain('возраста 21+ уже пройдено');
  });

  test('клавиатуры корзины и подтверждения', () => {
    expect(cartActionsKeyboard().flat().map((b) => b.callbackData)).toEqual(['cart', 'checkout']);
    expect(confirmOrderKeyboard().flat().map((b) => b.callbackData)).toEqual(['confirm_order', 'cancel_order']);
  });

  test('цена на кнопке учитывает акцию', () => {
    const promo = item({ item_id: 5, name: 'Heineken 0.5', price: 1000, promotions: [{ type: 'DISCOUNT', discount: 10 }] });
    const offer = buildSearchOffer('хайнекен', [promo]);
    expect(offer.text).toContain('900 ₸');
  });
});

describe('buildShoppingSystemPrompt', () => {
  test('содержит контекст и все действия', () => {
    const prompt = buildShoppingSystemPrompt({
      address: 'Бухар-Жырау 70',
      businessName: 'Градусы24',
      businessId: 11,
      cart: [cartItem()],
      searchCache: [item()],
      deliveryFee: 30,
    });

    expect(prompt).toContain('Бухар-Жырау 70');
    expect(prompt).toContain('Градусы24');
    expect(prompt).toContain('search_items');
    expect(prompt).toContain('add_to_cart');
    expect(prompt).toContain('checkout');
    expect(prompt).toContain('handoff');
    expect(prompt).toContain('СТРОГО одним JSON-объектом');
  });

  test('добавляет кастомный промт владельца', () => {
    const prompt = buildShoppingSystemPrompt({
      cart: [],
      searchCache: [],
      deliveryFee: 30,
      customPrompt: 'Называть клиента по имени',
    });
    expect(prompt).toContain('Называть клиента по имени');
  });

  test('упоминает имя и телефон клиента, когда известны', () => {
    const prompt = buildShoppingSystemPrompt({
      cart: [],
      searchCache: [],
      deliveryFee: 30,
      clientName: 'Алексей',
      phone: '+77051234567',
    });
    expect(prompt).toContain('Клиента зовут Алексей');
    expect(prompt).toContain('Телефон клиента уже известен');
  });
});
