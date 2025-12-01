# Руководство по хранению медиафайлов и документов

## 🚀 Быстрый старт

### Вариант 1: Локальное хранилище (по умолчанию)
✅ **Работает из коробки!** Ничего настраивать не нужно.

### Вариант 2: Cloudflare R2 (рекомендуется для продакшена)
📖 **Полная инструкция:** [`R2_SETUP_GUIDE.md`](./R2_SETUP_GUIDE.md)

**Краткая настройка:**
```bash
# 1. Установите зависимости
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# 2. Добавьте в .env
STORAGE_TYPE=r2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_key
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET_NAME=messenger-media
R2_PUBLIC_URL=https://pub-xxxxx.r2.dev

# 3. Готово! Перезапустите сервер
```

**Преимущества R2:**
- 💰 **10 GB бесплатно** каждый месяц
- 🚀 **$0 за исходящий трафик** (vs S3: $0.09/GB)
- ⚡ **В 10 раз дешевле** чем Amazon S3
- 🌍 **Глобальный CDN** Cloudflare включен

---

## 📁 Текущая структура хранения

### Локальное хранилище (по умолчанию)

```
messenger-backend/
├── public/
│   └── media/                    # Все медиафайлы
│       ├── 1764021058759-202800845.jpeg
│       ├── 1764021164793-402564833.jpeg
│       └── document-1701234567-123456789.pdf
└── dist/
    └── public/
        └── media/                # Копия после компиляции
```

**Путь к файлам:** `/Users/shrvse/messenger/messenger-backend/public/media/`

**URL доступа:** `http://localhost:4000/media/filename.ext`

### Формат имени файла

```
{timestamp}-{random}.{extension}
```

**Пример:**
- `1764021058759-202800845.jpeg` - изображение
- `1701234567-123456789.pdf` - документ PDF
- `1701234567-987654321.mp3` - аудио

## 📊 Поддерживаемые типы файлов

### Изображения
- `.jpeg`, `.jpg` - JPEG изображения
- `.png` - PNG изображения
- `.gif` - GIF анимации
- `.webp` - WebP формат

### Документы
- `.pdf` - PDF документы
- `.doc`, `.docx` - Microsoft Word
- `.xls`, `.xlsx` - Microsoft Excel
- `.ppt`, `.pptx` - Microsoft PowerPoint
- `.txt` - Текстовые файлы
- `.csv` - CSV таблицы

### Аудио
- `.mp3` - MP3 аудио
- `.ogg` - OGG Vorbis
- `.wav` - WAV аудио
- `.m4a` - AAC аудио

### Видео
- `.mp4` - MP4 видео
- `.mov` - QuickTime
- `.avi` - AVI видео
- `.webm` - WebM видео

## 🔄 Текущий процесс хранения

### При получении сообщения с медиа (WhatsApp/Telegram)

```typescript
// src/config/baileys.ts - функция downloadAndSaveMedia()

1. Скачивание медиа из сообщения
   ↓
2. Создание директории public/media (если не существует)
   ↓
3. Генерация уникального имени файла
   ↓
4. Сохранение в public/media/
   ↓
5. Возврат URL: /media/{filename}
   ↓
6. Сохранение URL в базе данных (поле mediaUrl)
```

### При отправке медиа

```typescript
// src/controllers/mediaController.ts

1. Загрузка файла через API (multipart/form-data)
   ↓
2. Валидация файла (размер, тип)
   ↓
3. Сохранение в public/media/
   ↓
4. Получение URL файла
   ↓
5. Отправка через WhatsApp/Telegram
   ↓
6. Сохранение записи в БД с mediaUrl
```

## 💾 Хранилище в базе данных

### Таблица Message

```sql
CREATE TABLE "Message" (
  id SERIAL PRIMARY KEY,
  chatId INT NOT NULL,
  content TEXT,
  type VARCHAR(50),           -- 'text', 'image', 'document', 'audio', 'video'
  mediaUrl TEXT,              -- '/media/filename.ext' или полный URL
  filename VARCHAR(255),       -- Оригинальное имя файла
  mimeType VARCHAR(100),       -- 'application/pdf', 'image/jpeg', etc.
  mediaSize INT,               -- Размер в байтах
  ...
);
```

**Примеры записей:**

```json
{
  "id": 123,
  "type": "document",
  "content": "Договор.pdf",
  "mediaUrl": "/media/1701234567-123456789.pdf",
  "filename": "Договор.pdf",
  "mimeType": "application/pdf",
  "mediaSize": 245678
}
```

## 🌐 Варианты хранения

### 1. ✅ Локальное хранилище (текущее)

**Преимущества:**
- ✅ Простота настройки
- ✅ Нет дополнительных затрат
- ✅ Быстрый доступ
- ✅ Полный контроль

**Недостатки:**
- ❌ Ограничено размером диска
- ❌ Сложность масштабирования
- ❌ Нет автоматического резервного копирования
- ❌ Потеря данных при сбое сервера

**Подходит для:**
- Разработка и тестирование
- Малый объем файлов (< 10 GB)
- Одиночный сервер

---

### 2. 🗄️ Сетевое хранилище (NFS/SMB)

**Настройка:**

```bash
# Монтирование сетевого диска
sudo mount -t nfs server:/share /mnt/media

# Изменить путь в коде
const mediaDir = '/mnt/media';
```

**Преимущества:**
- ✅ Централизованное хранение
- ✅ Легко масштабировать
- ✅ Резервное копирование на уровне сервера

**Недостатки:**
- ❌ Зависимость от сети
- ❌ Возможные задержки

---

### 3. ☁️ Облачное хранилище (S3, MinIO, Google Cloud Storage)

**Рекомендуется для продакшена!**

#### Вариант A: Amazon S3

**Установка:**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**Пример кода:**

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function uploadToS3(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const key = `media/${Date.now()}-${filename}`;
  
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));

  return `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${key}`;
}
```

**Переменные окружения (.env):**

```env
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=messenger-media
AWS_REGION=us-east-1
```

**Преимущества:**
- ✅ Безлимитное хранилище
- ✅ Высокая доступность (99.99%)
- ✅ CDN интеграция (CloudFront)
- ✅ Автоматическое резервное копирование
- ✅ Версионирование файлов

**Стоимость:** ~$0.023/GB/месяц

---

#### Вариант B: MinIO (Self-hosted S3)

**Docker Compose:**

```yaml
version: '3'
services:
  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - ./minio-data:/data
    command: server /data --console-address ":9001"
```

**Использование:**

```typescript
import { S3Client } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  },
  forcePathStyle: true,
});
```

**Преимущества:**
- ✅ Бесплатно (self-hosted)
- ✅ S3-совместимый API
- ✅ Полный контроль
- ✅ Веб-интерфейс

---

#### Вариант C: Cloudflare R2 (рекомендуется для продакшена!)

**Почему R2?**
- 🎯 **Без платы за исходящий трафик** (в отличие от S3)
- 💰 Дешевле S3 в 10 раз
- ⚡ Интеграция с Cloudflare CDN
- 🌍 Глобальная сеть Cloudflare
- ✅ S3-совместимый API

**Стоимость:**
- Хранение: **$0.015/GB/месяц** (vs S3: $0.023/GB)
- Исходящий трафик: **$0** (vs S3: $0.09/GB)
- Операции Class A: $4.50 за миллион
- Операции Class B: $0.36 за миллион
- **Бесплатно:** 10 GB хранилища + 1 млн операций/месяц

**Создание R2 bucket:**

1. Зайдите в [Cloudflare Dashboard](https://dash.cloudflare.com)
2. R2 → Create bucket
3. Имя: `messenger-media`
4. Регион: Automatic (используется ближайший)
5. API Tokens → Manage R2 API Tokens → Create API Token
   - Permissions: Object Read & Write
   - Скопируйте: Access Key ID и Secret Access Key

**Установка зависимостей:**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**Конфигурация (.env):**

```env
# Cloudflare R2
USE_R2=true
R2_ACCOUNT_ID=your_account_id              # Из Cloudflare Dashboard
R2_ACCESS_KEY_ID=your_access_key_id         # Из API Token
R2_SECRET_ACCESS_KEY=your_secret_key        # Из API Token
R2_BUCKET_NAME=messenger-media
R2_PUBLIC_URL=https://pub-xxxxx.r2.dev      # Public bucket URL (опционально)
```

**Пример кода:**

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

async function uploadToR2(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const key = `media/${Date.now()}-${filename}`;
  
  await r2Client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));

  // Вариант 1: Публичный URL (если bucket публичный)
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL}/${key}`;
  }
  
  // Вариант 2: Подписанный URL (приватный bucket)
  const signedUrl = await getSignedUrl(
    r2Client,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    }),
    { expiresIn: 3600 * 24 * 7 } // 7 дней
  );
  
  return signedUrl;
}
```

**Настройка публичного доступа:**

1. R2 → Your Bucket → Settings
2. Public Access → Allow Access
3. Скопируйте R2.dev URL: `https://pub-xxxxx.r2.dev`
4. Добавьте в `.env`: `R2_PUBLIC_URL=https://pub-xxxxx.r2.dev`

**Custom Domain (опционально):**

1. R2 → Your Bucket → Settings → Custom Domains
2. Add Custom Domain: `media.yourdomain.com`
3. Cloudflare автоматически настроит DNS
4. Используйте: `https://media.yourdomain.com/media/file.jpg`

**Преимущества R2:**
- ✅ Бесплатный исходящий трафик (экономия $$$)
- ✅ Автоматический CDN Cloudflare
- ✅ Дешевле S3 в 10 раз
- ✅ S3-совместимый API
- ✅ 10 GB бесплатно каждый месяц
- ✅ Custom domains
- ✅ Глобальная репликация

**Недостатки:**
- ❌ Меньше функций чем у S3 (нет lifecycle policies пока)
- ❌ Относительно новый сервис

---

### 4. 🔗 Гибридное решение (рекомендуется)

**Стратегия:**
- Малые файлы (< 1 MB) → локально
- Большие файлы (> 1 MB) → R2/S3
- Кэширование популярных → локально

**Пример кода:**

```typescript
async function saveMedia(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const sizeInMB = buffer.length / (1024 * 1024);
  
  if (sizeInMB < 1) {
    // Малый файл - сохраняем локально
    return await saveLocally(buffer, filename);
  } else {
    // Большой файл - в облако (R2 или S3)
    return await uploadToR2(buffer, filename, mimeType);
  }
}
```

## 📋 Рекомендации по внедрению

### Для разработки
```bash
✅ Локальное хранилище (public/media/)
```

### Для малого бизнеса (< 1000 пользователей)
```bash
✅ Cloudflare R2 (10 GB бесплатно!)
✅ Резервное копирование раз в день
```

### Для среднего бизнеса
```bash
✅ Cloudflare R2 + Custom Domain
✅ Автоматическое резервное копирование
✅ Экономия на трафике
```

### Для крупного проекта
```bash
✅ Cloudflare R2 + Workers для обработки
✅ Репликация через Cloudflare
✅ Custom Domain + CDN
✅ Автоматическая оптимизация изображений
```

### Для крупного проекта
```bash
✅ Amazon S3 + CloudFront
✅ Репликация в несколько регионов
✅ Автоматическое архивирование (S3 Glacier)
✅ CDN для быстрой доставки
```

## 🔧 Миграция с локального на S3

### Шаг 1: Установка зависимостей

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### Шаг 2: Создание сервиса хранилища

```typescript
// src/services/storageService.ts

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';

const USE_S3 = process.env.USE_S3 === 'true';

const s3Client = USE_S3 ? new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
}) : null;

export async function saveMedia(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  if (USE_S3 && s3Client) {
    return await uploadToS3(buffer, filename, mimeType);
  } else {
    return await saveLocally(buffer, filename);
  }
}

async function uploadToS3(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const key = `media/${Date.now()}-${filename}`;
  
  await s3Client!.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));

  return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

async function saveLocally(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const mediaDir = path.join(__dirname, '..', '..', 'public', 'media');
  await fs.mkdir(mediaDir, { recursive: true });

  const filePath = path.join(mediaDir, filename);
  await fs.writeFile(filePath, buffer);

  return `/media/${filename}`;
}
```

### Шаг 3: Обновление .env

```env
# Хранилище
USE_S3=false                          # true для S3, false для локального

# AWS S3 (если USE_S3=true)
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
S3_BUCKET_NAME=messenger-media
AWS_REGION=us-east-1
```

### Шаг 4: Миграция существующих файлов

```typescript
// scripts/migrate-to-s3.js

import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();
const s3Client = new S3Client({ /* ... */ });

async function migrateFilesToS3() {
  const messages = await prisma.message.findMany({
    where: {
      mediaUrl: { startsWith: '/media/' }
    }
  });

  for (const message of messages) {
    const localPath = path.join(__dirname, '..', 'public', message.mediaUrl);
    const buffer = await fs.readFile(localPath);
    
    const s3Url = await uploadToS3(buffer, path.basename(message.mediaUrl));
    
    await prisma.message.update({
      where: { id: message.id },
      data: { mediaUrl: s3Url }
    });
    
    console.log(`✅ Migrated: ${message.mediaUrl} → ${s3Url}`);
  }
}

migrateFilesToS3();
```

## 🔒 Безопасность

### Ограничение размера файлов

```typescript
// src/middlewares/uploadMiddleware.ts

import multer from 'multer';

const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'application/pdf',
      'application/msword',
      'audio/mpeg',
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый тип файла'));
    }
  },
});
```

### Очистка старых файлов

```typescript
// scripts/cleanup-old-media.js

import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

async function cleanupOldFiles() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const oldMessages = await prisma.message.findMany({
    where: {
      createdAt: { lt: thirtyDaysAgo },
      type: { in: ['image', 'document', 'audio', 'video'] }
    }
  });

  for (const msg of oldMessages) {
    if (msg.mediaUrl?.startsWith('/media/')) {
      const filePath = path.join(__dirname, '..', 'public', msg.mediaUrl);
      await fs.unlink(filePath).catch(() => {});
      console.log(`🗑️ Deleted: ${msg.mediaUrl}`);
    }
  }
}
```

## 📊 Мониторинг хранилища

```bash
# Проверка размера директории
du -sh public/media/

# Количество файлов
ls -1 public/media/ | wc -l

# Топ-10 самых больших файлов
du -h public/media/* | sort -rh | head -10
```

## 🚀 Быстрый старт

### Текущая конфигурация (локальное хранилище)
**Работает из коробки!** Никаких изменений не требуется.

Файлы сохраняются в:
```
/Users/shrvse/messenger/messenger-backend/public/media/
```

Доступ по URL:
```
http://localhost:4000/media/filename.ext
```

### Переход на S3 (опционально)

1. Создайте S3 bucket
2. Добавьте credentials в `.env`
3. Установите `USE_S3=true`
4. Перезапустите сервер

**Всё готово!** 🎉
