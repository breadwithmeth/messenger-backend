import express from 'express';
import authRoutes from './routes/authRoutes';
import organizationRoutes from './routes/organizationRoutes';
// import chatRoutes from './routes/chatRoutes';
import messageRoutes from './routes/messageRoutes';
import waRoutes from './routes/waRoutes';
import errorHandler from './middlewares/errorHandler'; // Corrected import path

const app = express();

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
// app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/wa', waRoutes);

// Глобальный обработчик ошибок
app.use(errorHandler);

export default app;
