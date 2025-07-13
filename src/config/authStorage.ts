// src/config/authStorage.ts
import { PrismaClient } from '@prisma/client';
import { Buffer } from 'buffer';

const prisma = new PrismaClient();

export type StoredDataType = 'json' | 'buffer' | 'base64_json';

interface AuthDBAdapter {
  // get/set теперь работают со строками, как и раньше
  get(key: string): Promise<{ value: string; type: StoredDataType } | null>;
  set(key: string, value: string, dataType: StoredDataType): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createAuthDBAdapter(organizationId: number, phoneJid: string): AuthDBAdapter {
  return {
    async get(key: string): Promise<{ value: string; type: StoredDataType } | null> {
      try {
        const record = await prisma.baileysAuth.findUnique({
          where: {
            organizationId_phoneJid_key: {
              organizationId,
              phoneJid,
              key,
            },
          },
        });
        return record ? { value: record.value, type: record.type as StoredDataType } : null;
      } catch (error: unknown) {
        console.error(`Prisma: Ошибка при получении ключа "${key}" для ${organizationId}/${phoneJid}:`, error);
        // Не выбрасываем ошибку, чтобы Baileys мог продолжить, как если бы ключ отсутствовал
        return null;
      }
    },

    async set(key: string, value: string, dataType: StoredDataType): Promise<void> {
      try {
        await prisma.baileysAuth.upsert({
          where: {
            organizationId_phoneJid_key: {
              organizationId,
              phoneJid,
              key,
            },
          },
          update: {
            value: value,
            type: dataType,
          },
          create: {
            organizationId: organizationId,
            phoneJid: phoneJid,
            key: key,
            value: value,
            type: dataType,
          },
        });
      } catch (error: unknown) {
        console.error(`Prisma: Ошибка при установке ключа "${key}" для ${organizationId}/${phoneJid}:`, error);
        throw error; // Здесь выбрасываем, так как запись важна
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await prisma.baileysAuth.delete({
          where: {
            organizationId_phoneJid_key: {
              organizationId,
              phoneJid,
              key,
            },
          },
        });
      } catch (error: any) {
        if (error.code === 'P2025') { // P2025 - запись не найдена
          return;
        }
        console.error(`Prisma: Ошибка при удалении ключа "${key}" для ${organizationId}/${phoneJid}:`, error);
        throw error;
      }
    },
  };
}

export { prisma };