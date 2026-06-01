#!/usr/bin/env node

/*
  WABA broadcast template sender

  Пример:
    node scripts/waba-broadcast-template.js \
      --list ./numbers.txt \
      --phone-number-id 958088394044701 \
      --template new_number \
      --language ru

  Требования:
    - В .env должен быть WABA_ACCESS_TOKEN (или экспортируйте переменную окружения)

  Формат списка:
    - .txt: один номер на строку (можно с +, пробелами, дефисами)
    - .json: массив строк ["7705...", "7777..."]
*/

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function usageAndExit(message) {
  if (message) console.error(`\nОшибка: ${message}\n`);
  console.error(
    [
      'Использование:',
      '  node scripts/waba-broadcast-template.js --list <file> --phone-number-id <id> [опции]',
      '',
      'Обязательные параметры:',
      '  --list               Путь к файлу со списком номеров (.txt или .json)',
      '  --phone-number-id    Phone Number ID (например 958088394044701)',
      '',
      'Опции:',
      '  --template           Имя шаблона (по умолчанию: new_number)',
      '  --language           Язык шаблона (по умолчанию: ru)',
      '  --components         JSON строка components (по умолчанию: body с пустыми parameters)',
      '  --delay-ms           Задержка между отправками (по умолчанию: 250)',
      '  --dry-run            Не отправлять, только показать что будет отправлено',
      '',
      'Переменные окружения:',
      '  WABA_ACCESS_TOKEN    Access token для Graph API',
    ].join('\n')
  );
  process.exit(1);
}

function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits;
}

function loadRecipients(listPath) {
  const abs = path.isAbsolute(listPath) ? listPath : path.join(process.cwd(), listPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Файл не найден: ${abs}`);
  }

  const raw = fs.readFileSync(abs, 'utf8').trim();
  if (!raw) return [];

  if (abs.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('JSON должен быть массивом строк');
    return parsed;
  }

  // txt/csv-like: one per line; allow comments
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

async function sendTemplate({
  apiVersion,
  phoneNumberId,
  accessToken,
  to,
  templateName,
  language,
  components,
}) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components,
    },
  };

  const resp = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });

  return resp.data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const listPath = args.list;
  const phoneNumberId = args['phone-number-id'] || process.env.WABA_PHONE_NUMBER_ID;
  const accessToken = process.env.WABA_ACCESS_TOKEN;

  if (args.help) usageAndExit();
  if (!listPath) usageAndExit('Не задан --list');
  if (!phoneNumberId) usageAndExit('Не задан --phone-number-id и нет WABA_PHONE_NUMBER_ID');
  if (!accessToken) usageAndExit('Не задан WABA_ACCESS_TOKEN в окружении/.env');

  const apiVersion = process.env.WABA_API_VERSION || 'v21.0';
  const templateName = args.template || 'new_number';
  const language = args.language || 'ru';
  const delayMs = Number(args['delay-ms'] ?? 250);
  const dryRun = Boolean(args['dry-run']);

  let components;
  if (args.components) {
    try {
      components = JSON.parse(args.components);
    } catch (e) {
      usageAndExit('Некорректный JSON в --components');
    }
  } else {
    // По умолчанию — как в вашем примере
    components = [
      {
        type: 'body',
        parameters: [],
      },
    ];
  }

  const rawRecipients = loadRecipients(listPath);
  const recipients = rawRecipients
    .map(normalizePhone)
    .filter(Boolean);

  if (recipients.length === 0) {
    console.log('Список получателей пуст. Нечего отправлять.');
    return;
  }

  console.log('WABA broadcast запущен');
  console.log(`- phoneNumberId: ${phoneNumberId}`);
  console.log(`- apiVersion: ${apiVersion}`);
  console.log(`- template: ${templateName}`);
  console.log(`- language: ${language}`);
  console.log(`- recipients: ${recipients.length}`);
  console.log(`- delayMs: ${delayMs}`);
  console.log(`- dryRun: ${dryRun}`);

  let ok = 0;
  let fail = 0;

  for (let idx = 0; idx < recipients.length; idx++) {
    const to = recipients[idx];
    const prefix = `[${idx + 1}/${recipients.length}] ${to}`;

    try {
      if (dryRun) {
        console.log(`${prefix} DRY-RUN (не отправлено)`);
      } else {
        const data = await sendTemplate({
          apiVersion,
          phoneNumberId,
          accessToken,
          to,
          templateName,
          language,
          components,
        });

        const messageId = data?.messages?.[0]?.id;
        console.log(`${prefix} OK${messageId ? ` id=${messageId}` : ''}`);
      }
      ok++;
    } catch (err) {
      fail++;
      const status = err?.response?.status;
      const payload = err?.response?.data;
      console.error(`${prefix} FAIL${status ? ` status=${status}` : ''}`);
      if (payload) console.error(JSON.stringify(payload));
      else console.error(err?.message || String(err));
    }

    if (idx < recipients.length - 1 && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  console.log('Готово');
  console.log(`- ok: ${ok}`);
  console.log(`- fail: ${fail}`);

  if (fail > 0) process.exitCode = 2;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
