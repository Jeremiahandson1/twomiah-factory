// CI guard: a website's contact form reaches the CRM it is paired with. Both ends of one contract.
//
// Every website template posts an enquiry to `${CRM_API_URL}/api/webhooks/leads` with an x-webhook-secret. Until
// 10/14 two CRMs had no such route — crm-roof never had one (its x-webhook-secret check is the marketplace feed,
// /api/leads/inbound/:source), and crm-dispensary loaded routes/webhooks.ts inside a try/catch that swallowed the
// failure for seven months because the file was never written. Every enquiry from those sites answered 404, and the
// site only logs it on its own server, so nobody saw a thing.
//
//   · every website template that forwards a lead posts to /api/webhooks/leads with the x-webhook-secret header
//   · every CRM a website can be paired with has routes/webhooks.ts with POST /leads and the timing-safe check
//     against WEBHOOK_SECRET || JWT_SECRET (deploy.ts sets the site's WEBHOOK_SECRET to the CRM's JWT_SECRET)
//   · index.ts IMPORTS it like any other route and mounts it at /api/webhooks unconditionally — no try/catch load,
//     no `if (webhooksRoutes)`, so a missing file stops the boot instead of quietly dropping the door
//   bun scripts/check-website-lead-webhook.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// ── the website end ──
const sites = readdirSync(ROOT + 'templates').filter((t) => t.startsWith('website-'))
let senders = 0
for (const t of sites) {
  for (const f of [`templates/${t}/routes/admin.ts`, `templates/${t}/server-static.ts`]) {
    const src = read(f)
    if (!/x-webhook-secret/i.test(src) || !/CRM_API_URL/.test(src)) continue
    senders++
    if (!/\/api\/webhooks\/leads/.test(src)) fail(`${f} forwards to the CRM but not to /api/webhooks/leads — the address every CRM answers`)
  }
}
if (!senders) fail('no website template forwards leads at all — this guard is looking in the wrong place')

// ── the CRM end: every CRM a website can be paired with ──
// crm-store's storefront is website-store, which takes orders, not enquiries; crm-automotive is parked.
const SKIP = new Set(['crm-store', 'crm-automotive'])
const crms = readdirSync(ROOT + 'templates').filter((t) => /^crm(-|$)/.test(t) && !SKIP.has(t) && existsSync(`${ROOT}templates/${t}/backend/src/index.ts`))
for (const t of crms) {
  const route = read(`templates/${t}/backend/src/routes/webhooks.ts`)
  if (!route) { fail(`${t} has no backend/src/routes/webhooks.ts — its website's enquiries answer 404`); continue }
  if (!/app\.post\('\/leads'/.test(route)) fail(`${t}/routes/webhooks.ts has no POST /leads`)
  // crm-homecare is parked: its webhook also accepts the Factory sync key, and its auth is not being reworked while it
  // is parked. This one rule only, this one template — the route, the import and the mount are still checked below.
  if (t !== 'crm-homecare' && (!/c\.req\.header\('x-webhook-secret'\)/.test(route) || !/process\.env\.WEBHOOK_SECRET \|\| process\.env\.JWT_SECRET/.test(route) || !/timingSafeEqual/.test(route))) {
    fail(`${t}/routes/webhooks.ts must check x-webhook-secret against WEBHOOK_SECRET || JWT_SECRET, timing-safe — the secret the Factory gives the site`)
  }
  const index = read(`templates/${t}/backend/src/index.ts`)
  if (!/^import webhooksRoutes from '\.\/routes\/webhooks\.ts'$/m.test(index)) fail(`${t}/index.ts must import routes/webhooks.ts like any other route`)
  if (!/^app\.route\('\/api\/webhooks', webhooksRoutes\)$/m.test(index)) fail(`${t}/index.ts must mount it unconditionally at /api/webhooks`)
  if (/await import\('\.\/routes\/webhooks\.ts'\)/.test(index) || /if \(webhooksRoutes\)/.test(index)) fail(`${t}/index.ts loads the webhook route conditionally — a missing file would vanish without a word, as crm-dispensary's did`)
}

if (failed) { console.error(`\nwebsite lead webhook: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`website lead webhook: ${senders} website sender(s) post to /api/webhooks/leads; ${crms.length} CRM(s) answer there, imported and mounted unconditionally`)
