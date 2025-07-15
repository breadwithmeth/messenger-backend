import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { AuthRequest } from '../middlewares/authMiddleware'; // Импортируем AuthRequest

const prisma = new PrismaClient();

/**
 * Создание нового пользователя (оператора или администратора).
 * ID организации берется из токена аутентифицированного пользователя.
 */
export const createUser = async (req: AuthRequest, res: Response) => { // Используем AuthRequest
  const { email, password, name, role } = req.body;
  
  // Получаем ID организации из объекта user, добавленного authMiddleware
  const organizationId = req.user?.organizationId;

  // Валидация обязательных полей
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name are required' });
  }

  // Проверка, что organizationId доступен
  if (!organizationId) {
    return res.status(401).json({ error: 'Could not determine user organization. Invalid token.' });
  }

  try {
    // 1. Проверяем, существует ли организация (дополнительная проверка)
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // 2. Хешируем пароль
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Создаем пользователя в базе данных с ID организации создателя
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        organizationId: organizationId, // Используем ID из токена
        role: role || 'operator',
      },
    });

    // 4. Убираем хеш пароля из ответа для безопасности
    const { passwordHash: _, ...userWithoutPassword } = newUser;

    res.status(201).json(userWithoutPassword);
  } catch (error: any) {
    // Обработка ошибки, если пользователь с таким email уже существует
    if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error while creating user' });
  }
};

// Получение списка пользователей (операторов) для организации текущего пользователя
export const getUsersByOrganization = async (req: Request, res: Response) => {
  try {
    // --- ИСПРАВЛЕНО: Получаем organizationId из req.user, а не из res.locals.user ---
    const { organizationId } = (req as any).user;

    if (!organizationId) {
      return res.status(400).json({ message: 'Organization ID не найден в токене' });
    }

    const users = await prisma.user.findMany({
      where: {
        organizationId: organizationId,
      },
      select: { // Выбираем только безопасные поля для отправки клиенту
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    res.status(200).json(users);
  } catch (error) {
    console.error('Ошибка при получении пользователей по организации:', error);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
};

// --- НОВЫЙ МЕТОД ---
// Получение информации о текущем пользователе (себе)
export const getMe = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user;

    if (!userId) {
      return res.status(400).json({ message: 'User ID не найден в токене' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Ошибка при получении данных пользователя:', error);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
};
