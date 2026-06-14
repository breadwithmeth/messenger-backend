import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { generateWebsiteWidgetPublicKey } from '../services/websiteWidgetService';

function cleanRequiredName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name ? name.slice(0, 160) : null;
}

function cleanOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('Ожидалась строка');
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function validatePrimaryColor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error('primaryColor должен быть цветом в формате #RRGGBB');
  }
  return value.toLowerCase();
}

export async function listWebsiteWidgets(_req: Request, res: Response) {
  try {
    const widgets = await prisma.websiteWidget.findMany({
      where: { organizationId: res.locals.organizationId },
      include: {
        _count: {
          select: { chats: true, sessions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ widgets });
  } catch (error: any) {
    res.status(500).json({ error: 'Не удалось получить виджеты', details: error.message });
  }
}

export async function createWebsiteWidget(req: Request, res: Response) {
  try {
    const name = cleanRequiredName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'name обязателен' });

    const primaryColor = validatePrimaryColor(req.body?.primaryColor);
    const welcomeMessage = cleanOptionalText(req.body?.welcomeMessage, 1000);

    const widget = await prisma.websiteWidget.create({
      data: {
        organizationId: res.locals.organizationId,
        publicKey: generateWebsiteWidgetPublicKey(),
        name,
        primaryColor,
        welcomeMessage,
      },
    });

    res.status(201).json({ widget });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Не удалось создать виджет' });
  }
}

export async function updateWebsiteWidget(req: Request, res: Response) {
  try {
    const widgetId = Number.parseInt(req.params.widgetId, 10);
    if (!Number.isInteger(widgetId)) return res.status(400).json({ error: 'Некорректный widgetId' });

    const existing = await prisma.websiteWidget.findFirst({
      where: { id: widgetId, organizationId: res.locals.organizationId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Виджет не найден' });

    const data: Record<string, unknown> = {};
    if (req.body?.name !== undefined) {
      const name = cleanRequiredName(req.body.name);
      if (!name) return res.status(400).json({ error: 'name не может быть пустым' });
      data.name = name;
    }
    if (req.body?.status !== undefined) {
      if (!['active', 'inactive'].includes(req.body.status)) {
        return res.status(400).json({ error: 'status должен быть active или inactive' });
      }
      data.status = req.body.status;
    }
    if (req.body?.primaryColor !== undefined) {
      data.primaryColor = validatePrimaryColor(req.body.primaryColor);
    }
    if (req.body?.welcomeMessage !== undefined) {
      data.welcomeMessage = cleanOptionalText(req.body.welcomeMessage, 1000);
    }

    const widget = await prisma.websiteWidget.update({
      where: { id: widgetId },
      data,
    });
    res.json({ widget });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Не удалось обновить виджет' });
  }
}

export async function rotateWebsiteWidgetKey(req: Request, res: Response) {
  try {
    const widgetId = Number.parseInt(req.params.widgetId, 10);
    if (!Number.isInteger(widgetId)) return res.status(400).json({ error: 'Некорректный widgetId' });

    const result = await prisma.websiteWidget.updateMany({
      where: { id: widgetId, organizationId: res.locals.organizationId },
      data: { publicKey: generateWebsiteWidgetPublicKey() },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Виджет не найден' });

    const widget = await prisma.websiteWidget.findUniqueOrThrow({ where: { id: widgetId } });
    res.json({ widget });
  } catch (error: any) {
    res.status(500).json({ error: 'Не удалось обновить ключ виджета', details: error.message });
  }
}
