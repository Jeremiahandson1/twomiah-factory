import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.ts';
import { db } from '../../db/index.ts';
import { supportTicket, supportTicketMessage, supportKnowledgeBase, supportSlaPolicy, contact, user } from '../../db/schema.ts';
import { eq, and, desc, asc, like, or, sql, count, inArray } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

const app = new Hono();

// ─── Helper: generate ticket number ──────────────────────────────────────────
async function nextTicketNumber(companyId: string): Promise<string> {
  const [result] = await db.select({ cnt: count() }).from(supportTicket).where(eq(supportTicket.companyId, companyId));
  return 'TKT-' + String((result?.cnt || 0) + 1).padStart(4, '0');
}

// ─── Helper: apply SLA deadlines ─────────────────────────────────────────────
async function applySla(companyId: string, priority: string) {
  const [policy] = await db.select().from(supportSlaPolicy)
    .where(and(eq(supportSlaPolicy.companyId, companyId), eq(supportSlaPolicy.priority, priority), eq(supportSlaPolicy.active, true)))
    .limit(1);

  if (!policy) {
    // Default SLA: response 4h, resolve 24h for normal
    const defaults: Record<string, { response: number; resolve: number }> = {
      critical: { response: 30, resolve: 240 },
      urgent: { response: 60, resolve: 480 },
      high: { response: 120, resolve: 960 },
      normal: { response: 240, resolve: 1440 },
      low: { response: 480, resolve: 2880 },
    };
    const d = defaults[priority] || defaults.normal;
    const now = new Date();
    return {
      slaResponseDue: new Date(now.getTime() + d.response * 60000),
      slaResolveDue: new Date(now.getTime() + d.resolve * 60000),
    };
  }

  const now = new Date();
  return {
    slaResponseDue: new Date(now.getTime() + policy.responseTimeMinutes * 60000),
    slaResolveDue: new Date(now.getTime() + policy.resolveTimeMinutes * 60000),
  };
}

// ─── Helper: auto-categorize with simple keyword matching ────────────────────
function autoCategory(subject: string, description?: string): { category: string; priorityScore: number } {
  const text = ((subject || '') + ' ' + (description || '')).toLowerCase();

  const categories: [string, string[], number][] = [
    ['billing', ['invoice', 'payment', 'charge', 'subscription', 'billing', 'refund', 'price'], 40],
    ['bug', ['bug', 'error', 'crash', 'broken', 'not working', 'fails', '500', '404', 'issue'], 60],
    ['technical', ['setup', 'install', 'configure', 'api', 'integration', 'deploy', 'database', 'server'], 50],
    ['feature_request', ['feature', 'request', 'wish', 'would be nice', 'suggestion', 'add', 'improve'], 30],
    ['general', [], 20],
  ];

  for (const [cat, keywords, score] of categories) {
    if (keywords.some(k => text.includes(k))) {
      return { category: cat, priorityScore: score };
    }
  }
  return { category: 'general', priorityScore: 20 };
}


// ─── Protected routes ────────────────────────────────────────────────────────
app.use('*', authenticate);

// GET /support/tickets — list tickets
app.get('/tickets', async (c) => {
  const u = c.get('user') as any;
  const status = c.req.query('status');
  const priority = c.req.query('priority');
  const assignedToMe = c.req.query('mine');
  const type = c.req.query('type');
  const search = c.req.query('search');
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '50');

  try {
    const conditions = [eq(supportTicket.companyId, u.companyId)];
    if (status) conditions.push(eq(supportTicket.status, status));
    if (priority) conditions.push(eq(supportTicket.priority, priority));
    if (type) conditions.push(eq(supportTicket.type, type));
    if (assignedToMe === 'true') conditions.push(eq(supportTicket.assignedToId, u.userId));
    if (search) conditions.push(or(
      like(supportTicket.subject, '%' + search + '%'),
      like(supportTicket.number, '%' + search + '%'),
    )!);

    const where = and(...conditions);
    const [totalResult] = await db.select({ cnt: count() }).from(supportTicket).where(where);
    const total = totalResult?.cnt || 0;

    const tickets = await db.select().from(supportTicket)
      .where(where)
      .orderBy(desc(supportTicket.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return c.json({ data: tickets, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e: any) {
    if (e.message?.includes('does not exist')) return c.json({ data: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } });
    throw e;
  }
});

// GET /support/tickets/stats
app.get('/tickets/stats', async (c) => {
  const u = c.get('user') as any;
  try {
    const all = await db.select({
      status: supportTicket.status,
      cnt: count(),
    }).from(supportTicket)
      .where(eq(supportTicket.companyId, u.companyId))
      .groupBy(supportTicket.status);

    const breached = await db.select({ cnt: count() }).from(supportTicket)
      .where(and(
        eq(supportTicket.companyId, u.companyId),
        inArray(supportTicket.status, ['open', 'in_progress']),
        sql`${supportTicket.slaResolveDue} < now()`,
      ));

    const stats: Record<string, number> = {};
    for (const row of all) stats[row.status] = row.cnt;
    stats.sla_breached = breached[0]?.cnt || 0;

    return c.json(stats);
  } catch (e: any) {
    if (e.message?.includes('does not exist')) return c.json({});
    throw e;
  }
});

// POST /support/tickets — create ticket
app.post('/tickets', async (c) => {
  const u = c.get('user') as any;
  const body = await c.req.json();
  const number = await nextTicketNumber(u.companyId);

  const ai = autoCategory(body.subject, body.description);
  const sla = await applySla(u.companyId, body.priority || 'normal');

  const [ticket] = await db.insert(supportTicket).values({
    number,
    subject: body.subject,
    description: body.description,
    priority: body.priority || 'normal',
    category: body.category || ai.category,
    type: body.type || 'internal',
    source: body.source || 'portal',
    contactId: body.contactId || null,
    assignedToId: body.assignedToId || null,
    createdById: u.userId,
    companyId: u.companyId,
    tags: body.tags || [],
    aiCategory: ai.category,
    aiPriorityScore: ai.priorityScore,
    ...sla,
  }).returning();

  return c.json(ticket, 201);
});

// GET /support/tickets/:id
app.get('/tickets/:id', async (c) => {
  const u = c.get('user') as any;
  const id = c.req.param('id');

  const [ticket] = await db.select().from(supportTicket)
    .where(and(eq(supportTicket.id, id), eq(supportTicket.companyId, u.companyId)));

  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
  return c.json(ticket);
});

// PATCH /support/tickets/:id
app.patch('/tickets/:id', async (c) => {
  const u = c.get('user') as any;
  const id = c.req.param('id');
  const body = await c.req.json();

  const updates: any = { updatedAt: new Date() };
  if (body.status) updates.status = body.status;
  if (body.priority) updates.priority = body.priority;
  if (body.category) updates.category = body.category;
  if (body.assignedToId !== undefined) updates.assignedToId = body.assignedToId;
  if (body.tags) updates.tags = body.tags;

  if (body.status === 'resolved') updates.resolvedAt = new Date();
  if (body.status === 'closed') updates.closedAt = new Date();

  const [ticket] = await db.update(supportTicket).set(updates)
    .where(and(eq(supportTicket.id, id), eq(supportTicket.companyId, u.companyId)))
    .returning();

  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
  return c.json(ticket);
});

// POST /support/tickets/:id/rate
app.post('/tickets/:id/rate', async (c) => {
  const u = c.get('user') as any;
  const id = c.req.param('id');
  const { rating, comment } = await c.req.json();

  const [ticket] = await db.update(supportTicket).set({
    rating: Math.min(5, Math.max(1, rating)),
    ratingComment: comment || null,
    updatedAt: new Date(),
  }).where(and(eq(supportTicket.id, id), eq(supportTicket.companyId, u.companyId)))
    .returning();

  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
  return c.json(ticket);
});

// ─── Messages ────────────────────────────────────────────────────────────────

// GET /support/tickets/:id/messages
app.get('/tickets/:id/messages', async (c) => {
  const u = c.get('user') as any;
  const ticketId = c.req.param('id');

  // Verify ticket belongs to company
  const [ticket] = await db.select({ id: supportTicket.id }).from(supportTicket)
    .where(and(eq(supportTicket.id, ticketId), eq(supportTicket.companyId, u.companyId)));
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  const messages = await db.select().from(supportTicketMessage)
    .where(eq(supportTicketMessage.ticketId, ticketId))
    .orderBy(asc(supportTicketMessage.createdAt));

  return c.json(messages);
});

// POST /support/tickets/:id/messages
app.post('/tickets/:id/messages', async (c) => {
  const u = c.get('user') as any;
  const ticketId = c.req.param('id');
  const body = await c.req.json();

  const [ticket] = await db.select().from(supportTicket)
    .where(and(eq(supportTicket.id, ticketId), eq(supportTicket.companyId, u.companyId)));
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  // Track first response for SLA
  const updates: any = { updatedAt: new Date() };
  if (!ticket.firstResponseAt && !body.isInternal) {
    updates.firstResponseAt = new Date();
  }
  if (ticket.status === 'open') {
    updates.status = 'in_progress';
  }
  await db.update(supportTicket).set(updates).where(eq(supportTicket.id, ticketId));

  const [msg] = await db.insert(supportTicketMessage).values({
    ticketId,
    body: body.body,
    isInternal: body.isInternal || false,
    userId: u.userId,
  }).returning();

  return c.json(msg, 201);
});

// ─── Knowledge Base ──────────────────────────────────────────────────────────

app.get('/kb', async (c) => {
  const u = c.get('user') as any;
  const search = c.req.query('search');
  const category = c.req.query('category');

  try {
    const conditions = [eq(supportKnowledgeBase.companyId, u.companyId), eq(supportKnowledgeBase.published, true)];
    if (category) conditions.push(eq(supportKnowledgeBase.category, category));
    if (search) conditions.push(or(
      like(supportKnowledgeBase.title, '%' + search + '%'),
      like(supportKnowledgeBase.content, '%' + search + '%'),
    )!);

    const articles = await db.select().from(supportKnowledgeBase)
      .where(and(...conditions))
      .orderBy(desc(supportKnowledgeBase.viewCount))
      .limit(50);

    return c.json(articles);
  } catch (e: any) {
    if (e.message?.includes('does not exist')) return c.json([]);
    throw e;
  }
});

app.post('/kb', async (c) => {
  const u = c.get('user') as any;
  const body = await c.req.json();

  const [article] = await db.insert(supportKnowledgeBase).values({
    title: body.title,
    content: body.content,
    category: body.category,
    tags: body.tags || [],
    companyId: u.companyId,
    createdById: u.userId,
  }).returning();

  return c.json(article, 201);
});

app.put('/kb/:id', async (c) => {
  const u = c.get('user') as any;
  const id = c.req.param('id');
  const body = await c.req.json();

  const [article] = await db.update(supportKnowledgeBase).set({
    title: body.title,
    content: body.content,
    category: body.category,
    tags: body.tags,
    published: body.published,
    updatedAt: new Date(),
  }).where(and(eq(supportKnowledgeBase.id, id), eq(supportKnowledgeBase.companyId, u.companyId)))
    .returning();

  if (!article) return c.json({ error: 'Article not found' }, 404);
  return c.json(article);
});

app.delete('/kb/:id', async (c) => {
  const u = c.get('user') as any;
  const id = c.req.param('id');

  await db.delete(supportKnowledgeBase)
    .where(and(eq(supportKnowledgeBase.id, id), eq(supportKnowledgeBase.companyId, u.companyId)));

  return c.json({ success: true });
});

// ─── AI Chat ─────────────────────────────────────────────────────────────────
// Level 3: AI tries to resolve using knowledge base before creating a ticket

app.post('/ai-chat', async (c) => {
  const u = c.get('user') as any;
  const { message, conversationHistory } = await c.req.json();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ reply: 'AI support is not configured. Please submit a ticket instead.', resolved: false });

  // Fetch relevant KB articles
  let kbContext = '';
  try {
    const articles = await db.select({
      title: supportKnowledgeBase.title,
      content: supportKnowledgeBase.content,
    }).from(supportKnowledgeBase)
      .where(and(eq(supportKnowledgeBase.companyId, u.companyId), eq(supportKnowledgeBase.published, true)))
      .limit(20);

    if (articles.length > 0) {
      kbContext = '\n\nKnowledge Base Articles:\n' + articles.map(a => `## ${a.title}\n${a.content}`).join('\n\n');
    }
  } catch {}

  const systemPrompt = `You are a helpful support assistant for a business management CRM. Answer questions based on the knowledge base articles provided. If you cannot find a relevant answer, say you'll need to create a support ticket for the team to handle.${kbContext}`;

  const messages = [
    ...(conversationHistory || []).map((m: any) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await res.json() as any;
    const reply = data.content?.[0]?.text || 'Sorry, I could not process that request.';

    const resolved = !reply.toLowerCase().includes('support ticket') && !reply.toLowerCase().includes('team to handle');

    return c.json({ reply, resolved });
  } catch (e) {
    return c.json({ reply: 'AI service is temporarily unavailable. Please submit a ticket instead.', resolved: false });
  }
});

// ─── SLA Policies ────────────────────────────────────────────────────────────

app.get('/sla-policies', async (c) => {
  const u = c.get('user') as any;
  try {
    const policies = await db.select().from(supportSlaPolicy)
      .where(eq(supportSlaPolicy.companyId, u.companyId))
      .orderBy(asc(supportSlaPolicy.priority));
    return c.json(policies);
  } catch (e: any) {
    if (e.message?.includes('does not exist')) return c.json([]);
    throw e;
  }
});

app.post('/sla-policies', async (c) => {
  const u = c.get('user') as any;
  const body = await c.req.json();

  const [policy] = await db.insert(supportSlaPolicy).values({
    name: body.name,
    priority: body.priority,
    responseTimeMinutes: body.responseTimeMinutes,
    resolveTimeMinutes: body.resolveTimeMinutes,
    escalateAfterMinutes: body.escalateAfterMinutes,
    companyId: u.companyId,
  }).returning();

  return c.json(policy, 201);
});

// ─── Pattern Detection (Level 5) ────────────────────────────────────────────

app.get('/tickets/patterns', async (c) => {
  const u = c.get('user') as any;

  try {
    // Category distribution
    const byCategory = await db.select({
      category: supportTicket.category,
      cnt: count(),
    }).from(supportTicket)
      .where(eq(supportTicket.companyId, u.companyId))
      .groupBy(supportTicket.category);

    // Priority distribution
    const byPriority = await db.select({
      priority: supportTicket.priority,
      cnt: count(),
    }).from(supportTicket)
      .where(eq(supportTicket.companyId, u.companyId))
      .groupBy(supportTicket.priority);

    // Average rating
    const [avgRating] = await db.select({
      avg: sql<number>`avg(${supportTicket.rating})`,
      cnt: sql<number>`count(${supportTicket.rating})`,
    }).from(supportTicket)
      .where(and(eq(supportTicket.companyId, u.companyId), sql`${supportTicket.rating} is not null`));

    // Recent trends — tickets per day for last 30 days
    const daily = await db.select({
      day: sql<string>`date(${supportTicket.createdAt})`,
      cnt: count(),
    }).from(supportTicket)
      .where(and(
        eq(supportTicket.companyId, u.companyId),
        sql`${supportTicket.createdAt} > now() - interval '30 days'`,
      ))
      .groupBy(sql`date(${supportTicket.createdAt})`)
      .orderBy(sql`date(${supportTicket.createdAt})`);

    return c.json({
      byCategory,
      byPriority,
      averageRating: avgRating?.avg ? Number(avgRating.avg).toFixed(1) : null,
      ratedCount: avgRating?.cnt || 0,
      dailyTrend: daily,
    });
  } catch (e: any) {
    if (e.message?.includes('does not exist')) return c.json({ byCategory: [], byPriority: [], averageRating: null, ratedCount: 0, dailyTrend: [] });
    throw e;
  }
});

export default app;
