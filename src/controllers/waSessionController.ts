// 📁 src/controllers/waSessionController.ts

import { Request, Response } from 'express';
import { startWaSession } from '../services/waService';
// import { getQrCodeForSession } from '../config/baileys'; // <-- УДАЛИТЬ ЭТУ СТРОКУ, т.к. она больше не нужна
import { prisma } from '../config/authStorage'; // Импортируем prisma клиент

// ... (ваша функция startSessionHandler - она уже была переписана и корректна) ...
export async function startSessionHandler(req: Request, res: Response) {
  // ... (код startSessionHandler без изменений) ...
}


// ... (ваша функция getSessionsHandler - она уже была переписана и корректна) ...
export async function getSessionsHandler(req: Request, res: Response) {
  // ... (код getSessionsHandler без изменений) ...
}

// Получение QR-кода для подключения
export async function getQrHandler(req: Request, res: Response) {
  const organizationId = res.locals.organizationId; // Получаем из middleware
  const { phoneJid } = req.query; // Query params по умолчанию строки

  if (!organizationId || !phoneJid) {
    return res.status(400).json({ error: 'organizationId и phoneJid обязательны.' });
  }

  try {
    // Находим OrganizationPhone, чтобы получить его текущий статус и QR-код из БД
    const organizationPhone = await prisma.organizationPhone.findUnique({
      where: {
        organizationId: organizationId,
        phoneJid: String(phoneJid), // Убеждаемся, что phoneJid - это строка
      },
      select: { id: true, status: true, qrCode: true }, // Выбираем qrCode
    });

    if (!organizationPhone) {
      return res.status(404).json({ error: 'Указанный номер WhatsApp не найден для вашей организации. Пожалуйста, сначала запустите сессию.' });
    }

    // Если сессия уже подключена, QR-код не нужен
    if (organizationPhone.status === 'connected') {
        return res.status(200).json({ message: 'Сессия уже подключена, QR-код не требуется.', status: organizationPhone.status });
    }

    // Получаем QR-код непосредственно из записи БД
    const qr = organizationPhone.qrCode;

    if (!qr) {
      // Если QR-код еще не готов, но сессия в статусе запуска или переподключения
      if (['pending', 'loading', 'reconnecting'].includes(organizationPhone.status)) {
          return res.status(202).json({ error: 'QR код ещё не готов или сессия находится в процессе запуска. Попробуйте снова через несколько секунд.', status: organizationPhone.status });
      }
      return res.status(404).json({ error: 'QR код недоступен. Возможно, сессия была отключена или требует перезапуска.', status: organizationPhone.status });
    }
    res.json({ qrCode: qr, status: organizationPhone.status }); // Отдаем QR-код
  } catch (error) {
    console.error('Ошибка получения QR-кода:', error);
    res.status(500).json({ error: 'Не удалось получить QR-код. Подробности в логах сервера.' });
  }
}
