# Быстрая настройка Cloudflare R2

## 🚀 Пошаговая инструкция

### Шаг 1: Установка зависимостей

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### Шаг 2: Создание R2 bucket в Cloudflare

1. Перейдите на [Cloudflare Dashboard](https://dash.cloudflare.com)
2. В меню слева выберите **R2 Object Storage**
3. Нажмите **Create bucket**
4. Введите имя bucket: `messenger-media`
5. Нажмите **Create bucket**

### Шаг 3: Получение API токенов

1. В разделе R2 нажмите **Manage R2 API Tokens**
2. Нажмите **Create API Token**
3. Заполните:
   - **Token Name**: `messenger-backend`
   - **Permissions**: Object Read & Write
   - **TTL**: Forever (или выберите срок)
   - **Specify bucket(s)**: Apply to specific buckets only → выберите `messenger-media`
4. Нажмите **Create API Token**
5. **Скопируйте и сохраните:**
   - Access Key ID
   - Secret Access Key
   - **ВАЖНО:** Secret ключ показывается только один раз!

### Шаг 4: Найдите Account ID

1. В Cloudflare Dashboard справа вверху найдите **Account ID**
2. Или перейдите в R2 → настройки bucket → в URL будет `.../accounts/{ACCOUNT_ID}/r2/...`
3. Скопируйте Account ID

### Шаг 5: Настройка публичного доступа (опционально)

**Вариант А: Публичный bucket (проще)**

1. R2 → Выберите ваш bucket `messenger-media`
2. Settings → Public Access → **Allow Access**
3. Скопируйте **R2.dev subdomain URL**: `https://pub-xxxxxxxxxxxxx.r2.dev`

**Вариант Б: Custom Domain (красивее)**

1. R2 → Выберите ваш bucket → Settings
2. Custom Domains → **Connect Domain**
3. Введите: `media.yourdomain.com`
4. Cloudflare автоматически настроит DNS
5. Используйте: `https://media.yourdomain.com`

### Шаг 6: Обновите .env файл

Откройте `/Users/shrvse/messenger/messenger-backend/.env` и добавьте:

```env
# Хранилище медиафайлов
STORAGE_TYPE=r2                                    # local | r2 | s3

# Cloudflare R2 (если STORAGE_TYPE=r2)
R2_ACCOUNT_ID=your_account_id_here                 # Из шага 4
R2_ACCESS_KEY_ID=your_access_key_id_here           # Из шага 3
R2_SECRET_ACCESS_KEY=your_secret_access_key_here   # Из шага 3
R2_BUCKET_NAME=messenger-media
R2_PUBLIC_URL=https://pub-xxxxxxxxxxxxx.r2.dev     # Если bucket публичный (опционально)
```

**Пример заполненного .env:**

```env
STORAGE_TYPE=r2
R2_ACCOUNT_ID=a1b2c3d4e5f6g7h8i9j0
R2_ACCESS_KEY_ID=a1b2c3d4e5f6g7h8i9j0k1l2m3n4
R2_SECRET_ACCESS_KEY=s3cr3tk3yw1thL0tsOfCh4r4ct3rs
R2_BUCKET_NAME=messenger-media
R2_PUBLIC_URL=https://pub-1234567890abcdef.r2.dev
```

### Шаг 7: Обновите код для использования storageService

**В `src/config/baileys.ts`:**

```typescript
// Было:
import fs from 'fs/promises';
import path from 'path';

async function downloadAndSaveMedia(...) {
  // старый код с локальным сохранением
}

// Стало:
import { saveMedia } from '../services/storageService';

async function downloadAndSaveMedia(
  messageContent: any,
  type: MediaType,
  originalFilename?: string
): Promise<string | undefined> {
  try {
    const stream = await downloadContentFromMessage(messageContent, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const extension = path.extname(originalFilename || '') || 
      `.${messageContent.mimetype?.split('/')[1] || 'bin'}`;
    const filename = `${originalFilename || 'file'}${extension}`;
    const mimeType = messageContent.mimetype || 'application/octet-stream';

    // Используем сервис хранилища (автоматически выберет R2/S3/local)
    return await saveMedia(buffer, filename, mimeType);
  } catch (error) {
    logger.error('❌ Ошибка при скачивании или сохранении медиа:', error);
    return undefined;
  }
}
```

**В `src/services/telegramService.ts`:**

```typescript
import { saveMedia } from './storageService';

// В функции handleIncomingMessage добавьте:
if (msg.photo || msg.document || msg.audio || msg.video) {
  const buffer = await downloadTelegramFile(fileLink);
  const filename = msg.document?.file_name || `file-${Date.now()}`;
  const mimeType = msg.document?.mime_type || 'application/octet-stream';
  
  mediaUrl = await saveMedia(buffer, filename, mimeType);
}
```

### Шаг 8: Перезапустите сервер

```bash
# Скомпилируйте TypeScript
npm run build

# Запустите сервер
npm start
```

### Шаг 9: Проверьте работу

**Отправьте изображение через WhatsApp или Telegram**

Проверьте логи:
```bash
✅ Файл загружен в R2: media/1701234567-123456789.jpeg
```

**Проверьте в Cloudflare:**
1. R2 → Ваш bucket `messenger-media`
2. В списке файлов должен появиться файл в папке `media/`

**Проверьте URL:**
- Публичный: `https://pub-xxxxx.r2.dev/media/1701234567-123456789.jpeg`
- Custom domain: `https://media.yourdomain.com/media/1701234567-123456789.jpeg`

---

## 🔄 Миграция существующих файлов с локального хранилища в R2

Если у вас уже есть файлы в `public/media/`, запустите скрипт миграции:

```bash
node scripts/migrate-to-r2.js
```

**Создайте файл `scripts/migrate-to-r2.js`:**

```javascript
const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs/promises');
const path = require('path');

const prisma = new PrismaClient();

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function migrateToR2() {
  console.log('🚀 Начало миграции файлов в R2...');

  const messages = await prisma.message.findMany({
    where: {
      mediaUrl: { startsWith: '/media/' }
    }
  });

  console.log(`📁 Найдено ${messages.length} сообщений с локальными файлами`);

  for (const message of messages) {
    try {
      const localPath = path.join(__dirname, '..', 'public', message.mediaUrl);
      const buffer = await fs.readFile(localPath);
      const filename = path.basename(message.mediaUrl);
      const key = `media/${filename}`;

      await r2Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: message.mimeType || 'application/octet-stream',
      }));

      const r2Url = process.env.R2_PUBLIC_URL 
        ? `${process.env.R2_PUBLIC_URL}/${key}`
        : key;

      await prisma.message.update({
        where: { id: message.id },
        data: { mediaUrl: r2Url }
      });

      console.log(`✅ Мигрирован: ${message.mediaUrl} → ${r2Url}`);
    } catch (error) {
      console.error(`❌ Ошибка миграции ${message.mediaUrl}:`, error.message);
    }
  }

  console.log('🎉 Миграция завершена!');
  await prisma.$disconnect();
}

migrateToR2();
```

**Запустите миграцию:**

```bash
npm install dotenv
node -r dotenv/config scripts/migrate-to-r2.js
```

---

## 💰 Стоимость использования R2

### Бесплатный план
- ✅ **10 GB** хранилища
- ✅ **1 миллион** операций Class A (запись)
- ✅ **10 миллионов** операций Class B (чтение)
- ✅ **0$** за исходящий трафик

### Платный план (при превышении)
- **$0.015/GB/месяц** - хранение (в 10 раз дешевле S3!)
- **$0** - исходящий трафик (S3 берет $0.09/GB!)
- **$4.50** за миллион операций Class A
- **$0.36** за миллион операций Class B

### Пример расчета для мессенджера
**1000 пользователей, 50 медиафайлов/день:**

- Объем: ~20 GB
- Операции: ~50K записей/месяц
- Трафик: ~500 GB/месяц

**Cloudflare R2:** ~$0.15/месяц
**Amazon S3:** ~$45.50/месяц

**Экономия: $45.35/месяц (99.7%)** 🎉

---

## 🔍 Полезные команды

### Проверка размера bucket в R2
```bash
# В Cloudflare Dashboard → R2 → Your Bucket
# Показывается автоматически
```

### Список всех файлов
```bash
# Используйте AWS CLI с R2 endpoint
aws s3 ls s3://messenger-media/media/ \
  --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
```

### Очистка старых файлов (> 30 дней)
Создайте скрипт `scripts/cleanup-old-r2-files.js` (см. документацию)

---

## ❓ Частые вопросы

**Q: Можно ли использовать R2 бесплатно?**
A: Да! 10 GB и 1 млн операций/месяц бесплатно навсегда.

**Q: Чем R2 лучше S3?**
A: Бесплатный исходящий трафик экономит огромные деньги при большом количестве пользователей.

**Q: Нужен ли Cloudflare Workers?**
A: Нет, можно использовать напрямую через S3 API.

**Q: Можно ли вернуться на локальное хранилище?**
A: Да, просто измените `STORAGE_TYPE=local` в `.env`.

**Q: Как настроить CORS для R2?**
A: В Cloudflare Dashboard → R2 → Settings → CORS Policy

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedHeaders": ["*"]
  }
]
```

---

## ✅ Готово!

Теперь все медиафайлы будут автоматически загружаться в Cloudflare R2! 🎉

**Проверьте:**
1. Отправьте изображение через WhatsApp/Telegram
2. Проверьте логи: `✅ Файл загружен в R2`
3. Откройте URL в браузере
4. Проверьте bucket в Cloudflare Dashboard
