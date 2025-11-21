# 📨 Документация: Процесс обработки входящих сообщений

## Обзор

Этот документ описывает полный жизненный цикл входящего WhatsApp сообщения в вашей системе — от момента получения через Baileys до сохранения в базу данных и обновления состояния чата.

---

## 🔄 Поток обработки сообщения

```
WhatsApp → Baileys Socket → Event Handler → Обработка → База данных → Обновление чата
```

---

## 📋 Детальное описание процесса

### 1️⃣ **Получение события от WhatsApp**

**Файл:** `src/config/baileys.ts`  
**Обработчик:** `currentSock.ev.on('messages.upsert', ...)`  
**Строки:** 481-705

Когда приходит новое сообщение в WhatsApp:

```typescript
currentSock.ev.on('messages.upsert', async ({ messages, type }) => {
  if (type === 'notify') {
    // Обработка каждого сообщения
  }
});
```

**Что происходит:**
- Baileys получает событие `messages.upsert` от WhatsApp Web API
- Событие содержит массив сообщений и тип (`notify` для новых сообщений)
- Система обрабатывает только тип `notify` (игнорирует `append`, `prepend`)

---

### 2️⃣ **Фильтрация сообщений**

**Пропускаются следующие сообщения:**

#### ❌ Сообщения без контента
```typescript
if (!msg.message) {
    logger.info(`Пропущено сообщение без контента (ID: ${msg.key.id})`);
    continue;
}
```

#### ❌ Системные исходящие сообщения
```typescript
if (msg.key.fromMe && !msg.message.conversation && !msg.message.extendedTextMessage ...) {
    logger.info(`Пропущено исходящее системное сообщение`);
    continue;
}
```

#### ❌ Широковещательные и статусы
```typescript
if (isJidBroadcast(remoteJid) || remoteJid === 'status@broadcast') {
    logger.info(`Пропускаем широковещательное сообщение`);
    continue;
}
```

---

### 3️⃣ **Извлечение данных сообщения**

#### 📍 Идентификация отправителя

```typescript
// Поддержка Baileys v7 LID (Lid-Integrated Domain)
const rawRemote: string = (msg.key as any).remoteJidAlt ?? msg.key.remoteJid ?? '';
const remoteJid = jidNormalizedUser(rawRemote);

const rawParticipant: string = (msg.key as any).participantAlt ?? msg.key.participant ?? remoteJid;
const senderJid = jidNormalizedUser(msg.key.fromMe ? currentSock?.user?.id : rawParticipant);
```

**Переменные:**
- `remoteJid` - JID чата (пользователь или группа)
- `senderJid` - JID отправителя сообщения
- `msg.key.fromMe` - флаг, исходящее ли это сообщение

---

### 4️⃣ **Определение типа сообщения**

Система поддерживает следующие типы:

| Тип | Поле в `msg.message` | Извлекаемые данные |
|-----|---------------------|-------------------|
| **text** | `conversation` | Текст сообщения |
| **text** | `extendedTextMessage` | Текст + цитированное сообщение |
| **image** | `imageMessage` | Подпись, MIME, размер, файл |
| **video** | `videoMessage` | Подпись, MIME, размер |
| **document** | `documentMessage` | Имя файла, MIME, размер, файл |
| **audio** | `audioMessage` | MIME, размер, файл |
| **sticker** | `stickerMessage` | MIME, размер |
| **location** | `locationMessage` | Широта, долгота |
| **live_location** | `liveLocationMessage` | Координаты + последовательность |
| **contact** | `contactMessage` | vCard контакта |
| **contacts_array** | `contactsArrayMessage` | Массив контактов |
| **reaction** | `reactionMessage` | Emoji реакция на сообщение |
| **protocol** | `protocolMessage` | Системное сообщение |
| **call** | `call` | Информация о звонке |

#### Пример обработки текстового сообщения:

```typescript
if (messageContent?.conversation) {
    content = messageContent.conversation;
    messageType = "text";
} else if (messageContent?.extendedTextMessage) {
    content = messageContent.extendedTextMessage.text || undefined;
    messageType = "text";
    
    // Обработка ответа на сообщение
    const contextInfo = messageContent.extendedTextMessage.contextInfo;
    if (contextInfo?.quotedMessage) {
        quotedMessageId = contextInfo.stanzaId;
        quotedContent = contextInfo.quotedMessage.conversation || 
                        contextInfo.quotedMessage.extendedTextMessage?.text || 
                        '[Медиафайл]';
    }
}
```

#### Пример обработки медиафайла (изображение):

```typescript
if (messageContent?.imageMessage) {
    messageType = "image";
    content = messageContent.imageMessage.caption || undefined;
    mimeType = messageContent.imageMessage.mimetype;
    size = Number(messageContent.imageMessage.fileLength);
    
    // Скачивание и сохранение файла
    mediaUrl = await downloadAndSaveMedia(messageContent.imageMessage, 'image');
}
```

---

### 5️⃣ **Обработка временных меток**

```typescript
let timestampInSeconds: number;
const ts = msg.messageTimestamp;

if (typeof ts === 'number') {
    timestampInSeconds = ts;
} else if (ts && typeof ts === 'object' && typeof (ts as any).toNumber === 'function') {
    // Объект Long из Baileys
    timestampInSeconds = (ts as any).toNumber();
} else {
    // Fallback на текущее время
    timestampInSeconds = Math.floor(Date.now() / 1000);
}

const timestampDate = new Date(timestampInSeconds * 1000);
```

---

### 6️⃣ **Создание или поиск чата**

**Функция:** `ensureChat()`  
**Строки:** 91-220

```typescript
const chatId = await ensureChat(
    organizationId,
    organizationPhoneId,
    myJid,
    remoteJid,
    contactName
);
```

#### Логика работы `ensureChat`:

1. **Нормализация JID:**
   ```typescript
   const normalizedRemoteJid = jidNormalizedUser(remoteJid);
   let myJidNormalized = jidNormalizedUser(receivingPhoneJid);
   ```

2. **Поиск существующего чата:**
   ```typescript
   let chat = await prisma.chat.findUnique({
       where: {
           organizationId_receivingPhoneJid_remoteJid: {
               organizationId,
               receivingPhoneJid: myJidNormalized,
               remoteJid: normalizedRemoteJid,
           },
       },
   });
   ```

3. **Обновление чатов с пустым receivingPhoneJid (legacy):**
   ```typescript
   if (!chat) {
       const emptyChat = await prisma.chat.findFirst({
           where: {
               organizationId,
               remoteJid: normalizedRemoteJid,
               receivingPhoneJid: '',
           },
       });
       
       if (emptyChat && myJidNormalized) {
           chat = await prisma.chat.update({
               where: { id: emptyChat.id },
               data: {
                   receivingPhoneJid: myJidNormalized,
                   organizationPhoneId,
                   lastMessageAt: new Date(),
               },
           });
       }
   }
   ```

4. **Создание нового чата:**
   ```typescript
   if (!chat) {
       chat = await prisma.chat.create({
           data: {
               organizationId,
               receivingPhoneJid: myJidNormalized,
               remoteJid: normalizedRemoteJid,
               organizationPhoneId: organizationPhoneId,
               name: name || normalizedRemoteJid.split('@')[0],
               isGroup: isJidGroup(normalizedRemoteJid),
               lastMessageAt: new Date(),
               // Поля тикет-системы получают значения по умолчанию из схемы
               status: 'new',  // Новый тикет
               priority: 'medium',
               ticketNumber: null,  // Нужно добавить автогенерацию!
           },
       });
   }
   ```

---

### 7️⃣ **Сохранение сообщения в БД**

**Строки:** 644-667

```typescript
const savedMessage = await prisma.message.create({
    data: {
        chatId: chatId,
        organizationPhoneId: organizationPhoneId,
        receivingPhoneJid: myJid,
        remoteJid: remoteJid,
        whatsappMessageId: msg.key.id || `_temp_${Date.now()}_${Math.random()}`,
        senderJid: senderJid,
        fromMe: msg.key.fromMe || false,
        content: content || '',
        type: messageType,
        mediaUrl: mediaUrl,
        filename: filename,
        mimeType: mimeType,
        size: size,
        timestamp: timestampDate,
        status: 'received',
        organizationId: organizationId,
        
        // Статус прочтения
        isReadByOperator: msg.key.fromMe || false,  // Исходящие = прочитанные
        
        // Ответы на сообщения
        quotedMessageId: quotedMessageId,
        quotedContent: quotedContent,
    },
});
```

---

### 8️⃣ **Обновление счетчиков чата**

#### Для входящих сообщений (fromMe = false):

```typescript
if (!msg.key.fromMe) {
    await prisma.chat.update({
        where: { id: chatId },
        data: {
            unreadCount: {
                increment: 1,  // Увеличиваем счетчик непрочитанных
            },
            lastMessageAt: timestampDate,  // Обновляем время последнего сообщения
        },
    });
    logger.info(`📬 Увеличен счетчик непрочитанных для чата ${chatId}`);
}
```

#### Для исходящих сообщений (fromMe = true):

```typescript
else {
    await prisma.chat.update({
        where: { id: chatId },
        data: {
            lastMessageAt: timestampDate,  // Только обновляем время
        },
    });
}
```

---

### 9️⃣ **Логирование и завершение**

```typescript
logger.info(`💾 Сообщение (тип: ${messageType}, ID: ${savedMessage.id}) сохранено в БД (JID собеседника: ${remoteJid}, Ваш номер: ${phoneJid}, chatId: ${savedMessage.chatId}).`);
```

---

## 🔍 Важные детали

### Поддержка Baileys v7 (LID - Lid-Integrated Domain)

Система поддерживает альтернативные поля для JID, появившиеся в Baileys v7:

```typescript
const rawRemote: string = (msg.key as any).remoteJidAlt ?? msg.key.remoteJid ?? '';
const rawParticipant: string = (msg.key as any).participantAlt ?? msg.key.participant ?? remoteJid;
```

**Это обеспечивает:**
- Обратную совместимость с Baileys 6.x
- Готовность к миграции на Baileys 7.x
- Корректную работу с новыми JID форматами

---

### Скачивание медиафайлов

Функция `downloadAndSaveMedia()` (не показана в коде выше) отвечает за:

1. Скачивание медиа из WhatsApp через Baileys
2. Сохранение файла в `public/media/`
3. Возврат относительного URL для хранения в БД

**Типы медиа:**
- `image` → `public/media/images/`
- `video` → `public/media/videos/`
- `document` → `public/media/documents/`
- `audio` → `public/media/audio/`

---

### Обработка ответов на сообщения (Replies)

```typescript
const contextInfo = messageContent.extendedTextMessage.contextInfo;
if (contextInfo?.quotedMessage) {
    quotedMessageId = contextInfo.stanzaId;  // ID цитируемого сообщения
    quotedContent = contextInfo.quotedMessage.conversation ||  // Текст
                    contextInfo.quotedMessage.extendedTextMessage?.text ||
                    contextInfo.quotedMessage.imageMessage?.caption ||
                    '[Медиафайл]';
}
```

**В БД сохраняется:**
- `quotedMessageId` - ID сообщения, на которое ответили
- `quotedContent` - Содержимое цитируемого сообщения

---

## 🎯 Интеграция с тикет-системой

### Статус нового чата

Когда создается новый чат (первое сообщение от клиента):

```typescript
chat = await prisma.chat.create({
    data: {
        // ... другие поля ...
        status: 'new',        // Новый тикет
        priority: 'medium',   // Средний приоритет по умолчанию
        ticketNumber: null,   // ⚠️ ТРЕБУЕТСЯ АВТОГЕНЕРАЦИЯ!
    },
});
```

### ⚠️ TODO: Автогенерация номера тикета

**Текущая проблема:** При создании нового чата поле `ticketNumber` остается `null`.

**Требуется реализовать:**

```typescript
// В функции ensureChat, при создании нового чата:
const lastTicket = await prisma.chat.findFirst({
    where: { organizationId },
    orderBy: { ticketNumber: 'desc' },
    select: { ticketNumber: true },
});

const nextTicketNumber = (lastTicket?.ticketNumber || 0) + 1;

chat = await prisma.chat.create({
    data: {
        // ... существующие поля ...
        ticketNumber: nextTicketNumber,
        status: 'new',
        priority: 'medium',
    },
});
```

---

## 📊 Схема базы данных

### Таблица `Message`

```prisma
model Message {
  id                   Int       @id @default(autoincrement())
  chatId               Int
  organizationPhoneId  Int
  receivingPhoneJid    String
  remoteJid            String
  whatsappMessageId    String
  senderJid            String
  fromMe               Boolean   @default(false)
  content              String    @db.Text
  type                 String    // text, image, video, document, etc.
  mediaUrl             String?
  filename             String?
  mimeType             String?
  size                 Int?
  timestamp            DateTime
  status               String    @default("sent")
  organizationId       Int
  isReadByOperator     Boolean   @default(false)
  quotedMessageId      String?
  quotedContent        String?   @db.Text
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
}
```

### Таблица `Chat` (с полями тикет-системы)

```prisma
model Chat {
  id                   Int       @id @default(autoincrement())
  organizationId       Int
  receivingPhoneJid    String
  remoteJid            String    @unique
  organizationPhoneId  Int
  name                 String?
  isGroup              Boolean   @default(false)
  unreadCount          Int       @default(0)
  lastMessageAt        DateTime  @default(now())
  
  // Поля тикет-системы
  status               String    @default("new")
  priority             String    @default("medium")
  ticketNumber         Int?      @unique
  tags                 Json?
  category             String?
  subject              String?
  assignedUserId       Int?
  firstResponseAt      DateTime?
  resolvedAt           DateTime?
  closedAt             DateTime?
  closeReason          String?
  customerRating       Int?
  internalNotes        String?   @db.Text
  
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  
  @@unique([organizationId, receivingPhoneJid, remoteJid])
}
```

---

## 🔒 Обработка ошибок

```typescript
try {
    // ... вся логика обработки сообщения ...
} catch (error: any) {
    logger.error(`❌ Ошибка при сохранении сообщения в БД для JID ${remoteJid}`);
    
    if (error instanceof Error) {
        logger.error('Сообщение об ошибке:', error.message);
        logger.error('Stack trace:', error.stack);
        
        // Специальная обработка ошибок Prisma
        if ('code' in error && 'meta' in error) {
            logger.error(`Prisma Error Code: ${error.code}`);
            logger.error(`Meta:`, JSON.stringify(error.meta, null, 2));
        }
    }
}
```

**Важно:** Ошибка обработки одного сообщения не останавливает обработку других сообщений в массиве.

---

## 📝 Логи

### Примеры логов при получении сообщения:

```
[Message Upsert] Получено сообщение
  [text] Содержимое: "Привет!"
✅ Создан новый чат для JID: 77079861373@s.whatsapp.net (Ваш номер: 77717070766@s.whatsapp.net, Организация: 1, Phone ID: 4, ID чата: 295)
💾 Сообщение (тип: text, ID: 1234) сохранено в БД (JID собеседника: 77079861373@s.whatsapp.net, Ваш номер: 77717070766@s.whatsapp.net, chatId: 295)
📬 Увеличен счетчик непрочитанных для чата 295
```

---

## 🚀 Оптимизации

### Текущие оптимизации:

1. **Нормализация JID** - предотвращает дублирование чатов
2. **Уникальные индексы** - быстрый поиск чатов по комбинации полей
3. **Транзакции** - атомарность операций создания/обновления
4. **Обработка гонок** - catch блок для P2002 (unique constraint violation)

### Возможные улучшения:

1. **Батчинг сообщений** - группировать update операций для чатов
2. **Кеширование** - кешировать часто запрашиваемые чаты
3. **Асинхронная обработка медиа** - скачивание файлов в фоне через очередь
4. **Дедупликация** - проверка на повторные сообщения по `whatsappMessageId`

---

## 🔄 Жизненный цикл тикета

```
[new] → [open] → [in_progress] → [resolved] → [closed]
             ↓          ↓
           [pending] [waiting_customer]
```

**При получении нового сообщения:**

1. **Первое сообщение от клиента:**
   - Создается чат со статусом `new`
   - `unreadCount = 1`
   - `ticketNumber` должен быть присвоен автоматически

2. **Последующие сообщения:**
   - Увеличивается `unreadCount`
   - Обновляется `lastMessageAt`
   - Статус тикета НЕ изменяется автоматически

3. **Ответ оператора (fromMe = true):**
   - `unreadCount` НЕ изменяется
   - Обновляется `lastMessageAt`
   - Если `firstResponseAt` пуст → устанавливается текущее время

---

## 📚 Связанные документы

- **Тикет-система:** `TICKET_SYSTEM_DOCUMENTATION.md`
- **API для фронтенда:** `API_FRONTEND_GUIDE.md`
- **Миграция Baileys v7:** `BAILEYS_V7_MIGRATION_PLAN.md`
- **API документация:** `API_DOCUMENTATION.md`

---

## ⚙️ Переменные окружения

```env
PORT=4000
DATABASE_URL="postgresql://..."
CORS_ORIGINS="http://localhost:3000,https://yourdomain.com"
```

---

## 🐛 Известные проблемы и TODO

### ⚠️ Критичные:

1. **Автогенерация ticketNumber** - требуется реализация при создании чата
2. **Автоматическое назначение тикетов** - round-robin или на основе правил
3. **SLA мониторинг** - отслеживание времени первого ответа и решения

### 📋 Улучшения:

1. **Обработка редактирования сообщений** - WhatsApp позволяет редактировать
2. **Удаление сообщений** - обработка `protocolMessage` типа DELETE
3. **Групповые чаты** - расширенная обработка участников
4. **Вебхуки** - уведомления о новых сообщениях для интеграций

---

## 🎓 Заключение

Система обработки сообщений построена с учетом:
- ✅ Надежности (обработка ошибок, fallback значения)
- ✅ Масштабируемости (нормализация, индексы)
- ✅ Совместимости (поддержка Baileys v6 и v7)
- ✅ Расширяемости (тикет-система, медиафайлы, ответы)

**Следующий шаг:** Реализация автогенерации `ticketNumber` и автоматического назначения тикетов операторам.
