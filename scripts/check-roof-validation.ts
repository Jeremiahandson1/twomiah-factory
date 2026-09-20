// CI guard: a write schema must mean what the product means.
//
// Roof T17 found the same fault in six routes at once — H5, M1, M2, M3, N1, N3 — and the tester was
// right that they are one job. Each one declared `z.string()` where the product meant "one of these
// eleven", or `.optional()` where it meant "an email address". Every one returned 201 and stored
// nonsense: five junk job statuses, an adjuster reachable on "abcdefghij", a canvassing stop with the
// outcome "banana", a material order whose prices were silently stripped on the way in.
//
// None of that looks like a bug from the outside. It surfaces later as a report that stops adding up
// — 50 jobs, 44 in the breakdown — or a $2,880 order listing with a blank total.
//
//   bun scripts/check-roof-validation.ts
import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }

const B = 'templates/crm-roof/backend/src/'
const F = 'templates/crm-roof/frontend/src/'

// ── one home for the vocabulary ───────────────────────────────────────────────────────────────────
const lib = read(B + 'lib/validation.ts')
if (!lib) fail(`${B}lib/validation.ts is missing — the accepted values need one home`)
for (const [name, why] of [
  ['JOB_STATUSES', 'the job pipeline'],
  ['MATERIAL_ORDER_STATUSES', 'material order states'],
  ['CANVASSING_OUTCOMES', 'door-knock outcomes'],
] as Array<[string, string]>) {
  if (!new RegExp(`export const ${name} = \\[`).test(lib)) fail(`${why} must be enumerated in lib/validation.ts, not spelled out per route`)
}
if (!/export const phone = z\.string\(\)\.trim\(\)\.refine/.test(lib)) fail('a phone must be validated in one place — three routes accepted letters')
if (!/d\.length >= 10 && d\.length <= 15/.test(lib)) fail('…by digit count, so any human formatting still passes')
if (!/export const email = z\.string\(\)\.trim\(\)\.email/.test(lib)) fail('…and an email likewise')
if (!/export const optional = /.test(lib)) fail('"blank" must mean "not given" rather than "invalid", or every optional field becomes required')

/** the eleven statuses, read from the one place that declares them */
const statuses = (lib.match(/export const JOB_STATUSES = \[([\s\S]*?)\] as const/)?.[1] ?? '')
  .match(/'[a-z_]+'/g)?.map((s) => s.slice(1, -1)) ?? []
if (statuses.length < 5) fail('could not read JOB_STATUSES — this guard is not looking where it thinks it is')

// ── H5: the pipeline is declared once and enforced ────────────────────────────────────────────────
{
  const jobs = read(B + 'routes/jobs.ts')
  if (/const PIPELINE_ORDER = \[\s*\n\s*'lead'/.test(jobs))
    fail('jobs.ts is keeping its own copy of the pipeline again — it drifted from the schema once already')
  if (!/const PIPELINE_ORDER: readonly string\[\] = JOB_STATUSES/.test(jobs))
    fail('…the "Advance" order and the accepted values must be the same list')
  if (/status: z\.string\(\)\.optional\(\)/.test(jobs))
    fail('a job status must be one of the pipeline values — as a free string, five junk statuses were accepted and their jobs dropped out of the report breakdown (H5)')
  if (!/status: optional\(jobStatus\)/.test(jobs))
    fail('…so the schema must use the enum')

  // the frontend declares the same list twice; all three must agree or a status renders as a blank column
  for (const [file, decl] of [['pages/roofing/PipelineBoard.tsx', 'STAGES'], ['pages/roofing/JobsPage.tsx', 'STATUSES']] as Array<[string, string]>) {
    const src = read(F + file)
    const feList = (src.match(new RegExp(`const ${decl} = \\[([\\s\\S]*?)\\]`))?.[1] ?? '').match(/'[a-z_]+'/g)?.map((s) => s.slice(1, -1)) ?? []
    if (!feList.length) { fail(`${file} no longer declares ${decl} where this guard can read it`); continue }
    const missing = statuses.filter((s) => !feList.includes(s))
    const extra = feList.filter((s) => !statuses.includes(s))
    if (missing.length || extra.length)
      fail(`${file} ${decl} has drifted from JOB_STATUSES — missing [${missing}], unexpected [${extra}]. A status the backend accepts but the board does not know renders as a blank column.`)
  }
}

// ── M2 / N3: contact details ──────────────────────────────────────────────────────────────────────
{
  const ins = read(B + 'routes/insurance.ts')
  if (!/phone: optional\(phoneField\)/.test(ins) || !/email: optional\(emailField\)/.test(ins))
    fail('an adjuster is a person you have to phone or email — both were accepted as any string (M2)')
  const crews = read(B + 'routes/crews.ts')
  if (/foremanPhone: z\.string\(\)\.min\(1\)/.test(crews)) fail('a crew foreman phone accepted "abcdefghij" (N3)')
  if (!/foremanPhone: phone/.test(crews)) fail('…it must use the shared phone rule')
}

// ── N3: the door-knock outcome ────────────────────────────────────────────────────────────────────
{
  const canv = read(B + 'routes/canvassing.ts')
  if (/const body = await c\.req\.json\(\)\n[\s\S]{0,200}canvassingStop/.test(canv) && !/stopSchema/.test(canv))
    fail('the canvassing stop still reads its body raw')
  if (!/outcome: canvassingOutcome/.test(canv))
    fail('a stop outcome drives the map pin and the lead count — "banana" stored with a 201 (N3)')
  if (!/const body = stopSchema\.parse/.test(canv))
    fail('…and the body must go through that schema')
}

// ── N1: material orders ───────────────────────────────────────────────────────────────────────────
{
  const mat = read(B + 'routes/materials.ts')
  if (/quantity: z\.number\(\),/.test(mat))
    fail('the material write schema is back to demanding `quantity` while the rest of the product sends `qty` — no payload satisfies both ends (N1)')
  if (!/lineItems: z\.array\(lineItemInput\)\.min\(1\)/.test(mat))
    fail('…it must accept both spellings and require at least one line')
  if (!/const \{ lineItems, total \} = normaliseLineItems\(data\.lineItems\)/.test(mat))
    fail('…and normalise them rather than storing whatever arrived')
  if (/totalCost: data\.totalCost\?\.toString\(\)/.test(mat))
    fail('totalCost must be computed from the line items — a $2,880 order listed with a blank total (N1)')
  if (!/totalCost: total\.toFixed\(2\)/.test(mat))
    fail('…from the server\'s own arithmetic')
  if (!/orderStatus: optional\(materialOrderStatus\)/.test(mat))
    fail('an unknown orderStatus was silently stored as not_ordered (N1)')
  // the edit path has to obey the same rule as create
  if (!/delete updateData\.totalCost/.test(mat) || !/updateData\.totalCost = total\.toFixed\(2\)/.test(mat))
    fail('…and an edit must recompute it too, not take the client\'s figure')
}

// ── M1: receptionist rules ────────────────────────────────────────────────────────────────────────
{
  const ai = read(B + 'routes/aiReceptionist.ts')
  if (!/const ruleFields = z\.object\(/.test(ai))
    fail('receptionist rules were handed to the database unvalidated — four junk inputs stored, two came back as 500s that were really NOT NULL violations (M1)')
  if (!/trigger: z\.enum\(\[/.test(ai) || !/channel: z\.enum\(\[/.test(ai))
    fail('…a rule with an unknown trigger or channel simply never fires')
  if (!/const body = ruleSchema\.parse/.test(ai))
    fail('…and the create route must use it')
  // the object and the cross-field rule stay apart: superRefine returns a ZodEffects with no
  // `.partial()`, so folding them together makes the edit route throw at runtime
  if (!/const body = ruleFields\.partial\(\)\.parse/.test(ai))
    fail('…while the edit route partials the plain object, not the refined one')
}

// ── M3: the CSV importer ──────────────────────────────────────────────────────────────────────────
{
  const imp = read(B + 'services/import.ts')
  if (!/LOOKS_LIKE_EMAIL/.test(imp))
    fail('the importer accepted anything in the email column (M3)')
  if (!/results\.errors\.push\(\{ line: lineNum, error: `"\$\{String\(rawEmail\)/.test(imp))
    fail('…and must SAY so — it reported errors: 0 on a file with a bad address, which is worse than refusing it')
}

// ── H3: revenue is money, not what the pipeline is thought to be worth ────────────────────────────
{
  const inv = read(B + 'routes/invoices.ts')
  if (!/app\.get\('\/summary'/.test(inv))
    fail('Reports needs invoiced / collected / outstanding from invoices — it showed a single "Revenue" tile summed from job estimates (H3)')
  if (inv.indexOf("app.get('/summary'") > inv.indexOf("app.get('/:id'") && inv.indexOf("app.get('/:id'") !== -1)
    fail("…declared before '/:id', or the path is swallowed as an invoice id and answers 404")
  // the fleet's definitions, not new ones
  if (!/NOT IN \('void', 'draft'\)/.test(inv)) fail('invoiced must be every BILLED invoice — draft and void excluded, a refunded sale still counted')
  if (!/NOT IN \('void', 'draft', 'refunded'\)/.test(inv)) fail('outstanding must be ISSUED only — a refunded invoice owes nothing')

  const rp = read(F + 'pages/roofing/ReportsPage.tsx').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  if (/Total Revenue/.test(rp)) fail('the estimates tile must not be called "Total Revenue" — it is pipeline value (H3)')
  if (!/Pipeline Value<\/span>/.test(rp)) fail('…it must say what it is')
  if (!/\/api\/invoices\/summary/.test(rp)) fail('…and the real money must come from the server')
}

// ── M5: a bar label is readable on its own bar ────────────────────────────────────────────────────
{
  const rp = read(F + 'pages/roofing/ReportsPage.tsx')
  if (/<span className="text-white text-xs font-medium">/.test(rp))
    fail('chart bar labels are white on whatever colour the bar is — 2.15:1 on the amber crew bars (M5)')
  if (!/function labelOn\(hex: string\)/.test(rp))
    fail('…the label colour must be computed from the bar\'s own luminance')
}

// ── M9: an upload is what its bytes say it is ─────────────────────────────────────────────────────
{
  if (!/export function sniffImage\(/.test(lib))
    fail('photo upload trusted the client\'s declared MIME type — HTML and SVG were stored and served as images (M9)')
  if (/mime: 'image\/svg/.test(lib))
    fail('…SVG must NOT be accepted: it is a document that can carry script, and serving one from the tenant origin is stored XSS')
  const jobs = read(B + 'routes/jobs.ts')
  if (/if \(!file\.type\.startsWith\('image\/'\)\)/.test(jobs))
    fail('…the route must not decide from file.type, which is a string the uploader chose')
  if (!/const sniffed = sniffImage\(buffer\)/.test(jobs)) fail('…it must read the bytes')
  if (!/uploadFile\(key, buffer, sniffed\.mime\)/.test(jobs)) fail('…and store it under the type it actually is')
  if (!/JOB_PHOTO_TYPES\.includes\(photoType as any\)/.test(jobs)) fail('…photoType accepted "banana" (M9)')
}

// ── M10: an error message is for the user, not a map of the server ────────────────────────────────
{
  for (const f of ['stormRadar.ts', 'financing.ts', 'reviews.ts']) {
    const src = read(B + `routes/${f}`)
    if (/message: e\.message/.test(src))
      fail(`${f} hands the caller the exception text, which names the source file and the environment variables (M10)`)
    if (!/logger\.error\(/.test(src)) fail(`…${f} must log the detail instead of discarding it`)
  }
}

// ── M11: money that will not fit decimal(10,2) ────────────────────────────────────────────────────
{
  const q = read(B + 'routes/quotes.ts')
  if (!/export const MONEY_CEILING = 99_999_999\.99/.test(q))
    fail('a unit price of 100,000,000 came back as a 500 — the column ceiling must be a named limit (M11)')
  if (!/if \(!Number\.isFinite\(line\) \|\| line > MONEY_CEILING\)/.test(q))
    fail('…checked on the computed line total, because quantity × unitPrice overflows before either field does')
  if (!/class QuoteTooLargeError/.test(q)) fail('…as an error the API layer can turn into a 400')
  const idx = read(B + 'index.ts')
  if (!/err\.name === 'QuoteTooLargeError'/.test(idx)) fail('…and index.ts must answer 400, not the driver\'s 500')
}

// ── M7: a feature switch has to switch the API off too ────────────────────────────────────────────
{
  const idx = read(B + 'index.ts')
  if (!/import \{ requireEnabledFeature \} from '\.\/middleware\/enabledFeature\.ts'/.test(idx))
    fail('switching a feature off hid the nav and left the API serving — roof was the only template that never wired in the shared gate (M7)')
  const gated = [...idx.matchAll(/\['(\/api\/[a-z-]+)', '([a-z_]+)'\]/g)].map((m) => m[1])
  if (gated.length < 12) fail(`only ${gated.length} optional modules are gated — the list has shrunk`)
  if (!gated.includes('/api/leads')) fail('…lead_inbox is the one the tester proved; it must stay gated')
  // and the gate must never reach the product itself
  for (const core of ['/api/contacts', '/api/jobs', '/api/quotes', '/api/invoices', '/api/settings', '/api/users', '/api/company', '/api/auth']) {
    if (gated.includes(core)) fail(`${core} must NOT be feature-gated — a missing flag would lock a tenant out of their own CRM, which is worse than the bug being fixed`)
  }
  if (!/app\.use\(`\$\{path\}\/\*`, authenticate, requireEnabledFeature\(feature\)\)/.test(idx))
    fail("…both the bare path and the wildcard must be registered: '/api/leads' does not match '/api/leads/*'")
}

// ── N2: an event on a timeline says what happened ─────────────────────────────────────────────────
{
  const jobs = read(B + 'routes/jobs.ts')
  if (!/body: `Photo added\$\{/.test(jobs))
    fail('photo events carried no text, so a job timeline rendered thirteen bare dates out of fifteen (N2)')
}

// ── the generated scope keeps its own content type ────────────────────────────────────────────────
{
  const media = read(B + 'routes/media.ts')
  if (!/const GENERATED_DOCUMENT = /.test(media))
    fail('the Xactimate scope and CSV were relabelled application/octet-stream, so the PDF downloaded instead of previewing')
  if (!/GENERATED_DOCUMENT\.test\(key\) && GENERATED_TYPES\.has\(obj\.contentType\)/.test(media))
    fail('…and the exemption must be by PROVENANCE — a key this server wrote — not by file type, because an uploaded PDF served inline from the tenant origin is a real vector')
  if (!/SAFE_INLINE_TYPES/.test(media)) fail('…the image allow-list must stay')
}

if (failed) { console.error(`\nroof validation: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`roof validation: the pipeline (${statuses.length} statuses), contact details, door-knock outcomes and material money all mean what the product means`)
