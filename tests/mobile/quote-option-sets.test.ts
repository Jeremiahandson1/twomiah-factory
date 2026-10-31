// The phone's quote screen handles option SETS (docs/parity/fieldservice-quote-options.md rows 5 and 6): a quote's options
// come in up to three sets — a set the customer picks one of, or an additive set they add any of — and the screen lays
// them out set by set, picks for the customer in a pick-one set, and adds / removes an add-on on its own, through the one
// server route the customer's own pick uses (POST /api/quotes/:id/proposal/choose { optionId, chosen }). Nothing here
// needs a device: it reads the screen's source for the rules the server holds it to.
//
//   bun run tests/mobile/quote-option-sets.test.ts
import fs from 'node:fs'
import path from 'node:path'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const root = path.resolve(import.meta.dir, '../../apps/mobile')
const src = fs.readFileSync(path.join(root, 'app/(details)/quote/[id].tsx'), 'utf8')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

check('the screen reads the sets the server answers (proposal.sets) and lays the options out set by set', /proposal\.sets/.test(code) && /sets\.map\(/.test(code))
check('a server answering options only (before sets) is read as one pick-one set', /kind:\s*'one'/.test(code) && /proposal\.options/.test(code))
check('a set says what it is for: its name and whether the customer picks one or adds any', /choose one/.test(code) && /add any/.test(code) && /s\.name/.test(code))
check('the pick goes through the one server route the customer uses, saying which option and whether it is taken', /\/proposal\/choose`,\s*\{\s*optionId,\s*chosen\s*\}/.test(code))
check('an add-on is added and removed on its own (chosen true / false), a pick-one option only picked (chosen true)', /chooseOption\(o\.id,\s*!o\.chosen\)/.test(code) && /chooseOption\(o\.id,\s*true\)/.test(code))
check('an add-on shows what it adds, not the whole job', /addPrice/.test(code))
check('every pick and add-on asks first (a confirm sheet), never a native dialog', /setConfirmAction\(\{\s*title:\s*o\.chosen \? `Remove/.test(code) && !/Alert\.alert|confirm\(/.test(code))
check('the Remove and Choose buttons name the customer, for the screen reader', /accessibilityLabel=\{`\$\{o\.chosen \? 'Remove' : 'Add'\} \$\{o\.name\} for the customer`\}/.test(code) && /accessibilityLabel=\{`Choose \$\{o\.name\} for the customer`\}/.test(code))
check('the screen names the permission the server checks (quotes:update) before offering a pick', /can\('quotes:update'\)/.test(code) && /canUpdate && open/.test(code))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
