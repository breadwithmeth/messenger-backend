import { Request, Response } from 'express';
import prisma from '../config/prisma';

export async function createOrganization(req: Request, res: Response) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Название обязательно' });

  const org = await prisma.organization.create({ data: { name } });
  res.json(org);
}

export async function listOrganizations(req: Request, res: Response) {
  const orgs = await prisma.organization.findMany();
  res.json(orgs);
}
