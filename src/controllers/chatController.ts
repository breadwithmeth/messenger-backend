// import { Request, Response } from 'express';
// import * as chatService from '../services/chatService';

// export async function createChat(req: Request, res: Response) {
//   try {
//     const { organizationId, clientId, operatorId } = req.body;
//     if (!organizationId || !clientId || !operatorId) {
//       return res.status(400).json({ error: 'Не указаны обязательные поля' });
//     }

//     const chat = await chatService.createChat(organizationId, clientId, operatorId);
//     res.json(chat);
//   } catch (err) {
//     res.status(500).json({ error: 'Ошибка создания чата' });
//   }
// }

// export async function listChats(req: Request, res: Response) {
//   try {
//     const organizationId = Number(req.query.organizationId);
//     if (!organizationId) {
//       return res.status(400).json({ error: 'organizationId обязателен' });
//     }

//     const chats = await chatService.getChatsByOrganization(organizationId);
//     res.json(chats);
//   } catch (err) {
//     res.status(500).json({ error: 'Ошибка получения чатов' });
//   }
// }
