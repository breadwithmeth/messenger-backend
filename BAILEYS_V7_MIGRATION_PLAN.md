# План миграции на Baileys v7.0.0

## 🎯 Статус: НЕ ТРЕБУЕТСЯ СЕЙЧАС
Проект уже подготовлен к v7 благодаря использованию `remoteJidAlt` и `participantAlt`.

---

## 📋 Checklist для миграции (когда потребуется)

### 1. Конвертация в ESM ⚠️ КРИТИЧНО

#### Изменения в package.json
```json
{
  "type": "module",  // Было: "commonjs"
  "main": "dist/app.js",
  "exports": {
    ".": "./dist/app.js"
  },
  "scripts": {
    "start": "node dist/src/server.js",
    "dev": "tsx watch src/server.ts"  // Рекомендуется tsx для dev
  }
}
```

#### Изменения в tsconfig.json
```json
{
  "compilerOptions": {
    "module": "ESNext",           // Было: "commonjs"
    "moduleResolution": "bundler", // Или "node16"
    "esModuleInterop": true,
    "target": "ES2022"
  }
}
```

#### Замена всех require() на import
```typescript
// ❌ Старый код (CommonJS)
const express = require('express');
const { PrismaClient } = require('@prisma/client');

// ✅ Новый код (ESM)
import express from 'express';
import { PrismaClient } from '@prisma/client';
```

#### Расширения файлов в импортах
```typescript
// ❌ Старый код
import { baileys } from './config/baileys';

// ✅ Новый код (ESM требует расширения)
import { baileys } from './config/baileys.js';  // НЕ .ts!
```

#### __dirname и __filename в ESM
```typescript
// ❌ Старый код
const __dirname = path.dirname(__filename);

// ✅ Новый код
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

---

### 2. Обновление кода Baileys

#### Замена импорта
```typescript
// ❌ Старый код (v6 в CommonJS)
import makeWASocket from '@whiskeysockets/baileys';

// ✅ Новый код (v7 в ESM)
import makeWASocket from '@whiskeysockets/baileys';
// Больше не нужно .default!
```

#### Замена функций проверки JID
```typescript
// ❌ Старый код
import { isJidUser } from '@whiskeysockets/baileys';

// ✅ Новый код
import { isPnUser } from '@whiskeysockets/baileys';

// В коде:
if (isPnUser(jid)) {  // Вместо isJidUser
  // ...
}
```

#### Работа с LID маппингом
```typescript
// Новая функциональность в v7
const store = sock.signalRepository.lidMapping;

// Доступные методы:
// - storeLIDPNMapping(lid, pn)
// - storeLIDPNMappings(mappings)
// - getLIDForPN(pn)
// - getLIDsForPNs(pns)
// - getPNForLID(lid)

// Пример использования
const lid = await store.getLIDForPN('1234567890@s.whatsapp.net');
```

#### Событие lid-mapping.update
```typescript
// Добавить новый обработчик событий
sock.ev.on('lid-mapping.update', async (mapping) => {
  console.log('New LID mapping:', mapping);
  // Сохранить маппинг в БД если нужно
});
```

#### Protobuf изменения
```typescript
// ❌ Старый код
const msg = proto.Message.fromObject({ ... });

// ✅ Новый код
const msg = proto.Message.create({ ... });

// Для decode используйте decodeAndHydrate
import { decodeAndHydrate } from '@whiskeysockets/baileys';
```

---

### 3. Обновление схемы БД (опционально)

#### Добавить поля для LID
```prisma
model Message {
  id              Int      @id @default(autoincrement())
  remoteJid       String   // Основной JID
  remoteJidAlt    String?  // Альтернативный JID (уже есть!)
  participant     String?
  participantAlt  String?  // Альтернативный participant (уже есть!)
  
  // НОВОЕ: маппинг LID <-> PN
  senderLid       String?  // LID отправителя
  senderPn        String?  // Phone Number отправителя
  
  // ... остальные поля
}

// Новая таблица для хранения LID маппингов
model LidMapping {
  id        Int      @id @default(autoincrement())
  lid       String   @unique
  pn        String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([lid])
  @@index([pn])
}
```

#### Создать миграцию
```bash
npx prisma migrate dev --name add_lid_support
```

---

### 4. Изменения в src/config/baileys.ts

#### Обновить ensureChat
```typescript
async function ensureChat(
  remoteJid: string,
  organizationPhoneId: number,
  pushName?: string,
  remoteJidAlt?: string  // Уже используется!
) {
  // Нормализация JID с учетом LID
  const normalizedJid = jidNormalizedUser(remoteJid);
  const normalizedAlt = remoteJidAlt ? jidNormalizedUser(remoteJidAlt) : null;
  
  // Поиск по обоим JID (основному и альтернативному)
  let chat = await prisma.chat.findFirst({
    where: {
      organizationPhoneId,
      OR: [
        { remoteJid: normalizedJid },
        { remoteJid: normalizedAlt },
        { remoteJidAlt: normalizedJid },
        { remoteJidAlt: normalizedAlt }
      ]
    }
  });
  
  if (!chat) {
    chat = await prisma.chat.create({
      data: {
        remoteJid: normalizedJid,
        remoteJidAlt: normalizedAlt,
        displayName: pushName || normalizedJid,
        organizationPhoneId,
        receivingPhoneJid: normalizedJid
      }
    });
  }
  
  return chat;
}
```

#### Обработка нового события
```typescript
// В startBaileys() добавить:
sock.ev.on('lid-mapping.update', async (mapping) => {
  logger.info('LID mapping update:', mapping);
  
  // Опционально: сохранить в БД
  for (const [lid, pn] of Object.entries(mapping)) {
    await prisma.lidMapping.upsert({
      where: { lid },
      update: { pn, updatedAt: new Date() },
      create: { lid, pn }
    });
  }
});
```

---

### 5. Обновление Contact API

```typescript
// src/controllers/contactController.ts

// ❌ Старый код (v6)
export async function getContactProfile(req: Request, res: Response) {
  const contact = await sock.onWhatsApp(remoteJid);
  // contact.jid ...
}

// ✅ Новый код (v7)
export async function getContactProfile(req: Request, res: Response) {
  const contacts = await sock.onWhatsApp(remoteJid);
  
  // В v7 структура Contact изменилась:
  // - id: предпочитаемый ID (может быть LID или PN)
  // - phoneNumber: присутствует если id - это LID
  // - lid: присутствует если id - это PN
  
  const contact = contacts[0];
  const displayId = contact.id;  // Основной ID
  const altId = contact.lid || contact.phoneNumber;  // Альтернативный
  
  res.json({
    id: displayId,
    alternativeId: altId,
    exists: contact.exists
  });
}
```

---

### 6. Изменения в GroupMetadata

```typescript
// В v7 group metadata имеет новые поля
interface GroupMetadataV7 {
  owner: string;      // LID владельца
  ownerPn?: string;   // PN владельца (если известен)
  
  descOwner: string;  // LID автора описания
  descOwnerPn?: string;
  
  participants: Array<{
    id: string;          // Предпочитаемый ID
    phoneNumber?: string; // Если id - это LID
    lid?: string;         // Если id - это PN
    admin: 'admin' | 'superadmin' | null;
  }>;
}
```

---

### 7. Удаление ACK отправки

```typescript
// ❌ Старый код - больше не делать!
// await sock.sendReceipt(message.key.remoteJid, message.key.id, 'read');

// ✅ v7 - WhatsApp банит за отправку ACK
// Просто убрать все sendReceipt/sendAck вызовы
```

---

### 8. Обновление зависимостей

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "^7.0.0",  // Когда выйдет
    "@prisma/client": "^6.11.1",
    "express": "^5.1.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",  // Для ESM dev mode
    "@types/node": "^22.0.0",
    "typescript": "^5.8.3"
  }
}
```

---

### 9. Обновление Dockerfile

```dockerfile
# Dockerfile для ESM проекта

FROM node:20-alpine AS deps

WORKDIR /app

# Копировать package files
COPY package.json package-lock.json ./

# Установить зависимости
RUN npm ci --only=production && \
    npm cache clean --force

# Prisma generate
COPY prisma ./prisma/
RUN npx prisma generate

# ===== Builder Stage =====
FROM node:20-alpine AS builder

WORKDIR /app

# Копировать все для сборки
COPY . .
COPY --from=deps /app/node_modules ./node_modules

# Build TypeScript -> JavaScript (ESM)
RUN npm run build

# ===== Runner Stage =====
FROM node:20-alpine AS runner

WORKDIR /app

# Копировать зависимости и собранный код
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

# ESM требует NODE_OPTIONS для некоторых пакетов
ENV NODE_ENV=production
ENV NODE_OPTIONS="--experimental-specifier-resolution=node"

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
```

---

## 🧪 Тестирование после миграции

### 1. Unit тесты
```bash
npm test
```

### 2. Локальная сборка
```bash
npm run build
npm start
```

### 3. Docker сборка
```bash
docker build -t messenger-backend:v7 .
docker run -p 3000:3000 messenger-backend:v7
```

### 4. Проверка функциональности
- [ ] QR-код генерация
- [ ] Отправка текстовых сообщений
- [ ] Отправка медиа
- [ ] Получение сообщений с LID
- [ ] Профили контактов работают
- [ ] Групповые чаты
- [ ] LID маппинг сохраняется

---

## 📚 Дополнительные ресурсы

- [Baileys v7 Migration Guide](https://baileys.wiki/docs/migration/to-v7.0.0/)
- [Baileys GitHub Releases](https://github.com/WhiskeySockets/Baileys/releases/)
- [Node.js ESM Documentation](https://nodejs.org/api/esm.html)
- [TypeScript ESM Guide](https://www.typescriptlang.org/docs/handbook/esm-node.html)

---

## ⚠️ Внимание!

**НЕ МИГРИРОВАТЬ СЕЙЧАС**, пока:
1. Baileys v7.0.0 не станет стабильным в npm
2. Не появятся критичные фичи, которые вам нужны
3. Проект уже готов к миграции благодаря использованию alt-полей

**Рекомендация**: Оставаться на **Baileys 6.7.20** до официального релиза v7.0.0.
