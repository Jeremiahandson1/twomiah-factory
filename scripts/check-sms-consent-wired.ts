// CI guard: a vertical that offers "Opt Out SMS" must have somewhere to put the answer.
//
// WHY THIS EXISTS. T35 N1, found by a tester reading the row back after the toggle said it worked:
// on the base CRM the contact page's SMS opt-out answered 200, showed "SMS opted out", and stored
// nothing — the column did not exist on that vertical. The send path then did this:
//
//     if ((contactRow as any).optedOutSms) return null
//
// `undefined` is falsy, so the guard passed and the customer was texted anyway. A withdrawal of
// consent was acknowledged to the user and lost. Five templates were in that state
// (crm, crm-restaurant, crm-rv, crm-salon, crm-vet) while three others had carried the column since
// the same bug was fixed in crm-fieldservice months earlier and never propagated.
//
// Three reasons nothing caught it:
//   · the button is in packages/tenant-ui, so one component ships it to every vertical at once
//   · the `as any` means TypeScript cannot object to a column that is not there
//   · NO suite in ANY vertical asserted the sender honours the flag — the three templates that
//     stored it correctly were never proven to act on it either
//
// THE RULE. If a template's contact page can set the flag, that template must (a) have the column
// and (b) accept the field on the contact route. Both halves, because either one alone is a lie:
// no column and the write is dropped; no field and the column is never written.
//
//   bun scripts/check-sms-consent-wired.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const FLAG = 'optedOutSms'

/** The shared contact page is what ships the button. If it stops offering one, this guard is moot. */
const SHARED_PAGE = join(ROOT, 'packages/tenant-ui/src/contacts/ContactDetailPage.tsx')
const sharedOffersIt = new RegExp(`${FLAG}[^\\n]*\\}\\)|api\\.put\\([^\\n]*${FLAG}`).test(read(SHARED_PAGE))
if (!sharedOffersIt) {
  fail(`${SHARED_PAGE} no longer writes ${FLAG} — if the toggle was deliberately removed, delete this guard; if it was renamed, retarget it.`)
}

/**
 * The SEND side, which is the half that actually protects the customer. Asserted on the behaviour
 * line rather than on the identifier, so a rename cannot quietly satisfy it.
 */
const SENDER = join(ROOT, 'packages/tenant-backend/src/integrations/sms.ts')
const senderSrc = read(SENDER)
const guards = (senderSrc.match(/optedOutSms\)\s*return null/g) || []).length
if (guards < 2) {
  fail(`${SENDER} has ${guards} consent check(s); both sendSMS and sendJobUpdate must refuse an opted-out contact.`)
}

const TEMPLATES = join(ROOT, 'templates')
for (const tpl of readdirSync(TEMPLATES).filter((d) => d.startsWith('crm'))) {
  const be = join(TEMPLATES, tpl, 'backend')
  if (!existsSync(be)) continue

  // Does THIS template's contact page come from the shared package, or set the flag itself?
  const feDir = join(TEMPLATES, tpl, 'frontend/src')
  const pages: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/ContactDetailPage\.tsx$/.test(e.name)) pages.push(p)
    }
  }
  walk(feDir)
  const offersToggle = pages.some((p) => {
    const src = read(p)
    return /from '\.\.\/shared'|from '\.\.\/\.\.\/shared'|from '\.\.\/\.\.\/\.\.\/shared'/.test(src) || src.includes(FLAG)
  })
  if (!offersToggle) continue

  const hasColumn = /opted_out_sms/.test(read(join(be, 'db/schema.ts')))
  const acceptsField = read(join(be, 'src/routes/contacts.ts')).includes(FLAG)
  if (!hasColumn) fail(`${tpl} offers the SMS opt-out but contact has no opted_out_sms column — the toggle would answer 200 and store nothing.`)
  if (!acceptsField) fail(`${tpl} offers the SMS opt-out but routes/contacts.ts does not accept ${FLAG} — the shared contact schema drops unknown fields.`)
  if (hasColumn && acceptsField) console.log(`  ok   ${tpl}`)
}

if (failed) {
  console.error(`\ncheck-sms-consent-wired: ${failed} problem(s).`)
  process.exit(1)
}
console.log('check-sms-consent-wired: every vertical that offers the toggle can store and honour it.')
