# 🚀 Как запустить проект

## Способ 1: Docker Compose (Рекомендуется для продакшена)

### Быстрый старт
```bash
# Запустить все сервисы (PostgreSQL + API)
docker-compose up -d

# Проверить статус
docker-compose ps

# Посмотреть логи
docker-compose logs -f api

# Остановить
docker-compose down
```

### Подробная инструкция

1. **Создать .env файл** (опционально, есть дефолтные значения)
```bash
cat > .env << 'EOF'
# Database
DATABASE_URL=postgresql://app:app@localhost:5432/messenger?schema=public

# Server
PORT=3000
NODE_ENV=production

# JWT
JWT_SECRET=your-super-secret-key-change-this

# CORS (разделённые запятыми)
CORS_ORIGINS=http://localhost:3001,http://localhost:5173
EOF
```

2. **Запустить через Docker Compose**
```bash
# Собрать и запустить
docker-compose up --build -d

# Первый запуск - применить миграции (автоматически происходит в Dockerfile)
docker-compose exec api npx prisma migrate deploy
```

3. **Проверить работу**
```bash
# Health check
curl http://localhost:3000/health

# Должен вернуть: {"status":"ok"}
```

4. **Доступ:**
- API: http://localhost:3000
- PostgreSQL: localhost:5432
- Swagger/Docs: см. API_DOCUMENTATION.md

---

## Способ 2: Локальная разработка (без Docker)

### Требования
- Node.js 20+
- PostgreSQL 16+ (запущен отдельно)
- npm или yarn

### Шаги

1. **Установить PostgreSQL локально**
```bash
# macOS (Homebrew)
brew install postgresql@16
brew services start postgresql@16

# Создать БД
createdb messenger

# Или через psql
psql postgres
CREATE DATABASE messenger;
\q
```

2. **Создать .env файл**
```bash
cat > .env << 'EOF'
# Database (локальный PostgreSQL)
DATABASE_URL=postgresql://YOUR_USER@localhost:5432/messenger?schema=public

# Server
PORT=3000
NODE_ENV=development

# JWT
JWT_SECRET=dev-secret-key

# CORS
CORS_ORIGINS=http://localhost:3001,http://localhost:5173
EOF
```

3. **Установить зависимости**
```bash
npm install
```

4. **Применить миграции Prisma**
```bash
npx prisma migrate deploy

# Или для dev-режима (создаёт миграции если нужно)
npx prisma migrate dev
```

5. **Сгенерировать Prisma Client**
```bash
npx prisma generate
```

6. **Запустить в режиме разработки**
```bash
# Dev mode с hot-reload
npm run dev

# Или собрать и запустить production
npm run build
npm start
```

7. **Проверить работу**
```bash
curl http://localhost:3000/health
```

---

## Способ 3: Docker (только API, без Compose)

### Если PostgreSQL уже запущен отдельно

1. **Собрать образ**
```bash
docker build -t messenger-backend .
```

2. **Запустить контейнер**
```bash
docker run -d \
  --name messenger-api \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://app:app@host.docker.internal:5432/messenger" \
  -e JWT_SECRET="your-secret" \
  -e PORT=3000 \
  -v $(pwd)/public:/app/public \
  messenger-backend
```

3. **Проверить логи**
```bash
docker logs -f messenger-api
```

---

## 📝 Переменные окружения

| Переменная | Описание | Дефолт | Обязательна |
|------------|----------|--------|-------------|
| `DATABASE_URL` | PostgreSQL connection string | - | ✅ Да |
| `PORT` | Порт API | 3000 | ❌ Нет |
| `NODE_ENV` | Окружение | production | ❌ Нет |
| `JWT_SECRET` | Секрет для JWT токенов | - | ✅ Да |
| `CORS_ORIGINS` | Разрешённые origins для CORS | * | ❌ Нет |

### Пример .env файла
```bash
# Database
DATABASE_URL=postgresql://app:app@localhost:5432/messenger?schema=public

# Server
PORT=3000
NODE_ENV=production

# Auth
JWT_SECRET=change-this-to-random-string

# CORS (несколько origins через запятую)
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,https://yourdomain.com
```

---

## 🔍 Проверка работы

### 1. Health Check
```bash
curl http://localhost:3000/health
# Ответ: {"status":"ok"}
```

### 2. Проверка БД
```bash
# Если используете Docker Compose
docker-compose exec db psql -U app -d messenger -c "\dt"

# Локально
psql messenger -c "\dt"

# Должны увидеть таблицы: Organization, User, Chat, Message и т.д.
```

### 3. Создать первую организацию (опционально)
```bash
curl -X POST http://localhost:3000/api/organizations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Org",
    "description": "My first organization"
  }'
```

### 4. Проверить логи
```bash
# Docker Compose
docker-compose logs -f api

# Docker
docker logs -f messenger-api

# Локально - в терминале где запущен npm run dev
```

---

## 🐛 Траблшутинг

### Ошибка: "Cannot connect to database"
```bash
# Проверить что PostgreSQL запущен
docker-compose ps db
# или
brew services list | grep postgresql

# Проверить DATABASE_URL в .env
cat .env | grep DATABASE_URL
```

### Ошибка: "Port 3000 already in use"
```bash
# Найти процесс на порту 3000
lsof -ti:3000

# Убить процесс
kill -9 $(lsof -ti:3000)

# Или изменить PORT в .env
```

### Ошибка: "Prisma Client did not initialize"
```bash
# Регенерировать Prisma Client
npx prisma generate

# Пересобрать Docker образ
docker-compose build --no-cache
```

### Ошибка: "Migration failed"
```bash
# Проверить статус миграций
npx prisma migrate status

# Сбросить БД (ОСТОРОЖНО: удалит все данные!)
npx prisma migrate reset

# Применить миграции заново
npx prisma migrate deploy
```

---

## 📚 Полезные команды

### Docker Compose
```bash
# Запустить в фоне
docker-compose up -d

# Пересобрать образы
docker-compose build

# Пересобрать и запустить
docker-compose up --build -d

# Остановить без удаления volumes
docker-compose stop

# Остановить и удалить всё (включая volumes)
docker-compose down -v

# Посмотреть логи
docker-compose logs -f

# Подключиться к контейнеру
docker-compose exec api sh
docker-compose exec db psql -U app -d messenger
```

### Prisma
```bash
# Применить миграции
npx prisma migrate deploy

# Создать новую миграцию (dev mode)
npx prisma migrate dev --name add_new_feature

# Статус миграций
npx prisma migrate status

# Открыть Prisma Studio (GUI для БД)
npx prisma studio

# Сгенерировать Prisma Client
npx prisma generate

# Форматировать schema.prisma
npx prisma format
```

### Development
```bash
# Запустить dev mode
npm run dev

# Собрать TypeScript
npm run build

# Запустить production build
npm start

# Lint код
npm run lint
```

---

## 🌐 Деплой на production

### На Coolify / Nixpacks
1. Подключить Git репозиторий
2. Настроить переменные окружения
3. Nixpacks автоматически определит Node.js проект
4. Deploy!

### На VPS (ручной деплой)
```bash
# На сервере
git clone https://github.com/breadwithmeth/messenger-backend.git
cd messenger-backend

# Создать .env с production значениями
nano .env

# Запустить через Docker Compose
docker-compose up -d

# Или через systemd (см. документацию)
```

---

## 📖 Документация

- **API документация**: см. `API_DOCUMENTATION.md`
- **Новые фичи**: см. `README_NEW_FEATURES.md`
- **Миграция Baileys v7**: см. `BAILEYS_V7_MIGRATION_PLAN.md`

---

## ✅ Готово!

После запуска API доступно по адресу: **http://localhost:3000**

Основные endpoints:
- `GET /health` - проверка работы
- `POST /api/auth/login` - авторизация
- `GET /api/chats` - список чатов
- `POST /api/messages/send` - отправка сообщения

Полный список см. в `API_DOCUMENTATION.md` 🚀
