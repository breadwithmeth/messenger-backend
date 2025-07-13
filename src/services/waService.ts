// 📁 src/services/waService.ts
import { startBaileys,  } from '../config/baileys';

export async function startWaSession(organizationId: number, phoneJid: string) {
  await startBaileys(organizationId, phoneJid);
}

// export async function getWaSessions(organizationId: number) {
//   return await getBaileysSessionsByOrganization(organizationId);
// }
