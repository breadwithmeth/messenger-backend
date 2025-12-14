# ✅ Telegram Media Support Added

## Что изменилось

Добавлена полная поддержка отправки медиа-файлов в Telegram через универсальный эндпоинт `/api/messages/send-by-chat`.

---

## 🎯 Теперь работает

### Telegram поддерживает:
- ✅ **text** - Текстовые сообщения
- ✅ **image** - Изображения (JPG, PNG, WebP)
- ✅ **document** - Документы (PDF, DOC, DOCX, etc)
- ✅ **video** - Видео (MP4, AVI, MOV)
- ✅ **audio** - Аудио (MP3, WAV, OGG, M4A)

---

## 📋 Примеры использования

### 1. Отправка изображения в Telegram

```bash
# Шаг 1: Загрузить изображение на R2
curl -X POST "http://localhost:3000/api/media/upload-for-waba" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "media=@photo.jpg" \
  -F "mediaType=image"

# Ответ: { "mediaUrl": "https://r2.drawbridge.kz/media/image_123.jpg" }

# Шаг 2: Отправить в Telegram чат
curl -X POST "http://localhost:3000/api/messages/send-by-chat" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 456,
    "type": "image",
    "mediaUrl": "https://r2.drawbridge.kz/media/image_123.jpg",
    "caption": "Смотри какое фото!"
  }'
```

### 2. Отправка документа в Telegram

```bash
curl -X POST "http://localhost:3000/api/messages/send-by-chat" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 456,
    "type": "document",
    "mediaUrl": "https://r2.drawbridge.kz/media/document_123.pdf",
    "filename": "report.pdf",
    "caption": "Ваш отчет за декабрь"
  }'
```

### 3. Отправка видео в Telegram

```bash
curl -X POST "http://localhost:3000/api/messages/send-by-chat" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 456,
    "type": "video",
    "mediaUrl": "https://r2.drawbridge.kz/media/video_123.mp4",
    "caption": "Обучающее видео"
  }'
```

### 4. Отправка аудио в Telegram

```bash
curl -X POST "http://localhost:3000/api/messages/send-by-chat" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": 456,
    "type": "audio",
    "mediaUrl": "https://r2.drawbridge.kz/media/audio_123.mp3"
  }'
```

---

## 🔧 Технические изменения

### 1. Новые функции в telegramService.ts

**Добавлено 4 новые функции:**
- `sendTelegramPhoto()` - Отправка изображений
- `sendTelegramDocument()` - Отправка документов
- `sendTelegramVideo()` - Отправка видео
- `sendTelegramAudio()` - Отправка аудио

### 2. Обновлен messageController.ts

**Функция `sendMessageByChat()` теперь:**
- Обрабатывает все типы медиа для Telegram
- Автоматически выбирает правильную функцию
- Сохраняет сообщения в БД с правильным типом
- Поддерживает `caption` и `text` как подписи

---

## 📊 Матрица поддержки

| Тип сообщения | Baileys | WABA | Telegram |
|--------------|---------|------|----------|
| text | ✅ | ✅ | ✅ |
| image | ❌ | ✅ | ✅ |
| document | ❌ | ✅ | ✅ |
| video | ❌ | ✅ | ✅ |
| audio | ❌ | ✅ | ✅ |
| template | ❌ | ✅ | ❌ |

---

## 🗃️ Сохранение в базе данных

Все отправленные медиа-сообщения сохраняются в таблицу `Message` с:

```sql
INSERT INTO "Message" (
  chatId,
  channel,              -- 'telegram'
  type,                 -- 'image' | 'document' | 'video' | 'audio'
  content,              -- caption/text
  mediaUrl,             -- 'https://r2.drawbridge.kz/media/...'
  filename,             -- для документов
  telegramMessageId,    -- ID сообщения в Telegram
  telegramChatId,       -- Chat ID в Telegram
  telegramBotId,        -- ID бота
  fromMe,               -- true
  status,               -- 'sent'
  senderUserId,         -- ID отправителя
  timestamp,
  ...
)
```

---

## 🧪 Тестирование

### JavaScript/TypeScript

```typescript
// Загрузка и отправка изображения
async function sendImageToTelegram(chatId: number, file: File) {
  const token = localStorage.getItem('authToken');

  // 1. Загружаем файл на R2
  const formData = new FormData();
  formData.append('media', file);
  formData.append('mediaType', 'image');

  const uploadRes = await fetch('/api/media/upload-for-waba', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });

  const { mediaUrl } = await uploadRes.json();

  // 2. Отправляем в Telegram
  const sendRes = await fetch('/api/messages/send-by-chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chatId,
      type: 'image',
      mediaUrl,
      caption: 'Смотри фото!'
    })
  });

  return sendRes.json();
}
```

### React Hook

```typescript
import { useState } from 'react';

export function useTelegramMedia() {
  const [uploading, setUploading] = useState(false);

  const sendMedia = async (
    chatId: number,
    file: File,
    type: 'image' | 'document' | 'video' | 'audio',
    caption?: string
  ) => {
    setUploading(true);
    try {
      const token = localStorage.getItem('authToken');

      // Загрузка на R2
      const formData = new FormData();
      formData.append('media', file);
      formData.append('mediaType', type);

      const uploadRes = await fetch('/api/media/upload-for-waba', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      const { mediaUrl } = await uploadRes.json();

      // Отправка в Telegram
      const sendRes = await fetch('/api/messages/send-by-chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chatId,
          type,
          mediaUrl,
          caption
        })
      });

      return sendRes.json();
    } finally {
      setUploading(false);
    }
  };

  return { sendMedia, uploading };
}
```

---

## 🔄 Workflow: Загрузка и отправка

```
┌─────────────┐
│   Client    │
│  (Upload)   │
└──────┬──────┘
       │
       │ POST /api/media/upload-for-waba
       │ multipart/form-data
       │
       ▼
┌─────────────────────┐
│  Media Controller   │
│ (Upload to R2)      │
└──────┬──────────────┘
       │
       │ Returns: { mediaUrl }
       │
       ▼
┌─────────────────────┐
│   Client            │
│  (Send message)     │
└──────┬──────────────┘
       │
       │ POST /api/messages/send-by-chat
       │ { chatId, type, mediaUrl }
       │
       ▼
┌─────────────────────┐
│  Message Controller │
│ (Detect channel)    │
└──────┬──────────────┘
       │
       │ channel === 'telegram'
       │
       ▼
┌─────────────────────┐
│  Telegram Service   │
│ sendTelegramPhoto() │
└──────┬──────────────┘
       │
       │ telegram.sendPhoto()
       │
       ▼
┌─────────────────────┐
│   Telegram API      │
│  (Message sent)     │
└─────────────────────┘
```

---

## 📖 Документация обновлена

- ✅ **UNIFIED_SEND_API.md** - Добавлены примеры для Telegram медиа
- ✅ **TELEGRAM_MEDIA_SUPPORT.md** - Это руководство

---

## ✅ Готово к использованию!

Теперь можно отправлять любые медиа-файлы в Telegram через единый API! 🎉

**Никаких дополнительных действий не требуется** - просто используйте:
1. `/api/media/upload-for-waba` для загрузки файла на R2
2. `/api/messages/send-by-chat` для отправки в любой канал (WhatsApp или Telegram)

**Один API для всех каналов!** 🚀
