// src/services/whatsappFlowService.ts
//
// WhatsApp Flows: форма сбора данных (Имя, Город, Адрес, Тип оплаты).
// Meta-hosted Flow (без endpoint-а обмена данными): Flow JSON загружается в Meta через
// Graph API, клиенту отправляется interactive-сообщение типа 'flow', ответ приходит
// в вебхуке как message.interactive.type = 'nfm_reply'.

import axios from 'axios';
import { createLogger } from '../config/logging';

const logger = createLogger();

// --- Константы формы сбора данных ---

/** Идентификатор экрана в Flow JSON */
export const FLOW_COLLECTION_SCREEN = 'COLLECT_DATA';

/** Flow JSON version (см. https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson) */
const FLOW_JSON_VERSION = '7.0';

/** Опции типа оплаты: id → лейбл (titles совпадают с data-source формы) */
export const PAYMENT_TYPE_OPTIONS: Record<string, string> = {
  cash: 'Наличными',
  halyk: 'Halyk',
  kaspi: 'Kaspi',
};

/**
 * Flow JSON формы сбора данных: один экран с полями
 * Имя, Контактный телефон, Город, Адрес, Тип оплаты (наличные / Halyk / Kaspi),
 * Номер для выставления счёта (опционально) и Комментарий (опционально).
 *
 * Имена компонентов (NameInput, ContactPhoneInput, CityInput, AddressInput,
 * PaymentType, InvoicePhoneInput, CommentInput) определяют ключи в response_json
 * вебхука при автогенерации: screen_0_NameInput_0 и т.д.
 */
export const COLLECTION_FLOW_JSON = {
  version: FLOW_JSON_VERSION,
  screens: [
    {
      id: FLOW_COLLECTION_SCREEN,
      title: 'Оформление заказа',
      terminal: true,
      success: true,
      data: {},
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'form',
            children: [
              {
                type: 'TextHeading',
                text: 'Данные для доставки',
              },
              {
                type: 'TextBody',
                text: 'Заполните данные, чтобы мы могли оформить заказ и организовать доставку.',
              },
              {
                type: 'TextInput',
                name: 'NameInput',
                label: 'Ваше имя',
                'input-type': 'text',
                required: true,
              },
              {
                type: 'TextInput',
                name: 'ContactPhoneInput',
                label: 'Контактный телефон',
                'input-type': 'phone',
                required: true,
              },
              {
                type: 'TextInput',
                name: 'CityInput',
                label: 'Город',
                'input-type': 'text',
                required: true,
              },
              {
                type: 'TextInput',
                name: 'AddressInput',
                label: 'Адрес доставки',
                'input-type': 'text',
                required: true,
              },
              {
                type: 'TextHeading',
                text: 'Оплата заказа',
              },
              {
                type: 'RadioButtonsGroup',
                name: 'PaymentType',
                label: 'Способ оплаты',
                required: true,
                'data-source': Object.entries(PAYMENT_TYPE_OPTIONS).map(([id, title]) => ({
                  id,
                  title,
                })),
              },
              {
                type: 'TextInput',
                name: 'InvoicePhoneInput',
                label: 'Номер для выставления счёта',
                'input-type': 'phone',
                required: false,
              },
              {
                type: 'TextArea',
                name: 'CommentInput',
                label: 'Комментарий к заказу',
                required: false,
              },
              {
                type: 'Footer',
                label: 'Отправить заказ',
                'on-click-action': {
                  name: 'complete',
                  // ВАЖНО: для Meta-hosted flow в payload нужно явно прокинуть значения
                  // полей через ${form.<name>} — иначе в ответе придёт только flow_token
                  payload: {
                    name: '${form.NameInput}',
                    contact_phone: '${form.ContactPhoneInput}',
                    city: '${form.CityInput}',
                    address: '${form.AddressInput}',
                    payment_type: '${form.PaymentType}',
                    invoice_phone: '${form.InvoicePhoneInput}',
                    comment: '${form.CommentInput}',
                  },
                },
              },
            ],
          },
        ],
      },
    },
  ],
};

// --- Graph API: управление Flow ---

interface WabaGraphConfig {
  accessToken: string;
  wabaId: string;
  apiVersion: string;
}

function graphBaseUrl(apiVersion: string): string {
  return `https://graph.facebook.com/${apiVersion}`;
}

/**
 * Создать Flow в WhatsApp Business Account
 * POST /{waba-id}/flows?name=...&categories=["other"]
 */
export async function createFlow(config: WabaGraphConfig, name: string): Promise<string> {
  if (!config.wabaId) {
    throw new Error('WABA ID is missing. Set wabaId for this organization phone.');
  }

  const url = `${graphBaseUrl(config.apiVersion)}/${config.wabaId}/flows`;
  const response = await axios.post(
    url,
    { name, categories: ['other'] },
    {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const flowId = response.data?.id;
  if (!flowId) {
    throw new Error(`Meta did not return flow id: ${JSON.stringify(response.data)}`);
  }

  logger.info(`✅ WABA Flow: Создан Flow ${flowId} (${name})`);
  return String(flowId);
}

/**
 * Загрузить Flow JSON в Meta
 * POST /{flow-id}/assets (multipart/form-data, type=FLOW_JSON)
 */
export async function uploadFlowJson(
  config: WabaGraphConfig,
  flowId: string,
  flowJson: object
): Promise<void> {
  const url = `${graphBaseUrl(config.apiVersion)}/${flowId}/assets`;

  const formData = new FormData();
  const flowJsonString = JSON.stringify(flowJson);
  formData.append('file', new Blob([flowJsonString], { type: 'application/json' }), 'flow.json');
  formData.append('name', 'flow.json');
  formData.append('asset_type', 'FLOW_JSON');
  formData.append('type', 'FLOW_JSON');

  try {
    await axios.post(url, formData, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    });
    logger.info(`✅ WABA Flow: Flow JSON загружен в Flow ${flowId}`);
  } catch (error: any) {
    logger.error('❌ WABA Flow: Ошибка загрузки Flow JSON:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Опубликовать Flow (после публикации им можно пользоваться в продакшене)
 * POST /{flow-id}/publish
 */
export async function publishFlow(config: WabaGraphConfig, flowId: string): Promise<void> {
  const url = `${graphBaseUrl(config.apiVersion)}/${flowId}/publish`;
  await axios.post(
    url,
    {},
    {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    }
  );
  logger.info(`✅ WABA Flow: Flow ${flowId} опубликован`);
}

/**
 * Получить статус Flow и ошибки валидации из Meta
 * GET /{flow-id}?fields=id,name,status,validation_errors,categories
 */
export async function getFlowStatus(config: WabaGraphConfig, flowId: string): Promise<any> {
  const url = `${graphBaseUrl(config.apiVersion)}/${flowId}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
    params: {
      fields: 'id,name,status,validation_errors,categories',
    },
  });
  return response.data;
}

// --- Парсинг ответа формы (nfm_reply) ---

export interface ParsedFlowResponse {
  flowToken: string | null;
  name: string | null;
  contactPhone: string | null;
  city: string | null;
  address: string | null;
  paymentType: string | null; // cash | halyk | kaspi (или raw значение, если не из списка)
  invoicePhone: string | null;
  comment: string | null;
  raw: Record<string, any>;
  /** Человекочитаемый текст для отображения в чате */
  displayText: string;
}

/**
 * Маппинг ключей response_json на поля формы.
 *
 * Поддерживаются два формата:
 * 1. Точные ключи из payload Footer-а: name, contact_phone, city, address,
 *    payment_type, invoice_phone, comment (текущая форма).
 * 2. Автогенерированные ключи Meta вида screen_0_NameInput_0, screen_0_CityInput_1 и т.д.
 *    (поиск по подстроке имени компонента — устойчив к смещению индексов).
 */
function findValueByComponent(raw: Record<string, any>, componentName: string): string | null {
  const key = Object.keys(raw).find(
    (k) => k.toLowerCase().includes(componentName.toLowerCase())
  );
  if (key === undefined) return null;
  const value = raw[key];
  return value === undefined || value === null ? null : String(value).trim() || null;
}

function readString(raw: Record<string, any>, key: string): string | null {
  const value = raw[key];
  return value === undefined || value === null ? null : String(value).trim() || null;
}

/**
 * Спарсить response_json из вебхука nfm_reply в структурированные поля формы.
 * Возвращает null, если JSON невалиден.
 */
export function parseFlowResponse(responseJson: string): ParsedFlowResponse | null {
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(responseJson);
  } catch (error) {
    logger.error('❌ WABA Flow: Невалидный response_json:', responseJson);
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const flowToken = typeof raw.flow_token === 'string' ? raw.flow_token : null;
  const name = readString(raw, 'name') ?? findValueByComponent(raw, 'NameInput');
  const contactPhone =
    readString(raw, 'contact_phone') ?? readString(raw, 'contactPhone') ?? findValueByComponent(raw, 'ContactPhoneInput');
  const city = readString(raw, 'city') ?? findValueByComponent(raw, 'CityInput');
  const address = readString(raw, 'address') ?? findValueByComponent(raw, 'AddressInput');
  // RadioButtons возвращает id опции (cash/halyk/kaspi); если значение кастомное — оставляем как есть
  const paymentType =
    readString(raw, 'payment_type') ?? readString(raw, 'paymentType') ?? findValueByComponent(raw, 'PaymentType');
  const invoicePhone =
    readString(raw, 'invoice_phone') ?? readString(raw, 'invoicePhone') ?? findValueByComponent(raw, 'InvoicePhoneInput');
  const comment = readString(raw, 'comment') ?? findValueByComponent(raw, 'CommentInput');

  const lines: string[] = [];
  if (name) lines.push(`Имя: ${name}`);
  if (contactPhone) lines.push(`Телефон: ${contactPhone}`);
  if (city) lines.push(`Город: ${city}`);
  if (address) lines.push(`Адрес: ${address}`);
  if (paymentType) {
    lines.push(`Тип оплаты: ${PAYMENT_TYPE_OPTIONS[paymentType] || paymentType}`);
  }
  if (invoicePhone) lines.push(`Счёт на номер: ${invoicePhone}`);
  if (comment) lines.push(`Комментарий: ${comment}`);
  const displayText = lines.join('\n') || '📋 Ответ из формы (данные не распознаны)';

  return { flowToken, name, contactPhone, city, address, paymentType, invoicePhone, comment, raw, displayText };
}

/**
 * Сгенерировать flow_token для отправки Flow-сообщения.
 * Возвращается в ответе формы — по нему можно связать ответ с отправкой.
 */
export function generateFlowToken(chatId: number, remoteJid: string): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `waf_${chatId}_${Date.now().toString(36)}_${random}_${remoteJid.split('@')[0]}`;
}
