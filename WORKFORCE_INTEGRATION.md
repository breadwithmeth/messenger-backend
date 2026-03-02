# Workforce integration (bm → naliv-emp)

`bm` использует **internal API** сервиса Employee Workforce Service (`naliv-emp`) и аутентифицируется **service-to-service токеном** через Keycloak `client_credentials`.

## Env конфиг

Добавьте в окружение:

- `EMP_BASE_URL` — base URL `naliv-emp` (например `https://naliv-emp.internal`)
- `KEYCLOAK_BASE_URL` — base URL Keycloak (например `https://keycloak.company.tld`)
- `KEYCLOAK_REALM` — по умолчанию `naliv-prod`
- `BM_SERVICE_CLIENT_ID`
- `BM_SERVICE_CLIENT_SECRET`
- `HTTP_TIMEOUT_MS` — default `4000`
- `HTTP_RETRY_COUNT` — default `2`
- `HTTP_RETRY_BASE_DELAY_MS` — default `200`

### Быстрый старт для твоего окружения

1) Создай локальный `.env` (он уже игнорируется git’ом):

```bash
cp .env.workforce.example .env
```

2) Проверь, что значения выставлены так:

- `KEYCLOAK_BASE_URL=https://sec.naliv.kz`
- `EMP_BASE_URL=http://localhost:3005`
- `BM_SERVICE_CLIENT_ID=naliv-bm`
- `BM_SERVICE_CLIENT_SECRET=...` (вставь секрет локально, не коммить)

Важно:
- `naliv-emp` internal endpoints принимают только `Authorization: Bearer <SERVICE_TOKEN>`
- `bm` **никогда не пересылает user JWT** в internal API `naliv-emp`

## Как устроено

- TokenProvider: `src/integrations/workforce/tokenProvider.ts`
  - `POST {KEYCLOAK_BASE_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token`
  - `grant_type=client_credentials`
  - кеш до `exp - 30s`
  - concurrency-safe refresh (один refresh на все конкурентные запросы)

- WorkforceClient: `src/integrations/workforce/workforceClient.ts`
  - timeout на каждый запрос
  - retry только для network errors / timeout / 5xx
  - 4xx не ретраятся
  - structured logs: `requestId`, `endpoint`, `method`, `statusCode`, `latencyMs`, `retryCount`

- Error mapping: `src/integrations/workforce/errors.ts`
  - `401` → `UpstreamAuthError`
  - `403` → `UpstreamForbiddenError`
  - `404` → `UpstreamNotFoundError`
  - `409` → `UpstreamConflictError`
  - `5xx/timeout` → `UpstreamUnavailableError`

## Wiring в bm

1) `syncEmployee` после успешной аутентификации

Middleware `src/middlewares/authMiddleware.ts` триггерит `syncEmployeeFromClaims(...)` после успешной проверки токена.

Для синка нужен `keycloakId` в claims (`sub`). Если `keycloakId` отсутствует — синк пропускается.

2) Operator actions (смены / presence)

Добавлены эндпоинты:

- `GET /api/workforce/me` — employee для текущего пользователя
- `POST /api/workforce/shifts/start`
- `POST /api/workforce/shifts/stop`
- `GET /api/workforce/shifts`
- `PATCH /api/workforce/presence` body: `{ "status": "online" }`
- `GET /api/workforce/employees` — admin/supervisor only

## Тесты

Тесты: `src/integrations/workforce/__tests__/*`

- Token cache + concurrency refresh
- Retry policy (network/timeout/5xx, no retry for 4xx)
- Error mapping
- Happy path sync + shift start/stop с mock fetch

Запуск: `npm test`
