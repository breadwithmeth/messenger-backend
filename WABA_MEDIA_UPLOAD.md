# API загрузки медиафайлов для WABA

## Описание

Эндпоинт `/api/media/upload-for-waba` позволяет загрузить медиафайлы на **Cloudflare R2** и получить публичный URL для использования в WABA API.

**🌐 Все файлы автоматически загружаются на Cloudflare R2:**
- Хранилище: `messenger` bucket
- Публичный URL: `https://r2.drawbridge.kz`
- Никакие файлы не сохраняются локально (за исключением режима разработки)

## Эндпоинт

```
POST /api/media/upload-for-waba
```

**Требуется авторизация:** Bearer Token (JWT)  
**Content-Type:** `multipart/form-data`

## Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `media` | File | Да | Медиафайл (форма multipart) |
| `mediaType` | string | Да | Тип медиа: `image`, `document`, `video`, `audio` |

## Ограничения

- **Максимальный размер файла:** 50 MB
- **Поддерживаемые типы:**
  - **image:** JPG, PNG, WebP
  - **document:** PDF, DOC, DOCX, XLS, XLSX, TXT
  - **video:** MP4, AVI, MOV
  - **audio:** MP3, WAV, OGG, M4A

## Ответ

### Успешный ответ (200 OK)

```json
{
  "success": true,
  "mediaUrl": "https://r2.drawbridge.kz/media/image_1738234567890_abc123.jpg",
  "fileName": "image_1738234567890_abc123.jpg",
  "mediaType": "image",
  "size": 245678,
  "mimeType": "image/jpeg",
  "metadata": {
    "uploadedAt": "2025-01-30T10:30:00.000Z",
    "storage": "r2"
  }
}
```

### Ошибки

- `400` - Некорректные параметры или неподдерживаемый тип файла
- `401` - Не авторизован
- `500` - Ошибка сервера при сохранении файла

## Примеры использования

### cURL (bash)

```bash
# Загрузка изображения
curl -X POST https://bm.drawbridge.kz/api/media/upload-for-waba \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "media=@/path/to/image.jpg" \
  -F "mediaType=image"

# Загрузка документа
curl -X POST https://bm.drawbridge.kz/api/media/upload-for-waba \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "media=@/path/to/document.pdf" \
  -F "mediaType=document"

# Загрузка видео
curl -X POST https://bm.drawbridge.kz/api/media/upload-for-waba \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "media=@/path/to/video.mp4" \
  -F "mediaType=video"

# Загрузка аудио
curl -X POST https://bm.drawbridge.kz/api/media/upload-for-waba \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "media=@/path/to/audio.mp3" \
  -F "mediaType=audio"
```

### JavaScript/TypeScript

```typescript
async function uploadMediaForWABA(
  file: File,
  mediaType: 'image' | 'document' | 'video' | 'audio',
  token: string
): Promise<string> {
  const formData = new FormData();
  formData.append('media', file);
  formData.append('mediaType', mediaType);

  const response = await fetch('https://bm.drawbridge.kz/api/media/upload-for-waba', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to upload media');
  }

  const result = await response.json();
  return result.mediaUrl; // Возвращаем URL для использования в WABA
}

// Пример использования
const file = document.getElementById('fileInput').files[0];
const token = localStorage.getItem('authToken');

try {
  const mediaUrl = await uploadMediaForWABA(file, 'image', token);
  console.log('Media URL:', mediaUrl);
  
  // Теперь можно использовать mediaUrl в WABA API
  await sendWABAMessage(chatId, 'image', { mediaUrl, caption: 'Фото' });
} catch (error) {
  console.error('Upload failed:', error);
}
```

### React Hook

```typescript
import { useState } from 'react';

export function useMediaUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadMedia = async (
    file: File,
    mediaType: 'image' | 'document' | 'video' | 'audio'
  ): Promise<string> => {
    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('media', file);
      formData.append('mediaType', mediaType);

      const token = localStorage.getItem('authToken');
      
      const xhr = new XMLHttpRequest();

      // Отслеживание прогресса
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          setProgress(percentComplete);
        }
      });

      const response = await new Promise<any>((resolve, reject) => {
        xhr.open('POST', '/api/media/upload-for-waba');
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(xhr.responseText));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });

      return response.mediaUrl;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return { uploadMedia, uploading, progress, error };
}

// Использование в компоненте
function MediaUploadComponent() {
  const { uploadMedia, uploading, progress, error } = useMediaUpload();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const mediaUrl = await uploadMedia(file, 'image');
      console.log('Uploaded:', mediaUrl);
      // Используйте mediaUrl для отправки через WABA
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  return (
    <div>
      <input
        type="file"
        onChange={handleFileSelect}
        disabled={uploading}
        accept="image/*"
      />
      {uploading && (
        <div>
          <progress value={progress} max="100" />
          <span>{progress.toFixed(0)}%</span>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

### Python

```python
import requests

def upload_media_for_waba(
    file_path: str,
    media_type: str,
    token: str
) -> str:
    """
    Загрузить медиафайл и получить URL для WABA
    
    Args:
        file_path: Путь к файлу
        media_type: Тип медиа ('image', 'document', 'video', 'audio')
        token: JWT токен авторизации
    
    Returns:
        str: URL загруженного файла
    """
    url = 'https://bm.drawbridge.kz/api/media/upload-for-waba'
    headers = {
        'Authorization': f'Bearer {token}'
    }
    
    with open(file_path, 'rb') as f:
        files = {'media': f}
        data = {'mediaType': media_type}
        
        response = requests.post(url, headers=headers, files=files, data=data)
        response.raise_for_status()
        
        result = response.json()
        return result['mediaUrl']

# Пример использования
token = 'your_jwt_token'

# Загрузка изображения
image_url = upload_media_for_waba('/path/to/image.jpg', 'image', token)
print(f'Image URL: {image_url}')

# Загрузка документа
doc_url = upload_media_for_waba('/path/to/document.pdf', 'document', token)
print(f'Document URL: {doc_url}')

# Теперь используйте URL в WABA API
send_waba_message(chat_id, 'image', {'mediaUrl': image_url, 'caption': 'Фото'})
```

## Полный workflow: загрузка и отправка

### JavaScript

```typescript
// 1. Загружаем файл на сервер
async function uploadAndSend(file: File, chatId: number, caption: string) {
  const token = localStorage.getItem('authToken');
  
  // Шаг 1: Загрузка файла
  const formData = new FormData();
  formData.append('media', file);
  formData.append('mediaType', 'image');

  const uploadResponse = await fetch('/api/media/upload-for-waba', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });

  const { mediaUrl } = await uploadResponse.json();

  // Шаг 2: Отправка через WABA
  const sendResponse = await fetch('/api/messages/send-by-chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chatId,
      type: 'image',
      mediaUrl,
      caption
    })
  });

  return sendResponse.json();
}

// Использование
const file = document.getElementById('fileInput').files[0];
const result = await uploadAndSend(file, 123, 'Смотри какое фото!');
console.log('Message sent:', result.messageId);
```

### React компонент с предпросмотром

```typescript
import { useState } from 'react';

function ImageUploadAndSend({ chatId }: { chatId: number }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    
    // Создаем предпросмотр
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleSend = async () => {
    if (!file) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');

      // 1. Загружаем файл
      const formData = new FormData();
      formData.append('media', file);
      formData.append('mediaType', 'image');

      const uploadRes = await fetch('/api/media/upload-for-waba', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      const { mediaUrl } = await uploadRes.json();

      // 2. Отправляем через WABA
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
          caption
        })
      });

      if (sendRes.ok) {
        // Успешно отправлено
        setFile(null);
        setPreview(null);
        setCaption('');
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        disabled={loading}
      />
      
      {preview && (
        <div>
          <img src={preview} alt="Preview" style={{ maxWidth: '300px' }} />
          <input
            type="text"
            placeholder="Добавить подпись..."
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <button onClick={handleSend} disabled={loading}>
            {loading ? 'Отправка...' : 'Отправить'}
          </button>
        </div>
      )}
    </div>
  );
}
```

## Сравнение с обычным `/api/media/upload`

| Особенность | `/api/media/upload` | `/api/media/upload-for-waba` |
|-------------|---------------------|------------------------------|
| Назначение | Общая загрузка медиа | Специально для WABA |
| Возвращает | `fileUrl`, `filePath`, `fileName` | `mediaUrl` (оптимизировано для WABA) |
| Метаданные | Минимальные | Расширенные (organizationId, uploadedAt) |
| Логирование | Общее | С префиксом [WABA] |

## Cloudflare R2 Storage

### Настройка

Все медиафайлы автоматически загружаются на **Cloudflare R2**. Настройка производится через переменные окружения:

```env
# Тип хранилища (r2/s3/local)
STORAGE_TYPE=r2

# Cloudflare R2 credentials
R2_ACCOUNT_ID=c83e6cf3f5ad60b7219f4e6ace3873a6
R2_ACCESS_KEY_ID=0213c9ffa418275d1d2615189500ca63
R2_SECRET_ACCESS_KEY=a1e2500b39bd58af4b48dfc7ca812c93a65743d65f15c9d2e3f96004ea586b8a
R2_BUCKET_NAME=messenger
R2_PUBLIC_URL=https://r2.drawbridge.kz
```

### Структура хранения

```
messenger bucket
└── media/
    ├── image_1738234567890_abc123.jpg
    ├── document_1738234567891_def456.pdf
    ├── video_1738234567892_ghi789.mp4
    └── audio_1738234567893_jkl012.mp3
```

### Публичный доступ

Все файлы доступны по URL:
```
https://r2.drawbridge.kz/media/<filename>
```

Пример:
```
https://r2.drawbridge.kz/media/image_1738234567890_abc123.jpg
```

### Логирование

При загрузке файла в R2:
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

### Переключение хранилищ

Для переключения на другое хранилище просто измените `.env`:

**Локальное хранилище (разработка):**
```env
STORAGE_TYPE=local
```

**Cloudflare R2 (продакшн):**
```env
STORAGE_TYPE=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=messenger
R2_PUBLIC_URL=https://r2.drawbridge.kz
```

**Amazon S3 (опционально):**
```env
STORAGE_TYPE=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=...
```

Никакого изменения кода не требуется!

## Полезные ссылки

- **R2_INTEGRATION_STATUS.md** - Полная документация по R2 интеграции
- **R2_SETUP_GUIDE.md** - Руководство по настройке R2
- **R2_CHEATSHEET.md** - Шпаргалка по R2

- [Универсальный API отправки сообщений](./UNIFIED_SEND_API.md)
- [Документация WABA](./WABA_OPERATOR_API.md)
- [Примеры WABA](./WABA_SEND_EXAMPLES.md)
