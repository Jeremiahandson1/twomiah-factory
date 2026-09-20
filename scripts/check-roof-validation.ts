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

/**
 * Two lists, read from the one place that declares them.
 *
 * PIPELINE_STATUSES is the ordered walk from lead to collected — what Advance steps along and what
 * the board draws a column for. TERMINAL_STATUSES (lost, cancelled) is where a job ends when it is
 * NOT going to be paid; those are valid statuses but deliberately not stages, because a closed job
 * comes off the board and Advance must never walk a collected job into `lost`.
 */
const pipeline = (lib.match(/export const PIPELINE_STATUSES = \[([\s\S]*?)\] as const/)?.[1] ?? '')
  .match(/'[a-z_]+'/g)?.map((s) => s.slice(1, -1)) ?? []
const terminal = (lib.match(/export const TERMINAL_STATUSES = \[([^\]]*)\] as const/)?.[1] ?? '')
  .match(/'[a-z_]+'/g)?.map((s) => s.slice(1, -1)) ?? []
const statuses = pipeline
if (pipeline.length < 5) fail('could not read PIPELINE_STATUSES — this guard is not looking where it thinks it is')
if (!terminal.length) fail('a job needs somewhere to end that is not "paid" — TERMINAL_STATUSES is how a job that fell through leaves the board')
if (!/export const JOB_STATUSES = \[\.\.\.PIPELINE_STATUSES, \.\.\.TERMINAL_STATUSES\] as const/.test(lib))
  fail('JOB_STATUSES must be the two lists joined, so the accepted values and the board can never disagree')
for (const t of terminal) {
  if (pipeline.includes(t))
    fail(`"${t}" is in PIPELINE_STATUSES — Advance would walk a job into it, so a collected job could become ${t}`)
}

// ── H5: the pipeline is declared once and enforced ────────────────────────────────────────────────
{
  const jobs = read(B + 'routes/jobs.ts')
  if (/const PIPELINE_ORDER = \[\s*\n\s*'lead'/.test(jobs))
    fail('jobs.ts is keeping its own copy of the pipeline again — it drifted from the schema once already')
  // Was `= JOB_STATUSES`, which was right while every status was a stage. Now that a job can end as
  // lost or cancelled, Advance must walk the PIPELINE half only — the rule is unchanged (no local
  // copy; the order comes from the shared declaration), the source is narrower.
  if (!/const PIPELINE_ORDER: readonly string\[\] = PIPELINE_STATUSES/.test(jobs))
    fail('…the "Advance" order must be the shared PIPELINE_STATUSES, never a local copy and never the terminal statuses')
  if (!/app\.post\('\/:id\/close'/.test(jobs))
    fail('a job that falls through needs a way to be closed — without one it sits on the board for ever and keeps counting in pipeline reports')
  if (!/lostReason: z\.string\(\)\.trim\(\)\.min\(1/.test(jobs))
    fail('…and closing must require a REASON: close-rate by reason is the number the business is run on, and a bare flag throws it away')
  if (!/existing\.status === 'collected'/.test(jobs))
    fail('…while a job that was PAID must not be closeable as lost, or revenue walks out of the report')
  if (/status: z\.string\(\)\.optional\(\)/.test(jobs))
    fail('a job status must be one of the pipeline values — as a free string, five junk statuses were accepted and their jobs dropped out of the report breakdown (H5)')
  if (!/status: optional\(jobStatus\)/.test(jobs))
    fail('…so the schema must use the enum')

  // The frontend declares the list twice, for two different jobs:
  //   the BOARD draws a column per pipeline stage — a terminal status there would be a column for
  //     jobs that are off the board, which is the opposite of closing one;
  //   the LIST filters by any status a job can hold, terminal included, or a closed job becomes
  //     unfindable and closing would look like deleting.
  for (const [file, decl, expected, what] of [
    ['pages/roofing/PipelineBoard.tsx', 'STAGES', pipeline, 'PIPELINE_STATUSES'],
    ['pages/roofing/JobsPage.tsx', 'STATUSES', [...pipeline, ...terminal], 'JOB_STATUSES'],
  ] as Array<[string, string, string[], string]>) {
    const src = read(F + file)
    const feList = (src.match(new RegExp(`const ${decl} = \\[([\\s\\S]*?)\\]`))?.[1] ?? '').match(/'[a-z_]+'/g)?.map((s) => s.slice(1, -1)) ?? []
    if (!feList.length) { fail(`${file} no longer declares ${decl} where this guard can read it`); continue }
    const missing = expected.filter((s) => !feList.includes(s))
    const extra = feList.filter((s) => !expected.includes(s))
    if (missing.length || extra.length)
      fail(`${file} ${decl} has drifted from ${what} — missing [${missing}], unexpected [${extra}]. A status the backend accepts but the screen does not know renders as a blank column or an unfindable job.`)
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
  const pairs = [...idx.matchAll(/\['(\/api\/[a-z-]+)', '([a-z_]+)'\]/g)].map((m) => [m[1], m[2]] as [string, string])
  const gated = pairs.map(([p]) => p)
  if (gated.length < 6) fail(`only ${gated.length} optional modules are gated — the list has shrunk`)
  if (!gated.includes('/api/leads')) fail('…lead_inbox is the one the tester proved; it must stay gated')

  /**
   * The gate must not be wider than the product's own idea of optional.
   *
   * A first attempt gated insurance, crews, materials, measurements, AI receptionist, SMS and
   * QuickBooks, and switched off twelve modules on a tenant using them daily — because those nav
   * items are shown unconditionally. A UI that offers a page the API refuses is worse than an API
   * that serves a page the UI hides: it is a 403 in the user's face, on a link the product gave them.
   *
   * So every server-gated feature must also be gated in the nav.
   */
  const layout = read(F + 'components/layout/AppLayout.tsx')
  const navFeatures = new Set([...layout.matchAll(/feature: '([a-z_]+)'/g)].map((m) => m[1]))
  const uiWouldStillOffer = pairs.filter(([, feat]) => !navFeatures.has(feat))
  if (uiWouldStillOffer.length)
    fail(`${uiWouldStillOffer.length} module(s) are gated on the server but shown unconditionally in the nav — switching the feature off leaves a visible link that 403s: ${uiWouldStillOffer.map(([p, f]) => `${p} (${f})`).join(', ')}`)
  if (!/const enabled = <T extends \{ feature\?: string \}>\(items: T\[\]\)/.test(layout))
    fail('…and every nav group must be filtered, or a feature key added to one of them is silently ignored')
  // and the gate must never reach the product itself
  for (const core of ['/api/contacts', '/api/jobs', '/api/quotes', '/api/invoices', '/api/settings', '/api/users', '/api/company', '/api/auth']) {
    if (gated.includes(core)) fail(`${core} must NOT be feature-gated — a missing flag would lock a tenant out of their own CRM, which is worse than the bug being fixed`)
  }
  /**
   * Both registrations, and what each must carry.
   *
   * The previous version of this check matched one literal expression —
   * `app.use(\`${path}/*\`, authenticate, requireEnabledFeature(feature))` — which had two problems.
   * It only ever inspected the WILDCARD line, despite an error message claiming to check both; and
   * pinning the exact middleware text meant any legitimate change to how they are composed tripped
   * it, inviting exactly the "widen the regex" reflex that turns a guard into decoration.
   *
   * What actually matters is structural: BOTH `app.use(path, …)` and `app.use(\`${path}/*\`, …)` are
   * registered (Hono does not match '/api/leads/*' for '/api/leads'), and each carries the auth check
   * and the feature check — however they are wrapped. They are wrapped now: `skipPublic` exempts the
   * webhook paths that authenticate themselves with a secret, which the first gate broke.
   */
  for (const [decl, what] of [
    [/app\.use\(path,([^\n]*)\)/, 'the bare path'],
    [/app\.use\(`\$\{path\}\/\*`,([^\n]*)\)/, 'the wildcard'],
  ] as Array<[RegExp, string]>) {
    const m = idx.match(decl)
    if (!m) { fail(`${what} is not registered — '/api/leads' does not match '/api/leads/*', so both are needed`); continue }
    if (!/\bauthenticate\b/.test(m[1])) fail(`${what} does not apply authenticate`)
    if (!/\brequireEnabledFeature\(feature\)/.test(m[1])) fail(`${what} does not apply the feature check`)
  }
  /**
   * …and the gate must not answer the door to the outside world.
   *
   * A REGRESSION THAT SHIPPED (c0821bf7, 08:27). Putting `authenticate` in front of everything under
   * a gated prefix also covered paths that are public by design — a lead source POSTing with a
   * webhook secret, a signed Wisetack callback, Twilio and CallRail posting recordings. All of them
   * answered 401 in production: inbound lead capture was simply dead.
   */
  if (!/const PUBLIC_WITHIN_GATED = \[/.test(idx))
    fail('the gate must record the paths that are public by design, or it 401s the webhooks that feed the CRM')
  for (const pub of ['\\/api\\/leads\\/inbound\\/', '\\/api\\/financing\\/webhooks\\/']) {
    if (!idx.includes(pub)) fail(`${pub.replace(/\\\//g, '/')} must stay reachable without a bearer token — it authenticates itself`)
  }
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

// ── M4: dark mode has to be reachable, or its CSS is decoration ───────────────────────────────────
{
  // comments stripped first: `// applyStoredTheme()` satisfies a naive match while doing nothing,
  // which is exactly the state this check exists to detect
  const main = read(F + 'main.tsx').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  if (!/applyStoredTheme\(\)/.test(main))
    fail('roof shipped 173 dark: rules and nothing ever put the `dark` class on <html> — every one of them was dead CSS (M4)')
  if (!/import \{ applyStoredTheme \} from '\.\/shared'/.test(main))
    fail('…using the fleet\'s shared hook rather than a private copy')
  const layout = read(F + 'components/layout/AppLayout.tsx')
  if (!/const \{ setTheme, isDark \} = useTheme\(\)/.test(layout))
    fail('…and a person must be able to choose it')
  if (!/aria-label=\{isDark \? 'Switch to light mode' : 'Switch to dark mode'\}/.test(layout))
    fail('…from a control that says what it does')
}

// ── M8: a measurement that was taken is a measurement worth keeping ───────────────────────────────
{
  const est = read(B + 'routes/estimator.ts')
  if (!/await db\.insert\(measurementReport\)\.values\(\{/.test(est))
    fail('the instant estimator computed squares and a price range, returned them, and stored nothing — the lead arrived with less information than the homeowner had (M8)')
  if (!/source: 'instant_estimator',\n\s*estimateLow:/.test(est))
    fail('…the price range must be recorded with it')
  if (!/cost: '0\.00'/.test(est))
    fail('…at no measurement cost: the public estimator burns no credit, and that is verified separately')
  if (!/jobId: null,/.test(est))
    fail('…with no job yet, so it is already there to attach when the lead becomes one')
}

// ── the lows that are silent rather than loud ─────────────────────────────────────────────────────
{
  const q = read(B + 'routes/quotes.ts')
  if (!/class DiscountTooLargeError/.test(q))
    fail('a $99,999 discount on a $100 quote clamped silently and saved at $0.00 — the number typed was not the number applied, and nobody was told (L2)')
  if (!/if \(discount > subtotal\) throw new DiscountTooLargeError/.test(q))
    fail('…it must be refused rather than clamped')
  if (!/expiresAt: z\.string\(\)\.optional\(\)\.refine\(/.test(q))
    fail('an expiry of 2020-01-01 was accepted, so the quote arrived already expired (L3)')
  if (!/new Date\(v\)\.getTime\(\) > Date\.now\(\) - 24 \* 60 \* 60 \* 1000/.test(q))
    fail('…checked against now, with a day of slack for time zones')

  // L5: the user table has no `name` column, so `u.name || u.email` is not a fallback — it is the
  // only branch, and Reports listed reps by email.
  const helper = read(F + 'utils/user.ts')
  if (!/export function displayName\(/.test(helper))
    fail('sales reps were listed by raw email because `u.name` does not exist on the user table (L5)')
  // the implementation matters as much as its existence: `firstName + ' ' + lastName` is always
  // truthy, so a user with no surname renders as "Dana undefined" and the email is unreachable
  if (!/\[u\.firstName, u\.lastName\]\.filter\(Boolean\)\.join\(' '\)/.test(helper))
    fail('…built by filtering the parts, not concatenating them')
  const offenders: string[] = []
  for (const page of ['ReportsPage', 'PipelineBoard', 'JobsPage', 'JobDetailPage', 'CanvassingDashboard']) {
    const src = read(F + `pages/roofing/${page}.tsx`)
    if (/u\.name \|\| u\.email|u\.name \|\| u\.firstName/.test(src)) offenders.push(page)
    if (/displayName\(/.test(src) && !/utils\/user/.test(src)) offenders.push(`${page} (uses it without importing)`)
  }
  if (offenders.length) fail(`${offenders.length} page(s) still name a person by hand instead of using displayName(): ${offenders.join(', ')}`)
}

// ── L1 / L6 / L7 ──────────────────────────────────────────────────────────────────────────────────
{
  const settings = read(B + 'routes/settings.ts')
  if (!/'enabledFeatures' in body/.test(settings))
    fail('settings PUT accepted enabledFeatures, dropped it, and answered 200 — a caller who thinks they saved their feature list is worse off than one who got an error (L1)')
  if (!/company\/features/.test(settings))
    fail('…and it must say where features are actually changed')

  const q = read(B + 'routes/quotes.ts')
  if (!/convertedToJobId: newJob\.id, jobId: newJob\.id/.test(q))
    fail('a converted quote left its own jobId null, so the Job column stayed blank for ever (L6)')

  const claim = read(F + 'pages/roofing/InsuranceClaimPage.tsx')
  if (/value=\{li\.unitPrice\} onChange=\{\(e\) => updateSupLineItem\(i, 'unitPrice', Number\(e\.target\.value\)\)\}/.test(claim))
    fail('typing -1500 into a supplement price produced 01500 — Number() on every keystroke turns a lone minus into 0 and the digits append to it (L7)')
  if (!/value=\{li\.unitPrice === 0 \|\| li\.unitPrice === undefined \? '' : li\.unitPrice\}/.test(claim))
    fail('…an empty field must stay empty while it is being filled in')
}

if (failed) { console.error(`\nroof validation: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`roof validation: the pipeline (${statuses.length} statuses), contact details, door-knock outcomes and material money all mean what the product means`)
