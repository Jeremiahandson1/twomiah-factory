import { supabase, requireRole } from '../../middleware/auth'
import { notifyNewTicket, notifyTicketReply } from '../../services/email'
import { type FactoryApp, parseJsonBody, UUID_RE } from './shared'

export function registerSupportRoutes(factory: FactoryApp) {
// ─── Support Tickets (Level 1: CRM customers → Twomiah) ─────────────────────

// List all support tickets (Factory team view)
factory.get('/support/tickets', async (c) => {
  const status = c.req.query('status')
  const priority = c.req.query('priority')
  const tenantId = c.req.query('tenant_id')
  const search = c.req.query('search')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')

  let query = supabase.from('support_tickets').select('*, tenants!inner(name, slug, plan, email)', { count: 'exact' })

  if (status) query = query.eq('status', status)
  if (priority) query = query.eq('priority', priority)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  if (search) query = query.or(`subject.ilike.%${search}%,number.ilike.%${search}%`)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data || [], pagination: { page, limit, total: count || 0, pages: Math.ceil((count || 0) / limit) } })
})

// Support ticket stats for dashboard
factory.get('/support/stats', async (c) => {
  // Single query instead of 3 sequential queries (fixes 23s response times)
  const { data: all } = await supabase.from('support_tickets')
    .select('status, priority, rating, sla_resolve_due')

  const tickets = all || []
  const stats: Record<string, number> = { open: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0, total: 0 }
  const now = new Date().toISOString()
  let slaBreach = 0
  const ratings: number[] = []

  for (const t of tickets) {
    stats[t.status] = (stats[t.status] || 0) + 1
    stats.total++
    // SLA breach check inline
    if ((t.status === 'open' || t.status === 'in_progress') && t.sla_resolve_due && t.sla_resolve_due < now) {
      slaBreach++
    }
    // Collect ratings inline
    if (t.rating != null) ratings.push(t.rating)
  }

  stats.sla_breached = slaBreach
  const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null

  return c.json({ ...stats, avgRating, ratedCount: ratings.length })
})

// Get single ticket with messages
factory.get('/support/tickets/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ticket ID' }, 400)

  const { data: ticket } = await supabase.from('support_tickets').select('*, tenants(name, slug, plan, email)').eq('id', id).single()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const { data: messages } = await supabase.from('support_ticket_messages')
    .select('*').eq('ticket_id', id).order('created_at', { ascending: true })

  return c.json({ ...ticket, messages: messages || [] })
})

// Create ticket (from Factory dashboard, editor+)
factory.post('/support/tickets', requireRole('owner', 'admin', 'editor'), async (c) => {
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  if (!body.tenant_id || !body.subject) return c.json({ error: 'tenant_id and subject are required' }, 400)

  // Generate ticket number
  const { count } = await supabase.from('support_tickets').select('id', { count: 'exact', head: true })
  const number = 'TWO-' + String((count || 0) + 1).padStart(4, '0')

  // Auto-categorize
  const text = ((body.subject || '') + ' ' + (body.description || '')).toLowerCase()
  let aiCategory = 'general'
  let aiPriorityScore = 20
  const cats: [string, string[], number][] = [
    ['billing', ['invoice', 'payment', 'charge', 'subscription', 'billing', 'refund'], 40],
    ['bug', ['bug', 'error', 'crash', 'broken', 'not working', 'fails'], 60],
    ['technical', ['setup', 'install', 'configure', 'api', 'integration', 'deploy'], 50],
    ['feature_request', ['feature', 'request', 'wish', 'suggestion'], 30],
  ]
  for (const [cat, kws, score] of cats) {
    if (kws.some(k => text.includes(k))) { aiCategory = cat; aiPriorityScore = score; break }
  }

  // SLA defaults based on priority
  const slaDefaults: Record<string, { response: number; resolve: number }> = {
    critical: { response: 30, resolve: 240 },
    urgent: { response: 60, resolve: 480 },
    high: { response: 120, resolve: 960 },
    normal: { response: 240, resolve: 1440 },
    low: { response: 480, resolve: 2880 },
  }
  const sla = slaDefaults[body.priority || 'normal'] || slaDefaults.normal
  const now = new Date()

  const record = {
    number,
    subject: body.subject,
    description: body.description || null,
    status: 'open',
    priority: body.priority || 'normal',
    category: body.category || aiCategory,
    source: body.source || 'portal',
    tenant_id: body.tenant_id,
    submitter_email: body.submitter_email || null,
    submitter_name: body.submitter_name || null,
    assigned_to: body.assigned_to || null,
    ai_category: aiCategory,
    ai_priority_score: aiPriorityScore,
    sla_response_due: new Date(now.getTime() + sla.response * 60000).toISOString(),
    sla_resolve_due: new Date(now.getTime() + sla.resolve * 60000).toISOString(),
  }

  const { data: ticket, error } = await supabase.from('support_tickets').insert(record).select().single()
  if (error) return c.json({ error: error.message }, 500)

  // Send email notification for new ticket
  if (ticket) {
    const { data: ticketTenant } = await supabase.from('tenants').select('email').eq('id', body.tenant_id).single()
    notifyNewTicket(ticket, ticketTenant?.email).catch(e => console.warn('[Email] New ticket notification failed:', e.message))
  }

  return c.json(ticket, 201)
})

// Update ticket
factory.patch('/support/tickets/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.status) updates.status = body.status
  if (body.priority) updates.priority = body.priority
  if (body.category) updates.category = body.category
  if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to
  if (body.status === 'resolved') updates.resolved_at = new Date().toISOString()
  if (body.status === 'closed') updates.closed_at = new Date().toISOString()

  const { data, error } = await supabase.from('support_tickets').update(updates).eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// Add message to ticket
factory.post('/support/tickets/:id/messages', async (c) => {
  const ticketId = c.req.param('id')
  if (!UUID_RE.test(ticketId)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  if (!body.body) return c.json({ error: 'Message body is required' }, 400)

  // Track first response
  const { data: ticket } = await supabase.from('support_tickets').select('first_response_at, status').eq('id', ticketId).single()
  if (ticket) {
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (!ticket.first_response_at && body.sender_type === 'agent') updates.first_response_at = new Date().toISOString()
    if (ticket.status === 'open' && body.sender_type === 'agent') updates.status = 'in_progress'
    await supabase.from('support_tickets').update(updates).eq('id', ticketId)
  }

  const { data, error } = await supabase.from('support_ticket_messages').insert({
    ticket_id: ticketId,
    body: body.body,
    is_internal: body.is_internal || false,
    sender_type: body.sender_type || 'agent',
    sender_email: body.sender_email || null,
    sender_name: body.sender_name || null,
  }).select().single()

  if (error) return c.json({ error: error.message }, 500)

  // Send email notification for ticket reply (skip internal notes)
  if (data && !body.is_internal) {
    const { data: fullTicket } = await supabase.from('support_tickets').select('number, subject, submitter_email, tenant_id').eq('id', ticketId).single()
    if (fullTicket) {
      const { data: replyTenant } = await supabase.from('tenants').select('email').eq('id', fullTicket.tenant_id).single()
      notifyTicketReply(fullTicket, data, replyTenant?.email).catch(e => console.warn('[Email] Ticket reply notification failed:', e.message))
    }
  }

  return c.json(data, 201)
})

// Rate ticket
factory.post('/support/tickets/:id/rate', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const { rating, comment } = parsed.data

  const { data, error } = await supabase.from('support_tickets').update({
    rating: Math.min(5, Math.max(1, rating)),
    rating_comment: comment || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// ─── Customer-facing ticket endpoints (public, by tenant) ────────────────────

factory.post('/public/support/tickets', async (c) => {
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  if (!body.tenant_id || !body.subject || !body.submitter_email) {
    return c.json({ error: 'tenant_id, subject, and submitter_email are required' }, 400)
  }

  // Generate number
  const { count } = await supabase.from('support_tickets').select('id', { count: 'exact', head: true })
  const number = 'TWO-' + String((count || 0) + 1).padStart(4, '0')

  const now = new Date()
  const record = {
    number,
    subject: body.subject,
    description: body.description || null,
    status: 'open',
    priority: body.priority || 'normal',
    source: 'portal',
    tenant_id: body.tenant_id,
    submitter_email: body.submitter_email,
    submitter_name: body.submitter_name || null,
    sla_response_due: new Date(now.getTime() + 240 * 60000).toISOString(),
    sla_resolve_due: new Date(now.getTime() + 1440 * 60000).toISOString(),
  }

  const { data: ticket, error } = await supabase.from('support_tickets').insert(record).select().single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(ticket, 201)
})

// Customer view their tickets
factory.get('/public/support/tickets', async (c) => {
  const tenantId = c.req.query('tenant_id')
  const email = c.req.query('email')
  if (!tenantId || !email) return c.json({ error: 'tenant_id and email are required' }, 400)

  const { data } = await supabase.from('support_tickets')
    .select('id, number, subject, status, priority, category, created_at, resolved_at, rating')
    .eq('tenant_id', tenantId)
    .eq('submitter_email', email)
    .order('created_at', { ascending: false })

  return c.json(data || [])
})

// ─── Knowledge Base (Factory-level) ──────────────────────────────────────────

factory.get('/support/kb', async (c) => {
  const search = c.req.query('search')
  const category = c.req.query('category')

  let query = supabase.from('support_knowledge_base').select('*').eq('published', true)
  if (category) query = query.eq('category', category)
  if (search) query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`)

  const { data } = await query.order('view_count', { ascending: false }).limit(50)
  return c.json(data || [])
})

factory.post('/support/kb', async (c) => {
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const { data, error } = await supabase.from('support_knowledge_base').insert({
    title: body.title,
    content: body.content,
    category: body.category || null,
    tags: body.tags || [],
  }).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data, 201)
})

factory.put('/support/kb/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const { data, error } = await supabase.from('support_knowledge_base').update({
    title: body.title,
    content: body.content,
    category: body.category,
    tags: body.tags,
    published: body.published,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

factory.delete('/support/kb/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)
  await supabase.from('support_knowledge_base').delete().eq('id', id)
  return c.json({ success: true })
})

// ─── Product Feedback (Level 5) ──────────────────────────────────────────────

factory.get('/support/feedback', async (c) => {
  const status = c.req.query('status')
  const category = c.req.query('category')

  let query = supabase.from('product_feedback').select('*, tenants(name)')
  if (status) query = query.eq('status', status)
  if (category) query = query.eq('category', category)

  const { data } = await query.order('votes', { ascending: false }).limit(100)
  return c.json(data || [])
})

factory.post('/support/feedback', async (c) => {
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const { data, error } = await supabase.from('product_feedback').insert({
    title: body.title,
    description: body.description || null,
    category: body.category || null,
    source_ticket_id: body.source_ticket_id || null,
    tenant_id: body.tenant_id || null,
  }).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data, 201)
})

factory.patch('/support/feedback/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const updates: Record<string, any> = {}
  if (body.status) updates.status = body.status
  if (body.votes) updates.votes = body.votes

  const { data, error } = await supabase.from('product_feedback').update(updates).eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// ─── Pattern Detection Dashboard (Level 5) ──────────────────────────────────

factory.get('/support/patterns', async (c) => {
  // Category distribution
  const { data: allTickets } = await supabase.from('support_tickets').select('category, priority, rating, created_at')

  const byCategory: Record<string, number> = {}
  const byPriority: Record<string, number> = {}
  const ratings: number[] = []
  const dailyMap: Record<string, number> = {}

  for (const t of allTickets || []) {
    byCategory[t.category || 'general'] = (byCategory[t.category || 'general'] || 0) + 1
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1
    if (t.rating) ratings.push(t.rating)
    const day = t.created_at?.split('T')[0]
    if (day) dailyMap[day] = (dailyMap[day] || 0) + 1
  }

  const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null

  // Top feedback items
  const { data: topFeedback } = await supabase.from('product_feedback')
    .select('title, votes, status, category')
    .order('votes', { ascending: false })
    .limit(10)

  return c.json({
    byCategory: Object.entries(byCategory).map(([k, v]) => ({ category: k, count: v })),
    byPriority: Object.entries(byPriority).map(([k, v]) => ({ priority: k, count: v })),
    avgRating,
    ratedCount: ratings.length,
    dailyTrend: Object.entries(dailyMap).sort().slice(-30).map(([day, cnt]) => ({ day, count: cnt })),
    topFeedback: topFeedback || [],
  })
})
}
