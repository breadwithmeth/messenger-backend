import { NextFunction, Response } from 'express';
import { AuthRequest } from './authMiddleware';
import prisma from '../config/prisma';
import { normalizeAppRole } from '../auth/roleUtils';

export function requireRole(allowed: string[]) {
  return async function (req: AuthRequest, res: Response, next: NextFunction) {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const allowedNormalized = allowed
      .map((role) => normalizeAppRole(role))
      .filter((role): role is NonNullable<typeof role> => Boolean(role));

    const tokenRole = normalizeAppRole(req.user?.role);
    if (tokenRole) {
      if (allowedNormalized.includes(tokenRole)) {
        return next();
      }
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      const role = normalizeAppRole(user?.role);
      if (!role || !allowedNormalized.includes(role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    } catch {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}
