import { Hono } from 'hono';
import { reportAiUsage } from '../services/aiUsage'
import { authenticate } from '../middleware/auth.ts';
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts';
import { db } from '../../db/index.ts';
import { supportTicket, supportTicketMessage, supportKnowledgeBase, supportSlaPolicy, contact, user } from '../../db/schema.ts';
import { eq, and, desc, asc, like, or, sql, count, inArray } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
// One numbering rule for every document in the product — locked, and only ever forwards.
import { nextNumber } from '../shared/invoicing/money.ts';
import { enabledFeaturesFor } from '../middleware/enabledFeature.ts';
import { visibleArticles, enabledTopics } from '../utils/helpArticles.ts';

const app = new Hono();

// ─── Helper: generate ticket number ──────────────────────────────────────────
/**
 * TICKET NUMBERS ONLY GO FORWARDS. (T58k)
 *
 * `COUNT(*) + 1` does not need the newest ticket deleted to break: delete ANY one and the count
 * lands on a number another ticket still holds. A ticket number is what a customer quotes back at
 * you, so two tickets sharing one is the whole problem.
 *
 * Nobody reported this. It was found by sweeping EVERY generator in the product after T58j fixed
 * only the three the owner had named and left the siblings — the shared pricebook, the recurring
 * invoice, both change-order writers and this — still reusing numbers.
 *
 * Takes the caller's transaction so nextNumber's advisory lock still holds when the row lands.
 */
async function nextTicketNumber(companyId: string, exec: any = db): Promise<string> {
  return nextNumber(exec, supportTicket, supportTicket.number, supportTicket.companyId, companyId, { prefix: 'TKT', pad: 4 });
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
// A ticket's subject is the only thing the queue shows, and its priority and status are what the queue
// is SORTED by — so a blank subject is a row nobody can act on, and "banana" priority is a row that
// sorts nowhere. All three saved happily. (Salon T28 M8)
const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];

app.post('/tickets', async (c) => {
  const u = c.get('user') as any;
  const body = await c.req.json();
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject) return c.json({ error: 'A subject is required — it is the only thing the ticket list shows.' }, 400);
  if (subject.length > 200) return c.json({ error: 'Subject must be 200 characters or fewer.' }, 400);
  if (body.priority !== undefined && body.priority !== null && !TICKET_PRIORITIES.includes(String(body.priority))) {
    return c.json({ error: `Priority must be one of ${TICKET_PRIORITIES.join(', ')}.` }, 400);
  }
  if (body.status !== undefined && body.status !== null && !TICKET_STATUSES.includes(String(body.status))) {
    return c.json({ error: `Status must be one of ${TICKET_STATUSES.join(', ')}.` }, 400);
  }

  const ai = autoCategory(body.subject, body.description);
  const sla = await applySla(u.companyId, body.priority || 'normal');

  // One transaction: the number's lock must still be held when the ticket lands. (T58k)
  const [ticket] = await db.transaction(async (tx: any) => tx.insert(supportTicket).values({
    number: await nextTicketNumber(u.companyId, tx),
    subject,
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
  }).returning());

  return c.json(ticket, 201);
});

// GET /support/tickets/:id
/**
 * DECLARED BEFORE /tickets/:id, and it has to stay there. (T38)
 *
 * Hono matches in registration order. This sat below the `:id` route, so every request for it was
 * answered by that handler as a lookup for a ticket whose id is the word "patterns" —
 * {"error":"Ticket not found"}, for the life of the endpoint, in nine of the ten templates that
 * carry it. `/tickets/stats` a few lines above was always correct, which is how the rule was known
 * and the later addition still missed it.
 */

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

  /**
   * DESK WORK, NOT GETTING HELP. (T42: "a viewer can … edit support tickets through the API")
   *
   * This route had `authenticate` and nothing else, so any seat that could sign in — a read-only
   * viewer included — could close, reprioritise or reassign anybody's ticket. Raising and replying
   * stay open by design (see the note beside support:update in the permission matrix); changing a
   * ticket's state is a different act.
   *
   * The raiser keeps control of their OWN ticket, which is the latitude the matrix already gives a
   * person over their own timesheet line. Reassignment is triage and needs the permission either
   * way, because handing work to somebody else is not a thing you do to your own ticket.
   */
  const mayTriage = hasPermission(u.role, 'support:update', await getExtraPermissions(u.userId));
  const [existing] = await db.select({ createdById: supportTicket.createdById }).from(supportTicket)
    .where(and(eq(supportTicket.id, id), eq(supportTicket.companyId, u.companyId))).limit(1);
  if (!existing) return c.json({ error: 'Ticket not found' }, 404);
  const isRaiser = !!existing.createdById && existing.createdById === u.userId;
  if (!mayTriage && !isRaiser) {
    return c.json({ error: 'You can change a support ticket you raised; changing anybody else\'s needs support:update.' }, 403);
  }
  if (body.assignedToId !== undefined && !mayTriage) {
    return c.json({ error: 'Assigning a support ticket to somebody needs support:update.' }, 403);
  }

  if (body.status !== undefined && body.status !== null && !TICKET_STATUSES.includes(String(body.status))) {
    return c.json({ error: `Status must be one of ${TICKET_STATUSES.join(', ')}.` }, 400);
  }
  if (body.priority !== undefined && body.priority !== null && !TICKET_PRIORITIES.includes(String(body.priority))) {
    return c.json({ error: `Priority must be one of ${TICKET_PRIORITIES.join(', ')}.` }, 400);
  }
  if (body.subject !== undefined && !String(body.subject).trim()) {
    return c.json({ error: 'A subject is required — it is the only thing the ticket list shows.' }, 400);
  }

  const updates: any = { updatedAt: new Date() };
  if (body.subject !== undefined) updates.subject = String(body.subject).trim().slice(0, 200);
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

  // Replying is open to every seat — that is how somebody gets help. An INTERNAL note is written
  // ABOUT the requester rather than to them, and it is the one thing on this route that is desk
  // work. (T42: "posting internal notes also succeed" for a viewer.)
  if (body.isInternal && !hasPermission(u.role, 'support:update', await getExtraPermissions(u.userId))) {
    return c.json({ error: 'An internal note is only visible to the desk, so writing one needs support:update. Post it as a normal reply instead.' }, 403);
  }

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

    // Help must not describe a module this tenant does not have. "Marketing campaigns — reach your
    // clients from the Marketing page" was offered with Email Marketing switched off, where there is no
    // such page and no sidebar entry to it. Anything the salon wrote themselves is always kept.
    // (Salon T27 N15)
    return c.json(visibleArticles(articles, await enabledFeaturesFor(u.companyId)));
  } catch (e: any) {
    if (e.message?.includes('does not exist')) return c.json([]);
    throw e;
  }
});

app.post('/kb', requirePermission('support-kb:create'), async (c) => {
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

app.put('/kb/:id', requirePermission('support-kb:update'), async (c) => {
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

app.delete('/kb/:id', requirePermission('support-kb:delete'), async (c) => {
  const u = c.get('user') as any;
  const id = c.req.param('id');

  await db.delete(supportKnowledgeBase)
    .where(and(eq(supportKnowledgeBase.id, id), eq(supportKnowledgeBase.companyId, u.companyId)));

  return c.json({ success: true });
});

// ─── AI Chat ─────────────────────────────────────────────────────────────────
// Level 3: AI tries to resolve using knowledge base before creating a ticket

/**
 * AN EMPTY QUESTION IS NOT A QUESTION. (T58j)
 *
 *   showcase: "an empty AI chat request returns 200."
 *
 * Reported on one tenant, identical in eleven. Measured live on basictest, `{}`, `{"message":""}`
 * and `{"message":"   "}` all answered:
 *
 *     200 {"reply":"Sorry, I could not process that request.","resolved":true}
 *
 * `resolved: true` — on a request that was never answered. The empty message went to the Anthropic
 * API as empty content, the API refused it, `data.content` was absent, `reply` fell back to the
 * apology string, and the `resolved` line asked only whether that string mentions a support ticket.
 * It does not, so a FAILED call was reported to the screen as a resolved conversation — the state
 * that stops a ticket being raised. A customer with a problem is told it is handled.
 *
 * So: the message is required and bounded before anything is spent, a malformed body is a 400 rather
 * than a 500, and `resolved` is only ever computed from a reply the model actually produced.
 */
const MAX_CHAT_CHARS = 8000;

app.post('/ai-chat', async (c) => {
  const u = c.get('user') as any;
  // A body that is not JSON threw here and became a 500. It is a bad request, and says so.
  const body = await c.req.json().catch(() => null) as any;
  if (!body || typeof body !== 'object') return c.json({ error: 'Send a JSON body with a message.' }, 400);
  const { message, conversationHistory } = body;
  const asked = typeof message === 'string' ? message.trim() : '';
  if (!asked) return c.json({ error: 'Type a question first.' }, 400);
  if (asked.length > MAX_CHAT_CHARS) {
    return c.json({ error: `That question is too long — keep it under 8,000 characters.` }, 400);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ reply: 'AI support is not configured. Please submit a ticket instead.', resolved: false });

  // What this company actually has. The prompt below used to hard-list every salon feature, so the
  // assistant recommended the Marketing page to tenants without one — inventing a screen, in the one
  // place people go when they cannot find a screen. (Salon T27 N15)
  const companyFeatures = await enabledFeaturesFor(u.companyId);

  // Fetch relevant KB articles
  let kbContext = '';
  try {
    const articles = await db.select({
      title: supportKnowledgeBase.title,
      content: supportKnowledgeBase.content,
    }).from(supportKnowledgeBase)
      .where(and(eq(supportKnowledgeBase.companyId, u.companyId), eq(supportKnowledgeBase.published, true)))
      .limit(20);

    const grounded = visibleArticles(articles, companyFeatures);
    if (grounded.length > 0) {
      kbContext = '\n\nKnowledge Base Articles:\n' + grounded.map(a => `## ${a.title}\n${a.content}`).join('\n\n');
    }
  } catch {}

  // Ground the assistant in THIS product's actual features. It used to describe a generic
  // CRM and told salon users their formula history / rebooking features don't exist and to
  // "create a Job or Schedule page" — construction concepts this app doesn't have. (HELP-01)
  const systemPrompt = `You are a helpful support assistant for a salon & spa management CRM. The features THIS salon has are: ${enabledTopics(companyFeatures) || 'Client Profiles and the Service Menu'}. Those are the only ones that exist for this user — never mention or suggest a feature that is not in that list, because the page for it is not in their app. This app has NO "jobs", "projects", "quotes", or "change orders" — never suggest those. Answer from these features and the knowledge base articles provided. If you cannot find a relevant answer, say you'll need to create a support ticket for the team to handle.${kbContext}`;

  const messages = [
    ...(conversationHistory || []).map((m: any) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: asked },
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
    reportAiUsage(data.usage?.input_tokens, data.usage?.output_tokens, 'claude-haiku-4-5-20251001');
    /**
     * NO ANSWER IS NOT A RESOLVED CONVERSATION.
     *
     * `resolved` used to be computed from the fallback apology string, which mentions neither
     * trigger phrase — so an upstream refusal came back as `resolved: true` and the screen stopped
     * offering to raise a ticket. Resolution is now only ever read off a reply the model produced.
     */
    const answer = typeof data?.content?.[0]?.text === 'string' ? data.content[0].text : '';
    if (!res.ok || !answer) {
      console.warn('[support/ai-chat] no answer', { status: res.status, type: data?.error?.type });
      return c.json({ reply: 'AI support could not answer that just now. Please submit a ticket and the team will pick it up.', resolved: false });
    }

    const resolved = !answer.toLowerCase().includes('support ticket') && !answer.toLowerCase().includes('team to handle');

    return c.json({ reply: answer, resolved });
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

app.post('/sla-policies', requirePermission('support-sla:create'), async (c) => {
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

export default app;
