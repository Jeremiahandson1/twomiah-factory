import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { salesLead, contact, unit, company, user } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

// AI Lead Responder — for a fresh lead, Claude drafts a personalized, inventory-
// aware first-touch email + SMS (the "<5-minute response" DP360's AI Advanced sells),
// native to the CRM with full customer + inventory context.
const app = new Hono()
app.use('*', authenticate)

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

// GET /inbox — recent leads with customer + the unit they're interested in
app.get('/inbox', async (c) => {
  const u = c.get('user') as any
  try {
    const rows = await db.select({
      id: salesLead.id, stage: salesLead.stage, source: salesLead.source, createdAt: salesLead.createdAt,
      customerName: contact.name, email: contact.email, phone: contact.phone,
      unitYear: unit.year, unitMake: unit.make, unitModel: unit.modelName, unitPrice: unit.internetPrice, unitCategory: unit.category,
    })
      .from(salesLead)
      .leftJoin(contact, eq(salesLead.contactId, contact.id))
      .leftJoin(unit, eq(salesLead.unitId, unit.id))
      .where(eq(salesLead.companyId, u.companyId))
      .orderBy(desc(salesLead.createdAt))
      .limit(30)
    return c.json({ leads: rows })
  } catch (e: any) { return c.json({ leads: [], error: e?.message }, 200) }
})

// POST /draft — { leadId } → AI-drafted first-touch email + SMS
app.post('/draft', async (c) => {
  const u = c.get('user') as any
  const cid = u.companyId
  const body = await c.req.json().catch(() => ({}))
  const leadId = String(body.leadId || '')
  if (!leadId) return c.json({ error: 'Pick a lead first.' }, 400)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return c.json({ error: 'AI isn’t configured yet (missing ANTHROPIC_API_KEY).' }, 503)

  const [lead] = await db.select().from(salesLead).where(and(eq(salesLead.id, leadId), eq(salesLead.companyId, cid))).limit(1)
  if (!lead) return c.json({ error: 'Lead not found.' }, 404)
  const [cust] = lead.contactId ? await db.select().from(contact).where(eq(contact.id, lead.contactId)).limit(1) : [null]
  const [interest] = lead.unitId ? await db.select().from(unit).where(eq(unit.id, lead.unitId)).limit(1) : [null]
  const [co] = await db.select().from(company).where(eq(company.id, cid)).limit(1)
  const [me] = await db.select({ firstName: user.firstName, lastName: user.lastName, email: user.email }).from(user).where(eq(user.id, u.userId)).limit(1)

  let pool: any[] = []
  try { pool = await db.select().from(unit).where(and(eq(unit.companyId, cid), eq(unit.status, 'available'))).limit(50) } catch {}
  const alsoAvailable = (interest?.category ? pool.filter(m => m.category === interest.category && m.id !== interest.id) : pool)
    .slice(0, 3).map(m => ({ year: m.year, make: m.make, model: m.modelName, price: m.internetPrice }))

  const ctx = {
    dealership: { name: co?.name, phone: co?.phone, city: co?.city, state: co?.state },
    salesperson: { name: `${me?.firstName || ''} ${me?.lastName || ''}`.trim() || 'the team', email: me?.email },
    customer: { name: cust?.name || 'there', firstName: (cust?.name || 'there').split(' ')[0], leadSource: lead.source },
    interestedIn: interest ? { year: interest.year, make: interest.make, model: interest.modelName, price: interest.internetPrice, category: interest.category } : null,
    alsoAvailable,
  }

  const system = `You are an elite powersports / RV / marine dealership salesperson writing the FIRST response to a fresh internet lead. Warm, concise, human — NOT corporate spam. Use the customer's first name. Reference the SPECIFIC unit they asked about (year/make/model + price if given). Offer a clear next step (schedule a test ride / visit, answer questions, financing pre-qual). If an "alsoAvailable" unit fits, you may mention ONE briefly as an alternative. NEVER invent specs or prices not provided. Write like a top closer who replies within 5 minutes.
Return ONLY raw JSON (no markdown, no code fences): {"email":{"subject":"...","body":"..."},"sms":"..."}. Email body 60–110 words with a friendly sign-off using the salesperson + dealership name. SMS under 300 chars, casual, names the dealership and ends with a question to invite a reply.`

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages: [{ role: 'user', content: 'Lead context:\n' + JSON.stringify(ctx, null, 2) + '\n\nWrite the first-touch email + SMS now. JSON only.' }] }),
    })
  } catch (e: any) { return c.json({ error: 'AI request failed: ' + (e?.message || e) }, 502) }
  if (!res.ok) { const t = await res.text().catch(() => ''); return c.json({ error: 'AI error (' + res.status + '): ' + t.slice(0, 200) }, 502) }

  const data: any = await res.json().catch(() => ({}))
  const txt = data?.content?.[0]?.text || ''
  let parsed: any = null
  try { parsed = JSON.parse(txt) } catch { const m = txt.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]) } catch {} } }
  if (!parsed?.email) return c.json({ error: 'AI returned an unreadable draft. Try again.', raw: txt.slice(0, 300) }, 502)

  return c.json({
    draft: parsed,
    lead: { customerName: cust?.name, email: cust?.email, phone: cust?.phone, interestedIn: ctx.interestedIn },
    generatedAt: new Date().toISOString(),
  })
})

export default app
