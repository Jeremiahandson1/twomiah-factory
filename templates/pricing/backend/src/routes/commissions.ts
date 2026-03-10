import { Hono } from 'hono';
import { db } from '../../db/index';
import { commissionRecord, repProfile, user, quote } from '../../db/schema';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { authenticate, requireManager } from '../middleware/auth';
import { NotFoundError } from '../utils/errors';
import { logger } from '../services/logger';

const app = new Hono();

app.use('*', authenticate);

// GET / — list commissions
app.get('/', async (c) => {
  const authUser = c.get('user');
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '25');
  const offset = (page - 1) * limit;

  const conditions: any[] = [eq(commissionRecord.companyId, authUser.companyId)];

  // Reps only see their own
  if (authUser.role === 'rep' || authUser.role === 'senior_rep') {
    if (authUser.repProfileId) {
      conditions.push(eq(commissionRecord.repProfileId, authUser.repProfileId));
    }
  }

  const records = await db
    .select({
      commission: commissionRecord,
      repFirstName: user.firstName,
      repLastName: user.lastName,
      quoteNumber: quote.quoteNumber,
      customerFirstName: quote.customerFirstName,
      customerLastName: quote.customerLastName,
    })
    .from(commissionRecord)
    .leftJoin(repProfile, eq(commissionRecord.repProfileId, repProfile.id))
    .leftJoin(user, eq(repProfile.userId, user.id))
    .leftJoin(quote, eq(commissionRecord.quoteId, quote.id))
    .where(and(...conditions))
    .orderBy(desc(commissionRecord.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(commissionRecord)
    .where(and(...conditions));

  const formatted = records.map((r) => ({
    ...(r.commission as any),
    repName: `${r.repFirstName || ''} ${r.repLastName || ''}`.trim(),
    quoteNumber: r.quoteNumber,
    customerName: `${r.customerFirstName || ''} ${r.customerLastName || ''}`.trim(),
  }));

  return c.json({
    commissions: formatted,
    pagination: {
      page,
      limit,
      total: Number((countResult as any).count),
    },
  });
});

// GET /summary
app.get('/summary', requireManager, async (c) => {
  const authUser = c.get('user');

  const summaryRows = await db
    .select({
      repProfileId: commissionRecord.repProfileId,
      totalEarned: sql<string>`sum(cast(${commissionRecord.totalAmount} as decimal))`,
      totalBase: sql<string>`sum(cast(${commissionRecord.baseAmount} as decimal))`,
      totalBonus: sql<string>`sum(cast(${commissionRecord.bonusAmount} as decimal))`,
      count: sql<number>`count(*)`,
    })
    .from(commissionRecord)
    .where(
      and(
        eq(commissionRecord.companyId, authUser.companyId),
        isNull((commissionRecord as any).cancelledAt)
      )
    )
    .groupBy(commissionRecord.repProfileId);

  // Enrich with rep names
  const enriched = [];
  for (const row of summaryRows) {
    let repName = 'Unknown';
    if (row.repProfileId) {
      const [rep] = await db
        .select()
        .from(repProfile)
        .where(eq(repProfile.id, row.repProfileId))
        .limit(1);
      if (rep) {
        const [u] = await db
          .select()
          .from(user)
          .where(eq(user.id, (rep as any).userId))
          .limit(1);
        if (u) {
          repName = `${(u as any).firstName || ''} ${(u as any).lastName || ''}`.trim();
        }
      }
    }

    enriched.push({
      repProfileId: row.repProfileId,
      repName,
      totalEarned: parseFloat(row.totalEarned || '0'),
      totalBase: parseFloat(row.totalBase || '0'),
      totalBonus: parseFloat(row.totalBonus || '0'),
      dealCount: Number(row.count),
    });
  }

  return c.json({ summary: enriched });
});

// POST /:id/pay-base
app.post('/:id/pay-base', requireManager, async (c) => {
  const authUser = c.get('user');
  const commissionId = c.req.param('id');

  const [record] = await db
    .select()
    .from(commissionRecord)
    .where(
      and(
        eq(commissionRecord.id, commissionId),
        eq(commissionRecord.companyId, authUser.companyId)
      )
    )
    .limit(1);

  if (!record) throw new NotFoundError('Commission record');

  await db
    .update(commissionRecord)
    .set({ basePaidAt: new Date() })
    .where(eq(commissionRecord.id, commissionId));

  return c.json({ message: 'Base commission marked as paid' });
});

// POST /:id/pay-bonus
app.post('/:id/pay-bonus', requireManager, async (c) => {
  const authUser = c.get('user');
  const commissionId = c.req.param('id');

  const [record] = await db
    .select()
    .from(commissionRecord)
    .where(
      and(
        eq(commissionRecord.id, commissionId),
        eq(commissionRecord.companyId, authUser.companyId)
      )
    )
    .limit(1);

  if (!record) throw new NotFoundError('Commission record');

  await db
    .update(commissionRecord)
    .set({ bonusPaidAt: new Date() })
    .where(eq(commissionRecord.id, commissionId));

  return c.json({ message: 'Bonus commission marked as paid' });
});

// GET /export
app.get('/export', requireManager, async (c) => {
  const authUser = c.get('user');

  const records = await db
    .select({
      commission: commissionRecord,
      repFirstName: user.firstName,
      repLastName: user.lastName,
      quoteNumber: quote.quoteNumber,
      customerFirstName: quote.customerFirstName,
      customerLastName: quote.customerLastName,
    })
    .from(commissionRecord)
    .leftJoin(repProfile, eq(commissionRecord.repProfileId, repProfile.id))
    .leftJoin(user, eq(repProfile.userId, user.id))
    .leftJoin(quote, eq(commissionRecord.quoteId, quote.id))
    .where(eq(commissionRecord.companyId, authUser.companyId))
    .orderBy(desc(commissionRecord.createdAt));

  // Build CSV
  const headers = [
    'Rep Name',
    'Quote Number',
    'Customer Name',
    'Base Amount',
    'Bonus Amount',
    'Total Amount',
    'Base Paid',
    'Bonus Paid',
    'Created At',
  ];

  const rows = records.map((r) => {
    const comm = r.commission as any;
    return [
      `${r.repFirstName || ''} ${r.repLastName || ''}`.trim(),
      r.quoteNumber || '',
      `${r.customerFirstName || ''} ${r.customerLastName || ''}`.trim(),
      comm.baseAmount || '0',
      comm.bonusAmount || '0',
      comm.totalAmount || '0',
      comm.basePaidAt ? new Date(comm.basePaidAt).toISOString() : '',
      comm.bonusPaidAt ? new Date(comm.bonusPaidAt).toISOString() : '',
      comm.createdAt ? new Date(comm.createdAt).toISOString() : '',
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');

  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="commissions-export.csv"');
  return c.body(csv);
});

export default app;
