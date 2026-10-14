// A roofing website's contact form reaches the CRM. (10/14) This CRM had no POST /api/webhooks/leads — every website
// template posts there — so each enquiry answered 404. Mounted from the template's own index.ts wiring, posted the
// way website-premium-contractor/server-static.ts forwardLeadToCrm sends it.
process.env.WEBHOOK_SECRET = 'roof-site-secret-1014'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S: any = await import('./db/schema.ts')
const [co] = await db.insert(S.company).values({ name: 'Peak Roofing', slug: 'peak-roof', email: 'p@peak.test', state: 'TX', enabledFeatures: ['contacts', 'jobs', 'dashboard', 'lead_inbox'], settings: {} } as any).returning()

const app = new Hono()
app.route('/api/webhooks', (await import('./src/routes/webhooks.ts')).default)
const post = async (body: unknown, secret: string | null = process.env.WEBHOOK_SECRET!) => {
  const res = await app.request('/api/webhooks/leads', { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-webhook-secret': secret } : {}) }, body: JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const enquiry = { name: 'Jordan Reyes', email: 'jordan@home.test', phone: '+15555550123', message: 'Hail damage on the north slope', source: 'website' }

{
  const r = await post(enquiry)
  check(`a website enquiry is accepted (${r.status})`, r.status === 201 && !!r.json?.id, r.json)
  const [row] = await db.select().from(S.lead).where(eq(S.lead.id, r.json.id))
  check('…and lands in the Lead Inbox as new, from the website, with its message', row?.status === 'new' && row?.sourcePlatform === 'website' && row?.homeownerName === 'Jordan Reyes' && /Hail damage/.test(row?.description || ''), row)
}
{
  const bad = await post(enquiry, 'not-the-secret')
  const none = await post(enquiry, null)
  check(`a wrong secret is refused (${bad.status}), and so is none (${none.status})`, bad.status === 401 && none.status === 401)
  const noName = await post({ ...enquiry, name: '  ' })
  check(`an enquiry without a name is refused (${noName.status})`, noName.status === 400)
}
{
  // Lead Inbox off: the message is still kept in the lead table, and the person is written as a contact so they show
  await db.update(S.company).set({ enabledFeatures: ['contacts', 'jobs', 'dashboard'] } as any).where(eq(S.company.id, co.id))
  const { forgetFeatures } = await import('./src/middleware/enabledFeature.ts')
  forgetFeatures(co.id)
  const r = await post({ ...enquiry, name: 'Sam Lee Ortiz', email: 'sam@home.test' })
  const [person] = await db.select().from(S.contact).where(eq(S.contact.id, r.json?.id))
  const [kept] = r.json?.leadId ? await db.select().from(S.lead).where(eq(S.lead.id, r.json.leadId)) : []
  check(`inbox off → a lead contact, first and last name split (${person?.firstName} / ${person?.lastName})`, r.status === 201 && person?.firstName === 'Sam' && person?.lastName === 'Lee Ortiz' && person?.leadSource === 'website', person)
  check('…and the message is not lost: it is kept on the lead row', !!kept && /Hail damage/.test(kept.description || ''), kept)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
