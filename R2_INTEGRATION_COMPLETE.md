# 📦 R2 Object Storage - Интеграция завершена

## ✅ Статус интеграции

### Установлено
- ✅ `@aws-sdk/client-s3@3.x`
- ✅ `@aws-sdk/s3-request-presigner@3.x`

### Настроено
- ✅ `.env` с R2 credentials
- ✅ `storageService.ts` - универсальный storage
- ✅ `baileys.ts` - WhatsApp медиа → R2
- ✅ `telegramService.ts` - Telegram медиа → R2

### Компиляция
- ✅ `npm run build` - успешно

## 🔧 Конфигурация

### .env
```env
STORAGE_TYPE=r2
R2_ACCOUNT_ID=c83e6cf3f5ad60b7219f4e6ace3873a6
R2_BUCKET_NAME=messenger
R2_PUBLIC_URL=https://c83e6cf3f5ad60b7219f4e6ace3873a6.r2.cloudflarestorage.com
```

## 🚀 Как работает

### WhatsApp (Baileys)
```typescript
// baileys.ts - downloadAndSaveMedia()
const stream = await downloadContentFromMessage(messageContent, type);
const buffer = await streamToBuffer(stream);

const { saveMedia } = await import('../services/storageService');
const mediaUrl = await saveMedia(buffer, filename, mimetype);
// → https://.../messenger/image-123.jpg
```

### Telegram
```typescript
// telegramService.ts - handleIncomingMessage()
const fileLink = await telegram.getFileLink(photo.file_id);
const response = await fetch(fileLink);
const buffer = Buffer.from(await response.arrayBuffer());

const { saveMedia } = await import('./storageService');
const mediaUrl = await saveMedia(buffer, filename, mimetype);
// → https://.../messenger/telegram-456.jpg
```

## 📊 Что дальше?

### 1. Настроить публичный доступ к bucket
**Cloudflare R2 Dashboard:**
1. Откройте bucket `messenger`
2. Settings → Public Access → Enable
3. Добавьте политику:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::messenger/*"
  }]
}
```

### 2. Перезапустить сервер
```bash
npm run build
npm start
```

### 3. Протестировать
1. Отправьте фото в WhatsApp
2. Проверьте логи: `✅ Медиафайл сохранен: https://...`
3. Откройте URL - файл должен загрузиться
4. Проверьте R2 Dashboard - файл должен быть в bucket

## 🎯 Результат

**Было:**
```
WhatsApp → local → /public/media/image.jpg
Telegram → direct URL → https://api.telegram.org/file/...
```

**Стало:**
```
WhatsApp → R2 → https://.../messenger/image-123.jpg
Telegram → R2 → https://.../messenger/telegram-456.jpg
```

## 📝 Документация

См. подробности:
- `R2_SETUP_GUIDE.md` - настройка R2
- `R2_CHEATSHEET.md` - быстрая справка
- `MEDIA_STORAGE_GUIDE.md` - полная документация
