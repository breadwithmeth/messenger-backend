# Настройка Bitrix24 (сторона Bitrix) для интеграции с Messenger Backend

Этот документ описывает, что нужно сделать именно в Bitrix24, чтобы заработала двусторонняя синхронизация чатов через Open Lines.

## 1. Что подготовить заранее

Перед настройкой в Bitrix убедитесь, что у вас есть:

- публичный URL backend (HTTPS), например `https://api.example.com`
- доступ администратора в Bitrix24
- значения из backend `.env`:
- `BITRIX_DOMAIN`
- `BITRIX_TOKEN`
- `BITRIX_LINE_ID`
- `BITRIX_CONNECTOR_CODE`
- `BITRIX_CLIENT_ID`
- `BITRIX_CLIENT_SECRET`
- `BITRIX_REDIRECT_URI`

Роуты backend, которые будут использоваться из Bitrix:

- `GET /integrations/bitrix/connect`
- `GET /integrations/bitrix/oauth/callback`
- `POST /integrations/bitrix/imconnector`
- `POST /integrations/bitrix/outgoing`

## 2. Создать или проверить Open Line

В Bitrix24:

1. Откройте `Контакт-центр` -> `Открытые линии`.
2. Создайте новую линию или выберите существующую.
3. Запомните ID линии (он должен совпадать с `BITRIX_LINE_ID` в backend).
4. Включите маршрутизацию сообщений на операторов (по вашим бизнес-правилам).
5. Включите сохранение истории диалогов.

## 3. Настроить исходящий поток из Bitrix в backend

Нужно, чтобы Bitrix отправлял входящие сообщения в backend endpoint:

- `POST https://<ваш-домен>/integrations/bitrix/imconnector`

Что передать обязательно:

- HTTP header `x-bitrix-token: <BITRIX_TOKEN>`
- JSON payload с полями chat/message (стандарт Open Lines)

Если в вашем портале используется исходящий webhook по событию комментариев CRM (режим #reply), также укажите:

- `POST https://<ваш-домен>/integrations/bitrix/outgoing`
- HTTP header `x-bitrix-token: <BITRIX_TOKEN>`
- событие `ONCRMCOMMENTADD`

## 4. Настроить авторизацию приложения Bitrix (OAuth)

Рекомендуемый режим для production: OAuth.

В карточке локального приложения Bitrix:

1. Укажите Redirect URI, который строго совпадает с backend:
2. `https://<ваш-домен>/integrations/bitrix/oauth/callback`
3. Получите `client_id` и `client_secret`.
4. Запишите их в backend `.env` как `BITRIX_CLIENT_ID` и `BITRIX_CLIENT_SECRET`.
5. Проверьте, что `BITRIX_DOMAIN` совпадает с вашим порталом, например `company.bitrix24.com`.

После сохранения параметров выполните подключение:

1. Откройте в браузере:
2. `https://<ваш-домен>/integrations/bitrix/connect`
3. Подтвердите доступ приложению в Bitrix.
4. Убедитесь, что callback завершился успешно (`ok: true`).

## 5. Настроить Connector code

`BITRIX_CONNECTOR_CODE` в backend должен совпадать с кодом коннектора, который использует ваш сценарий Open Lines.

Рекомендуется:

- использовать один стабильный код, например `myconnector`
- не менять код после запуска в production без миграции маппингов

## 6. Проверка после настройки в Bitrix

Сделайте проверку в обе стороны.

Поток A: backend -> Bitrix

1. Отправьте сообщение в локальный чат (WhatsApp/Telegram) через backend.
2. Убедитесь, что сообщение появляется в диалоге Open Lines в Bitrix.

Поток B: Bitrix -> backend

1. Отправьте сообщение из интерфейса оператора Bitrix в диалоге Open Lines.
2. Убедитесь, что сообщение дошло в исходный канал (WhatsApp/Telegram).

Дополнительно:

- запустите `./test-bitrix-smoke.sh`
- проверьте логи backend по префиксам `BitrixConnector`, `BitrixOutgoing`, `BitrixImconnector`

## 7. Что проверить при ошибках на стороне Bitrix

Если сообщения из Bitrix не уходят:

- проверьте, что webhook URL публичный и доступен извне
- проверьте корректность header `x-bitrix-token`
- проверьте, что endpoint возвращает HTTP 200
- проверьте, что используется правильная Open Line (`BITRIX_LINE_ID`)

Если OAuth не работает:

- проверьте совпадение Redirect URI до символа
- проверьте `BITRIX_CLIENT_ID` и `BITRIX_CLIENT_SECRET`
- повторно выполните `GET /integrations/bitrix/connect`

Если дубли сообщений:

- убедитесь, что не настроены параллельно несколько одинаковых webhook в Bitrix
- не дублируйте отправку в `imconnector` и сторонние сценарии одновременно

## 8. Рекомендации для production

- используйте отдельное приложение Bitrix для production
- ограничьте доступ к webhook endpoint по IP/WAF где возможно
- регулярно ротируйте секреты (`BITRIX_TOKEN`, OAuth credentials)
- ведите журнал изменений в настройках Open Lines и вебхуков
