// CI guard: a rule applied when a record is CREATED also applies when it is EDITED.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// This is rule 2 of the three that were asked for by name, and it was the one with no guard. Rule 1
// (every sale path checks the batch) has check-every-sale-path-checks-batches.ts; rule 3 (a server
// feature has a screen) has check-server-features-have-screens.ts. Rule 2 was named in the same
// sentence and then went unenforced for four rounds, which is exactly the shape of thing it is
// about.
//
// The findings it exists to stop, all the same shape:
//
//   T31 L8    the markup notice was on POST only → editing a customer stripped markup in silence
//   T48 Q7    the campaign LIST was gated        → the detail routes were not
//   T47 P20   a new delivery zone could not overlap → editing one still could
//   T51/T52 M6 the date-of-birth rules were on POST only → a customer created at DOB 1990 could be
//             EDITED to 2010 and the record answered 200, turning an adult into a 16-year-old on a
//             system whose whole job is to know which it is
//
// A customer is created once and edited for years. The edit path is the one that matters more, and
// it is the one that keeps getting forgotten.
//
// ── what it checks ──────────────────────────────────────────────────────────────────────────────
//
// Not "does the file mention the rule" — the create handler mentions it, and the file is one file.
// Each entry names a rule, the CREATE route and the EDIT route, and the guard reads each route's
// own body. The only way to satisfy it is for both to run the rule, which in practice means one
// shared function called twice — which is the point.
//
//   bun scripts/check-create-rules-apply-on-edit.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
/** Comments stripped: a rule about code must not be satisfied by prose describing it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** One route's body: from its registration to the next top-level app.<verb>( . */
function routeBody(src: string, route: RegExp, label: string): string | null {
  const at = src.search(route)
  if (at === -1) { fail(`could not find ${label} — if it was renamed, update this guard`); return null }
  const rest = src.slice(at)
  const next = rest.slice(1).search(/\napp\.(?:get|post|put|patch|delete)\(/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

type Rule = {
  file: string
  what: string
  create: RegExp
  edit: RegExp
  needle: RegExp
  finding: string
}

const RULES: Rule[] = [
  {
    file: 'templates/crm-dispensary/backend/src/routes/contacts.ts',
    what: 'the date-of-birth rules on a customer',
    create: /app\.post\('\/',/,
    edit: /app\.put\('\/:id'/,
    needle: /checkDateOfBirth\(/,
    finding: 'T51/T52 M6 — a customer created at DOB 1990 could be edited to 2010 and answer 200',
  },
  {
    file: 'templates/crm-salon/backend/src/routes/serviceRecords.ts',
    what: 'normalising a formula into a list of steps',
    create: /app\.post\('\/',/,
    edit: /app\.put\('\/:id'/,
    needle: /normaliseFormula\(/,
    finding: 'RR2 R1 — the writer normalised on create and copied the raw body on edit, and a string formula took down the whole client chart',
  },
]

for (const r of RULES) {
  const src = code(read(r.file))
  if (!src) { fail(`${r.file} is missing`); continue }
  const createBody = routeBody(src, r.create, `the create route in ${r.file}`)
  const editBody = routeBody(src, r.edit, `the edit route in ${r.file}`)
  if (!createBody || !editBody) continue

  const onCreate = r.needle.test(createBody)
  const onEdit = r.needle.test(editBody)

  if (!onCreate && !onEdit) {
    fail(`${r.file}: ${r.what} is applied on NEITHER create nor edit — the rule has gone. (${r.finding})`)
  } else if (onCreate && !onEdit) {
    fail(`${r.file}: ${r.what} is applied when the record is CREATED and not when it is EDITED. A record is created once and edited for years. (${r.finding})`)
  } else if (!onCreate && onEdit) {
    fail(`${r.file}: ${r.what} is applied on EDIT and not on CREATE — same rule, same answer both ways. (${r.finding})`)
  }
}

// ── the best version of this rule: put it in the SCHEMA, and both paths get it for free ─────────
//
// Markup in a name is refused — not stripped with a warning, which is what T31 L8 originally
// settled on — and the refusal lives in a zod superRefine on contactSchema. Both handlers parse
// that schema (create with .parse, edit with .partial().parse), so the rule applies to both BY
// CONSTRUCTION rather than by anyone remembering. That is the shape to copy, and it is pinned here
// so the refusal cannot quietly move back into one route body.
{
  const contacts = code(read('templates/crm-dispensary/backend/src/routes/contacts.ts'))
  if (!/A name cannot contain formatting or tags/.test(contacts)) {
    fail('contacts.ts no longer refuses markup in a name (T31 L8, later hardened from a warning to a refusal)')
  }
  const schemaAt = contacts.search(/const contactSchema = z\.object\(/)
  const postAt = contacts.search(/app\.post\('\/',/)
  if (schemaAt === -1 || postAt === -1 || schemaAt > postAt) {
    fail('the markup refusal must live on contactSchema, above the routes, so create AND edit both run it')
  }
  if (!/contactSchema\.parse\(/.test(contacts)) fail('the create path must parse contactSchema')
  if (!/contactSchema\.partial\(\)\.parse\(/.test(contacts)) fail('the edit path must parse the SAME schema, partially — that is what makes the rule apply to both')
}

// …and the shared implementation really is shared: one definition, called from both. Two copies of
// a rule drift, which is how the pair above stops matching in the first place.
{
  const contacts = code(read('templates/crm-dispensary/backend/src/routes/contacts.ts'))
  const defs = (contacts.match(/function checkDateOfBirth\b/g) || []).length
  const calls = (contacts.match(/checkDateOfBirth\(/g) || []).length - defs
  if (defs !== 1) fail(`contacts.ts must define checkDateOfBirth exactly once — found ${defs}`)
  if (calls < 2) fail(`checkDateOfBirth is called ${calls} time(s); create and edit both have to run it`)
}

console.log(failed ? `\n${failed} failure(s)` : `ok: ${RULES.length} create-time rule(s) also apply on edit`)
process.exit(failed ? 1 : 0)
