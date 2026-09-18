// CI guard: the customer portal offers what the owner switched ON, and says it in English.
// A contractor tenant with Projects, Change Orders and Selections all switched off still showed all three in
// the portal nav and as dashboard tiles — "Review Change Orders" sitting above "0 Active Projects" — because
// `sections` was computed once at construction from which tables the vertical has (T14 M14). And the invoice
// list printed the status column verbatim: "$250 of $250 overdue", "Paid paid", "Paid refunded" (T14 L5).
//   bun scripts/check-portal-feature-sections.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// ── the portal asks what is switched on ─────────────────────────────────────────────────────────────────────────
const portal = read('packages/tenant-backend/src/portal/portal.ts')
if (!portal) fail('packages/tenant-backend/src/portal/portal.ts is missing')
if (!/enabledFeaturesFor\?: \(companyId: string\) => Promise<string\[\]>/.test(portal)) fail('the portal must be able to read the tenant\'s enabled features')
const map = portal.match(/const SECTION_FEATURES[\s\S]*?\n\}/)?.[0] || ''
if (!map) fail('SECTION_FEATURES is missing — nothing ties a portal section to a feature switch')
for (const [section, feature] of [['projects', "'projects'"], ['changeOrders', "'change_orders'"], ['selections', "'selections'"], ['sharedDocuments', "'documents'"]] as const) {
  if (!new RegExp(`${section}: \\[[^\\]]*${feature}`).test(map)) fail(`${section} must follow the ${feature} switch — it was offered on a tenant that had it off`)
}
const sectionsFor = portal.match(/async function sectionsFor[\s\S]*?\n  \}/)?.[0] || ''
if (!sectionsFor) fail('sectionsFor is missing — sections would go back to being fixed at construction')
if (!/deps\.enabledFeaturesFor\(companyId\)/.test(sectionsFor)) fail('…and it must actually call the lookup')
if (!/if \(enabled\.length === 0\) return has/.test(sectionsFor)) fail('an empty feature list must fall back to what is mounted — a portal that cannot read the list must not go blank')
if (!/catch[\s\S]{0,160}return has/.test(sectionsFor)) fail('…and so must a failed lookup')

// the home payload is read per request, not from the construction-time object
const home = portal.match(/app\.get\('\/p\/:token', portalAuth, async \(c\) => \{[\s\S]*?\n  \}\)/)?.[0] || ''
if (!home) fail('the portal home route is missing')
if (!/const sections = await sectionsFor\(contact\.companyId\)/.test(home)) fail('the home payload must work out the sections for THIS company')
if (!/\n      sections,/.test(home)) fail('…and return them')
if (/sections: has,/.test(portal)) fail('the payload still ships the construction-time sections — the switches are ignored')
if (!/\.\.\.\(sections\.projects \?/.test(home)) fail('the "Active Projects" tile must follow the same answer, or it reads 0 under a hidden module')

// taking a section out of the nav closes its endpoints too (#167)
if (!/const gate = \(section: keyof typeof has\)/.test(portal)) fail('a section route needs a gate — hiding a module must not leave its API open')
const GATED: Array<[string, string]> = [
  ["app.get('/p/:token/projects'", 'projects'],
  ["app.get('/p/:token/projects/:projectId'", 'projects'],
  ["app.get('/p/:token/change-orders'", 'changeOrders'],
  ["app.get('/p/:token/change-orders/:changeOrderId'", 'changeOrders'],
  ["app.post('/p/:token/change-orders/:changeOrderId/approve'", 'changeOrders'],
  ["app.post('/p/:token/change-orders/:changeOrderId/reject'", 'changeOrders'],
  ["app.get('/p/:token/selections/project/:projectId/selections'", 'selections'],
  ["app.post('/p/:token/selections/project/:projectId/selections/:selectionId'", 'selections'],
  ["app.get('/p/:token/shared-documents'", 'sharedDocuments'],
  ["app.get('/p/:token/projects/:projectId/files'", 'projectFiles'],
  ["app.post('/p/:token/projects/:projectId/files'", 'projectFiles'],
]
for (const [route, section] of GATED) {
  if (!portal.includes(`${route}, portalAuth, gate('${section}'),`)) fail(`${route} …) is not gated on ${section} — a switched-off module still serves the customer`)
}

// ── every template hands the portal the switches ────────────────────────────────────────────────────────────────
const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']
for (const t of TEMPLATES) {
  const src = read(`templates/${t}/backend/src/routes/portal.ts`)
  if (!src) { fail(`templates/${t}/backend/src/routes/portal.ts is missing`); continue }
  if (!/import \{ enabledFeaturesFor \} from '\.\.\/middleware\/enabledFeature\.ts'/.test(src)) fail(`${t} does not import the feature gate`)
  if (!/^  enabledFeaturesFor,$/m.test(src)) fail(`${t} does not pass enabledFeaturesFor — its portal falls back to "the tables exist"`)
}

// ── the invoice list speaks to the customer (T14 L5) ────────────────────────────────────────────────────────────
const inv = read('packages/tenant-ui/src/portal/PortalInvoices.tsx')
if (!inv) fail('packages/tenant-ui/src/portal/PortalInvoices.tsx is missing')
if (!/export const invoiceStatusLabel/.test(inv)) fail('the portal needs one place that turns a status into words')
const labels = inv.match(/const STATUS_LABELS[\s\S]*?\n\}/)?.[0] || ''
for (const [slug, word] of [['sent', 'Due'], ['partial', 'Partly paid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['refunded', 'Refunded']]) {
  if (!new RegExp(`${slug}: '${word}'`).test(labels)) fail(`"${slug}" must reach the customer as "${word}"`)
}
if (/\{invoice\.status\}/.test(inv)) fail('the customer is still shown the raw status column')
if (!/const settledLabel = /.test(inv)) fail('a settled invoice needs its own word — "Paid paid" and "Paid refunded" both came from printing two')
if (!/Settled \(\{paid\.length\}\)/.test(inv)) fail('the settled group must not be headed "Paid" while it holds a refunded invoice')
if (!/isPastDay\(inv\.dueDate\)/.test(inv)) fail('past due is a calendar-DAY question here too, or the portal disagrees with the invoice itself (#246)')

if (failed) { console.error(`\nportal feature sections: ${failed} check(s) FAILED`); process.exit(1) }
console.log('portal feature sections: the portal offers what is switched on, and says it in English')
