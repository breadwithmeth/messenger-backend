import express from 'express';
import authRoutes from './routes/authRoutes';
import organizationRoutes from './routes/organizationRoutes';
import chatRoutes from './routes/chatRoutes';
import messageRoutes from './routes/messageRoutes';
import waRoutes from './routes/waRoutes';
import errorHandler from './middlewares/errorHandler'; // Corrected import path
import cors from 'cors';
import path from 'path'; // <--- ДОБАВИТЬ
import { startBaileys } from './config/baileys';
import prisma from './config/prisma';
import pino from 'pino'; // Добавьте импорт pino
import { startWaSession } from './services/waService'; // Импортируйте startWaSession
import organizationPhoneRoutes from './routes/organizationPhoneRoutes';


const app = express();
const logger = pino({ level: 'info' }); // Инициализируйте logger

app.use(express.json());
app.use(cors());

// --- ДОБАВИТЬ: Раздача статических файлов ---
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/wa', waRoutes);
app.use('/api/organization-phones', organizationPhoneRoutes); 

// Глобальный обработчик ошибок
app.use(errorHandler);

export default app;
