# Messenger Backend - Система назначения чатов и медиафайлов

## Новые возможности

### 🎯 Система назначения чатов операторам
- Назначение чатов конкретным операторам
- Управление статусом чатов (открыт, закрыт, в ожидании)
- Установка приоритета чатов (низкий, обычный, высокий, срочный)
- Получение списка назначенных/неназначенных чатов

### 📬 Управление непрочитанными сообщениями
- Отметка сообщений как прочитанные
- Подсчет непрочитанных сообщений по чатам
- Статистика непрочитанных для организации и оператора
- Автоматическое обновление счетчиков при получении новых сообщений

### 📎 Отправка медиафайлов
- Загрузка и отправка изображений, видео, документов, аудио
- Валидация типов и размеров файлов
- Сохранение медиафайлов на сервере
- Поддержка URL и локальных файлов

## Основные эндпоинты

### Назначение чатов
```
POST   /api/chat-assignment/:chatId/assign     - Назначить чат оператору
DELETE /api/chat-assignment/:chatId/unassign   - Снять назначение
GET    /api/chat-assignment/assigned           - Получить назначенные чаты
GET    /api/chat-assignment/unassigned         - Получить неназначенные чаты
POST   /api/chat-assignment/:chatId/close      - Закрыть чат
```

### Непрочитанные сообщения
```
POST /api/unread/:chatId/mark-read            - Отметить сообщения как прочитанные
POST /api/unread/:chatId/mark-chat-read       - Отметить весь чат как прочитанный
GET  /api/unread/counts                       - Статистика непрочитанных
GET  /api/unread/chats                        - Чаты с непрочитанными сообщениями
```

### Медиафайлы
```
POST /api/media/send                          - Загрузить и отправить медиафайл
POST /api/media/upload                        - Просто загрузить медиафайл
```

### Обновленные эндпоинты
```
GET /api/chats?status=open&assigned=true      - Список чатов с фильтрацией
GET /api/chats/:chatId/messages               - Сообщения с информацией об отправителе
```

## Схема базы данных

### Новые поля в модели Chat
```prisma
assignedUserId    Int?           // ID назначенного оператора
assignedUser      User?          // Связь с оператором
assignedAt        DateTime?      // Время назначения
status            String         // open, closed, pending
priority          String         // low, normal, high, urgent  
unreadCount       Int            // Количество непрочитанных сообщений
```

### Новые поля в модели Message
```prisma
isReadByOperator  Boolean        // Прочитано ли оператором
readAt            DateTime?      // Время прочтения
senderUserId      Int?           // ID пользователя-отправителя
senderUser        User?          // Связь с пользователем
```

## Примеры использования

### Назначение чата оператору
```javascript
const response = await fetch('/api/chat-assignment/1/assign', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    operatorId: 2
  })
});
```

### Отправка изображения
```javascript
const formData = new FormData();
formData.append('media', imageFile);
formData.append('organizationPhoneId', '1');
formData.append('receiverJid', '79001234567@s.whatsapp.net');
formData.append('mediaType', 'image');
formData.append('caption', 'Описание изображения');

const response = await fetch('/api/media/send', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token
  },
  body: formData
});
```

### Отметка сообщений как прочитанные
```javascript
const response = await fetch('/api/unread/1/mark-read', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    messageIds: [1, 2, 3] // Опционально
  })
});
```

## Запуск проекта

1. Установите зависимости:
```bash
npm install
```

2. Соберите проект:
```bash
npm run build
```

3. Запустите сервер:
```bash
npm start
```

## Структура файлов медиа

Медиафайлы сохраняются в структуре:
```
public/
  media/
    image/      - Изображения
    video/      - Видеофайлы  
    document/   - Документы
    audio/      - Аудиофайлы
```

Доступ к файлам: `http://server/media/image/filename.jpg`

Подробная документация API находится в файле `API_DOCUMENTATION.md`.
