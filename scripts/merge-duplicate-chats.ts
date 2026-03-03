import { PrismaClient } from '@prisma/client';

/**
 * Merge duplicate chats by (organizationId, channel, remoteJid).
 * Default: DRY-RUN. Set APPLY=true to perform changes.
 * Run: APPLY=true npx ts-node scripts/merge-duplicate-chats.ts
 */
const prisma = new PrismaClient();

async function main() {
  const apply =  'true';

  const duplicates = await prisma.$queryRaw<
    { organizationId: number; channel: string; organizationPhoneId: number | null; remoteJid: string; ids: number[] }[]
  >`
    SELECT "organizationId", "channel", "organizationPhoneId", "remoteJid", ARRAY_AGG(id ORDER BY "createdAt", id) AS ids
    FROM "Chat"
    GROUP BY "organizationId", "channel", "organizationPhoneId", "remoteJid"
    HAVING COUNT(*) > 1
  `;

  if (!duplicates.length) {
    console.log('✅ No duplicate chats found.');
    return;
  }

  console.log(`Found ${duplicates.length} duplicate groups`);

  for (const dup of duplicates) {
    const { organizationId, channel, organizationPhoneId, remoteJid, ids } = dup;
    const chats = await prisma.chat.findMany({ where: { id: { in: ids } } });
    if (ids.length < 2 || chats.length < 2) continue;

    const keeperId = ids[0];
    const keeper = chats.find((c) => c.id === keeperId)!;
    const victims = ids.slice(1).map((id) => chats.find((c) => c.id === id)!).filter(Boolean);

    console.log(`\nGroup org=${organizationId} channel=${channel} orgPhone=${organizationPhoneId ?? 'null'} remoteJid=${remoteJid}`);
    console.log(` Keeper chatId=${keeper.id} (ticket=${keeper.ticketNumber ?? 'null'})`);
    console.log(` Victims: ${victims.map((v) => v.id).join(', ')}`);

    if (!apply) continue;

    for (const v of victims) {
      // Re-point related records
      await prisma.message.updateMany({ where: { chatId: v.id }, data: { chatId: keeper.id } });
      await prisma.ticketHistory.updateMany({ where: { chatId: v.id }, data: { chatId: keeper.id } });
      await prisma.chatComment.updateMany({ where: { chatId: v.id }, data: { chatId: keeper.id } });
      // Free ticketNumber to avoid unique issues (if any)
      await prisma.chat.update({ where: { id: v.id }, data: { ticketNumber: null } });
      // Delete victim chat
      await prisma.chat.delete({ where: { id: v.id } });
    }

    // Recompute aggregates for keeper
    const [agg] = await prisma.$queryRaw<{ unread: bigint; last: Date | null }[]>`
      SELECT
        COUNT(*) FILTER (WHERE m."fromMe" = false AND COALESCE(m."isReadByOperator", false) = false) AS unread,
        MAX(m."timestamp") AS last
      FROM "Message" m
      WHERE m."chatId" = ${keeper.id};
    `;

    await prisma.chat.update({
      where: { id: keeper.id },
      data: {
        unreadCount: Number(agg?.unread ?? 0),
        lastMessageAt: agg?.last ?? keeper.lastMessageAt,
        receivingPhoneJid: keeper.receivingPhoneJid || victims.find((v) => v.receivingPhoneJid)?.receivingPhoneJid || '',
      },
    });

    console.log(` Merged into chat ${keeper.id}; unread=${Number(agg?.unread ?? 0)}, last=${agg?.last ?? 'n/a'}`);
  }

  if (!apply) {
    console.log('\nDRY-RUN complete. Set APPLY=true to perform changes.');
  } else {
    console.log('\n✅ Merge complete.');
  }
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
