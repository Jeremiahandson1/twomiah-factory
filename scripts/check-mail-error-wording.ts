// CI guard: a failed send tells the owner what to do, not what the mail server said. Sending an invoice to an
// address that does not exist answered with the provider's reply verbatim — "550 5.1.1 <x@example.com>:
// Recipient address rejected: User unknown in virtual mailbox table" — which is accurate and useless.
// The raw text belongs in the log. (Contractor T14 L4)
//   bun scripts/check-mail-error-wording.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const mapper = read('packages/tenant-backend/src/integrations/mailError.ts')
if (!mapper) fail('packages/tenant-backend/src/integrations/mailError.ts is missing — nothing turns a transport failure into words')
if (!/export function mailFailureReason/.test(mapper)) fail('mailFailureReason must be exported')
// Only what the function RETURNS counts. Grepping the whole file would let a phrase sitting inside a
// detection regex stand in for the wording itself — which it did, the first time this guard was written.
const returned = (mapper.match(/return (['"])(?:(?!\1).)*\1/g) || []).join('\n')
// the failures worth telling apart, because the owner does something different about each
for (const [what, needle] of [
  ['an address that does not exist', /does not exist/],
  ['a full mailbox', /mailbox is full/],
  ['a spam refusal', /treated as spam|refused the message/],
  ['a temporary failure', /try again/i],
  ['sending credentials', /sending account/],
  ['email not set up yet', /not been set up/],
] as Array<[string, RegExp]>) {
  if (!needle.test(returned)) fail(`the mapper must have wording for ${what}`)
}
if (!/could not be delivered/i.test(returned)) fail('…and a fallback for a failure nobody anticipated')
// a full mailbox is also reported as "Recipient address rejected", so order matters: get it wrong and a real
// address gets called non-existent, and someone deletes a good contact.
const fullAt = mapper.indexOf("The recipient's mailbox is full.")
const unknownAt = mapper.indexOf('That email address does not exist.')
if (fullAt < 0 || unknownAt < 0 || fullAt > unknownAt) fail('the full-mailbox case must be tested BEFORE the unknown-address case — both say "Recipient address rejected"')

// the two places that used to pass the reply through
const invoices = read('packages/tenant-backend/src/invoicing/invoices.ts')
if (!/mailFailureReason/.test(invoices)) fail('the invoice send must use the shared wording')
if (/Could not send the invoice email: \$\{err\?\.message/.test(invoices)) fail('the invoice send still passes the provider reply straight to the screen')
if (!/console\.error\('\[invoices\] send failed'/.test(invoices)) fail('…and the raw reply must still reach the log, or support loses it')
if (!/It was not marked as sent\./.test(invoices)) fail('the message must still say the invoice was not marked as sent')

const portal = read('packages/tenant-backend/src/portal/portal.ts')
if (!/mailFailureReason/.test(portal)) fail('the portal invite must use the shared wording too')
if (/Could not send the portal invite: \$\{\(err as Error\)\.message\}/.test(portal)) fail('the portal invite still passes the provider reply through')
if (!/The link itself is still valid\./.test(portal)) fail('…and must still say the link works even though the mail did not')

if (failed) { console.error(`\nmail error wording: ${failed} check(s) FAILED`); process.exit(1) }
console.log('mail error wording: a failed send says what to do, and the provider reply goes to the log')
