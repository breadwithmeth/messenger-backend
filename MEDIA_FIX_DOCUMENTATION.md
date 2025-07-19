# Исправление проблемы с сохранением медиафайлов в базе данных

## Проблема
При отправке медиафайлов через API `/api/media/send` записи о сообщениях не создавались в базе данных.

## Причина проблемы
Функция `sendMessage` в файле `src/config/baileys.ts` не получала информацию о сохраненном медиафайле из контроллера. В результате поля `mediaUrl`, `filename`, и `size` оставались пустыми или неопределенными.

## Решение

### 1. Обновлена сигнатура функции `sendMessage`
Добавлен новый опциональный параметр `mediaInfo` для передачи информации о медиафайле:

```typescript
export async function sendMessage(
  sock: WASocket,
  jid: string,
  content: AnyMessageContent,
  organizationId: number,
  organizationPhoneId: number,
  senderJid: string,
  userId?: number,
  mediaInfo?: {
    mediaUrl?: string;
    filename?: string;
    size?: number;
  }
)
```

### 2. Обновлен контроллер медиафайлов
В методе `uploadAndSendMedia` теперь передается информация о сохраненном файле:

```typescript
const sentMessage = await sendMessage(
  sock,
  normalizedReceiverJid,
  messageContent,
  organizationId,
  organizationPhoneId,
  senderJid,
  userId,
  {
    mediaUrl: savedMedia.url,
    filename: file.originalname,
    size: savedMedia.size
  }
);
```

### 3. Улучшена логика сохранения в базе данных
Функция `sendMessage` теперь использует переданную информацию о медиафайле при создании записи в таблице `Message`:

```typescript
let mediaUrl: string | undefined = mediaInfo?.mediaUrl;
let filename: string | undefined = mediaInfo?.filename;
let size: number | undefined = mediaInfo?.size;
```

## Результат
Теперь при отправке медиафайлов:
1. Файл сохраняется на диск с уникальным именем
2. Медиафайл отправляется через WhatsApp
3. В базе данных создается запись со всей информацией о файле:
   - `mediaUrl` - URL для доступа к файлу
   - `filename` - оригинальное имя файла
   - `size` - размер файла в байтах
   - `type` - тип медиафайла (image, video, document, audio)
   - `mimeType` - MIME тип файла

## Тестирование
Используйте следующую команду curl для тестирования:

```bash
curl -X POST http://localhost:3000/api/media/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "media=@path/to/your/file.jpg" \
  -F "chatId=CHAT_ID" \
  -F "mediaType=image" \
  -F "caption=Тестовое изображение"
```

Замените:
- `YOUR_JWT_TOKEN` на ваш реальный JWT токен
- `path/to/your/file.jpg` на путь к тестовому файлу
- `CHAT_ID` на реальный ID чата из вашей базы данных

После отправки проверьте таблицу `Message` в базе данных - должна появиться новая запись с заполненными полями медиафайла.
