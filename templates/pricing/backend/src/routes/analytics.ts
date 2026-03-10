import { Hono } from 'hono';
import { db } from '../../db/index';
import { quote, quoteLine, repProfile, user, product } from '../../db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { authenticate, requireManager } from '../middleware/auth';

const app = new Hono();

app.use('*', authenticate);
app.use('*', requireManager);

// GET /dashboard
app.get('/dashboard', async (c) => {
  const authUser = c.get('user');

  const [totalQuotes] = await db
    .select({ count: sql<number>`count(*)` })
    .from(quote)
    .where(eq(quote.companyId, authUser.companyId));

  const [closedRevenue] = await db
    .select({
      total: sql<string>`coalesce(sum(cast(${quote.totalPrice} as decimal)), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(quote)
    .where(and(eq(quote.companyId, authUser.companyId), eq(quote.status, 'closed')));

  const [signedCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(quote)
    .where(
      and(
        eq(quote.companyId, authUser.companyId),
        sql`${quote.status} in ('signed', 'closed')`
      )
    );

  const [presentedCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(quote)
    .where(
      and(
        eq(quote.companyId, authUser.companyId),
        sql`${quote.status} in ('presented', 'signed', 'closed')`
      )
    );

  const totalCount = Number((totalQuotes as any).count) || 1;
  const signedTotal = Number((signedCount as any).count);
  const presentedTotal = Number((presentedCount as any).count) || 1;

  const closeRate = Math.round((signedTotal / presentedTotal) * 100 * 100) / 100;

  const avgTicket =
    Number((closedRevenue as any).count) > 0
      ? Math.round(
          (parseFloat((closedRevenue as any).total || '0') /
            Number((closedRevenue as any).count)) *
            100
        ) / 100
      : 0;

  return c.json({
    dashboard: {
      totalQuotes: Number((totalQuotes as any).count),
      revenueClosed: parseFloat((closedRevenue as any).total || '0'),
      closeRate,
      avgTicket,
    },
  });
});

// GET /rep-leaderboard
app.get('/rep-leaderboard', async (c) => {
  const authUser = c.get('user');

  const leaderboard = await db
    .select({
      repId: quote.repId,
      totalRevenue: sql<string>`coalesce(sum(cast(${quote.totalPrice} as decimal)), 0)`,
      dealCount: sql<number>`count(*)`,
    })
    .from(quote)
    .where(
      and(
        eq(quote.companyId, authUser.companyId),
        sql`${quote.status} in ('signed', 'closed')`
      )
    )
    .groupBy(quote.repId)
    .orderBy(desc(sql`sum(cast(${quote.totalPrice} as decimal))`));

  // Enrich with rep names
  const enriched = [];
  for (const row of leaderboard) {
    let repName = 'Unknown';
    if (row.repId) {
      // Try repProfile first
      const [rep] = await db
        .select()
        .from(repProfile)
        .where(eq(repProfile.id, row.repId as string))
        .limit(1);
      if (rep) {
        const [u] = await db
          .select()
          .from(user)
          .where(eq(user.id, (rep as any).userId))
          .limit(1);
        if (u) repName = `${(u as any).firstName || ''} ${(u as any).lastName || ''}`.trim();
      } else {
        // Might be userId directly
        const [u] = await db
          .select()
          .from(user)
          .where(eq(user.id, row.repId as string))
          .limit(1);
        if (u) repName = `${(u as any).firstName || ''} ${(u as any).lastName || ''}`.trim();
      }
    }

    enriched.push({
      repId: row.repId,
      repName,
      totalRevenue: parseFloat(row.totalRevenue || '0'),
      dealCount: Number(row.dealCount),
    });
  }

  return c.json({ leaderboard: enriched });
});

// GET /quote-funnel
app.get('/quote-funnel', async (c) => {
  const authUser = c.get('user');

  const statusCounts = await db
    .select({
      status: quote.status,
      count: sql<number>`count(*)`,
    })
    .from(quote)
    .where(eq(quote.companyId, authUser.companyId))
    .groupBy(quote.status);

  const funnel: Record<string, number> = {
    draft: 0,
    presented: 0,
    signed: 0,
    closed: 0,
    expired: 0,
    cancelled: 0,
  };

  for (const row of statusCounts) {
    funnel[(row as any).status] = Number(row.count);
  }

  return c.json({ funnel });
});

// GET /product-performance
app.get('/product-performance', async (c) => {
  const authUser = c.get('user');

  const performance = await db
    .select({
      productId: quoteLine.productId,
      productName: (quoteLine as any).productName,
      totalRevenue: sql<string>`coalesce(sum(cast(${quoteLine.sellingPrice} as decimal)), 0)`,
      totalQuantity: sql<number>`coalesce(sum(${quoteLine.quantity}), 0)`,
      lineCount: sql<number>`count(*)`,
    })
    .from(quoteLine)
    .innerJoin(quote, eq(quoteLine.quoteId, quote.id))
    .where(
      and(
        eq(quote.companyId, authUser.companyId),
        sql`${quote.status} in ('signed', 'closed')`
      )
    )
    .groupBy(quoteLine.productId, (quoteLine as any).productName)
    .orderBy(desc(sql`sum(cast(${quoteLine.sellingPrice} as decimal))`));

  const products = performance.map((p) => ({
    productId: p.productId,
    productName: p.productName || 'Unknown',
    totalRevenue: parseFloat(p.totalRevenue || '0'),
    totalQuantity: Number(p.totalQuantity),
    lineCount: Number(p.lineCount),
  }));

  return c.json({ products });
});

export default app;
