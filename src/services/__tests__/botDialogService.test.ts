// src/services/__tests__/botDialogService.test.ts

import {
  addToCart,
  removeFromCart,
  cartSubtotal,
  formatCart,
  formatMoney,
  cartForPrompt,
  formatDistance,
  parseNumberChoice,
  parseYesNo,
  isHandoffRequest,
  isCartCommand,
  parseAiAction,
  mergeSearchCache,
  effectivePrice,
  buildShoppingSystemPrompt,
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
    expect(cart).toEqual([{ itemId: 5, name: 'Пиво Heineken 0.5', price: 730, qty: 2, unit: 'шт' }]);
  });

  test('увеличивает количество существующего товара', () => {
    const cart = addToCart([cartItem({ itemId: 5, qty: 1 })], item({ item_id: 5 }), 2);
    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(3);
  });

  test('округляет количество до quantity_step', () => {
    const cart = addToCart([], item({ quantity_step: 4 }), 3);
    expect(cart[0].qty).toBe(4);
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
});
