# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Prisma build-time requirements on Alpine
RUN apk add --no-cache openssl libc6-compat

# Copy sources
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY public ./public

# Generate Prisma Client and build TS
RUN npx prisma generate
RUN npm run build

# --- Runtime stage ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Prisma runtime requirements on Alpine
RUN apk add --no-cache openssl libc6-compat

# Install Prisma CLI to run migrations in runtime
RUN npm i -g prisma@^6.11.1

# Copy built artifacts and runtime assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# Apply DB migrations and start server
CMD ["sh", "-c", "until prisma migrate deploy; do echo 'DB not ready, retrying...'; sleep 3; done; node dist/src/server.js"]
