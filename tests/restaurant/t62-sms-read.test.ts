// T62 Medium — "Events: staff can read SMS conversations without SMS permission."
//
// Reading a customer's texts asks what the Messages link asks: sms:send. The coordinator (field, no SMS right on
// Events) is refused the list and a thread; a seat granted sms:send reads them; the unread count stays a number
// anyone signed in may see. Through the real router.
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

const [co] = await db.insert(company).values({ name: 'Copper Still', slug: 'still-t62', email: 'still-t62@test.local', settings: {}, enabledFeatures: ['events', 'two_way_texting'] } as any).returning()
const mk = async (role: string, tag: string, extra: string[] = []) => (await db.insert(user).values({ email: `${tag}@still-t62.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true, extraPermissions: extra } as any).returning())[0]
const manager = await mk('manager', 'manager'), coordinator = await mk('field', 'coord'), texter = await mk('field', 'texter', ['sms:send'])

const app = new Hono()
app.route('/api/sms', (await import('./src/routes/sms.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (who: any, path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

const list = await get(coordinator, '/api/sms/conversations')
check('the coordinator (no sms:send) is refused the conversation list (403)', list.status === 403, { status: list.status, body: list.text.slice(0, 160) })
const one = await get(coordinator, '/api/sms/conversations/does-not-matter')
check('…and a thread (403 before any lookup)', one.status === 403, { status: one.status })
const unread = await get(coordinator, '/api/sms/unread-count')
check('…the unread count stays readable — a number, no text', unread.status === 200 && typeof unread.json?.count === 'number', unread)

for (const [who, label] of [[manager, 'a manager'], [texter, 'a staff member granted sms:send']] as const) {
  const r = await get(who, '/api/sms/conversations')
  check(`${label} reads the conversations`, r.status === 200, { status: r.status, body: r.text.slice(0, 160) })
}

console.log(`\nt62 sms read: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
