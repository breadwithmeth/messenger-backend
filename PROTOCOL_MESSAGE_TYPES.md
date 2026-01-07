# WhatsApp Protocol Message Types (Baileys)

Это полный справочник типов системных сообщений (`protocolMessage.type`) в Baileys WhatsApp библиотеке.

## Типы системных сообщений (Enum Type)

| № | Название | Значение | Описание |
|---|----------|----------|---------|
| 0 | `REVOKE` | REVOKE | Отозвание сообщения (удаление сообщения для всех участников) |
| 3 | `EPHEMERAL_SETTING` | EPHEMERAL_SETTING | Установка параметров самоудаляющихся сообщений (исчезающие сообщения) |
| **4** | **`EPHEMERAL_SYNC_RESPONSE`** | **EPHEMERAL_SYNC_RESPONSE** | **Синхронизация статуса самоудаляющихся сообщений - ответ** |
| 5 | `HISTORY_SYNC_NOTIFICATION` | HISTORY_SYNC_NOTIFICATION | Уведомление синхронизации истории чата |
| 6 | `APP_STATE_SYNC_KEY_SHARE` | APP_STATE_SYNC_KEY_SHARE | Обмен ключом синхронизации состояния приложения |
| 7 | `APP_STATE_SYNC_KEY_REQUEST` | APP_STATE_SYNC_KEY_REQUEST | Запрос ключа синхронизации состояния приложения |
| 8 | `MSG_FANOUT_BACKFILL_REQUEST` | MSG_FANOUT_BACKFILL_REQUEST | Запрос восстановления предыдущих сообщений |
| 9 | `INITIAL_SECURITY_NOTIFICATION_SETTING_SYNC` | INITIAL_SECURITY_NOTIFICATION_SETTING_SYNC | Начальная синхронизация параметров уведомлений безопасности |
| 10 | `APP_STATE_FATAL_EXCEPTION_NOTIFICATION` | APP_STATE_FATAL_EXCEPTION_NOTIFICATION | Уведомление о критической ошибке состояния приложения |
| 11 | `SHARE_PHONE_NUMBER` | SHARE_PHONE_NUMBER | Обмен номером телефона |
| 14 | `MESSAGE_EDIT` | MESSAGE_EDIT | Редактирование сообщения |
| 16 | `PEER_DATA_OPERATION_REQUEST_MESSAGE` | PEER_DATA_OPERATION_REQUEST_MESSAGE | Запрос операции с данными контакта |
| 17 | `PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE` | PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE | Ответ на запрос операции с данными контакта |
| 18 | `REQUEST_WELCOME_MESSAGE` | REQUEST_WELCOME_MESSAGE | Запрос приветственного сообщения |
| 19 | `BOT_FEEDBACK_MESSAGE` | BOT_FEEDBACK_MESSAGE | Сообщение обратной связи бота |
| 20 | `MEDIA_NOTIFY_MESSAGE` | MEDIA_NOTIFY_MESSAGE | Уведомление о медиа контенте |
| 21 | `CLOUD_API_THREAD_CONTROL_NOTIFICATION` | CLOUD_API_THREAD_CONTROL_NOTIFICATION | Уведомление управления потоком Cloud API |
| 22 | `LID_MIGRATION_MAPPING_SYNC` | LID_MIGRATION_MAPPING_SYNC | Синхронизация маппинга при миграции LID |
| 23 | `REMINDER_MESSAGE` | REMINDER_MESSAGE | Сообщение-напоминание |
| 24 | `BOT_MEMU_ONBOARDING_MESSAGE` | BOT_MEMU_ONBOARDING_MESSAGE | Сообщение подключения бота MEMU |
| 25 | `STATUS_MENTION_MESSAGE` | STATUS_MENTION_MESSAGE | Упоминание в статусе |
| 26 | `STOP_GENERATION_MESSAGE` | STOP_GENERATION_MESSAGE | Остановка генерации сообщения |
| 27 | `LIMIT_SHARING` | LIMIT_SHARING | Ограничение совместного доступа |
| 28 | `AI_PSI_METADATA` | AI_PSI_METADATA | Метаданные AI PSI |
| 29 | `AI_QUERY_FANOUT` | AI_QUERY_FANOUT | AI запрос рассылки |
| 30 | `GROUP_MEMBER_LABEL_CHANGE` | GROUP_MEMBER_LABEL_CHANGE | Изменение метки участника группы |

## Что такое системное сообщение 4 (EPHEMERAL_SYNC_RESPONSE)?

**Тип 4 - `EPHEMERAL_SYNC_RESPONSE`** (Синхронизация статуса самоудаляющихся сообщений - ответ)

### Описание
Это протокольное сообщение используется в WhatsApp для синхронизации статуса функции самоудаляющихся сообщений между устройствами пользователя. Когда пользователь включает или отключает функцию самоудаляющихся сообщений на одном устройстве, все остальные его устройства получают это сообщение для синхронизации этого параметра.

### Когда отправляется?
- Когда пользователь включает или отключает самоудаляющиеся сообщения для чата или контакта
- Как ответ на `EPHEMERAL_SETTING` (тип 3) для синхронизации состояния между устройствами
- Для синхронизации таймера исчезновения сообщений

### Поля в сообщении
Согласно proto-структуре Baileys, сообщение содержит:
- `key` - информация о ключе сообщения
- `type` - тип протокольного сообщения (в данном случае 4)
- `ephemeralExpiration` - время, через которое сообщение будет удалено (в секундах)
- `ephemeralSettingTimestamp` - временная метка параметра самоудаления

### Обработка в приложении
В текущей реализации (baileys.ts):
```typescript
if (messageContent.protocolMessage) {
  content = `Системное сообщение (тип: ${messageContent.protocolMessage.type})`
  type = 'protocol'
}
```

### Рекомендации
Если требуется специальная обработка типа 4:
1. Можно извлечь время автоудаления из `ephemeralExpiration`
2. Использовать для синхронизации настроек между устройствами
3. Обновлять настройки чата в базе данных

## Примеры использования в Baileys

```typescript
// Обработка протокольного сообщения типа 4
if (msg.message?.protocolMessage) {
  const protocolMsg = msg.message.protocolMessage;
  
  if (protocolMsg.type === 4) { // EPHEMERAL_SYNC_RESPONSE
    console.log('Синхронизация самоудаляющихся сообщений');
    console.log('Время исчезновения:', protocolMsg.ephemeralExpiration);
    console.log('Временная метка:', protocolMsg.ephemeralSettingTimestamp);
  }
}
```

## Исходные ссылки
- Файл определения: `node_modules/@whiskeysockets/baileys/WAProto/index.d.ts`
- Строки определения: 32805-32835
- Библиотека: @whiskeysockets/baileys
