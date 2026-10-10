// T63 Medium (Salon) — "a stylist can no longer pick themselves when booking or logging a service. Only
// 'Unassigned' is offered, because the picker now calls /api/team/assignable, which returns 403 for stylists."
//
// The picker list asks what booking asks: team:read OR schedule:create. A stylist (schedule:create) gets names and
// roles — themselves included — but no email addresses; a manager (team:read) gets the full rows.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Chair Nine', slug: 'chair-t63', email: 'chair-t63@test.local', settings: {}, enabledFeatures: [] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@chair-t63.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const manager = await mk('manager', 'manager'), stylist = await mk('field', 'stylist'), desk = await mk('viewer', 'desk')

const app = new Hono()
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (who: any) => {
  const res = await app.request('/api/team/assignable', { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

const s = await get(stylist)
check('a stylist gets the picker list (200)', s.status === 200, { status: s.status, body: s.text.slice(0, 160) })
check('…and can pick themselves', (s.json?.data || []).some((u: any) => u.id === stylist.id), s.json?.data)
check('…with no email addresses in it', !/@chair-t63\.local/.test(s.text), s.text.slice(0, 200))
const m = await get(manager)
check('a manager gets the full rows, emails included', m.status === 200 && (m.json?.data || []).some((u: any) => u.email === 'stylist@chair-t63.local'), m.json?.data)
const d = await get(desk)
// Front Desk (viewer) holds team:read in the base matrix, so it always had this list — unchanged, emails and all.
check('Front Desk (viewer, team:read) is unchanged: the full rows', d.status === 200 && /@chair-t63\.local/.test(d.text), { status: d.status })

console.log(`\nt63 stylist picker: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
