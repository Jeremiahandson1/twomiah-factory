// CI guard: factory → premium-site internal calls (booking reminders, rebook reminders, review
// requests, intake-photo seeding) carry the tenant's X-Factory-Key, so they may only go to a site we
// serve. tenants.website_url starts as the business's EXISTING site from the intake form; the
// booking crons used it as-is. ourPremiumSiteOrigin is the one gate — exercised here, and every
// caller is checked to go through it.
//
//   bun scripts/check-premium-site-origin.ts
import { readFileSync } from 'node:fs'
import { ourPremiumSiteOrigin } from '../apps/api/src/services/premiumSiteUrl.ts'

const ROOT = decodeURIComponent(new URL('../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1') // a path with spaces arrives %20-encoded
let failed = 0, passed = 0
const check = (ok: boolean, m: string) => { if (ok) passed++; else { failed++; console.error('FAIL: ' + m) } }
const t = (website_url: string | null, domain: string | null = null) => ourPremiumSiteOrigin({ slug: 'higgs-heritage-builders', website_url, domain, engine: null })

check(t('https://higgs-heritage-builders-site.onrender.com/') === 'https://higgs-heritage-builders-site.onrender.com', 'our Render site host')
check(t('https://higgs-heritage-builders.twomiah.app') === 'https://higgs-heritage-builders.twomiah.app', 'our twomiah.app subdomain')
check(t('https://www.higgsbuilders.com/', 'higgsbuilders.com') === 'https://www.higgsbuilders.com', 'the attached custom domain (www or not)')
check(t('https://higgsbuilders.com', 'https://www.higgsbuilders.com/') === 'https://higgsbuilders.com', 'domain stored with scheme/www still matches')
check(t('https://higgs-old-wordpress.com') === null, 'the business\'s previous website (intake) is not ours')
check(t('https://higgs-heritage-builders-site-evil.onrender.com') === null, 'a lookalike Render host is not ours')
check(t('https://higgs-heritage-builders.twomiah.app.evil.com') === null, 'a lookalike subdomain is not ours')
check(t('http://higgs-heritage-builders-site.onrender.com') === null, 'never plain http')
check(t('') === null && t(null) === null && t('not a url') === null, 'missing / malformed')
check(ourPremiumSiteOrigin({ slug: '', website_url: 'https://-site.onrender.com', engine: null }) === null, 'no slug, no match')
// A unified tenant has no premium site, and a row read without engine is refused (the booking crons, 10/30).
check(ourPremiumSiteOrigin({ slug: 'higgs-heritage-builders', website_url: 'https://higgsbuilders.com', domain: 'higgsbuilders.com', engine: 'unified' }) === null, 'a unified tenant is no premium site')
check((() => { try { ourPremiumSiteOrigin({ slug: 'higgs-heritage-builders', website_url: 'https://higgsbuilders.com', domain: 'higgsbuilders.com' }); return false } catch { return true } })(), 'a row read without engine is refused')

const lifecycle = readFileSync(ROOT + 'apps/api/src/routes/factory/lifecycle.ts', 'utf8')
for (const ep of ['booking-reminders', 'booking-rebook-reminders', 'booking-review-requests']) {
  check(lifecycle.includes("fetch(site + '/api/internal/" + ep + "'"), `lifecycle.ts: ${ep} must call the gated site origin`)
}
// Anywhere in the API: no /api/internal/* call built from a raw tenant URL field.
{
  const { readdirSync, statSync } = await import('node:fs')
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = d + '/' + n
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
  for (const f of walk(ROOT + 'apps/api/src')) {
    const src = readFileSync(f, 'utf8')
    for (const line of src.split('\n')) {
      if (/(website_url|render_frontend_url)\b.*\/api\/internal\//.test(line)) check(false, f.replace(ROOT, '') + ': internal call built from a raw tenant URL — use ourPremiumSiteOrigin: ' + line.trim().slice(0, 120))
    }
  }
  passed++
}
check(!/eq\('status', 'live'\)/.test(lifecycle), "lifecycle.ts: 'live' is not a tenant status (tenants_status_check) — the crons matched nobody")
const deploy = readFileSync(ROOT + 'apps/api/src/routes/factory/deploy.ts', 'utf8')
check(/const endpoint = site \+ '\/api\/internal\/seed-photos'/.test(deploy), 'deploy.ts: seed-photos must go to the gated site origin (not render_frontend_url, the CRM)')

if (failed) { console.error(`\n${failed} failed, ${passed} passed`); process.exit(1) }
console.log(`premium site origin: ${passed} checks passed`)
