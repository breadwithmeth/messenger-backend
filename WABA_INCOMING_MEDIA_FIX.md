# 📥 WABA Incoming Media - Автоматическая загрузка на R2

## ✅ Проблема решена

Теперь когда клиент отправляет медиа-файлы через WABA (изображения, документы, видео, аудио), они автоматически:

1. **Скачиваются** с серверов WhatsApp
2. **Загружаются** на Cloudflare R2
3. **Сохраняются** в базу с публичным URL

---

## 🔄 Как это работает

### 1. Клиент отправляет медиа
```
Клиент → WhatsApp → WABA API → Webhook → Ваш сервер
```

### 2. Webhook получает данные
```json
{
  "type": "image",
  "image": {
    "id": "1234567890",
    "mime_type": "image/jpeg",
    "caption": "Смотри фото!"
  }
}
```

### 3. Автоматическая обработка
```typescript
// Шаг 1: Получаем media ID
const mediaId = message.image.id;

// Шаг 2: Скачиваем с WhatsApp
const wabaService = await createWABAService(orgPhone.id);
const mediaUrl = await wabaService.downloadAndUploadMedia(mediaId, mimeType);

// Шаг 3: Сохраняем в БД
await prisma.message.create({
  data: {
    mediaUrl: "https://r2.drawbridge.kz/media/waba_1738234567890_abc123.jpg",
    // ...
  }
});
```

### 4. Результат
Медиа доступно по публичному URL:
```
https://r2.drawbridge.kz/media/waba_1738234567890_abc123.jpg
```

---

## 📋 Поддерживаемые типы медиа

### ✅ Изображения (image)
- JPEG, PNG, GIF, WebP
- Автоматически скачиваются и загружаются на R2
- Поддерживаются подписи (captions)

### ✅ Документы (document)
- PDF, DOC, DOCX, XLS, XLSX, TXT, CSV
- Сохраняется оригинальное имя файла
- Поддерживаются подписи

### ✅ Видео (video)
- MP4, MPEG, WebM
- Автоматическая загрузка на R2
- Поддерживаются подписи

### ✅ Аудио (audio)
- MP3, OGG, WAV, AAC, M4A
- Голосовые сообщения и аудио-файлы

---

## 🔧 Техническая реализация

### wabaService.ts - Новый метод

```typescript
/**
 * Скачать медиа-файл из WhatsApp и загрузить на R2
 */
async downloadAndUploadMedia(mediaId: string, mimeType: string): Promise<string> {
  // 1. Получаем URL медиа
  const mediaInfoUrl = `${this.baseUrl}/${mediaId}`;
  const mediaInfoResponse = await axios.get(mediaInfoUrl, {
    headers: { 'Authorization': `Bearer ${this.config.accessToken}` }
  });

  // 2. Скачиваем файл
  const mediaResponse = await axios.get(mediaInfoResponse.data.url, {
    headers: { 'Authorization': `Bearer ${this.config.accessToken}` },
    responseType: 'arraybuffer'
  });

  // 3. Генерируем имя файла
  const buffer = Buffer.from(mediaResponse.data);
  const ext = this.getExtensionFromMimeType(mimeType);
  const filename = `waba_${Date.now()}_${random}${ext}`;

  // 4. Загружаем на R2
  const publicUrl = await saveMedia(buffer, filename, mimeType);
  
  return publicUrl;
}
```

### wabaController.ts - Обработка входящих медиа

```typescript
// Пример для изображений
if (message.type === 'image' && message.image?.id) {
  const wabaService = await createWABAService(orgPhone.id);
  if (wabaService) {
    try {
      mediaUrl = await wabaService.downloadAndUploadMedia(
        message.image.id,
        message.image.mime_type
      );
      logger.info(`✅ WABA: Изображение загружено на R2: ${mediaUrl}`);
    } catch (error) {
      logger.error('❌ WABA: Ошибка загрузки изображения:', error);
    }
  }
}
```

Аналогичная логика для:
- `message.type === 'document'` → `message.document.id`
- `message.type === 'video'` → `message.video.id`
- `message.type === 'audio'` → `message.audio.id`

---

## 📊 Логирование

### При получении медиа от клиента
```
📥 WABA: Получен URL медиа-файла: 1234567890
📦 WABA: Скачан файл размером 245678 байт
📤 [R2] Начало загрузки файла:
   - Bucket: messenger
   - Key: media/waba_1738234567890_abc123.jpg
   - Size: 245678 bytes
   - MimeType: image/jpeg
✅ [R2] Файл успешно загружен в R2
✅ WABA: Изображение загружено на R2: https://r2.drawbridge.kz/media/waba_1738234567890_abc123.jpg
💾 WABA: Message saved to DB (chatId: 123)
```

### При ошибке
```
❌ WABA: Ошибка скачивания/загрузки медиа: [error details]
```

---

## 🗃️ База данных

### Таблица messages
После обработки входящего медиа:

```sql
INSERT INTO "Message" (
  chatId,
  content,              -- "Смотри фото!" (caption)
  type,                 -- "image" | "document" | "video" | "audio"
  mediaUrl,             -- "https://r2.drawbridge.kz/media/waba_1738234567890_abc123.jpg"
  filename,             -- "document.pdf" (для документов)
  mimeType,             -- "image/jpeg"
  fromMe,               -- false
  status,               -- "received"
  timestamp,
  ...
)
```

---

## 🧪 Тестирование

### 1. Отправьте изображение клиенту
Клиент отправляет фото в WhatsApp

### 2. Проверьте логи
```bash
tail -f logs/app.log | grep WABA
```

Должны увидеть:
```
📥 WABA: Получен URL медиа-файла
✅ WABA: Изображение загружено на R2
💾 WABA: Message saved to DB
```

### 3. Проверьте базу данных
```sql
SELECT id, type, mediaUrl, content, timestamp
FROM "Message"
WHERE type IN ('image', 'document', 'video', 'audio')
ORDER BY timestamp DESC
LIMIT 10;
```

### 4. Проверьте URL
Откройте `mediaUrl` в браузере → файл должен загрузиться

---

## 🔐 Безопасность

### WABA Access Token
Используется для:
1. Получения информации о медиа-файле
2. Скачивания файла с серверов WhatsApp

```typescript
const mediaInfoResponse = await axios.get(mediaInfoUrl, {
  headers: {
    'Authorization': `Bearer ${this.config.accessToken}`
  }
});
```

### R2 Storage
- Файлы загружаются на публичный bucket
- Доступны по URL: `https://r2.drawbridge.kz/media/`
- Уникальные имена файлов предотвращают конфликты

---

## 📦 Формат имен файлов

```
waba_<timestamp>_<random>.<extension>
```

**Примеры:**
- `waba_1738234567890_abc123.jpg` - изображение
- `waba_1738234567891_def456.pdf` - документ
- `waba_1738234567892_ghi789.mp4` - видео
- `waba_1738234567893_jkl012.mp3` - аудио

**Префикс `waba_` указывает, что файл получен от клиента через WABA**

---

## 🎯 Результат

### До исправления ❌
```json
{
  "type": "image",
  "mediaUrl": null,  // ❌ Нет URL
  "content": "Смотри фото!"
}
```

### После исправления ✅
```json
{
  "type": "image",
  "mediaUrl": "https://r2.drawbridge.kz/media/waba_1738234567890_abc123.jpg",  // ✅ Есть URL
  "content": "Смотри фото!",
  "mimeType": "image/jpeg",
  "size": 245678
}
```

---

## 📄 Связанные изменения

### Файлы изменены:

1. **src/services/wabaService.ts**
   - Добавлен метод `downloadAndUploadMedia()`
   - Добавлен метод `getExtensionFromMimeType()`
   - Добавлен импорт `saveMedia` из `storageService`

2. **src/controllers/wabaController.ts**
   - Обновлена функция `handleIncomingMessage()`
   - Добавлена автоматическая загрузка для всех типов медиа
   - Улучшено логирование

---

## ✅ Готово!

Теперь все медиа-файлы от клиентов **автоматически загружаются на Cloudflare R2** и доступны по публичным URL! 🎉

**Никаких дополнительных действий не требуется** - всё работает из коробки.
