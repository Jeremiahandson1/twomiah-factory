// CI guard: a branded address saved before there is a domain is set up once there is one.
//
// E2E Run 5 (10/16): the onboarding wizard saved support@ / admin@ in the CRM with no domain connected;
// the push to the Factory (POST /customers/:id/email-alias-sync) answered 400 for every signup and nothing
// replayed it, so support@<their domain> would never have forwarded. The cure has several parts, and
// losing any one of them quietly brings the bug back:
//   1. every CRM that mounts /api/email-aliases also mounts the Factory's read-back,
//      /api/internal/email-aliases (createEmailAliasesInternalRoute), which checks the Factory key;
//   2. the Factory reconciles (services/emailAliasSync.ts) after a domain is attached, bought or wired at
//      deploy, when the Email Domain page sees the zone active, and every hour (scheduler job + route);
//   3. the CRM-facing Factory routes (status, confirmation) pass the staff-login gate in routes/factory.ts
//      and check X-Factory-Key themselves;
//   4. the per-change push DEFERS a change it cannot apply yet instead of refusing it.
// One template is one door: the walk covers every templates/crm* directory that mounts /api/email-aliases.
//   bun scripts/check-email-alias-readback.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { stripSource as strip } from './lib/stripComments.ts'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n'))

// ── 1. every CRM door ────────────────────────────────────────────────────────────────────────────────
let doors = 0
for (const t of readdirSync(join(ROOT, 'templates')).filter((n) => /^crm($|-)/.test(n)).sort()) {
  const idxPath = `templates/${t}/backend/src/index.ts`
  if (!existsSync(join(ROOT, idxPath))) continue
  const idx = read(idxPath)
  if (!/app\.route\(\s*'\/api\/email-aliases'/.test(idx)) continue
  doors++
  const userMount = idx.search(/app\.route\(\s*'\/api\/email-aliases'\s*,\s*emailAliasesRoutes\s*\)/)
  const internalMount = idx.search(/app\.route\(\s*'\/api\/internal\/email-aliases'\s*,\s*emailAliasesInternal\s*\)/)
  if (internalMount < 0) fail(`${t}: src/index.ts must mount app.route('/api/internal/email-aliases', emailAliasesInternal) — the Factory cannot read the addresses back`)
  if (!/import\s+emailAliasesRoutes\s*,\s*\{\s*emailAliasesInternal\s*\}\s*from\s*'\.\/routes\/emailAliases\.ts'/.test(idx)) fail(`${t}: src/index.ts must import { emailAliasesInternal } from './routes/emailAliases.ts'`)
  if (userMount < 0) fail(`${t}: the user-facing mount app.route('/api/email-aliases', emailAliasesRoutes) moved — re-check this guard`)
  const wrap = read(`templates/${t}/backend/src/routes/emailAliases.ts`)
  if (!/export\s+const\s+emailAliasesInternal\s*=\s*createEmailAliasesInternalRoute\(\s*\{\s*db\s*,\s*emailAliasesTable:\s*emailAlias\s*\}\s*\)/.test(wrap)) fail(`${t}: routes/emailAliases.ts must export emailAliasesInternal = createEmailAliasesInternalRoute({ db, emailAliasesTable: emailAlias })`)
  // The internal route must not sit behind the wrapper's user auth: it is its own Hono app, not a route on `app`.
  if (/app\.route\(\s*'\/internal/.test(wrap)) fail(`${t}: the read-back must not be mounted inside the user-authenticated wrapper`)
}
if (doors < 12) fail(`expected all 12 CRMs to mount /api/email-aliases, found ${doors} — a template lost its addresses page or this walk broke`)

// ── the shared module ─────────────────────────────────────────────────────────────────────────────
const shared = read('packages/tenant-backend/src/emailAliases.ts')
const internal = shared.match(/export function createEmailAliasesInternalRoute[\s\S]*?\n}\n/)?.[0] || ''
if (!internal) fail('packages/tenant-backend/src/emailAliases.ts must export createEmailAliasesInternalRoute')
else {
  const keyAt = internal.search(/keyMatches\(/), readAt = internal.search(/\.select\(\)/)
  if (keyAt < 0 || readAt < 0 || keyAt > readAt) fail('createEmailAliasesInternalRoute must check X-Factory-Key BEFORE reading the table')
  if (!/if \(!key\) return c\.json\([^)]*503\)/.test(internal)) fail('createEmailAliasesInternalRoute must refuse (503) when FACTORY_SYNC_KEY is not set — never an open list')
}
if (!/export \{ createEmailAliasesRoutes, createEmailAliasesInternalRoute \} from '\.\/emailAliases'/.test(read('packages/tenant-backend/src/index.ts'))) fail('packages/tenant-backend/src/index.ts must export createEmailAliasesInternalRoute')

// ── 2. the Factory reconciles at every moment a domain can become usable ──────────────────────────────
const lifecycle = read('apps/api/src/routes/factory/lifecycle.ts')
const route = (method: string, path: string) => {
  const at = lifecycle.indexOf(`factory.${method}('${path}'`)
  if (at < 0) return ''
  const next = lifecycle.indexOf('\nfactory.', at + 10)
  return lifecycle.slice(at, next < 0 ? undefined : next)
}
const attach = route('post', '/internal/domain/attach/:tenantId')
if (!/wireDomainInfrastructure\([\s\S]*reconcileAliasesInBackground\(/.test(attach)) fail('domain attach must reconcile the addresses after wireDomainInfrastructure')
const domStatus = route('get', '/internal/domain/status/:tenantId')
if (!/status === 'active'\) reconcileAliasesInBackground\(/.test(domStatus)) fail('the Email Domain status route must reconcile once the zone is active')
if (!/render_backend_url/.test(domStatus.match(/\.select\('([^']*)'\)/)?.[1] || '')) fail('the Email Domain status route must select render_backend_url — the reconcile reads the CRM through it')
const billing = read('apps/api/src/routes/factory/billing.ts')
if (!/wireDomainInfrastructure\([\s\S]{0,3000}reconcileAliasesInBackground\(/.test(billing)) fail('a bought domain must reconcile the addresses after wireDomainInfrastructure (routes/factory/billing.ts)')
const deploy = read('apps/api/src/routes/factory/deploy.ts')
if (!/Domain infra errors[\s\S]{0,800}reconcileAliasesInBackground\(/.test(deploy)) fail('a deploy that wires a domain must reconcile the addresses (routes/factory/deploy.ts)')
const sweep = route('post', '/internal/email-alias-sweep')
if (!/checkCronSecret\(c\)/.test(sweep) || !/reconcileTenantAliases\(/.test(sweep)) fail('POST /internal/email-alias-sweep must check the cron secret and reconcile each tenant')
if (!/name: 'email-alias-sweep', path: '\/api\/v1\/factory\/internal\/email-alias-sweep', schedule: 'hourly'/.test(read('apps/api/src/services/scheduler.ts'))) fail('services/scheduler.ts must run email-alias-sweep hourly')

// ── 3. the CRM-facing routes: past the staff gate, each checking the tenant's key ──────────────────────
const gate = read('apps/api/src/routes/factory.ts')
for (const [m, p] of [['GET', 'email-alias-status'], ['POST', 'email-alias-confirmation']]) {
  if (!new RegExp(`c\\.req\\.method === '${m}' && /\\\\/customers\\\\/\\[0-9a-f-\\]\\{36\\}\\\\/${p}\\$/i\\.test\\(c\\.req\\.path\\)`).test(gate)) fail(`routes/factory.ts must let ${m} /customers/:id/${p} past the staff-login gate (exact match) — the CRM calls it with X-Factory-Key`)
  const body = route(m.toLowerCase(), `/customers/:id/${p}`)
  if (!body) fail(`lifecycle.ts must define ${m} /customers/:id/${p}`)
  else if (!/checkFactoryKey\(c, tenant\)/.test(body)) fail(`${m} /customers/:id/${p} must check the tenant's X-Factory-Key`)
}

// ── 4. a change that cannot apply yet is deferred, not refused ────────────────────────────────────────
const push = route('post', '/customers/:id/email-alias-sync')
if (/no domain or Cloudflare zone configured' \}, 400\)/.test(push)) fail('email-alias-sync must not 400 a change made before the domain exists — defer it')
if (!/action: 'deferred', reason: 'waiting_for_domain'/.test(push) || !/action: 'deferred', reason: 'waiting_for_nameservers'/.test(push)) fail('email-alias-sync must answer "deferred" while there is no domain and while its nameservers are pending')
if (!/applyAliasRule\(/.test(push)) fail('email-alias-sync must apply the rule through applyAliasRule — one rule logic for the push and the reconcile')

if (failed) { console.error(`\nemail alias read-back: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`email alias read-back: ${doors} CRMs mount it; the Factory reconciles on attach, buy, deploy, activation and hourly`)
