########## deps: install dependencies and generate Prisma client ##########
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache openssl libc6-compat
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY prisma ./prisma
ENV PRISMA_CLIENT_ENGINE_TYPE=library
ENV PRISMA_CLI_QUERY_ENGINE_TYPE=library
RUN npx prisma generate

# prune dev dependencies, keeping generated @prisma/client
RUN npm prune --omit=dev

########## builder: build TypeScript ##########
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
RUN npm run build

########## runner: production image ##########
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PRISMA_CLIENT_ENGINE_TYPE=library
ENV PRISMA_CLI_QUERY_ENGINE_TYPE=library

RUN apk add --no-cache openssl libc6-compat

# Use prebuilt node_modules (prod only) with generated @prisma/client
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Static dir for uploads
RUN mkdir -p public/media

# Install Prisma CLI globally for migrate deploy
RUN npm i -g prisma@^6.11.1

EXPOSE 3000

CMD ["sh", "-c", "until prisma migrate deploy; do echo 'DB not ready, retrying...'; sleep 3; done; node dist/src/server.js"]
