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
import errorHandler from './middlewares/errorHandler'; // Corrected import path
import cors from 'cors';
import path from 'path'; // <--- ДОБАВИТЬ
import { startBaileys } from './config/baileys';
import prisma from './config/prisma';
import pino from 'pino'; // Добавьте импорт pino
import { startWaSession } from './services/waService'; // Импортируйте startWaSession
import organizationPhoneRoutes from './routes/organizationPhoneRoutes';
import accountRoutes from './routes/accountRoutes';
import userRoutes from './routes/userRoutes'; // <-- Добавить
import contactRoutes from './routes/contactRoutes';


const app = express();
const logger = pino({ level: 'info' }); // Инициализируйте logger

app.use(express.json());
app.use(cors());

// --- ДОБАВЛЯЕМ ОБЩЕЕ ЛОГИРОВАНИЕ ВСЕХ ЗАПРОСОВ ---
app.use((req, res, next) => {
  console.log(`🌐 INCOMING REQUEST: ${req.method} ${req.originalUrl}`);
  console.log(`🌐 Headers:`, req.headers);
  next();
});

// --- ДОБАВИТЬ: Раздача статических файлов ---
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/wa', waRoutes);
app.use('/api/organization-phones', organizationPhoneRoutes); 
app.use('/api/accounts', accountRoutes);
app.use('/api/users', userRoutes); // <-- Добавить
app.use('/api', contactRoutes);
app.use('/api/chat-assignment', chatAssignmentRoutes); // Новые маршруты для назначения чатов
app.use('/api/message-read', messageReadRoutes); // Новые маршруты для непрочитанных сообщений
console.log('🔄 Подключаем unread маршруты...');
app.use('/api/unread', unreadRoutes); // Маршруты для управления непрочитанными сообщениями
console.log('✅ Unread маршруты подключены');
app.use('/api/media', mediaRoutes); // Маршруты для загрузки и отправки медиафайлов

// 404 JSON для несуществующих маршрутов
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', method: req.method, path: req.originalUrl });
});

// Глобальный обработчик ошибок
app.use(errorHandler);

export default app;
