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

if (failed) { console.error(`\nroof validation: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`roof validation: the pipeline (${statuses.length} statuses), contact details, door-knock outcomes and material money all mean what the product means`)
