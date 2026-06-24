import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { unit, salesLead, repairOrder, invoice, contact, user } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

// AI Reports — the dealer asks a plain-English question and Claude answers over
// the tenant's real CRM data (inventory, sales pipeline, service, invoices).
const app = new Hono()
app.use('*', authenticate)

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

const SUGGESTIONS = [
  'How many units did we sell last month, and what was the total gross?',
  'Show my aged inventory — units in stock longest, with prices.',
  'Which salesperson has the most closed deals this quarter?',
  'What’s sitting in service right now and what’s the open RO value?',
  'Which leads are stalled in the pipeline and need follow-up?',
  'Break down my inventory by category and condition.',
]

app.get('/suggestions', async (c) => c.json({ suggestions: SUGGESTIONS }))

app.post('/generate', async (c) => {
  const u = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  const question = String(body.question || '').trim()
  if (!question) return c.json({ error: 'Ask a question first.' }, 400)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return c.json({ error: 'AI Reports isn’t configured yet (missing ANTHROPIC_API_KEY).' }, 503)

  const cid = u.companyId
  const grab = async (fn: () => Promise<any[]>) => { try { return await fn() } catch { return [] } }
  const [units, leads, ros, invoices, contacts, users] = await Promise.all([
    grab(() => db.select().from(unit).where(eq(unit.companyId, cid)).limit(500)),
    grab(() => db.select().from(salesLead).where(eq(salesLead.companyId, cid)).limit(500)),
    grab(() => db.select().from(repairOrder).where(eq(repairOrder.companyId, cid)).limit(500)),
    grab(() => db.select().from(invoice).where(eq(invoice.companyId, cid)).limit(500)),
    grab(() => db.select().from(contact).where(eq(contact.companyId, cid)).limit(500)),
    grab(() => db.select({ id: user.id, name: user.name, role: user.role }).from(user).where(eq(user.companyId, cid)).limit(100)),
  ])

  const today = new Date().toISOString().slice(0, 10)
  const dataContext = [
    `TODAY: ${today}`,
    `=== INVENTORY / UNITS (${units.length}) ===\n${JSON.stringify(units)}`,
    `=== SALES PIPELINE / LEADS (${leads.length}) ===\n${JSON.stringify(leads)}`,
    `=== SERVICE / REPAIR ORDERS (${ros.length}) ===\n${JSON.stringify(ros)}`,
    `=== INVOICES (${invoices.length}) ===\n${JSON.stringify(invoices)}`,
    `=== CONTACTS (${contacts.length}) ===\n${JSON.stringify(contacts)}`,
    `=== TEAM / USERS (${users.length}) ===\n${JSON.stringify(users)}`,
  ].join('\n\n')

  const system = `You are the dealership's data analyst, built into its CRM (an RV / powersports / marine dealership). Answer the manager's question using ONLY the data provided below. Correlate records by their IDs: salesLead.contactId→contact.id, salesLead.unitId→unit.id, salesLead.assignedTo→user.id, repairOrder.customerId→contact.id, invoice.contactId→contact.id. Be specific and quantitative — cite real numbers, dollar amounts (with $), counts, names, and dates. Money fields are strings; parse them as numbers. Sales stages: closed_won = sold, closed_lost = lost; everything else is still open. If the data genuinely can't answer the question, say so plainly and name what's missing. Format the answer as a clean, scannable Markdown report: a one-line bold headline answer first, then supporting bullets or a small table, then 1–2 short "what this means" insight callouts. Keep it tight and useful — a busy GM is reading it.`

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2048, system, messages: [{ role: 'user', content: dataContext + '\n\n---\nMANAGER’S QUESTION: ' + question }] }),
    })
  } catch (e: any) { return c.json({ error: 'AI request failed: ' + (e?.message || e) }, 502) }

  if (!res.ok) { const t = await res.text().catch(() => ''); return c.json({ error: 'AI error (' + res.status + '): ' + t.slice(0, 300) }, 502) }
  const data: any = await res.json().catch(() => ({}))
  const report = data?.content?.[0]?.text || 'No response generated.'
  return c.json({
    report, question, generatedAt: new Date().toISOString(),
    rowsAnalyzed: { units: units.length, leads: leads.length, service: ros.length, invoices: invoices.length, contacts: contacts.length },
  })
})

export default app
