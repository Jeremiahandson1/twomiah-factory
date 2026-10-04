// CI guard: a contact's PORTAL TOKEN must never leave the server inside a contact row.
//
// WHY THIS EXISTS. T42, salon HIGH: "Stylists can read client portal tokens: GET /api/clients/:id
// returns contact.portalToken for portal-enabled clients (removed from list endpoints in T22, not the
// detail endpoint)."
//
// `contact.portal_token` is a BEARER CREDENTIAL. Whoever holds it opens /portal/<token> as that
// customer — their invoices, their documents, and on the contractor template the page where change
// orders get signed. It is a password kept in a column, and the only handlers that should ever see it
// are the one that mints it and the one that redeems it.
//
// It had been fixed three times, each time in one place, because the contact row leaves the server
// through more doors than anybody checked:
//
//   T20 L4  the salon clients LIST      fixed by hand, in that one map
//   T22     the shared contacts module  fixed properly, with a helper
//   T42     the salon client CHART      had never stripped anything at all
//
// …and writing this guard turned up six more that no QA round had reached: the shared invoice detail,
// roof's forked contacts route, roof's quote detail, roof's SMS thread, the salon project detail and
// the vet patient chart (the pet owner's row, whole). Every one of them was the same bug, and every
// one had to be found separately, because each door had its own copy of "return the row".
//
// There is one helper now — `withoutPortalCredential`, exported from
// packages/tenant-backend/src/contacts/contacts.ts and re-exported from the package index — and this
// guard is what makes the NEXT door fail in CI instead of in a QA round.
//
// WHAT IT WALKS. Every .ts under packages/tenant-backend/src and templates/*/backend/src, for all 13
// CRM templates including the parked ones: crm-automotive is not developed, but a guard that skips it
// silently is how a leak survives a template being un-parked, so it is named in the ALLOW list below
// with its reason instead. Website templates have no contact table and are not walked.
//
// THE RULE. Two shapes of read can carry the column, and both are checked:
//
//   A  an unprojected row — `db.select().from(contact)` — assigned to a variable, directly or as one
//      element of a `Promise.all([…])`;
//   B  a PROJECTION that names the whole table — `db.select({ contact, profile: clientProfile })` —
//      which puts the entire row under `row.contact`. This is the shape the salon list leaked
//      through, and the shape a guard looking only for `select()` would call clean.
//
// Either one, spread into an object (`...row`) or handed over as an object value (`contact: row`,
// `owner: row || null`, `contact: rows[0] || null`), must pass through `withoutPortalCredential(…)`.
// A projection that lists COLUMNS (`db.select({ id: contact.id, name: contact.name })`) cannot carry
// a column it did not ask for and is deliberately not flagged.
//
// THE ALLOW LIST is the set of files where that row deliberately goes somewhere that is not a CRM
// response, each with its reason. It lists FILES with justifications, not line numbers, so it cannot
// drift as files are edited.
//
//   bun scripts/check-portal-token-never-ships.ts
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { stripSource as strip } from './lib/stripComments.ts'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const HELPER = 'withoutPortalCredential'

/**
 * Files where a whole contact row is read and passed on deliberately, and the destination is not a
 * response to a CRM user. Each entry says why, because an allow list without reasons is just a list
 * of leaks somebody got used to.
 */
const ALLOW: Record<string, string> = {
  // The row becomes an EMAIL template's data, rendered server-side and sent to the customer
  // themselves. Nothing serialises it to a browser.
  'packages/tenant-backend/src/bulk/bulk.ts':
    'the invoice-email payload — rendered into a message body, never returned to a caller',
  'packages/tenant-backend/src/invoicing/quotes.ts':
    'the quote-sent email hook — the same, and the hook is optional per template',
  // The QuickBooks mapper picks the fields Intuit's customer object needs: an input to a transform.
  'packages/tenant-backend/src/integrations/quickbooks.ts':
    'the QuickBooks customer/invoice mapper — an input to a transform, not a response',
  // This module mints the token and redeems it. It reads the row to issue a link, and its own
  // responses are built field by field — see /contacts/:contactId/status, which answers
  // `portalUrlWithheld` and makes the caller ask /link, which requires contacts:update.
  'packages/tenant-backend/src/portal/portal.ts':
    'the handler that mints the token and the one that redeems it — this is where it lives',
  // The caller IS the customer, authenticated BY the token they already hold.
  'packages/tenant-backend/src/payments/stripe.ts':
    'the portal payment endpoints — the caller authenticated with that very token',
  // PARKED and not to be modified (see the project's CLAUDE.md). Named rather than skipped so that
  // un-parking it brings this back as a decision instead of as a silent pass. Auto dealers route to
  // crm-rv, which is walked.
  'templates/crm-automotive/backend/src/routes/contacts.ts':
    'crm-automotive is PARKED — not deployed to any tenant, and not to be edited',
}

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    // `shared` is the vendored copy of packages/tenant-backend made at generation time; it is not in
    // git and would double-count the package's own files when a worktree has one lying around.
    if (e === 'node_modules' || e === 'dist' || e === 'shared') continue
    const p = `${dir}/${e}`
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e.endsWith('.ts')) out.push(p)
  }
  return out
}

const roots = [`${ROOT}packages/tenant-backend/src`]
const templates: string[] = []
for (const e of readdirSync(`${ROOT}templates`)) {
  if (!e.startsWith('crm')) continue
  const backend = `${ROOT}templates/${e}/backend/src`
  if (existsSync(backend)) { roots.push(backend); templates.push(e) }
}
const files: string[] = []
for (const r of roots) walk(r, files)
if (files.length < 200) fail(`only ${files.length} backend files walked — the walk is broken, not the code`)
if (templates.length < 12) fail(`only ${templates.length} CRM templates walked — expected every crm* template with a backend`)

/**
 * The whole statement starting at line `i`, read by balancing parentheses and brackets.
 *
 * A fixed line window does not work here, and the first draft of this guard proved it: drizzle
 * statements run 2–6 lines, so a `.from(contact)` belonging to the NEXT statement sat inside the
 * window and a `.from(event)` read was reported as a contact row. Balancing from the first bracket to
 * its partner is what makes "this statement reads the contact table" a fact rather than an accident
 * of layout.
 */
function statementAt(lines: string[], i: number, fromCol = 0): string {
  // A line ending on an operator, and a line beginning with one, are both the middle of a statement.
  // This is what reads `const [x] = cond\n  ? await db.select()…\n  : [null]` as one statement —
  // four of the leaks in the header are written that way, and bracket depth alone stops at the `]`
  // of the destructuring on the left of the `=`, which is why the scan starts after it.
  const opensNext = (l: string) => /[?:=,(\[.]\s*$|&&\s*$|\|\|\s*$/.test(l)
  const continues = (l: string) => /^\s*(?:[.?:,)\]]|&&|\|\|)/.test(l)
  let depth = 0, out = ''
  for (let j = i; j < Math.min(i + 40, lines.length); j++) {
    const text = j === i ? lines[j].slice(fromCol) : lines[j]
    out += (j > i ? '\n' : '') + text
    for (const ch of text) {
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth--
    }
    if (depth > 0) continue
    if (opensNext(text)) continue
    if (j + 1 < lines.length && continues(lines[j + 1])) continue
    break
  }
  return out
}

/** Top-level elements of the first `[ … ]` in `src`, split on commas at depth 0. */
function arrayElements(src: string): string[] {
  const open = src.indexOf('[')
  if (open < 0) return []
  const parts: string[] = []
  let depth = 0, cur = ''
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '[' || ch === '(' || ch === '{') { depth++; if (depth === 1) continue }
    else if (ch === ']' || ch === ')' || ch === '}') { depth--; if (depth === 0) { parts.push(cur); break } }
    if (depth === 1 && ch === ',') { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  return parts
}

/** An unprojected read of the contact table — shape A. */
const readsWholeContact = (stmt: string) =>
  /\.\s*select\(\s*\)/.test(stmt) && /\.from\(\s*(?:t\.)?contact\s*\)/.test(stmt)

/**
 * A projection that names the WHOLE table — shape B: `select({ contact, profile })` or
 * `select({ contact: contact, … })`. Deliberately not `select({ id: contact.id })`, which names
 * columns and cannot carry one it did not ask for.
 */
const projectsWholeContact = (stmt: string) => {
  const m = stmt.match(/\.\s*select\(\s*\{([\s\S]*?)\}\s*\)/)
  if (!m) return false
  return /(^|[,{]\s*)(?:t\.)?contact\s*(?:,|$)/.test(m[1]) || /(^|[,{]\s*)contact\s*:\s*(?:t\.)?contact\s*(?:,|$)/.test(m[1])
}

let sites = 0
const reported = new Set<string>()

for (const abs of files) {
  const rel = abs.slice(ROOT.length).replace(/\\/g, '/')
  const raw = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
  if (!/(?:t\.)?contact\b/.test(raw)) continue
  // Comments quote the leak they fixed, so they are stripped or the guard fails on the explanations.
  // stripComments collapses a block comment to ONE newline, so stripped line numbers do not match the
  // file's — the offending line is looked up by its own text before anything is reported.
  const original = raw.split('\n')
  const lines = strip(raw).split('\n')
  const lineInFile = (text: string, fallback: number) => {
    const t = text.trim()
    const at = original.findIndex((l) => l.trim() === t)
    return at >= 0 ? at + 1 : fallback
  }

  /**
   * Regex sources for the expressions in this file that evaluate to a whole contact row, each with
   * the line range over which that name means that row.
   *
   * SCOPED ON PURPOSE. Eight templates' wisetack.ts declare `contactRow` twice — once as a whole row
   * and once, in another function, as a three-column projection — and a file-wide taint reported the
   * projection as a leak. A name means the row from its declaration until the next declaration of
   * the same name; crude next to a real scope analysis, and enough to tell two functions apart.
   */
  const taints: { src: string; from: number; to: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    // `= await db…`, but also `= cond ? await db… : [null]`, which is how four of the leaks in the
    // header were written. The DECLARATION only has to be a declaration; the statement decides.
    const decl = lines[i].match(/const\s+(\[[^\]]*\]|\w+)\s*=/)
    if (!decl) continue
    const stmt = statementAt(lines, i, (decl.index || 0) + decl[0].length)
    if (!/\bawait\b/.test(stmt)) continue
    const until = (name: string) => {
      const re = new RegExp(`const\\s+(?:\\[[^\\]]*\\b${name}\\b[^\\]]*\\]|${name})\\s*=`)
      for (let j = i + 1; j < lines.length; j++) if (re.test(lines[j])) return j
      return lines.length
    }
    const nameTaints = (n: string) => {
      const to = until(n)
      taints.push({ src: n, from: i + 1, to }, { src: `${n}\\[0\\]`, from: i + 1, to })
    }

    // `const [a, b] = await Promise.all([ … ])` — which element reads the contact table decides which
    // NAME is tainted. Position matters, so the array is split before it is tested.
    if (/Promise\.all/.test(stmt) && decl[1].startsWith('[')) {
      const names = decl[1].slice(1, -1).split(',').map((s) => s.trim())
      const elements = arrayElements(stmt.slice(stmt.indexOf('Promise.all')))
      elements.forEach((el, idx) => {
        const name = names[idx]
        if (!name || !/^\w+$/.test(name)) return
        if (readsWholeContact(el) || projectsWholeContact(el)) nameTaints(name)
      })
      continue
    }

    const name = /^\w+$/.test(decl[1]) ? decl[1]
      : /^\[\s*\w+\s*\]$/.test(decl[1]) ? decl[1].slice(1, -1).trim()
      : ''
    if (!name || name === 'c' || name === 'ctx') continue
    if (readsWholeContact(stmt)) nameTaints(name)
    // Shape B puts the row one level down, under `.contact` on every result row.
    else if (projectsWholeContact(stmt)) taints.push({ src: '\\w+\\.contact', from: i + 1, to: lines.length })
  }
  if (!taints.length) continue

  for (const { src, from, to } of taints) {
    const spread = new RegExp(`\\.\\.\\.\\s*(?:${src})(?![\\w.])`)
    const asValue = new RegExp(`:\\s*(?:${src})\\s*(?:\\?\\?|\\|\\||,|\\}|\\)|$)`)
    for (let i = from; i < to; i++) {
      const l = lines[i]
      if (!spread.test(l) && !asValue.test(l)) continue
      if (l.includes(`${HELPER}(`)) continue
      // `for (const { request, contact: ct } of pending)` BINDS the name, it does not hand it over.
      if (new RegExp(`\\b(?:const|let|var)\\b[^=]*\\{[^}]*:\\s*(?:${src})\\b`).test(l)) continue
      sites++
      if (ALLOW[rel]) continue
      const at = lineInFile(l, i + 1)
      const key = `${rel}:${at}`
      if (reported.has(key)) continue
      reported.add(key)
      fail(`${rel}:${at} hands a whole contact row on without ${HELPER}() — \`${l.trim().slice(0, 110)}\`. ` +
        `portal_token is a bearer credential for that customer's portal; wrap the row in ${HELPER}() ` +
        `(exported from the shared contacts module, reachable from a template as '../shared/index.ts'), ` +
        `or — if this row is not going to a CRM response — add the file to this guard's ALLOW list with the reason.`)
    }
  }
}

/**
 * …AND A FILE THAT CALLS IT HAS TO IMPORT IT.
 *
 * Writing this guard's own fix produced exactly this bug twice: leads.ts and integrations/sms.ts
 * wrapped the row and never imported the wrapper, so both answered 500 —
 * "withoutPortalCredential is not defined" — at runtime. esbuild parses that file happily, and the
 * rule above counts the site as WRAPPED, so the guard was green over two broken endpoints. The salon
 * suite caught the lead conversion; nothing exercises the SMS conversation detail, and that one was
 * silent. A guard that checks the shape of a call and not whether the callee is in scope is checking
 * the easier half.
 */
for (const abs of files) {
  const rel = abs.slice(ROOT.length).replace(/\\/g, '/')
  const raw = readFileSync(abs, 'utf8')
  if (!raw.includes(`${HELPER}(`)) continue
  const defines = new RegExp(`(?:export )?const ${HELPER} = `).test(raw)
  const imports = new RegExp(`import\\s*\\{[^}]*\\b${HELPER}\\b[^}]*\\}\\s*from`).test(raw)
  if (defines || imports) continue
  fail(`${rel} calls ${HELPER}() but neither imports nor defines it — the route answers 500 ` +
    `("${HELPER} is not defined") the first time that handler runs. Shared modules import it from ` +
    `'../contacts/contacts'; a template imports it from '../shared/index.ts'.`)
}

// The helper has to exist and be exported, or every "wrapped" site above is wrapped in nothing.
const contactsMod = readFileSync(`${ROOT}packages/tenant-backend/src/contacts/contacts.ts`, 'utf8')
if (!new RegExp(`export const ${HELPER} = `).test(contactsMod)) fail(`${HELPER} is not exported from the shared contacts module — the thing every call site imports`)
if (!/const \{ portalToken, portalTokenExp, \.\.\.rest \} = row/.test(contactsMod)) fail(`${HELPER} must remove BOTH portalToken and portalTokenExp — the expiry on its own tells a holder whether a link is still live`)
if (!new RegExp(`${HELPER}[,\\s}]`).test(readFileSync(`${ROOT}packages/tenant-backend/src/index.ts`, 'utf8'))) fail(`${HELPER} is not re-exported from packages/tenant-backend/src/index.ts — a template importing from '../shared/index.ts' cannot reach it`)

if (failed) {
  console.error(`\nportal token: ${failed} problem(s).`)
  process.exit(1)
}
console.log(`portal token: no contact row reaches a response with its portal credential on it — ${files.length} backend files, ${templates.length} CRM templates, ${sites} whole-row hand-off site(s), ${Object.keys(ALLOW).length} file(s) allowed by name`)
