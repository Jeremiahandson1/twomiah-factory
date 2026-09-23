// If a form SENDS a field, the route must ACCEPT it.
//
// Zod strips what it does not declare, and says nothing. A 200 comes back, the screen reports success,
// and the value is gone — worse than an error, because nobody goes looking. This has happened three
// times in one day, each identically:
//
//   storeHours   the column existed, Settings → General sent it, PUT /api/company never declared it.
//                Store hours could not be saved at all, and the route's own error text told callers to
//                send it. (Dispensary T29)
//   thcMg        the column shipped, the Products form shipped a THC-mg box, products.ts never
//                declared it. A dispensary could type 100, press Save, get a 200, and have the value
//                thrown away — so edibles stayed uncountable against a legal limit. (Dispensary T31)
//   defaultType  the import route had always sent it, ImportOptions never declared it, so every
//                untyped CSV row silently became a lead. (Salon T27)
//
// The question this asks is deliberately narrow: not "is every column writable" — plenty should not be
// — but "does anything the UI actually sends get silently discarded". That has no false positives to
// triage, and it is exactly the shape of all three.
//
//   bun run scripts/check-schema-fields-are-writable.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

type Pair = {
  label: string
  /** the screen that builds the payload */
  form: string
  /** the route whose zod schema has to accept it */
  route: string
  /** the object literal(s) in the form that become the request body */
  sends: RegExp
  /** fields the route deliberately ignores, with the reason */
  ignored?: Record<string, string>
}

const PAIRS: Pair[] = [
  {
    label: 'dispensary product form → products.ts',
    form: 'templates/crm-dispensary/frontend/src/pages/ProductsPage.tsx',
    route: 'templates/crm-dispensary/backend/src/routes/products.ts',
    // the form's state object — every key here is submitted
    sends: /const initialFormData = \{([\s\S]*?)\n\}/,
    ignored: {
      id: 'set by the server',
      stock: 'the form field for stockQuantity, which stock operations own',
      unit: 'written to unit_type by the route',
      imageUrl: 'set by the upload endpoint, not in the form body',
    },
  },
]

for (const p of PAIRS) {
  const formPath = join(ROOT, p.form)
  const routePath = join(ROOT, p.route)
  if (!existsSync(formPath) || !existsSync(routePath)) { console.log(`skip ${p.label} (not present)`); continue }

  const form = readFileSync(formPath, 'utf8')
  const route = readFileSync(routePath, 'utf8')

  const m = p.sends.exec(form)
  if (!m) { fail(`${p.label}: cannot find the form's payload object — this guard is pinned to its shape and can no longer read it`); continue }
  const fields = [...m[1].matchAll(/^\s*(\w+)\s*:/gm)].map(x => x[1])
  if (fields.length < 3) { fail(`${p.label}: only ${fields.length} field(s) parsed from the form — the shape changed`); continue }

  for (const f of fields) {
    if (p.ignored?.[f]) continue
    // A field counts as declared however it is validated. Matching only `f: z.` missed every field
    // built through a helper — this route validates free text with cleanText(), and the first version
    // of this guard reported strainName, barcode and description as dropped when all three were fine.
    // A guard that cries wolf gets switched off, and a near-miss "fix" for three non-bugs is exactly
    // the kind of churn it is supposed to prevent. Typecheck caught the duplicate keys; the guard
    // should not have produced them.
    if (new RegExp(`^\\s*${f}\\s*:`, 'm').test(route)) continue
    fail(`${p.label}: the form sends \`${f}\` and the route never declares it — zod strips what it does not know, so this saves with a 200 and throws the value away.`)
  }
  console.log(`${p.label}: ${fields.length} field(s) sent, all accepted`)
}

console.log(failures ? `\n${failures} problem(s).` : 'nothing a form sends is silently discarded')
process.exit(failures ? 1 : 0)
