// CI guard: a newly provisioned CRM points at the logo it was given.
//
// writeBrandingAssets writes the signup logo into the CRM's own frontend/public — the uploaded image under
// its own extension, or a synthesized monogram at logo.svg — and then calls updateSettingsField, which writes
// the WEBSITE's settings.json. Nothing set company.logo, which is what the customer portal header and the
// public booking page actually read, so every tenant showed its name instead of the logo sitting on the same
// origin. Colours already reached the row this way; the logo did not. (Contractor T14 M8)
//
// The two things that must stay true: the token has to name exactly the file writeBrandingAssets writes, and
// only templates whose company table really has the column may seed it.
//   bun scripts/check-seeded-logo.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const gen = read('apps/api/src/services/generator.ts')
if (!gen) fail('apps/api/src/services/generator.ts is missing')

// the token, and that it mirrors the writer
const token = gen.match(/'\{\{COMPANY_LOGO\}\}': ([^\n]+)/)?.[1] || ''
if (!token) fail('the generator must define {{COMPANY_LOGO}} — otherwise the seeded row points at nothing')
if (!/getExtFromDataUrl\(b\.logo\) \|\| 'png'/.test(token)) fail("…using the uploaded logo's own extension, the same way writeBrandingAssets picks it")
if (!/'\/logo\.svg'/.test(token)) fail('…and falling back to the synthesized monogram')
if (/https?:\/\//.test(token)) fail('the logo must stay root-relative — an absolute URL to the tenant website dies when the website is offboarded')

const writer = gen.match(/async function writeBrandingAssets[\s\S]*?\n\}/)?.[0] || ''
if (!writer) fail('writeBrandingAssets is missing')
if (!/const ext = getExtFromDataUrl\(branding\.logo\) \|\| 'png'/.test(writer)) fail('the writer must pick the extension the token predicts')
if (!/const altPath = path\.join\(targetDir, 'logo\.' \+ ext\)/.test(writer)) fail('an uploaded logo must land at <target>/logo.<ext>, which is what the token names')
if (!/write\(path\.join\(targetDir, 'logo\.svg'\), logoSvg\)/.test(writer)) fail('a synthesized logo must land at <target>/logo.svg')
if (!/if \(!branding\.logo\?\.startsWith\('data:'\)\)/.test(writer)) fail('the writer must branch on the same condition the token branches on')
// the CRM's target really is its public dir, or the path would not be served at the root
if (!/writeBrandingAssets\(path\.join\(workDir, crmOutputDir, 'frontend', 'public'\)/.test(gen)) fail("the CRM's branding target must be frontend/public, or /logo.* is not served")

// only templates whose company table has the column may seed it
const ALL = ['crm', 'crm-dispensary', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-roof', 'crm-rv', 'crm-salon', 'crm-vet']
for (const t of ALL) {
  const seed = read(`templates/${t}/backend/db/seed.template.ts`)
  const schema = read(`templates/${t}/backend/db/schema.ts`)
  if (!seed || !schema) { fail(`templates/${t} is missing its seed or schema`); continue }
  const companyTable = schema.match(/export const company = pgTable[\s\S]*?\n\}/)?.[0] || ''
  const hasColumn = /logo: text\('logo'\)/.test(companyTable)
  const seedsLogo = /logo: '\{\{COMPANY_LOGO\}\}',/.test(seed)
  if (hasColumn && !seedsLogo) fail(`${t} has a logo column and does not seed it — its portal will show the name instead`)
  if (!hasColumn && seedsLogo) fail(`${t} seeds a logo its company table does not have — the seed would fail on an unknown column`)
}

// crm-automotive is parked (CLAUDE.md): it must not be dragged into this
if (/COMPANY_LOGO/.test(read('templates/crm-automotive/backend/db/seed.template.ts'))) fail('crm-automotive is parked and must not be modified')

/**
 * …AND THE TAB ICON IS THE TENANT'S TOO. (T41)
 *
 *   showcase: "the favicon is Vite's logo"
 *
 * Reading the generator made that bigger: no CRM's favicon link resolved for an ordinary tenant.
 * Four templates linked /vite.svg (Vite's placeholder, which exists in no public/ but one), and six
 * linked /favicon.ico — which writeBrandingAssets DELETES for any tenant without an uploaded icon,
 * writing a per-tenant favicon.svg instead. So the link 404'd on every test tenant and on every
 * customer who never uploaded one.
 *
 * The rule: both are declared, SVG first, and the generator keeps exactly one of the two on disk —
 * the generated mark when nothing was uploaded, the uploaded raster otherwise (it removes the
 * generic SVG in that branch, or the browser would prefer it over the customer's own file).
 */
const FAVICON_TEMPLATES = [...ALL, 'crm-basic', 'crm-store']
for (const t of FAVICON_TEMPLATES) {
  const html = read(`templates/${t}/frontend/index.html`)
  if (!html) { fail(`templates/${t}/frontend/index.html is missing`); continue }
  if (/vite\.svg/.test(html)) fail(`${t}/frontend/index.html still links Vite's placeholder icon`)
  if (!/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/.test(html)) {
    fail(`${t}/frontend/index.html must link /favicon.svg — the per-tenant mark the generator writes`)
  }
  if (!/<link rel="icon" href="\/favicon\.ico" sizes="any" \/>/.test(html)) {
    fail(`${t}/frontend/index.html must also link /favicon.ico, for a tenant who uploaded a raster icon`)
  }
  if (html.indexOf('favicon.svg') > html.indexOf('favicon.ico')) {
    fail(`${t}/frontend/index.html must declare favicon.svg BEFORE favicon.ico`)
  }
}
if (!/for \(const d of \[buildDir, targetDir, path\.join\(targetDir, 'dist'\), crmPublicDir\]\)/.test(gen)
  || !/favicon\.svg'\); if \(fs\.existsSync\(f\)\) fs\.rmSync\(f\)/.test(gen)) {
  fail('an uploaded favicon must remove the generated favicon.svg, or the generic mark shadows the customer\'s own')
}
if (!/write\(path\.join\(d, 'favicon\.svg'\), favSvg\)/.test(gen)) fail('the generator must write the per-tenant favicon.svg')

if (failed) { console.error(`\nseeded logo: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`seeded logo: a new CRM points at the logo it was given, and all ${FAVICON_TEMPLATES.length} CRM tabs wear the tenant's own icon`)
