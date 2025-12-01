import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/authMiddleware';

const prisma = new PrismaClient();

/**
 * Получить список всех клиентов организации
 */
export const getClients = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    return res.status(401).json({ error: 'Could not determine user organization' });
  }

  try {
    const {
      page = '1',
      limit = '20',
      status,
      segment,
      clientType,
      search,
      assignedUserId,
      tags, // Фильтр по тегам (массив ID тегов)
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Формируем условия фильтрации
    const where: any = { organizationId };

    if (status) {
      where.status = status;
    }

    if (segment) {
      where.segment = segment;
    }

    if (clientType) {
      where.clientType = clientType;
    }

    if (assignedUserId) {
      where.assignedUserId = parseInt(assignedUserId as string);
    }

    // Фильтр по тегам
    if (tags) {
      const tagIds = Array.isArray(tags) 
        ? tags.map((id: any) => parseInt(id)) 
        : [parseInt(tags as string)];
      
      where.tags = {
        some: {
          id: { in: tagIds }
        }
      };
    }

    // Поиск по имени, email, телефону
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string, mode: 'insensitive' } },
        { companyName: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    // Получаем клиентов с пагинацией
    const [clients, total] = await Promise.all([
      prisma.organizationClient.findMany({
        where,
        include: {
          assignedUser: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          tags: {
            select: {
              id: true,
              name: true,
              color: true
            }
          }
        },
        skip,
        take: limitNum,
        orderBy: {
          [sortBy as string]: sortOrder
        }
      }),
      prisma.organizationClient.count({ where })
    ]);

    return res.json({
      clients,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }
};

/**
 * Получить клиента по ID
 */
export const getClientById = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;
  const { id } = req.params;

  if (!organizationId) {
    return res.status(401).json({ error: 'Could not determine user organization' });
  }

  try {
    const client = await prisma.organizationClient.findFirst({
      where: {
        id: parseInt(id),
        organizationId
      },
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        tags: {
          select: {
            id: true,
            name: true,
            color: true
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    return res.json(client);
  } catch (error) {
    console.error('Error fetching client:', error);
    return res.status(500).json({ error: 'Failed to fetch client' });
  }
};

/**
 * Создать нового клиента
 */
export const createClient = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    return res.status(401).json({ error: 'Could not determine user organization' });
  }

  try {
    const {
      clientType,
      name,
      email,
      phone,
      secondaryPhone,
      website,
      address,
      city,
      country,
      postalCode,
      companyName,
      taxId,
      registrationNumber,
      legalAddress,
      contactPerson,
      contactPosition,
      contactPhone,
      contactEmail,
      status,
      source,
      segment,
      assignedUserId,
      discount,
      notes,
      birthday,
      whatsappJid,
      telegramUserId,
      emailSubscribed,
      smsSubscribed
    } = req.body;

    // Валидация обязательных полей
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Проверка существующего email или телефона
    if (email) {
      const existingClient = await prisma.organizationClient.findFirst({
        where: {
          organizationId,
          email
        }
      });

      if (existingClient) {
        return res.status(400).json({ error: 'Client with this email already exists' });
      }
    }

    const client = await prisma.organizationClient.create({
      data: {
        organizationId,
        clientType: clientType || 'individual',
        name,
        email,
        phone,
        secondaryPhone,
        website,
        address,
        city,
        country,
        postalCode,
        companyName,
        taxId,
        registrationNumber,
        legalAddress,
        contactPerson,
        contactPosition,
        contactPhone,
        contactEmail,
        status: status || 'active',
        source,
        segment,
        assignedUserId: assignedUserId ? parseInt(assignedUserId) : null,
        discount,
        notes,
        birthday: birthday ? new Date(birthday) : null,
        whatsappJid,
        telegramUserId,
        emailSubscribed: emailSubscribed || false,
        smsSubscribed: smsSubscribed || false
      },
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return res.status(201).json(client);
  } catch (error) {
    console.error('Error creating client:', error);
    return res.status(500).json({ error: 'Failed to create client' });
  }
};

/**
 * Обновить клиента
 */
export const updateClient = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;
  const { id } = req.params;

  if (!organizationId) {
    return res.status(401).json({ error: 'Could not determine user organization' });
  }

  try {
    // Проверяем, что клиент существует и принадлежит организации
    const existingClient = await prisma.organizationClient.findFirst({
      where: {
        id: parseInt(id),
        organizationId
      }
    });

    if (!existingClient) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const {
      clientType,
      name,
      email,
      phone,
      secondaryPhone,
      website,
      address,
      city,
      country,
      postalCode,
      companyName,
      taxId,
      registrationNumber,
      legalAddress,
      contactPerson,
      contactPosition,
      contactPhone,
      contactEmail,
      status,
      source,
      segment,
      assignedUserId,
      totalRevenue,
      lastPurchaseDate,
      purchaseCount,
      averageCheck,
      discount,
      notes,
      birthday,
      whatsappJid,
      telegramUserId,
      emailSubscribed,
      smsSubscribed
    } = req.body;

    // Проверка уникальности email (если он изменился)
    if (email && email !== existingClient.email) {
      const emailExists = await prisma.organizationClient.findFirst({
        where: {
          organizationId,
          email,
          NOT: {
            id: parseInt(id)
          }
        }
      });

      if (emailExists) {
        return res.status(400).json({ error: 'Client with this email already exists' });
      }
    }

    const updateData: any = {};

    // Обновляем только переданные поля
    if (clientType !== undefined) updateData.clientType = clientType;
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (secondaryPhone !== undefined) updateData.secondaryPhone = secondaryPhone;
    if (website !== undefined) updateData.website = website;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (country !== undefined) updateData.country = country;
    if (postalCode !== undefined) updateData.postalCode = postalCode;
    if (companyName !== undefined) updateData.companyName = companyName;
    if (taxId !== undefined) updateData.taxId = taxId;
    if (registrationNumber !== undefined) updateData.registrationNumber = registrationNumber;
    if (legalAddress !== undefined) updateData.legalAddress = legalAddress;
    if (contactPerson !== undefined) updateData.contactPerson = contactPerson;
    if (contactPosition !== undefined) updateData.contactPosition = contactPosition;
    if (contactPhone !== undefined) updateData.contactPhone = contactPhone;
    if (contactEmail !== undefined) updateData.contactEmail = contactEmail;
    if (status !== undefined) updateData.status = status;
    if (source !== undefined) updateData.source = source;
    if (segment !== undefined) updateData.segment = segment;
    if (assignedUserId !== undefined) updateData.assignedUserId = assignedUserId ? parseInt(assignedUserId) : null;
    if (totalRevenue !== undefined) updateData.totalRevenue = totalRevenue;
    if (lastPurchaseDate !== undefined) updateData.lastPurchaseDate = lastPurchaseDate ? new Date(lastPurchaseDate) : null;
    if (purchaseCount !== undefined) updateData.purchaseCount = purchaseCount;
    if (averageCheck !== undefined) updateData.averageCheck = averageCheck;
    if (discount !== undefined) updateData.discount = discount;
    if (notes !== undefined) updateData.notes = notes;
    if (birthday !== undefined) updateData.birthday = birthday ? new Date(birthday) : null;
    if (whatsappJid !== undefined) updateData.whatsappJid = whatsappJid;
    if (telegramUserId !== undefined) updateData.telegramUserId = telegramUserId;
    if (emailSubscribed !== undefined) updateData.emailSubscribed = emailSubscribed;
    if (smsSubscribed !== undefined) updateData.smsSubscribed = smsSubscribed;

    const updatedClient = await prisma.organizationClient.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return res.json(updatedClient);
  } catch (error) {
    console.error('Error updating client:', error);
    return res.status(500).json({ error: 'Failed to update client' });
  }
};

/**
 * Удалить клиента
 */
export const deleteClient = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;
  const { id } = req.params;

  if (!organizationId) {
    return res.status(401).json({ error: 'Could not determine user organization' });
  }

  try {
    // Проверяем, что клиент существует и принадлежит организации
    const client = await prisma.organizationClient.findFirst({
      where: {
        id: parseInt(id),
        organizationId
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    await prisma.organizationClient.delete({
      where: { id: parseInt(id) }
    });

    return res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Error deleting client:', error);
    return res.status(500).json({ error: 'Failed to delete client' });
  }
};

/**
 * Получить статистику по клиентам
 */
export const getClientsStats = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    return res.status(401).json({ error: 'Could not determine user organization' });
  }

  try {
    const [
      totalClients,
      activeClients,
      inactiveClients,
      blockedClients,
      potentialClients,
      individualClients,
      companyClients,
      totalRevenue,
      averageRevenue
    ] = await Promise.all([
      // Всего клиентов
      prisma.organizationClient.count({
        where: { organizationId }
      }),
      // Активные
      prisma.organizationClient.count({
        where: { organizationId, status: 'active' }
      }),
      // Неактивные
      prisma.organizationClient.count({
        where: { organizationId, status: 'inactive' }
      }),
      // Заблокированные
      prisma.organizationClient.count({
        where: { organizationId, status: 'blocked' }
      }),
      // Потенциальные
      prisma.organizationClient.count({
        where: { organizationId, status: 'potential' }
      }),
      // Физ. лица
      prisma.organizationClient.count({
        where: { organizationId, clientType: 'individual' }
      }),
      // Юр. лица
      prisma.organizationClient.count({
        where: { organizationId, clientType: 'company' }
      }),
      // Общая выручка
      prisma.organizationClient.aggregate({
        where: { organizationId },
        _sum: { totalRevenue: true }
      }),
      // Средняя выручка на клиента
      prisma.organizationClient.aggregate({
        where: { organizationId },
        _avg: { totalRevenue: true }
      })
    ]);

    // Топ клиентов по выручке
    const topClients = await prisma.organizationClient.findMany({
      where: {
        organizationId,
        totalRevenue: { not: null }
      },
      orderBy: { totalRevenue: 'desc' },
      take: 10,
      select: {
        id: true,
        name: true,
        email: true,
        totalRevenue: true,
        segment: true
      }
    });

    // Распределение по сегментам
    const segmentDistribution = await prisma.$queryRaw`
      SELECT segment, COUNT(*)::int as count
      FROM "OrganizationClient"
      WHERE "organizationId" = ${organizationId} AND segment IS NOT NULL
      GROUP BY segment
      ORDER BY count DESC
    `;

    return res.json({
      total: totalClients,
      byStatus: {
        active: activeClients,
        inactive: inactiveClients,
        blocked: blockedClients,
        potential: potentialClients
      },
      byType: {
        individual: individualClients,
        company: companyClients
      },
      revenue: {
        total: totalRevenue._sum.totalRevenue || 0,
        average: averageRevenue._avg.totalRevenue || 0
      },
      topClients,
      segmentDistribution
    });
  } catch (error) {
    console.error('Error fetching clients stats:', error);
    return res.status(500).json({ error: 'Failed to fetch clients stats' });
  }
};

/**
 * Импорт клиентов из CSV/JSON
 */
export const importClients = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    return res.status(401).json({ error: 'Could not determine user organization' });
  }

  try {
    const { clients } = req.body;

    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(400).json({ error: 'Clients array is required' });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[]
    };

    for (const clientData of clients) {
      try {
        // Проверяем обязательные поля
        if (!clientData.name) {
          results.failed++;
          results.errors.push({
            client: clientData,
            error: 'Name is required'
          });
          continue;
        }

        // Проверяем дубликаты по email
        if (clientData.email) {
          const existing = await prisma.organizationClient.findFirst({
            where: {
              organizationId,
              email: clientData.email
            }
          });

          if (existing) {
            results.failed++;
            results.errors.push({
              client: clientData,
              error: 'Client with this email already exists'
            });
            continue;
          }
        }

        await prisma.organizationClient.create({
          data: {
            organizationId,
            clientType: clientData.clientType || 'individual',
            name: clientData.name,
            email: clientData.email,
            phone: clientData.phone,
            secondaryPhone: clientData.secondaryPhone,
            website: clientData.website,
            address: clientData.address,
            city: clientData.city,
            country: clientData.country,
            postalCode: clientData.postalCode,
            companyName: clientData.companyName,
            taxId: clientData.taxId,
            registrationNumber: clientData.registrationNumber,
            legalAddress: clientData.legalAddress,
            contactPerson: clientData.contactPerson,
            contactPosition: clientData.contactPosition,
            contactPhone: clientData.contactPhone,
            contactEmail: clientData.contactEmail,
            status: clientData.status || 'active',
            source: clientData.source,
            segment: clientData.segment,
            assignedUserId: clientData.assignedUserId,
            discount: clientData.discount,
            notes: clientData.notes,
            birthday: clientData.birthday ? new Date(clientData.birthday) : null,
            whatsappJid: clientData.whatsappJid,
            telegramUserId: clientData.telegramUserId,
            emailSubscribed: clientData.emailSubscribed || false,
            smsSubscribed: clientData.smsSubscribed || false
          }
        });

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          client: clientData,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return res.json({
      message: 'Import completed',
      results
    });
  } catch (error) {
    console.error('Error importing clients:', error);
    return res.status(500).json({ error: 'Failed to import clients' });
  }
};

/**
 * Экспорт клиентов в CSV/JSON
 */
export const exportClients = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    return res.status(401).json({ error: 'Could not determine user organization' });
  }

  try {
    const { format = 'json' } = req.query;

    const clients = await prisma.organizationClient.findMany({
      where: { organizationId },
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (format === 'csv') {
      // Формируем CSV
      const headers = [
        'ID', 'Type', 'Name', 'Email', 'Phone', 'Company', 'Status', 
        'Segment', 'Source', 'Total Revenue', 'Assigned User', 'Created At'
      ];

      const rows = clients.map(c => [
        c.id,
        c.clientType,
        c.name,
        c.email || '',
        c.phone || '',
        c.companyName || '',
        c.status,
        c.segment || '',
        c.source || '',
        c.totalRevenue?.toString() || '0',
        c.assignedUser?.name || '',
        c.createdAt.toISOString()
      ]);

      const csv = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="clients-${Date.now()}.csv"`);
      return res.send(csv);
    }

    // По умолчанию возвращаем JSON
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="clients-${Date.now()}.json"`);
    return res.json(clients);
  } catch (error) {
    console.error('Error exporting clients:', error);
    return res.status(500).json({ error: 'Failed to export clients' });
  }
};

/**
 * Обновить финансовую статистику клиента
 */
export const updateClientFinancials = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;
  const { id } = req.params;
  const { purchaseAmount } = req.body;

  if (!organizationId) {
    return res.status(401).json({ error: 'Could not determine user organization' });
  }

  if (!purchaseAmount || purchaseAmount <= 0) {
    return res.status(400).json({ error: 'Valid purchase amount is required' });
  }

  try {
    // Проверяем, что клиент существует и принадлежит организации
    const client = await prisma.organizationClient.findFirst({
      where: {
        id: parseInt(id),
        organizationId
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { updateClientPurchaseStats } = await import('../services/clientService');
    await updateClientPurchaseStats(parseInt(id), parseFloat(purchaseAmount));

    const updatedClient = await prisma.organizationClient.findUnique({
      where: { id: parseInt(id) },
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return res.json(updatedClient);
  } catch (error) {
    console.error('Error updating client financials:', error);
    return res.status(500).json({ error: 'Failed to update client financials' });
  }
};
