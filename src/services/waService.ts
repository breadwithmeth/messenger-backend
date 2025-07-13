// 📁 src/services/waService.ts
import { startBaileys,  } from '../config/baileys';

export async function startWaSession(organizationId: number, phoneJid: string, id: number) {
  await startBaileys(organizationId, id ,phoneJid);
}

// export async function getWaSessions(organizationId: number) {
//   return await getBaileysSessionsByOrganization(organizationId);
// }
