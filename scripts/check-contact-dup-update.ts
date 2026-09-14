// CI guard: the contact duplicate check must run on UPDATE as well as create, excluding the record being
// edited. It was create-only, so a contact's email/phone could be edited to one another contact already
// owns (RV). The update guard must exclude self (ne(contact.id, id)) or it would flag the record against
// itself.
//   bun scripts/check-contact-dup-update.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const src = strip(readFileSync(new URL('../packages/tenant-backend/src/contacts/contacts.ts', import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// Both create and update should return the 409 duplicate signal (two occurrences of the marker).
if ((src.match(/duplicate:\s*true/g) || []).length < 2) fail('the duplicate 409 must be returned on both create AND update')
// The update path must exclude the edited record from the match.
if (!/ne\(t\.contact\.id,\s*id\)/.test(src)) fail('the update duplicate check must exclude the record being edited (ne(contact.id, id))')

if (failed) { console.error(`\ncontact dup update: ${failed} check(s) FAILED`); process.exit(1) }
console.log('contact dup update: duplicate email/phone is checked on update too, excluding the edited record')
