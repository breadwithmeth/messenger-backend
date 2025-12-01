# Cloudflare R2 - Шпаргалка

## ⚡ Быстрая установка (5 минут)

### 1. Установка
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### 2. Создание bucket
```
https://dash.cloudflare.com
→ R2 Object Storage
→ Create bucket
→ Имя: messenger-media
```

### 3. API токены
```
R2 → Manage R2 API Tokens
→ Create API Token
→ Permissions: Object Read & Write
→ Скопируйте: Access Key ID + Secret
```

### 4. .env
```env
STORAGE_TYPE=r2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_key
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET_NAME=messenger-media
R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
```

### 5. Готово! 🎉
```bash
npm run build
npm start
```

---

## 📊 Сравнение хранилищ

| Функция | Локально | R2 | S3 |
|---------|----------|----|----|
| **Стоимость хранения** | Бесплатно | $0.015/GB | $0.023/GB |
| **Исходящий трафик** | Бесплатно | **$0** | $0.09/GB |
| **Бесплатный план** | ∞ | 10 GB | 5 GB |
| **CDN** | ❌ | ✅ | Платно |
| **Масштабирование** | ❌ | ✅ | ✅ |
| **Резервное копирование** | Ручное | Автомат | Автомат |

---

## 💰 Экономия на R2

### Пример: 1000 пользователей

**Данные:**
- 20 GB хранилища
- 500 GB трафика/месяц

**Cloudflare R2:**
```
Хранение: 20 GB × $0.015 = $0.30
Трафик:   500 GB × $0    = $0.00
-----------------------------------
ИТОГО:    $0.30/месяц
```

**Amazon S3:**
```
Хранение: 20 GB × $0.023 = $0.46
Трафик:   500 GB × $0.09 = $45.00
-----------------------------------
ИТОГО:    $45.46/месяц
```

**💸 Экономия: $45.16/месяц (99.3%)**

---

## 🔧 Основные операции

### Загрузка файла
```typescript
import { saveMedia } from './services/storageService';

const url = await saveMedia(buffer, 'file.pdf', 'application/pdf');
// → https://pub-xxxxx.r2.dev/media/1701234567-123456789.pdf
```

### Удаление файла
```typescript
import { deleteMedia } from './services/storageService';

await deleteMedia('/media/1701234567-123456789.pdf');
```

### Проверка существования
```typescript
import { mediaExists } from './services/storageService';

const exists = await mediaExists('/media/file.pdf');
```

### Подписанный URL (приватный bucket)
```typescript
import { getSignedMediaUrl } from './services/storageService';

const signedUrl = await getSignedMediaUrl('/media/file.pdf', 3600);
// Истекает через 3600 секунд (1 час)
```

---

## 🌐 Публичный доступ

### Вариант 1: R2.dev subdomain
```
R2 → Settings → Public Access → Allow
→ https://pub-xxxxxxxxxxxxx.r2.dev
```

### Вариант 2: Custom domain
```
R2 → Settings → Custom Domains → Connect
→ media.yourdomain.com
→ https://media.yourdomain.com
```

---

## 📝 CORS настройка

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

Добавьте в: **R2 → Bucket → Settings → CORS Policy**

---

## 🔄 Миграция с локального хранилища

```bash
# Создайте скрипт
node scripts/migrate-to-r2.js

# Или используйте готовый сервис
import { saveMedia } from './services/storageService';
# Автоматически загрузит в R2 при STORAGE_TYPE=r2
```

---

## ❓ FAQ

**Q: Сколько стоит R2?**
A: 10 GB бесплатно, далее $0.015/GB/месяц

**Q: Есть ли плата за трафик?**
A: Нет! Исходящий трафик бесплатный

**Q: Совместим ли с S3?**
A: Да, 100% S3-совместимый API

**Q: Нужен ли CloudFlare Workers?**
A: Нет, можно использовать напрямую

**Q: Можно ли вернуться на локальное?**
A: Да, измените `STORAGE_TYPE=local`

---

## 📚 Полная документация

- **Детальная настройка:** [`R2_SETUP_GUIDE.md`](./R2_SETUP_GUIDE.md)
- **Сравнение хранилищ:** [`MEDIA_STORAGE_GUIDE.md`](./MEDIA_STORAGE_GUIDE.md)
- **Cloudflare R2 Docs:** https://developers.cloudflare.com/r2/

---

## ✅ Checklist

- [ ] Установлены пакеты `@aws-sdk/client-s3` и `@aws-sdk/s3-request-presigner`
- [ ] Создан bucket в Cloudflare R2
- [ ] Получены API токены (Access Key + Secret)
- [ ] Найден Account ID
- [ ] Настроен публичный доступ (опционально)
- [ ] Обновлен `.env` файл
- [ ] Перезапущен сервер
- [ ] Протестирована загрузка файла

---

**🎉 Готово! Все медиафайлы теперь в облаке!**
