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
  type: string; // DISCOUNT, ...
  discount?: number;
  name?: string;
  base_amount?: number;
  add_amount?: number;
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
};

/** Позиция в корзине бота */
export type CartItem = {
  itemId: number;
  name: string;
  price: number;
  /** Количество в штуках = portions * quantity_step */
  qty: number;
  unit: string;
  /** Размер одной порции (quantity_step товара на момент добавления) */
  portionSize?: number;
};
