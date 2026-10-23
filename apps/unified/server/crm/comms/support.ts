// /api/support — this business's own help desk: tickets, their messages, the knowledge base, an AI chat over it, SLA
// policies and the pattern report. Moved from templates/crm/backend/src/routes/support.ts. (Contacting Twomiah, the
// software vendor, is /api/platform-support.)
//
// Raising a ticket, reading the desk and replying are open to every seat by design — that is how somebody gets help.
// Changing a ticket's state is desk work (support:update), except on a ticket you raised; an internal note needs
// support:update; the knowledge base and SLA policies are written with their own permissions.
import { Hono } from 'hono'
import { eq, and, desc, asc, like, or, count } from 'drizzle-orm'
import { nextNumber, reportAiUsage } from '@twomiah/tenant-backend'
import { supportTicket, supportTicketMessage, supportKnowledgeBase, supportSlaPolicy } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one, done, listAll } from '../../http/reply.ts'
import { ticketStatusCounts, ticketPatterns } from '../../data/support.ts'
import type { CrmDeps } from '../deps.ts'

/** The statuses and priorities written beside the columns in the schema. `category` is a free-text label. */
const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent', 'critical']
const MAX_CHAT_CHARS = 8000

/** A first guess at the category and how pressing it is, from keywords in the subject and description. */
function autoCategory(subject: string, description?: string): { category: string; priorityScore: number } {
  const text = ((subject || '') + ' ' + (description || '')).toLowerCase()
  const categories: [string, string[], number][] = [
    ['billing', ['invoice', 'payment', 'charge', 'subscription', 'billing', 'refund', 'price'], 40],
    ['bug', ['bug', 'error', 'crash', 'broken', 'not working', 'fails', '500', '404', 'issue'], 60],
    ['technical', ['setup', 'install', 'configure', 'api', 'integration', 'deploy', 'database', 'server'], 50],
    ['feature_request', ['feature', 'request', 'wish', 'would be nice', 'suggestion', 'add', 'improve'], 30],
    ['general', [], 20],
  ]
  for (const [cat, keywords, score] of categories) {
    if (keywords.some((k) => text.includes(k))) return { category: cat, priorityScore: score }
  }
  return { category: 'general', priorityScore: 20 }
}

/** A missing table (an old tenant database) answers empty rather than 500, as the template did. */
const missingTable = (e: any) => !!e?.message?.includes('does not exist')

export function createSupportRoutes(d: CrmDeps) {
  const { db, logger } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  /**
   * The help articles this business can act on (CrmSettings.help.articleFeatures): a seeded article about a module that is
   * switched off is left out; anything the business wrote itself is always kept. An EMPTY feature list hides nothing —
   * a business not yet synced must not lose its way out. (templates/crm-salon utils/helpArticles.ts, Salon T27 N15)
   */
  async function visible<T extends { title: string }>(companyId: string, rows: T[]): Promise<T[]> {
    const map = d.settings?.help?.articleFeatures
    if (!map) return rows
    const features = await d.features.enabledFeaturesFor(companyId)
    return features.length === 0 ? rows : rows.filter((r) => { const f = map[r.title]; return !f || features.includes(f) })
  }

  /** The vertical's features this business has on, in the words the assistant may use (CrmSettings.help.topics). */
  async function enabledTopics(companyId: string): Promise<string> {
    const topics = d.settings?.help?.topics || []
    const features = await d.features.enabledFeaturesFor(companyId)
    return (features.length === 0 ? topics : topics.filter(([id]) => features.includes(id))).map(([, label]) => label).join(', ')
  }

  /** Ticket numbers only go forwards: the shared locked numbering, inside the caller's transaction. (T58k) */
  const nextTicketNumber = (companyId: string, exec: any) =>
    nextNumber(exec, supportTicket, supportTicket.number, supportTicket.companyId, companyId, { prefix: 'TKT', pad: 4 } as any)

  /** The response and resolve deadlines for a priority: the company's active policy, or the defaults. */
  async function applySla(companyId: string, priority: string) {
    const [policy] = await db.select().from(supportSlaPolicy)
      .where(and(eq(supportSlaPolicy.companyId, companyId), eq(supportSlaPolicy.priority, priority), eq(supportSlaPolicy.active, true)))
      .limit(1)
    const now = new Date()
    if (!policy) {
      const defaults: Record<string, { response: number; resolve: number }> = {
        critical: { response: 30, resolve: 240 },
        urgent: { response: 60, resolve: 480 },
        high: { response: 120, resolve: 960 },
        normal: { response: 240, resolve: 1440 },
        low: { response: 480, resolve: 2880 },
      }
      const dft = defaults[priority] || defaults.normal
      return { slaResponseDue: new Date(now.getTime() + dft.response * 60000), slaResolveDue: new Date(now.getTime() + dft.resolve * 60000) }
    }
    return {
      slaResponseDue: new Date(now.getTime() + policy.responseTimeMinutes * 60000),
      slaResolveDue: new Date(now.getTime() + policy.resolveTimeMinutes * 60000),
    }
  }

  const mayTriage = async (u: any) => hasPermission(u.role, 'support:update', await getExtraPermissions(u.userId))

  // ── Tickets ──

  app.get('/tickets', async (c) => {
    const u = c.get('user')
    const status = c.req.query('status')
    const priority = c.req.query('priority')
    const type = c.req.query('type')
    const search = c.req.query('search')
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '50')
    try {
      const conditions: any[] = [eq(supportTicket.companyId, u.companyId)]
      if (status) conditions.push(eq(supportTicket.status, status))
      if (priority) conditions.push(eq(supportTicket.priority, priority))
      if (type) conditions.push(eq(supportTicket.type, type))
      if (c.req.query('mine') === 'true') conditions.push(eq(supportTicket.assignedToId, u.userId))
      if (search) conditions.push(or(like(supportTicket.subject, '%' + search + '%'), like(supportTicket.number, '%' + search + '%')))
      const where = and(...conditions)
      const [totalResult] = await db.select({ cnt: count() }).from(supportTicket).where(where)
      const total = totalResult?.cnt || 0
      const tickets = await db.select().from(supportTicket).where(where)
        .orderBy(desc(supportTicket.createdAt)).limit(limit).offset((page - 1) * limit)
      return list(c, tickets, { page, limit, total })
    } catch (e: any) {
      if (missingTable(e)) return list(c, [], { page: 1, limit: 50, total: 0 })
      throw e
    }
  })

  app.get('/tickets/stats', async (c) => {
    const u = c.get('user')
    try {
      const { byStatus, slaBreached } = await ticketStatusCounts(db, u.companyId)
      // Keyed by status value (the screen reads stats.open, stats.in_progress …) plus sla_breached.
      const stats: Record<string, number> = {}
      for (const row of byStatus) stats[row.status] = row.cnt
      stats.sla_breached = slaBreached
      return one(c, stats)
    } catch (e: any) {
      if (missingTable(e)) return one(c, {})
      throw e
    }
  })

  app.post('/tickets', async (c) => {
    const u = c.get('user')
    const body = await c.req.json()
    // A ticket's subject is the only thing the queue shows, and its priority and status are what the queue is sorted
    // by: a blank subject or a "banana" priority saved happily and sorted nowhere (templates/crm-salon routes/support.ts,
    // Salon T28 M8 — for every vertical).
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    if (!subject) return fail(c, 400, 'A subject is required — it is the only thing the ticket list shows.')
    if (subject.length > 200) return fail(c, 400, 'Subject must be 200 characters or fewer.')
    if (body.priority !== undefined && body.priority !== null && !TICKET_PRIORITIES.includes(String(body.priority))) {
      return fail(c, 400, `"${body.priority}" is not a ticket priority. Use one of: ${TICKET_PRIORITIES.join(', ')}.`)
    }
    if (body.status !== undefined && body.status !== null && !TICKET_STATUSES.includes(String(body.status))) {
      return fail(c, 400, `"${body.status}" is not a ticket status. Use one of: ${TICKET_STATUSES.join(', ')}.`)
    }
    body.subject = subject
    const ai = autoCategory(body.subject, body.description)
    const sla = await applySla(u.companyId, body.priority || 'normal')
    // One transaction: the number's lock is still held when the ticket lands. (T58k)
    const [ticket] = await db.transaction(async (tx: any) => tx.insert(supportTicket).values({
      number: await nextTicketNumber(u.companyId, tx),
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
    }).returning())
    return one(c, ticket, 201)
  })

  // Above /tickets/:id, or ":id" answers it as a ticket named "patterns". (T38)
  app.get('/tickets/patterns', async (c) => {
    const u = c.get('user')
    try {
      const p = await ticketPatterns(db, u.companyId)
      return one(c, {
        byCategory: p.byCategory,
        byPriority: p.byPriority,
        averageRating: p.ratingAvg ? Number(p.ratingAvg).toFixed(1) : null,
        ratedCount: p.ratedCount,
        dailyTrend: p.daily,
      })
    } catch (e: any) {
      if (missingTable(e)) return one(c, { byCategory: [], byPriority: [], averageRating: null, ratedCount: 0, dailyTrend: [] })
      throw e
    }
  })

  app.get('/tickets/:id', async (c) => {
    const u = c.get('user')
    const [ticket] = await db.select().from(supportTicket)
      .where(and(eq(supportTicket.id, c.req.param('id')), eq(supportTicket.companyId, u.companyId)))
    if (!ticket) return fail(c, 404, 'Ticket not found')
    return one(c, ticket)
  })

  app.patch('/tickets/:id', async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const body = await c.req.json()

    // Desk work, not getting help (T42): the raiser keeps control of their own ticket; anybody else's, and any
    // reassignment, needs support:update.
    const triage = await mayTriage(u)
    const [existing] = await db.select({ createdById: supportTicket.createdById }).from(supportTicket)
      .where(and(eq(supportTicket.id, id), eq(supportTicket.companyId, u.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Ticket not found')
    const isRaiser = !!existing.createdById && existing.createdById === u.userId
    if (!triage && !isRaiser) return fail(c, 403, 'You can change a support ticket you raised; changing anybody else\'s needs support:update.')
    if (body.assignedToId !== undefined && !triage) return fail(c, 403, 'Assigning a support ticket to somebody needs support:update.')

    // A status or priority the product does not know would strand the ticket in no filter and no bucket. (T42)
    if (body.status !== undefined && !TICKET_STATUSES.includes(body.status)) {
      return fail(c, 400, `"${body.status}" is not a ticket status. Use one of: ${TICKET_STATUSES.join(', ')}.`)
    }
    if (body.priority !== undefined && !TICKET_PRIORITIES.includes(body.priority)) {
      return fail(c, 400, `"${body.priority}" is not a ticket priority. Use one of: ${TICKET_PRIORITIES.join(', ')}.`)
    }
    // The subject can be corrected, never blanked (Salon T28 M8).
    if (body.subject !== undefined && !String(body.subject).trim()) {
      return fail(c, 400, 'A subject is required — it is the only thing the ticket list shows.')
    }

    const updates: any = { updatedAt: new Date() }
    if (body.subject !== undefined) updates.subject = String(body.subject).trim().slice(0, 200)
    if (body.status) updates.status = body.status
    if (body.priority) updates.priority = body.priority
    if (body.category) updates.category = body.category
    if (body.assignedToId !== undefined) updates.assignedToId = body.assignedToId
    if (body.tags) updates.tags = body.tags
    if (body.status === 'resolved') updates.resolvedAt = new Date()
    if (body.status === 'closed') updates.closedAt = new Date()

    const [ticket] = await db.update(supportTicket).set(updates)
      .where(and(eq(supportTicket.id, id), eq(supportTicket.companyId, u.companyId))).returning()
    if (!ticket) return fail(c, 404, 'Ticket not found')
    return one(c, ticket)
  })

  app.post('/tickets/:id/rate', async (c) => {
    const u = c.get('user')
    const { rating, comment } = await c.req.json()
    const [ticket] = await db.update(supportTicket).set({
      rating: Math.min(5, Math.max(1, rating)),
      ratingComment: comment || null,
      updatedAt: new Date(),
    }).where(and(eq(supportTicket.id, c.req.param('id')), eq(supportTicket.companyId, u.companyId))).returning()
    if (!ticket) return fail(c, 404, 'Ticket not found')
    return one(c, ticket)
  })

  // ── Messages ──

  app.get('/tickets/:id/messages', async (c) => {
    const u = c.get('user')
    const ticketId = c.req.param('id')
    const [ticket] = await db.select({ id: supportTicket.id }).from(supportTicket)
      .where(and(eq(supportTicket.id, ticketId), eq(supportTicket.companyId, u.companyId)))
    if (!ticket) return fail(c, 404, 'Ticket not found')
    const messages = await db.select().from(supportTicketMessage)
      .where(eq(supportTicketMessage.ticketId, ticketId))
      .orderBy(asc(supportTicketMessage.createdAt))
    return listAll(c, messages)
  })

  app.post('/tickets/:id/messages', async (c) => {
    const u = c.get('user')
    const ticketId = c.req.param('id')
    const body = await c.req.json()
    const [ticket] = await db.select().from(supportTicket)
      .where(and(eq(supportTicket.id, ticketId), eq(supportTicket.companyId, u.companyId)))
    if (!ticket) return fail(c, 404, 'Ticket not found')

    // Replying is open to every seat; an INTERNAL note is written about the requester, so it is desk work. (T42)
    if (body.isInternal && !(await mayTriage(u))) {
      return fail(c, 403, 'An internal note is only visible to the desk, so writing one needs support:update. Post it as a normal reply instead.')
    }

    // The first visible reply starts the SLA clock's response; an open ticket moves to in progress.
    const updates: any = { updatedAt: new Date() }
    if (!ticket.firstResponseAt && !body.isInternal) updates.firstResponseAt = new Date()
    if (ticket.status === 'open') updates.status = 'in_progress'
    await db.update(supportTicket).set(updates).where(eq(supportTicket.id, ticketId))

    const [msg] = await db.insert(supportTicketMessage).values({
      ticketId,
      body: body.body,
      isInternal: body.isInternal || false,
      userId: u.userId,
    }).returning()
    return one(c, msg, 201)
  })

  // ── Knowledge base ──

  app.get('/kb', async (c) => {
    const u = c.get('user')
    const search = c.req.query('search')
    const category = c.req.query('category')
    try {
      const conditions: any[] = [eq(supportKnowledgeBase.companyId, u.companyId), eq(supportKnowledgeBase.published, true)]
      if (category) conditions.push(eq(supportKnowledgeBase.category, category))
      if (search) conditions.push(or(like(supportKnowledgeBase.title, '%' + search + '%'), like(supportKnowledgeBase.content, '%' + search + '%')))
      const articles = await db.select().from(supportKnowledgeBase)
        .where(and(...conditions)).orderBy(desc(supportKnowledgeBase.viewCount)).limit(50)
      // Help must not describe a module this business does not have (Salon T27 N15).
      const shown = await visible(u.companyId, articles)
      return listAll(c, shown)
    } catch (e: any) {
      if (missingTable(e)) return list(c, [], { page: 1, limit: 0, total: 0 })
      throw e
    }
  })

  app.post('/kb', requirePermission('support-kb:create'), async (c) => {
    const u = c.get('user')
    const body = await c.req.json()
    const [article] = await db.insert(supportKnowledgeBase).values({
      title: body.title,
      content: body.content,
      category: body.category,
      tags: body.tags || [],
      // The Help screen's "Show as FAQ" and order: the template dropped both, so neither ever saved.
      isFaq: body.isFaq === true,
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      companyId: u.companyId,
      createdById: u.userId,
    }).returning()
    return one(c, article, 201)
  })

  app.put('/kb/:id', requirePermission('support-kb:update'), async (c) => {
    const u = c.get('user')
    const body = await c.req.json()
    const [article] = await db.update(supportKnowledgeBase).set({
      title: body.title,
      content: body.content,
      category: body.category,
      tags: body.tags,
      published: body.published,
      isFaq: typeof body.isFaq === 'boolean' ? body.isFaq : undefined,
      sortOrder: body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : undefined,
      updatedAt: new Date(),
    }).where(and(eq(supportKnowledgeBase.id, c.req.param('id')), eq(supportKnowledgeBase.companyId, u.companyId))).returning()
    if (!article) return fail(c, 404, 'Article not found')
    return one(c, article)
  })

  app.delete('/kb/:id', requirePermission('support-kb:delete'), async (c) => {
    const u = c.get('user')
    await db.delete(supportKnowledgeBase)
      .where(and(eq(supportKnowledgeBase.id, c.req.param('id')), eq(supportKnowledgeBase.companyId, u.companyId)))
    return done(c)
  })

  // ── AI chat: tries the knowledge base before a ticket is raised ──
  // The message is required and bounded before anything is spent, and `resolved` is only ever read off a reply the
  // model actually produced — a failed call is never reported as a resolved conversation. (T58j)
  app.post('/ai-chat', async (c) => {
    const u = c.get('user')
    const body = (await c.req.json().catch(() => null)) as any
    if (!body || typeof body !== 'object') return fail(c, 400, 'Send a JSON body with a message.')
    const { message, conversationHistory } = body
    const asked = typeof message === 'string' ? message.trim() : ''
    if (!asked) return fail(c, 400, 'Type a question first.')
    if (asked.length > MAX_CHAT_CHARS) return fail(c, 400, 'That question is too long — keep it under 8,000 characters.')

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return one(c, { reply: 'AI support is not configured. Please submit a ticket instead.', resolved: false })

    let kbContext = ''
    try {
      const articles = await db.select({ title: supportKnowledgeBase.title, content: supportKnowledgeBase.content })
        .from(supportKnowledgeBase)
        .where(and(eq(supportKnowledgeBase.companyId, u.companyId), eq(supportKnowledgeBase.published, true)))
        .limit(20)
      const grounded = await visible(u.companyId, articles)
      if (grounded.length > 0) kbContext = '\n\nKnowledge Base Articles:\n' + grounded.map((a: any) => `## ${a.title}\n${a.content}`).join('\n\n')
    } catch {}

    // What the assistant is told about this business's software: the vertical's own sentence where it has one
    // (CrmSettings.support; templates/crm-vet routes/support.ts), else the generic CRM. Where the vertical names its
    // features (CrmSettings.help), the assistant is told the ones THIS business has switched on and no others — it
    // recommended a Marketing page to salons without one (templates/crm-salon routes/support.ts, Salon T27 N15, HELP-01).
    const about = d.settings?.support?.assistant
    const help = d.settings?.help
    const topics = help ? await enabledTopics(u.companyId) : ''
    const systemPrompt = help
      ? `You are a helpful support assistant for ${help.productNoun}. The features THIS business has are: ${topics || help.fallbackTopics}. Those are the only ones that exist for this user — never mention or suggest a feature that is not in that list, because the page for it is not in their app.${help.notOffered ? ' ' + help.notOffered : ''} Answer from these features and the knowledge base articles provided. If you cannot find a relevant answer, say you'll need to create a support ticket for the team to handle.${kbContext}`
      : about
      ? `You are a helpful support assistant for ${about} If you cannot find a relevant answer, say you'll need to create a support ticket for the team to handle.${kbContext}`
      : `You are a helpful support assistant for a business management CRM. Answer questions based on the knowledge base articles provided. If you cannot find a relevant answer, say you'll need to create a support ticket for the team to handle.${kbContext}`
    const messages = [
      ...(conversationHistory || []).map((m: any) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: asked },
    ]

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: systemPrompt, messages }),
      })
      const data = (await res.json()) as any
      // The tokens are the business's to pay for, from its usage wallet (every CRM copy but the base: templates/crm-basic
      // routes/support.ts).
      reportAiUsage(data?.usage?.input_tokens, data?.usage?.output_tokens, 'claude-haiku-4-5-20251001')
      const answer =typeof data?.content?.[0]?.text === 'string' ? data.content[0].text : ''
      if (!res.ok || !answer) {
        logger.warn('[support/ai-chat] no answer', { status: res.status, type: data?.error?.type })
        return one(c, { reply: 'AI support could not answer that just now. Please submit a ticket and the team will pick it up.', resolved: false })
      }
      const resolved = !answer.toLowerCase().includes('support ticket') && !answer.toLowerCase().includes('team to handle')
      return one(c, { reply: answer, resolved })
    } catch {
      return one(c, { reply: 'AI service is temporarily unavailable. Please submit a ticket instead.', resolved: false })
    }
  })

  // ── SLA policies ──

  app.get('/sla-policies', async (c) => {
    const u = c.get('user')
    try {
      const policies = await db.select().from(supportSlaPolicy)
        .where(eq(supportSlaPolicy.companyId, u.companyId)).orderBy(asc(supportSlaPolicy.priority))
      return listAll(c, policies)
    } catch (e: any) {
      if (missingTable(e)) return list(c, [], { page: 1, limit: 0, total: 0 })
      throw e
    }
  })

  app.post('/sla-policies', requirePermission('support-sla:create'), async (c) => {
    const u = c.get('user')
    const body = await c.req.json()
    const [policy] = await db.insert(supportSlaPolicy).values({
      name: body.name,
      priority: body.priority,
      responseTimeMinutes: body.responseTimeMinutes,
      resolveTimeMinutes: body.resolveTimeMinutes,
      escalateAfterMinutes: body.escalateAfterMinutes,
      companyId: u.companyId,
    }).returning()
    return one(c, policy, 201)
  })

  return app
}
