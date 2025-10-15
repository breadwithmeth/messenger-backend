// src/controllers/contactController.ts

import { Request, Response } from 'express';
import { getBaileysSock } from '../config/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: 'info' });

// GET /api/chats/:remoteJid/profile
export async function getContactProfile(req: Request, res: Response) {
  const organizationId = res.locals.organizationId;
  const { organizationPhoneId } = req.query; // какой аккаунт использовать для запроса
  const { remoteJid } = req.params;

  if (!organizationId) {
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }
  const phoneIdNum = Number(organizationPhoneId);
  if (!phoneIdNum || Number.isNaN(phoneIdNum)) {
    return res.status(400).json({ error: 'Укажите organizationPhoneId как число в query' });
  }

  const sock = getBaileysSock(phoneIdNum);
  if (!sock || !sock.user) {
    return res.status(503).json({ error: 'WhatsApp аккаунт не готов' });
  }

  const jid = jidNormalizedUser(remoteJid);
  if (!jid) {
    return res.status(400).json({ error: 'Некорректный remoteJid' });
  }

  try {
    // Фото профиля (может быть недоступно по настройкам приватности)
    let photoUrl: string | undefined = undefined;
    try {
      photoUrl = await sock.profilePictureUrl(jid, 'image');
    } catch (e) {
      logger.debug(`[getContactProfile] Нет фото для ${jid}: ${String(e)}`);
    }

    // Имя: на бекенде мы сохраняем Chat.name из pushName. Здесь вернем только фото и jid.
    res.json({ jid, photoUrl: photoUrl || null });
  } catch (error: any) {
    logger.error(`[getContactProfile] Ошибка получения профиля ${remoteJid}:`, error);
    res.status(500).json({ error: 'Не удалось получить профиль контакта', details: error?.message });
  }
}
