// A dispensary website's contact form reaches the CRM. (10/14) index.ts loaded routes/webhooks.ts inside a try/catch
// for seven months; the file never existed, so POST /api/webhooks/leads answered 404 for every enquiry. The enquiry is
// now a lead contact — the Customers page lists every contact; nothing in this CRM reads the `leads` table.
process.env.WEBHOOK_SECRET = 'disp-site-secret-1014'
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
await db.insert(S.company).values({ name: 'Green Leaf', slug: 'green-leaf', email: 'g@leaf.test', settings: {}, enabledFeatures: ['orders', 'products', 'contacts'] } as any)

const app = new Hono()
app.route('/api/webhooks', (await import('./src/routes/webhooks.ts')).default)
const post = async (body: unknown, secret: string | null = process.env.WEBHOOK_SECRET!) => {
  const res = await app.request('/api/webhooks/leads', { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-webhook-secret': secret } : {}) }, body: JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

{
  const r = await post({ name: 'Casey Moore', email: 'casey@home.test', phone: '+15555550199', message: 'Do you stock CBD tinctures?', service: 'Products', source: 'website' })
  check(`a website enquiry is accepted (${r.status})`, r.status === 201 && !!r.json?.id, r.json)
  const [c] = await db.select().from(S.contact).where(eq(S.contact.id, r.json?.id))
  check('…as a lead contact from the website, the message in its notes', c?.type === 'lead' && c?.source === 'website' && c?.name === 'Casey Moore' && /Website enquiry/.test(c?.notes || '') && /CBD tinctures/.test(c?.notes || ''), c)
}
{
  const bad = await post({ name: 'X' }, 'wrong')
  check(`a wrong secret is refused (${bad.status})`, bad.status === 401)
  const noName = await post({ email: 'nobody@home.test' })
  check(`an enquiry without a name is refused (${noName.status})`, noName.status === 400)
}
{
  // the route is mounted the way index.ts mounts it, not only importable
  const ROOT = (process.env.FACTORY_ROOT || '').replace(/\/?$/, '/')
  const { readFileSync } = await import('node:fs')
  const index = readFileSync(ROOT + 'templates/crm-dispensary/backend/src/index.ts', 'utf8')
  check('index.ts imports the route and mounts it unconditionally', /^import webhooksRoutes from '\.\/routes\/webhooks\.ts'\r?$/m.test(index) && /^app\.route\('\/api\/webhooks', webhooksRoutes\)\r?$/m.test(index))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
