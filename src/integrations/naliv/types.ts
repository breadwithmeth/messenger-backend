// src/integrations/naliv/types.ts
//
// Типы публичного API "Налив" (njt25.naliv.kz)

/** Результат геокодинга адреса */
export type NalivAddress = {
  label: string;
  lat: number;
  lon: number;
  city?: string;
  street?: string;
  housenumber?: string;
};

/** Магазин (бизнес) "Налив" */
export type NalivBusiness = {
  id: number;
  name: string;
  description?: string;
  address: string;
  lat: number;
  lon: number;
  delivery_service_fee: number;
  has_wholesale_trade: number;
  city_id: number;
  enabled: number;
};

/** Магазин с рассчитанной дистанцией от точки клиента (в метрах) */
export type NalivBusinessWithDistance = NalivBusiness & {
  distanceM: number;
};

/** Промо-акция на товар */
export type NalivPromotion = {
  type: string; // DISCOUNT (процент), SUBTRACT (N+M: base_amount+add_amount), ...
  discount?: number | null;
  name?: string;
  base_amount?: number;
  add_amount?: number;
};

/** Вариант опции товара (например тара для розлива) */
export type NalivOptionVariant = {
  item_name?: string;
  relation_id: number; // option_item_relation_id для создания заказа
  item_id?: number;
  price_type?: string; // ADD — добавить к цене порции
  price?: number;
  parent_item_amount?: number; // сколько единиц родителя в одной порции (литры для розлива)
};

/** Опция товара */
export type NalivOption = {
  option_id: number;
  name: string;
  required?: number; // 1 — выбор обязателен
  selection?: string; // SINGLE | MULTIPLE
  variants?: NalivOptionVariant[];
};

/** Товар из поиска */
export type NalivItem = {
  item_id: number;
  name: string;
  description?: string | null;
  price: number;
  wholesale_price?: number | null;
  wholesale_min_amount?: number | null;
  amount: number;
  quantity_step: number;
  unit: string;
  img?: string | null;
  code?: string;
  category?: { category_id: number; name: string; parent_category?: number | null } | null;
  visible?: number;
  promotions?: NalivPromotion[] | null;
  options?: NalivOption[] | null;
};

/** Выбранная опция в корзине */
export type CartItemOption = {
  relationId: number;
  label: string; // «Пластиковая бутылка 2л»
};

/** Акция, зафиксированная в позиции корзины */
export type CartItemPromo = {
  type: string;
  base_amount?: number;
  add_amount?: number;
  discount?: number | null;
  name?: string;
};

/** Позиция в корзине бота */
export type CartItem = {
  itemId: number;
  name: string;
  price: number;
  /** Количество в штуках родителя = portions * portionSize */
  qty: number;
  unit: string;
  /** Размер одной порции в единицах родителя (quantity_step или parent_item_amount тары) */
  portionSize?: number;
  /** Выбранная опция (тара) */
  option?: CartItemOption | null;
  /** Наценка опции за одну порцию (price_type ADD) */
  optionSurcharge?: number;
  /** Акция позиции (для честного подсчёта 2+1) */
  promo?: CartItemPromo | null;
};
