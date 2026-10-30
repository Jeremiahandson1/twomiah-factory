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
//   4. the per-change push DEFERS a change it cannot apply yet instead of refusing it;
//   5. a website-only premium tenant keeps its addresses on the SITE: every premium template mounts the same
//      key-checked read-back, the Factory reads it when there is no CRM (aliasSource), every reconcile caller
//      selects what that decision needs, and a CRM add-on records the CRM's URL (else its tenant reads as CRM-less).
// One template is one door: the walk covers every templates/crm* directory that mounts /api/email-aliases.
//   bun scripts/check-email-alias-readback.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { stripSource as strip } from './lib/stripComments.ts'

const ROOT = decodeURIComponent(new URL('../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1') // a path with spaces arrives %20-encoded
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
if (!/export \{[^}]*\bcreateEmailAliasesInternalRoute\b[^}]*\} from '\.\/emailAliases'/.test(read('packages/tenant-backend/src/index.ts'))) fail('packages/tenant-backend/src/index.ts must export createEmailAliasesInternalRoute')

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

// ── 5. a website-only premium tenant: the site is the one place ───────────────────────────────────────
let sites = 0
for (const t of readdirSync(join(ROOT, 'templates')).filter((n) => n.startsWith('website-premium-')).sort()) {
  sites++
  const srv = read(`templates/${t}/server-static.ts`)
  const at = srv.indexOf("app.get('/api/internal/email-aliases'")
  if (at < 0) { fail(`${t}: server-static.ts must serve GET /api/internal/email-aliases — the Factory cannot read a website-only tenant's addresses`); continue }
  const body = srv.slice(at, srv.indexOf('\n})', at))
  const keyAt = body.search(/timingSafeEqual\(/), readAt = body.search(/\.select\(\)/)
  if (keyAt < 0 || readAt < 0 || keyAt > readAt) fail(`${t}: /api/internal/email-aliases must check X-Factory-Key (timingSafeEqual) BEFORE reading the table`)
  if (!/if \(!syncKey\) return c\.json\([^)]*503\)/.test(body)) fail(`${t}: /api/internal/email-aliases must refuse (503) when FACTORY_SYNC_KEY is not set — never an open list`)
  if (!/crmUrl = pairedCrmUrl\(s\)/.test(srv.slice(srv.indexOf("app.get('/api/admin/crm-status'")))) fail(`${t}: /api/admin/crm-status must answer through pairedCrmUrl — settings.crmUrl alone missed every site built with its CRM`)
  const admin = read(`templates/${t}/routes/admin.ts`)
  for (const m of admin.matchAll(/app\.(get|post|patch|delete)\('(\/email-aliases[^']*)',\s*([^)]*?)async/g)) {
    if (!/authMiddleware,\s*requireAdmin,/.test(m[3])) fail(`${t}: ${m[1].toUpperCase()} ${m[2]} must be authMiddleware, requireAdmin — the nav item is admin-only, so is the API`)
  }
  for (const [method, path] of [['post', '/email-aliases'], ['patch', '/email-aliases/:id'], ['delete', '/email-aliases/:id'], ['post', '/email-aliases/:id/resync']]) {
    const i = admin.indexOf(`app.${method}('${path}',`)
    const h = i < 0 ? '' : admin.slice(i, admin.indexOf('\n})', i))
    if (!/if \(crmUrl\) return c\.json\(crmOwnsEmail\(crmUrl\), 409\)/.test(h)) fail(`${t}: ${method.toUpperCase()} ${path} must refuse (409) when the site has a CRM — the Factory reads only the CRM and would delete the address`)
  }
}
if (sites < 11) fail(`expected all 11 premium templates, found ${sites}`)

const sync = read('apps/api/src/services/emailAliasSync.ts')
if (!/export function aliasSource[\s\S]*ourPremiumSiteOrigin\(tenant\)/.test(sync)) fail('emailAliasSync.ts aliasSource must reach a website-only tenant through ourPremiumSiteOrigin — never the raw website_url')
const cols = sync.match(/export const ALIAS_TENANT_COLUMNS = '([^']+)'/)?.[1] || ''
for (const c of ['slug', 'products', 'website_url', 'render_backend_url', 'factory_sync_key', 'cloudflare_zone_id', 'domain']) if (!cols.split(/\s*,\s*/).includes(c)) fail(`ALIAS_TENANT_COLUMNS must include ${c}`)
for (const [m, p] of [['get', '/customers/:id/email-alias-status'], ['post', '/customers/:id/email-alias-confirmation'], ['post', '/internal/email-alias-sweep']]) {
  if (!/\.select\((`\$\{)?ALIAS_TENANT_COLUMNS\b/.test(route(m, p))) fail(`${m.toUpperCase()} ${p} must select ALIAS_TENANT_COLUMNS — without products/website_url a website-only tenant's addresses are never read`)
}
if (/readCrmAliases/.test(lifecycle)) fail('lifecycle.ts must read addresses through readTenantAliases (the CRM, or a website-only tenant\'s site)')
for (const [m, p] of [['post', '/internal/domain/attach/:tenantId'], ['get', '/internal/domain/status/:tenantId']]) {
  const sel = route(m, p).match(/\.select\('([^']*)'\)/)?.[1] || ''
  for (const c of ['slug', 'products', 'website_url']) if (!sel.split(/\s*,\s*/).includes(c)) fail(`${m.toUpperCase()} ${p} must select ${c} — its reconcile reads a website-only tenant's site through it`)
}
const buyAt = billing.indexOf('reconcileAliasesInBackground(')
const buySel = billing.slice(billing.lastIndexOf(".select('", buyAt)).match(/^\.select\('([^']*)'\)/)?.[1] || '' // the select feeding that reconcile
for (const c of ['slug', 'products', 'website_url']) if (!buySel.split(/\s*,\s*/).includes(c)) fail(`billing.ts (bought domain) must select ${c} for its reconcile`)
if (!/reconcileAliasesInBackground\(\{[\s\S]{0,600}products: tenant\.products, website_url: result\.siteUrl \|\| tenant\.website_url/.test(deploy)) fail('deploy.ts must hand the reconcile products + website_url (a website-only premium tenant)')
const addon = read('apps/api/src/services/crmAddonProvision.ts')
if (!/products: newProducts,[\s\S]{0,200}render_backend_url: result\.apiUrl/.test(addon)) fail('crmAddonProvision.ts must record render_backend_url — without it the Factory treats an add-on CRM as missing')

if (failed) { console.error(`\nemail alias read-back: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`email alias read-back: ${doors} CRMs and ${sites} premium sites mount it; the Factory reconciles on attach, buy, deploy, activation and hourly`)
