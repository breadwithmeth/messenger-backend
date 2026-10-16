// src/integrations/naliv/__tests__/telegramBotClient.test.ts

import {
  parseActiveOrders,
  orderStatusLabel,
  ORDER_STATUS_LABELS,
} from '../telegramBotClient.js';

describe('parseActiveOrders', () => {
  test('парсит data как массив', () => {
    const payload = {
      success: true,
      data: [
        { id: 1, current_status: 3, status_updated_at: '2026-10-16T10:00:00Z' },
        { id: 2, current_status: 'ACCEPTED' },
      ],
    };
    expect(parseActiveOrders(payload)).toHaveLength(2);
    expect(parseActiveOrders(payload)[0]).toMatchObject({ id: 1, current_status: 3 });
  });

  test('парсит data.orders', () => {
    const payload = { success: true, data: { orders: [{ id: 5, current_status: 1 }] } };
    expect(parseActiveOrders(payload)).toHaveLength(1);
    expect(parseActiveOrders(payload)[0].id).toBe(5);
  });

  test('отбрасывает записи без id или статуса', () => {
    const payload = {
      data: [{ id: 1, current_status: 0 }, { current_status: 1 }, { id: 3 }, 'мусор', null],
    };
    expect(parseActiveOrders(payload)).toHaveLength(1);
  });

  test('пустой/битый ответ -> пустой массив', () => {
    expect(parseActiveOrders(null)).toEqual([]);
    expect(parseActiveOrders({})).toEqual([]);
    expect(parseActiveOrders({ data: null })).toEqual([]);
  });
});

describe('orderStatusLabel', () => {
  test('известные коды статусов', () => {
    expect(orderStatusLabel(66)).toBe('⏳ Ожидает оплаты');
    expect(orderStatusLabel('0')).toBe('🆕 Новый');
    expect(orderStatusLabel(1)).toBe('✅ Принят');
    expect(orderStatusLabel('2')).toBe('📦 Готов');
    expect(orderStatusLabel(3)).toBe('🚗 В пути');
  });

  test('неизвестный статус -> без падения', () => {
    expect(orderStatusLabel('WEIRD_STATUS')).toContain('WEIRD_STATUS');
  });

  test('все активные статусы из документации покрыты', () => {
    // UNPAID(66), NEW(0), ACCEPTED(1), READY(2), ON_THE_WAY(3)
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual(['0', '1', '2', '3', '66']);
  });
});
