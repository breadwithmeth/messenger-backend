# ✅ Cloudflare R2 Integration Status

## Статус: **АКТИВНА И НАСТРОЕНА**

Интеграция с Cloudflare R2 уже **полностью реализована и работает**. Все медиафайлы автоматически загружаются на R2.

---

## 🔧 Текущая конфигурация

### Переменные окружения (.env)
```env
STORAGE_TYPE=r2
R2_ACCOUNT_ID=c83e6cf3f5ad60b7219f4e6ace3873a6
R2_ACCESS_KEY_ID=0213c9ffa418275d1d2615189500ca63
R2_SECRET_ACCESS_KEY=a1e2500b39bd58af4b48dfc7ca812c93a65743d65f15c9d2e3f96004ea586b8a
R2_BUCKET_NAME=messenger
R2_PUBLIC_URL=https://r2.drawbridge.kz
```

### Установленные пакеты
- ✅ `@aws-sdk/client-s3@3.940.0` - S3-совместимый клиент для R2
- ✅ `@aws-sdk/s3-request-presigner@3.940.0` - Генерация подписанных URL

---

## 📂 Архитектура хранилища

### 1. Storage Service (`src/services/storageService.ts`)
**Универсальный сервис** для работы с разными типами хранилищ:
- ✅ **Cloudflare R2** (текущий, активный)
- ✅ **Amazon S3** (опционально)
- ✅ **Local filesystem** (fallback)

### 2. Автоматическое определение хранилища
```typescript
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local';
```
При `STORAGE_TYPE=r2` все файлы автоматически загружаются на R2.

### 3. Структура хранения
```
messenger bucket (R2)
└── media/
    ├── image_1738234567890_abc123.jpg
    ├── document_1738234567891_def456.pdf
    ├── video_1738234567892_ghi789.mp4
    └── audio_1738234567893_jkl012.mp3
```

---

## 🔄 Как это работает

### 1. Загрузка медиа через API
```bash
POST /api/media/upload-for-waba
Content-Type: multipart/form-data

{
  media: <file>,
  mediaType: 'image' | 'document' | 'video' | 'audio'
}
```

### 2. Обработка в Media Controller
```typescript
// src/controllers/mediaController.ts
const result = await saveUploadedMedia(
  req.file.buffer,
  req.file.originalname,
  req.file.mimetype,
  mediaType
);
```

### 3. Сохранение через Storage Service
```typescript
// src/services/mediaService.ts
export const saveUploadedMedia = async (...) => {
  // Генерация уникального имени
  const fileName = `${mediaType}_${timestamp}_${random}${ext}`;
  
  // Универсальный storage (автоматически использует R2)
  const fileUrl = await saveMedia(fileBuffer, fileName, mimeType);
  
  return { success: true, url: fileUrl, ... };
};
```

### 4. Загрузка в R2
```typescript
// src/services/storageService.ts
async function uploadToR2(buffer, filename, mimeType) {
  const key = `media/${filename}`;
  
  await r2Client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));
  
  // Возвращаем публичный URL
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}
```

### 5. Возврат публичного URL
```json
{
  "success": true,
  "mediaUrl": "https://r2.drawbridge.kz/media/image_1738234567890_abc123.jpg",
  "fileName": "image_1738234567890_abc123.jpg",
  "mediaType": "image",
  "size": 245678,
  "mimeType": "image/jpeg"
}
```

---

## 🌐 Публичный доступ к файлам

### Настроенный домен
```
https://r2.drawbridge.kz
```

Все медиафайлы доступны по URL:
```
https://r2.drawbridge.kz/media/<filename>
```

### Пример
```
https://r2.drawbridge.kz/media/image_1738234567890_abc123.jpg
```

---

## 🔐 Безопасность

### Публичный bucket
Если `R2_PUBLIC_URL` настроен → используются публичные URL:
```typescript
if (process.env.R2_PUBLIC_URL) {
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
  return publicUrl;
}
```

### Приватный bucket
Если `R2_PUBLIC_URL` не настроен → генерируются подписанные URL (7 дней):
```typescript
const signedUrl = await getSignedUrl(
  r2Client,
  new GetObjectCommand({ Bucket, Key }),
  { expiresIn: 3600 * 24 * 7 }
);
return signedUrl;
```

---

## 📊 Логирование

### При запуске приложения
```
🗄️  [Storage] Инициализация Storage Service:
   - STORAGE_TYPE: r2
   - R2 Endpoint: https://c83e6cf3f5ad60b7219f4e6ace3873a6.r2.cloudflarestorage.com
   - R2 Bucket: messenger
   - R2 Public URL: https://r2.drawbridge.kz
   - R2 Access Key ID: 0213c9ff...
```

### При загрузке файла
```
📤 [R2] Начало загрузки файла:
   - Bucket: messenger
   - Key: media/image_1738234567890_abc123.jpg
   - Size: 245678 bytes
   - MimeType: image/jpeg
   
✅ [R2] Файл успешно загружен в R2:
   - Key: media/image_1738234567890_abc123.jpg
   - ETag: "abc123def456..."
   - Public URL: https://r2.drawbridge.kz/media/image_1738234567890_abc123.jpg
```

---

## 🧪 Тестирование

### 1. Тест загрузки изображения
```bash
#!/bin/bash
TOKEN="your_jwt_token"
API="http://localhost:3000"

curl -X POST "$API/api/media/upload-for-waba" \
  -H "Authorization: Bearer $TOKEN" \
  -F "media=@test-image.jpg" \
  -F "mediaType=image"
```

### 2. Ожидаемый ответ
```json
{
  "success": true,
  "mediaUrl": "https://r2.drawbridge.kz/media/image_1738234567890_abc123.jpg",
  "fileName": "image_1738234567890_abc123.jpg",
  "mediaType": "image",
  "size": 245678,
  "mimeType": "image/jpeg",
  "metadata": {
    "uploadedAt": "2025-01-30T12:34:56.789Z",
    "storage": "r2"
  }
}
```

### 3. Использование в отправке сообщений
```bash
curl -X POST "$API/api/messages/send-by-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 123,
    "message": "Смотри фото!",
    "type": "image",
    "mediaUrl": "https://r2.drawbridge.kz/media/image_1738234567890_abc123.jpg"
  }'
```

---

## 🔄 Переключение типов хранилища

### Локальное хранилище (для разработки)
```env
STORAGE_TYPE=local
```
Файлы сохраняются в `public/media/`

### Cloudflare R2 (текущий, продакшн)
```env
STORAGE_TYPE=r2
R2_ACCOUNT_ID=c83e6cf3f5ad60b7219f4e6ace3873a6
R2_ACCESS_KEY_ID=0213c9ffa418275d1d2615189500ca63
R2_SECRET_ACCESS_KEY=a1e2500b39bd58af4b48dfc7ca812c93a65743d65f15c9d2e3f96004ea586b8a
R2_BUCKET_NAME=messenger
R2_PUBLIC_URL=https://r2.drawbridge.kz
```

### Amazon S3 (опционально)
```env
STORAGE_TYPE=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
S3_BUCKET_NAME=your-bucket
```

**Никакого изменения кода не требуется!** Просто меняете `.env`.

---

## 📄 Связанная документация

1. **WABA_MEDIA_UPLOAD.md** - Документация по API загрузки медиа
2. **R2_SETUP_GUIDE.md** - Подробное руководство по настройке R2
3. **R2_CHEATSHEET.md** - Шпаргалка по R2
4. **test-waba-media-upload.sh** - Скрипт для тестирования

---

## ✅ Что уже работает

- ✅ Загрузка изображений в R2
- ✅ Загрузка документов в R2
- ✅ Загрузка видео в R2
- ✅ Загрузка аудио в R2
- ✅ Генерация публичных URL
- ✅ Валидация типов файлов
- ✅ Валидация размеров файлов
- ✅ Логирование операций
- ✅ Обработка ошибок

---

## 🎯 Итог

**Cloudflare R2 интеграция полностью готова и работает!**

Все медиафайлы, загруженные через `/api/media/upload-for-waba`, автоматически сохраняются в R2 bucket `messenger` и доступны по адресу `https://r2.drawbridge.kz/media/<filename>`.

Никаких дополнительных действий не требуется. Система готова к использованию в продакшн!
