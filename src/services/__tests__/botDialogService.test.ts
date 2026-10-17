// src/services/__tests__/botDialogService.test.ts

import {
  addToCart,
  setCartQty,
  removeFromCart,
  getRecommendationQuery,
  cartHasPairing,
  buildOrderCreatePayload,
  normalizeStreet,
  lineTotal,
  linePortions,
  portionPrice,
  requiredSingleOption,
  promoBadge,
  pickPromo,
  buildTaraOffer,
  buildQtyOffer,
  buildMultiSearchOffer,
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
    expect(text).toContain('Пиво Heineken 0.5 — 1 000 ₸/шт × 2 = 2 000 ₸');
    expect(text).toContain('Товары: 2 000 ₸');
    expect(text).toContain('Доставка: 30 ₸');
    expect(text).toContain('Итого: 2 030 ₸');
  });

  test('показывает порции для товаров с шагом > 1', () => {
    const text = formatCart([cartItem({ name: 'Шот Ягер 0.04', qty: 8, portionSize: 4 })], 30);
    expect(text).toContain('4 шт) × 2 = 8 000 ₸');
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

describe('акции и опции (розлив)', () => {
  // Бавария розлив: 1810 ₸/л, тара обязательна, акция 2+1
  const bavaria = item({
    item_id: 31150,
    name: 'Пиво розлив Бавария 1л 4.8%',
    price: 1810,
    unit: 'л.',
    amount: 41.5,
    promotions: [{ type: 'SUBTRACT', base_amount: 2, add_amount: 1, name: '2+1' }],
    options: [
      {
        option_id: 659,
        name: 'Литраж',
        required: 1,
        selection: 'SINGLE',
        variants: [
          { item_name: 'Пластиковая бутылка 1л', relation_id: 3030, price_type: 'ADD', price: 110, parent_item_amount: 1 },
          { item_name: 'Пластиковая бутылка 2л', relation_id: 3031, price_type: 'ADD', price: 100, parent_item_amount: 2 },
          { item_name: 'Пластиковая бутылка 3л + ручка', relation_id: 3033, price_type: 'ADD', price: 150, parent_item_amount: 3 },
        ],
      },
    ],
  });
  const bottle2 = bavaria.options![0].variants![1];

  test('pickPromo извлекает 2+1 и бейдж', () => {
    expect(pickPromo(bavaria)).toMatchObject({ type: 'SUBTRACT', base_amount: 2, add_amount: 1 });
    expect(promoBadge(bavaria)).toBe(' 🔥2+1');
    expect(promoBadge(item({ promotions: [{ type: 'DISCOUNT', discount: 11.5 }] }))).toBe(' −12%');
    expect(promoBadge(item())).toBe('');
  });

  test('обязательная одиночная опция находится', () => {
    expect(requiredSingleOption(bavaria)?.name).toBe('Литраж');
    expect(requiredSingleOption(item())).toBeNull();
  });

  test('добавление с тарой: 1 тап = 1 бутылка = 2 л, цена порции = литры × цена + тара', () => {
    const cart = addToCart([], bavaria, 1, { variant: bottle2 });
    expect(cart[0]).toMatchObject({ itemId: 31150, qty: 2, portionSize: 2, optionSurcharge: 100 });
    expect(cart[0].option).toMatchObject({ relationId: 3031, label: 'Пластиковая бутылка 2л' });
    expect(portionPrice(cart[0])).toBe(1810 * 2 + 100);
  });

  test('линии корзины различаются по таре (1л и 2л отдельно)', () => {
    const v1 = bavaria.options![0].variants![0];
    let cart = addToCart([], bavaria, 1, { variant: bottle2 });
    cart = addToCart(cart, bavaria, 1, { variant: v1 });
    expect(cart).toHaveLength(2);
    expect(cart.map((c) => c.option?.relationId).sort()).toEqual([3030, 3031]);
  });

  test('2+1: 3 бутылки = платите за 2', () => {
    let cart = addToCart([], bavaria, 1, { variant: bottle2 });
    cart = addToCart(cart, bavaria, 1, { variant: bottle2 });
    cart = addToCart(cart, bavaria, 1, { variant: bottle2 });
    // 3 бутылки по 2л = 6 л; порций 3, акция 2+1 → платим за 2 порции
    expect(linePortions(cart[0])).toBe(3);
    expect(lineTotal(cart[0])).toBe(2 * (1810 * 2 + 100));
    expect(cartSubtotal(cart)).toBe(2 * (1810 * 2 + 100));
  });

  test('2+1: 4 бутылки = платите за 3', () => {
    let cart: CartItem[] = [];
    for (let i = 0; i < 4; i++) cart = addToCart(cart, bavaria, 1, { variant: bottle2 });
    expect(lineTotal(cart[0])).toBe(3 * (1810 * 2 + 100));
  });

  test('formatCart показывает тару и акцию', () => {
    let cart = addToCart([], bavaria, 1, { variant: bottle2 });
    cart = addToCart(cart, bavaria, 1, { variant: bottle2 });
    cart = addToCart(cart, bavaria, 1, { variant: bottle2 });
    const text = formatCart(cart, 910);
    expect(text).toContain('↳ Пластиковая бутылка 2л');
    expect(text).toContain('🔥 Акция 2+1: платите за 2');
    expect(text).toContain('Товары: 7 440 ₸');
  });

  test('cartForPrompt включает опцию и акцию', () => {
    const cart = addToCart([], bavaria, 1, { variant: bottle2 });
    const parsed = JSON.parse(cartForPrompt(cart))[0];
    expect(parsed.option).toBe('Пластиковая бутылка 2л');
    expect(parsed.promo).toBe('2+1');
  });

  test('весовой товар (шаг 0.15 кг): цена за порцию, не «/кг»', () => {
    // Чечил: 6 440 ₸/кг, упаковка 0.15 кг → порция 966 ₸
    const chechil = item({ item_id: 400, name: 'Чечил Адыгейский кг. 120-140гр.', price: 6440, unit: 'кг', quantity_step: 0.15, amount: 10.5 });

    const cart = addToCart([], chechil, 1);
    expect(cart[0].qty).toBe(0.15);
    expect(cart[0].portionSize).toBe(0.15);
    expect(linePortions(cart[0])).toBe(1);
    expect(portionPrice(cart[0])).toBe(966);
    expect(lineTotal(cart[0])).toBe(966);

    // в предложении количества — «за порцию», без «/кг»
    const qty = buildQtyOffer(chechil, null);
    expect(qty.text).toContain('966 ₸ за порцию (0.15 кг)');
    expect(qty.text).not.toContain('₸/кг');

    // и в корзине
    const cartText = formatCart(cart, 30);
    expect(cartText).toContain('966 ₸/порц. (0.15 кг) × 1 = 966 ₸');
    expect(cartText).toContain('Итого: 996 ₸');

    // 2 порции = 0.3 кг = 1 932 ₸
    const cart2 = addToCart(cart, chechil, 1);
    expect(cart2[0].qty).toBe(0.3);
    expect(lineTotal(cart2[0])).toBe(1932);
  });

  test('payload заказа содержит option_item_relation_id', () => {
    const cart = addToCart([], bavaria, 1, { variant: bottle2 });
    const payload = buildOrderCreatePayload(
      42,
      { businessId: 11, addressLat: 49.8, addressLon: 73.09, addressStreet: 'Толстого', addressHouse: '5' },
      cart
    );
    expect(payload?.items[0]).toEqual({
      item_id: 31150,
      amount: 2,
      options: [{ option_item_relation_id: 3031 }],
    });
  });

  test('кнопка товара ведёт в воронку (pick:), тарные показывают «от X ₸»', () => {
    const offer = buildSearchOffer('бавария', [bavaria]);
    const flat = offer.inlineKeyboard.flat();
    const btn = flat.find((b) => b.callbackData === 'pick:31150');
    expect(btn?.text).toContain('Бавария');
    expect(btn?.text).toContain('от 1 920 ₸'); // минимальная тара 1л: 1810 + 110
    expect(btn?.text).toContain('🔥2+1');
    // у обычных товаров — точная цена
    const offer2 = buildSearchOffer('корона', [item({ item_id: 111, name: 'Corona Extra 0.45', price: 990 })]);
    expect(offer2.inlineKeyboard.flat()[0].text).toContain('990 ₸');
    expect(offer2.inlineKeyboard.flat()[0].callbackData).toBe('pick:111');
  });

  test('кнопка на каждый товар из выдачи (лимит 8)', () => {
    const items = Array.from({ length: 12 }, (_, k) => item({ item_id: 100 + k, name: `Пиво ${k}` }));
    const offer = buildSearchOffer('пиво', items);
    const pickButtons = offer.inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('pick:'));
    expect(pickButtons).toHaveLength(8);
  });

  test('buildTaraOffer: кнопки тары с товаром, ценой порции и акцией', () => {
    const tara = buildTaraOffer(bavaria)!;
    expect(tara.text).toContain('выберите тару (Литраж)');
    const flat = tara.inlineKeyboard.flat();
    const btn2 = flat.find((b) => b.callbackData === 'tara:31150:3031');
    expect(btn2?.text).toContain('Пластиковая бутылка 2л');
    expect(btn2?.text).toContain('3 720 ₸');
    expect(btn2?.text).toContain('🔥2+1');
    expect(buildTaraOffer(item({ item_id: 9 }))).toBeNull();
  });

  test('buildQtyOffer: количество 1–6 кнопками с callback qty:<id>:<rel>:<n>', () => {
    const qty = buildQtyOffer(bavaria, bottle2);
    expect(qty.text).toContain('Пластиковая бутылка 2л');
    expect(qty.text).toContain('3 720 ₸');
    expect(qty.text).toContain('🔥 Акция 2+1');
    const qtyButtons = qty.inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('qty:'));
    expect(qtyButtons.map((b) => b.callbackData)).toEqual([
      'qty:31150:3031:1',
      'qty:31150:3031:2',
      'qty:31150:3031:3',
      'qty:31150:3031:4',
      'qty:31150:3031:5',
      'qty:31150:3031:6',
    ]);
    // «назад к таре»
    expect(qty.inlineKeyboard.flat().some((b) => b.callbackData === 'tara:31150:3031')).toBe(true);

    // без тары: rel = 0
    const qtyPlain = buildQtyOffer(item({ item_id: 77, price: 1000 }), null);
    expect(qtyPlain.inlineKeyboard.flat().some((b) => b.callbackData === 'qty:77:0:3')).toBe(true);
  });

  test('resolveVariant: дефолт — первая обязательная тара (розлив не добавится без тары)', () => {
    const cart = addToCart([], bavaria, 1); // без выбора тары
    expect(cart[0].option).toMatchObject({ relationId: 3030, label: 'Пластиковая бутылка 1л' });
    expect(cart[0].qty).toBe(1);

    const cart2 = setCartQty([], bavaria, 2); // set_qty без тары → тоже с тарой
    expect(cart2[0].option).toMatchObject({ relationId: 3030 });
    expect(cart2[0].qty).toBe(2);

    // у товара без опций дефолт не появляется
    const plain = addToCart([], item({ item_id: 9 }), 1);
    expect(plain[0].option ?? null).toBeNull();
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

  test('пустой JSON {} -> null (не отправляется клиенту, идёт переспрос)', () => {
    expect(parseAiAction('{}')).toBeNull();
    expect(parseAiAction('{ }')).toBeNull();
  });

  test('парсит limit для общих запросов', () => {
    expect(parseAiAction('{"action": "search_items", "query": "красное вино", "limit": 3}'))
      .toMatchObject({ action: 'search_items', limit: 3 });
    expect(parseAiAction('{"action": "search_items", "query": "вино", "limit": "2"}')?.limit).toBe(2);
    expect(parseAiAction('{"action": "reply"}')?.limit).toBeUndefined();
  });

  test('мультипоиск: query как массив строк', () => {
    expect(parseAiAction('{"action": "search_items", "query": ["чечил", "вино", "шампанское"]}'))
      .toMatchObject({ action: 'search_items', queries: ['чечил', 'вино', 'шампанское'], query: undefined });
    // ограничение 4 запросов, пустые отбрасываются
    expect(
      parseAiAction('{"action": "search_items", "query": ["a", "", "b", "c", "d", "e"]}')?.queries
    ).toEqual(['a', 'b', 'c', 'd']);
    // строковый query не ломается
    expect(parseAiAction('{"action": "search_items", "query": "пиво"}')?.queries).toBeUndefined();
  });

  test('buildMultiSearchOffer: группы с кнопками и пустые группы', () => {
    const offer = buildMultiSearchOffer([
      { query: 'чечил', items: [item({ item_id: 1, name: 'Чечил копчёный 120г', price: 890 })] },
      { query: 'шампанское', items: [item({ item_id: 2, name: 'Советское игристое 0.75', price: 2200 }), item({ item_id: 3, name: 'Ballet 0.75', price: 3100 })] },
      { query: 'устрицы', items: [] },
    ]);

    expect(offer.text).toContain('«чечил»');
    expect(offer.text).toContain('Чечил копчёный 120г — 890 ₸/шт');
    expect(offer.text).toContain('«шампанское»');
    expect(offer.text).toContain('😔 По «устрицы» ничего не нашлось');

    const flat = offer.inlineKeyboard.flat();
    expect(flat.filter((b) => b.callbackData === 'pick:1')).toHaveLength(1);
    expect(flat.filter((b) => b.callbackData === 'pick:2')).toHaveLength(1);
    expect(flat.filter((b) => b.callbackData === 'pick:3')).toHaveLength(1);
    expect(offer.inlineKeyboard[offer.inlineKeyboard.length - 1]).toEqual([
      { text: '🛒 Корзина', callbackData: 'cart' },
      { text: '✅ Оформить', callbackData: 'checkout' },
    ]);
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

describe('отправка заказа в «Налив»', () => {
  const dialog = {
    businessId: 11,
    addressLat: 49.799416,
    addressLon: 73.090596,
    addressStreet: 'проспект Бухар-жырау',
    addressHouse: '70',
  };

  test('normalizeStreet берёт первый сегмент метки геокодера', () => {
    expect(normalizeStreet('улица Толстого, Восточный, Павлодар, Казахстан')).toBe('улица Толстого');
    expect(normalizeStreet('проспект Бухар-жырау')).toBe('проспект Бухар-жырау');
    expect(normalizeStreet(null)).toBeNull();
    expect(normalizeStreet('  ')).toBeNull();
  });

  test('payload нормализует улицу из полного label', () => {
    const payload = buildOrderCreatePayload(
      42,
      { ...dialog, addressStreet: 'улица Толстого, Восточный, Павлодар, Казахстан' },
      [cartItem({ itemId: 132763, qty: 1 })]
    );
    expect(payload?.street).toBe('улица Толстого');
  });

  test('собирает payload: user, магазин, адрес, позиции в штуках', () => {
    const payload = buildOrderCreatePayload(42, dialog, [cartItem({ itemId: 132763, qty: 2 })]);
    expect(payload).toMatchObject({
      user_id: 42,
      business_id: 11,
      street: 'проспект Бухар-жырау',
      house: '70',
      lat: 49.799416,
      lon: 73.090596,
      items: [{ item_id: 132763, amount: 2 }],
    });
  });

  test('null при нехватке данных', () => {
    expect(buildOrderCreatePayload(42, { ...dialog, addressHouse: null }, [cartItem()])).toBeNull();
    expect(buildOrderCreatePayload(42, { ...dialog, businessId: null }, [cartItem()])).toBeNull();
    expect(buildOrderCreatePayload(42, dialog, [])).toBeNull();
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
    expect(offer.text).toContain('• Corona Extra 0.45 — 990 ₸/шт');
    expect(offer.text).toContain('• Корона Фрутзика 0.5 — 1 090 ₸/шт');

    // последний ряд — действия
    const actionRow = offer.inlineKeyboard[offer.inlineKeyboard.length - 1];
    expect(actionRow).toEqual([
      { text: '🛒 Корзина', callbackData: 'cart' },
      { text: '✅ Оформить', callbackData: 'checkout' },
    ]);

    // кнопки товаров: 2 в ряд, callback pick:<item_id>
    const flat = offer.inlineKeyboard.flat();
    expect(flat).toContainEqual(expect.objectContaining({ callbackData: 'pick:111' }));
    expect(flat).toContainEqual(expect.objectContaining({ callbackData: 'pick:222' }));
    // callback_data короче лимита Telegram в 64 байта
    for (const btn of flat) {
      expect(btn.callbackData.length).toBeLessThanOrEqual(64);
    }
  });

  test('buildSearchOffer ограничивает 8 кнопками', () => {
    const items = Array.from({ length: 12 }, (_, i) => item({ item_id: i, name: `Пиво ${i}` }));
    const offer = buildSearchOffer('пиво', items);
    expect(offer.inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('pick:'))).toHaveLength(8);
  });

  test('buildSearchOffer с limit: 2–3 варианта для общих запросов', () => {
    const items = Array.from({ length: 12 }, (_, i) => item({ item_id: i, name: `Вино ${i}` }));
    const offer3 = buildSearchOffer('красное вино', items, 3);
    expect(offer3.inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('pick:'))).toHaveLength(3);

    const offer2 = buildSearchOffer('белое сухое', items, 2);
    expect(offer2.inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('pick:'))).toHaveLength(2);

    // limit больше 8 обрезается до 8, меньше 1 — до 1
    expect(buildSearchOffer('пиво', items, 50).inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('pick:'))).toHaveLength(8);
    expect(buildSearchOffer('пиво', items, 0).inlineKeyboard.flat().filter((b) => b.callbackData.startsWith('pick:'))).toHaveLength(1);
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

  test('кастомный промт маркетинга замещает встроенный стиль', () => {
    const prompt = buildShoppingSystemPrompt({
      cart: [],
      searchCache: [],
      deliveryFee: 30,
      customPrompt: 'Ты — Барон Пенный, говоришь вычурно и с достоинством.',
    });
    // инструкция маркетинга загружена как стиль
    expect(prompt).toContain('СТИЛЬ ОБЩЕНИЯ (инструкция маркетинга');
    expect(prompt).toContain('Барон Пенный');
    // встроенный характер заместился
    expect(prompt).not.toContain('приятель, который разбирается в пенном');
    // протокол и ограничения на месте независимо от стиля
    expect(prompt).toContain('СТРОГО одним JSON-объектом');
    expect(prompt).toContain('ОГРАНИЧЕНИЯ');
    expect(prompt).toContain('Ничего не выдумывай');
  });

  test('без кастомного промта — встроенный характер по тон-оф-войс', () => {
    const prompt = buildShoppingSystemPrompt({ cart: [], searchCache: [], deliveryFee: 30 });
    expect(prompt).toContain('приятель, который разбирается в пенном и снеках');
    expect(prompt).toContain('По умолчанию — на «ты»');
    expect(prompt).toContain('Эмодзи — не больше одного на сообщение');
    expect(prompt).not.toContain('ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ВЛАДЕЛЬЦА БОТА');
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
