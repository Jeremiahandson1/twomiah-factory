// Compatibility shim for the shared tenant-ui pages (EmailAliasesPage etc.),
// which fetch GET /api/company expecting { domain, email }. crm-store has no
// company table — the equivalents live on store_settings: the storefront's
// hostname and the support email. Returns nulls when unset; the shared page
// renders its "connect a domain" callout in that case.
import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { storeSettings, users } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

app.get('/', async (c) => {
  const [s] = await db.select().from(storeSettings).limit(1)
  let domain: string | null = null
  try {
    if (s?.storefrontOrigin) domain = new URL(s.storefrontOrigin).hostname
  } catch { /* malformed origin — leave domain null */ }
  return c.json({ domain, email: s?.supportEmail ?? null, name: s?.companyName ?? null })
})

// The roster the shared AuditLogPage filters by (GET /api/company/users, { id, firstName, lastName }). Behind users:read,
// the owner's, exactly as the page itself only asks for it when that seat holds it. Names only — no role, no email.
app.get('/users', requirePermission('users:read'), async (c) => {
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(users.name)
  return c.json(rows.map((u) => ({ id: u.id, firstName: u.name || u.email, lastName: '' })))
})

export default app
