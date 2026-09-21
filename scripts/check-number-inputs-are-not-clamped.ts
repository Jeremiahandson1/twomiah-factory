// A number field must never rewrite the figure someone is typing.
//
// Roof shipped this twice — the supplement modal and the quote line items — as a fix for "the field
// accepts a negative":
//
//     onChange={(e) => update(i, 'unitPrice', Math.max(0, Number(e.target.value)))}
//
// It does stop the negative, and that is the trap. The typist enters -1500 and the field shows a
// different, entirely plausible POSITIVE number, with no error and nothing to notice: the lone "-"
// reads as 0, the digits that follow append to it, and a line item nobody asked for is priced and
// saved. A refused value is visible on screen. A quietly rewritten one is not, and it is worse.
// (roof T18 L7)
//
// The same clamp also eats decimal points — Number("2.") is 2, so re-rendering the field from state
// deletes the "." the moment it is typed and the user cannot enter 2.5 at all.
//
// The shape that works, and that this repo already used in the supplement EDIT modal: hold the raw
// string while it is being typed, price the row with a tolerant `num0()` for display, and convert and
// CHECK once on submit — refusing with a message that names the field.
//
// Scope is deliberately narrow. Plain `Number(e.target.value)` without a clamp is a milder version of
// the same problem (it eats the decimal point but does not invent a magnitude) and is a widespread
// React idiom — 37 more sites across the fleet at the time of writing. Pinning the clamp alone keeps
// this guard at zero allowlist entries, which is the point: it fails only on something indefensible.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', 'templates')

// a clamp wrapped around the value of the field being typed into
const CLAMPED = /onChange=\{[^}]*Math\.(?:max|min|abs)\s*\([^;]*?e\.target\.value/

let failures = 0
const templates = readdirSync(ROOT).filter((t) =>
  t.startsWith('crm') && t !== 'crm-automotive' && existsSync(join(ROOT, t, 'frontend', 'src')))

for (const t of templates) {
  const src = join(ROOT, t, 'frontend', 'src')
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === 'node_modules' || e === 'dist') continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!p.endsWith('.tsx')) continue
      const rel = p.slice(src.length + 1).replace(/\\/g, '/')
      readFileSync(p, 'utf8').split('\n').forEach((ln, i) => {
        if (!CLAMPED.test(ln)) return
        failures++
        console.error(`FAIL: ${t}: ${rel}:${i + 1} clamps the value as it is typed — the figure entered is replaced by a different one, silently. Hold the raw string and check it on submit.`)
        console.error(`        ${ln.trim().slice(0, 120)}`)
      })
    }
  }
  walk(src)
}

console.log(failures === 0
  ? `check-number-inputs-are-not-clamped: ok (${templates.length} templates)`
  : `check-number-inputs-are-not-clamped: ${failures} failure(s)`)
process.exit(failures ? 1 : 0)
