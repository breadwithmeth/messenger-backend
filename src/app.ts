import dotenv from 'dotenv';
dotenv.config(); // Загружаем переменные окружения из .env

import express from 'express';
import authRoutes from './routes/authRoutes';
import organizationRoutes from './routes/organizationRoutes';
import chatRoutes from './routes/chatRoutes';
import messageRoutes from './routes/messageRoutes';
import waRoutes from './routes/waRoutes';
import chatAssignmentRoutes from './routes/chatAssignmentRoutes';
import messageReadRoutes from './routes/messageReadRoutes';
import unreadRoutes from './routes/unreadRoutes';
import mediaRoutes from './routes/mediaRoutes';
import ticketRoutes from './routes/ticketRoutes';
import telegramRoutes from './routes/telegramRoutes'; // <-- НОВОЕ
import wabaRoutes from './routes/wabaRoutes'; // <-- WABA интеграция
import aiRoutes from './routes/aiRoutes'; // <-- AI предложения ответов
import analyticsRoutes from './routes/analyticsRoutes';
import errorHandler from './middlewares/errorHandler'; // Corrected import path
import cors, { CorsOptions } from 'cors';
import path from 'path'; // <--- ДОБАВИТЬ
import { startBaileys } from './config/baileys';
import prisma from './config/prisma';
import pino from 'pino'; // Добавьте импорт pino
import { startWaSession } from './services/waService'; // Импортируйте startWaSession
import organizationPhoneRoutes from './routes/organizationPhoneRoutes';
import accountRoutes from './routes/accountRoutes';
import userRoutes from './routes/userRoutes'; // <-- Добавить
import contactRoutes from './routes/contactRoutes';
import clientRoutes from './routes/clientRoutes'; // <-- Клиенты организации


const app = express();
const logger = pino({ level: 'info' }); // Инициализируйте logger

app.use(express.json());

// --- Расширенная настройка CORS ---
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions: CorsOptions = {
  // Если список не задан, отражаем Origin (для dev/prod) — безопаснее, чем '*', когда нужны credentials
  origin: allowedOrigins.length
    ? (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      }
    : true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
// Обрабатываем preflight без паттерна '*', который ломается в Express 5/path-to-regexp
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    // cors(corsOptions) уже проставил заголовки — возвращаем 204
    return res.sendStatus(204);
  }
  next();
});

// --- ДОБАВЛЯЕМ ОБЩЕЕ ЛОГИРОВАНИЕ ВСЕХ ЗАПРОСОВ ---
app.use((req, res, next) => {
  // console.log(`🌐 INCOMING REQUEST: ${req.method} ${req.originalUrl}`);
  // console.log(`🌐 Headers:`, req.headers);
  next();
});

// --- ДОБАВИТЬ: Раздача статических файлов ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// Простой healthcheck (и для проверки CORS в проде)
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/wa', waRoutes);
app.use('/api/organization-phones', organizationPhoneRoutes); 
app.use('/api/accounts', accountRoutes);
app.use('/api/users', userRoutes); // <-- Добавить
app.use('/api/clients', clientRoutes); // <-- API для клиентов организации
app.use('/api/waba', wabaRoutes); // <-- ВАЖНО: ПЕРЕД /api, чтобы не перехватывался contactRoutes
app.use('/api', contactRoutes);
app.use('/api/chat-assignment', chatAssignmentRoutes); // Новые маршруты для назначения чатов
app.use('/api/message-read', messageReadRoutes); // Новые маршруты для непрочитанных сообщений
console.log('🔄 Подключаем unread маршруты...');
app.use('/api/unread', unreadRoutes); // Маршруты для управления непрочитанными сообщениями
console.log('✅ Unread маршруты подключены');
app.use('/api/media', mediaRoutes); // Маршруты для загрузки и отправки медиафайлов
app.use('/api/tickets', ticketRoutes); // Маршруты для тикет-системы
app.use('/api/telegram', telegramRoutes); // <-- НОВОЕ: Маршруты для Telegram
app.use('/api/ai', aiRoutes); // <-- AI предложения ответов
app.use('/api/analytics', analyticsRoutes);

// 404 JSON для несуществующих маршрутов
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', method: req.method, path: req.originalUrl });
});

// Глобальный обработчик ошибок
app.use(errorHandler);

export default app;
