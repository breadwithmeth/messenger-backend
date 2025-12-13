# 🚀 Quick Start: Cloudflare R2 Integration

## ✅ Статус: Готово к использованию

Интеграция с Cloudflare R2 **полностью настроена и работает**. Все медиафайлы автоматически загружаются на R2.

---

## 📋 Чеклист

- ✅ `@aws-sdk/client-s3` установлен
- ✅ `@aws-sdk/s3-request-presigner` установлен
- ✅ `storageService.ts` реализован
- ✅ `.env` настроен с R2 credentials
- ✅ `STORAGE_TYPE=r2` активирован
- ✅ Публичный домен настроен: `https://r2.drawbridge.kz`

---

## 🔧 Конфигурация (.env)

```env
STORAGE_TYPE=r2
R2_ACCOUNT_ID=c83e6cf3f5ad60b7219f4e6ace3873a6
R2_ACCESS_KEY_ID=0213c9ffa418275d1d2615189500ca63
R2_SECRET_ACCESS_KEY=a1e2500b39bd58af4b48dfc7ca812c93a65743d65f15c9d2e3f96004ea586b8a
R2_BUCKET_NAME=messenger
R2_PUBLIC_URL=https://r2.drawbridge.kz
```

---

## 🧪 Быстрый тест

### 1. Загрузка файла
```bash
curl -X POST "http://localhost:3000/api/media/upload-for-waba" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "media=@photo.jpg" \
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
  "mimeType": "image/jpeg"
}
```

### 3. Проверка доступности
```bash
curl -I "https://r2.drawbridge.kz/media/image_1738234567890_abc123.jpg"
```

Должно вернуть `HTTP/1.1 200 OK`

---

## 📝 Использование в коде

### TypeScript (Backend)
```typescript
import { saveUploadedMedia } from './services/mediaService';

const result = await saveUploadedMedia(
  fileBuffer,
  originalName,
  mimeType,
  'image'
);

console.log(result.url); 
// → https://r2.drawbridge.kz/media/image_1738234567890_abc123.jpg
```

### JavaScript (Frontend)
```javascript
const formData = new FormData();
formData.append('media', file);
formData.append('mediaType', 'image');

const response = await fetch('/api/media/upload-for-waba', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

const data = await response.json();
console.log(data.mediaUrl);
// → https://r2.drawbridge.kz/media/image_1738234567890_abc123.jpg
```

---

## 🔄 Как это работает

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
│ (Express Multer)    │
└──────┬──────────────┘
       │
       │ saveUploadedMedia()
       │
       ▼
┌─────────────────────┐
│  Media Service      │
│ (Generate filename) │
└──────┬──────────────┘
       │
       │ saveMedia()
       │
       ▼
┌─────────────────────┐
│  Storage Service    │
│ (Switch by type)    │
└──────┬──────────────┘
       │
       │ STORAGE_TYPE=r2
       │
       ▼
┌─────────────────────┐
│   Cloudflare R2     │
│  (S3-compatible)    │
└──────┬──────────────┘
       │
       │ PutObjectCommand
       │
       ▼
┌─────────────────────┐
│  Public URL         │
│ r2.drawbridge.kz    │
└─────────────────────┘
```

---

## 📂 Структура файлов

```
messenger-backend/
├── .env                        # ✅ R2 credentials
├── src/
│   ├── services/
│   │   ├── storageService.ts   # ✅ R2 upload logic
│   │   └── mediaService.ts     # ✅ Media processing
│   ├── controllers/
│   │   └── mediaController.ts  # ✅ Upload endpoint
│   └── routes/
│       └── mediaRoutes.ts      # ✅ POST /api/media/upload-for-waba
└── package.json                # ✅ @aws-sdk/client-s3
```

---

## 🧪 Тестовые скрипты

### test-r2-integration.sh
Полный интеграционный тест:
- Загрузка файла на R2
- Проверка публичного URL
- Отправка в WABA

```bash
./test-r2-integration.sh
```

### test-waba-media-upload.sh
Тестирование endpoint загрузки:

```bash
./test-waba-media-upload.sh
```

---

## 📖 Полная документация

| Файл | Описание |
|------|----------|
| `R2_INTEGRATION_STATUS.md` | Полный статус R2 интеграции |
| `WABA_MEDIA_UPLOAD.md` | API загрузки медиа + R2 |
| `R2_SETUP_GUIDE.md` | Руководство по настройке R2 |
| `R2_CHEATSHEET.md` | Шпаргалка по R2 |

---

## 🐛 Troubleshooting

### Файлы не загружаются на R2
1. Проверьте `.env`:
   ```bash
   grep STORAGE_TYPE .env
   grep R2_ .env
   ```

2. Проверьте логи при запуске:
   ```
   🗄️  [Storage] Инициализация Storage Service:
      - STORAGE_TYPE: r2
      - R2 Bucket: messenger
   ```

### Файлы загружаются, но недоступны
1. Проверьте `R2_PUBLIC_URL`:
   ```env
   R2_PUBLIC_URL=https://r2.drawbridge.kz
   ```

2. Убедитесь, что bucket настроен как публичный в Cloudflare

### Ошибка "R2 client not initialized"
1. Проверьте, что `STORAGE_TYPE=r2`
2. Перезапустите сервер после изменения `.env`

---

## ✅ Что дальше?

**Ничего!** Система готова к использованию.

Просто используйте:
- `POST /api/media/upload-for-waba` для загрузки
- `POST /api/messages/send-by-chat` для отправки

Все файлы автоматически сохраняются на R2!

---

## 🎯 Итог

- ✅ R2 интеграция **работает**
- ✅ Конфигурация **настроена**
- ✅ Публичные URL **генерируются**
- ✅ API endpoints **готовы**
- ✅ Тестовые скрипты **созданы**
- ✅ Документация **обновлена**

**Готово к продакшн! 🚀**
