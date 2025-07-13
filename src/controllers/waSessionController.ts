// 📁 src/controllers/waSessionController.ts
import { Request, Response } from 'express';
import { startWaSession,  } from '../services/waService';
// import { getQrCodeForSession } from '../config/baileys';

// Старт новой сессии WhatsApp для организации и номера телефона
export async function startSessionHandler(req: Request, res: Response) {
  const { organizationId, phoneJid } = req.body;

  if (!organizationId || !phoneJid) {
    return res.status(400).json({ error: 'organizationId и phoneJid обязательны' });
  }

  try {
    await startWaSession(organizationId, phoneJid);
    res.status(200).json({ message: 'Сессия запускается' });
  } catch (error) {
    console.error('Ошибка запуска сессии:', error);
    res.status(500).json({ error: 'Не удалось запустить сессию' });
  }
}

// // Получение всех активных (и неактивных) сессий по организации
// export async function getSessionsHandler(req: Request, res: Response) {
//   const organizationId = Number(req.params.organizationId);

//   if (!organizationId) {
//     return res.status(400).json({ error: 'Некорректный organizationId' });
//   }

//   try {
//     const sessions = await getWaSessions(organizationId);
//     res.json({ sessions });
//   } catch (error) {
//     console.error('Ошибка получения сессий:', error);
//     res.status(500).json({ error: 'Не удалось получить сессии' });
//   }
// }

// // Получение QR-кода для подключения
// export async function getQrHandler(req: Request, res: Response) {
//   const { organizationId, phoneJid } = req.query;

//   if (!organizationId || !phoneJid) {
//     return res.status(400).json({ error: 'organizationId и phoneJid обязательны' });
//   }

//   const qr = getQrCodeForSession(Number(organizationId), String(phoneJid));
//   if (!qr) {
//     return res.status(404).json({ error: 'QR код ещё не готов' });
//   }
//   res.json({ qr });
// }
