// CI guard: if a quote can be built from the pricebook, so can an invoice.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// T42 #14. Quotes and invoices share ONE line-item editor — LineItemsEditor in tenant-ui's
// invoicing/ui.tsx. QuotesPage handed it the catalogue; InvoicesPage rendered it with `items` and
// `onChange` and nothing else. So on the same screen family, in the same template, one of the two
// documents a shop sends could be built from the pricebook and the other had to be typed out by
// hand — with the picker sitting right there, already written, already debounced, unused.
//
// That is the third time in one round that a fix landed on one screen and missed its sibling: the
// Support page was paired for light mode in crm-salon and not in the seven byte-identical copies,
// and the `.bg-white` ink rule was fixed in crm-rv and not in crm-restaurant. The shape is always the
// same — two callers of one shared thing, and only one of them updated — so it is worth a rule rather
// than a third round of finding it by eye.
//
// ── what is checked, and what is deliberately NOT ───────────────────────────────────────────────
//
// Both screens must pass `pricebook=` to the editor, both gated on `cfg.pricebook`, and both must
// actually FETCH the catalogue. What they pass for `canSeeCost` is NOT checked and must not be: a
// quote's line schema records unitCost, type and pricebookItemId and the cost columns belong there;
// an invoice's line is description + quantity + unitPrice and zod drops the rest silently, so
// offering cost fields on an invoice would be offering fields whose values vanish on save. The two
// answers are different ON PURPOSE, and a guard that forced them to match would force a lie onto one
// of the screens.
//
//   bun scripts/check-pricebook-picker-both-documents.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const SCREENS = [
  ['quotes', 'packages/tenant-ui/src/invoicing/QuotesPage.tsx'],
  ['invoices', 'packages/tenant-ui/src/invoicing/InvoicesPage.tsx'],
] as const

for (const [label, rel] of SCREENS) {
  let src = ''
  try { src = readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n') } catch { fail(`${rel} is missing — if the screen moved, point this guard at it`); continue }
  // Comments on both screens discuss the prop at length; strip them before looking for the code.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

  if (!/<LineItemsEditor\b/.test(code)) { fail(`${rel} no longer renders LineItemsEditor — this guard is out of date`); continue }
  if (!/\bpricebook=\{/.test(code)) {
    fail(`${rel}: the ${label} editor is not given the pricebook. The catalogue picker is part of this editor and the other document already offers it — a shop should not have to type a line by hand on one document and pick it on the other. (T42 #14)`)
    continue
  }
  if (!/cfg\.pricebook/.test(code)) {
    fail(`${rel}: the pricebook is passed without checking cfg.pricebook, so it would appear on verticals that do not price from a catalogue`)
  }
  if (!/\/api\/pricebook\/items/.test(code)) {
    fail(`${rel}: the pricebook prop is passed but the catalogue is never fetched, so the picker would render empty`)
  }
  // Active items only: a retired item must not be offered on a new document.
  if (!/active:\s*'true'/.test(code)) {
    fail(`${rel}: the catalogue is fetched without active:'true' — a retired item would be offered on a new ${label.replace(/s$/, '')}`)
  }
}

if (failed) { console.error(`\npricebook picker: ${failed} check(s) FAILED`); process.exit(1) }
console.log('pricebook picker: both the quote and the invoice editor are offered the catalogue, on the same terms')
