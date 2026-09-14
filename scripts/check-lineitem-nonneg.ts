// CI guard: the shared invoice/quote line-item editor must clamp quantity and unit price to >= 0 at the
// input, so the stored value matches the displayed total (calcTotals already floors both at 0) and never
// sends a negative to the server. A raw Number(e.target.value) let a typed negative diverge from the
// displayed total and reach the payload (FS: -50 unit price produced a $50 invoice with a success toast).
//   bun scripts/check-lineitem-nonneg.ts
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../packages/tenant-ui/src/invoicing/ui.tsx', import.meta.url), 'utf8')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

for (const field of ['quantity', 'unitPrice']) {
  const re = new RegExp(`${field}:\\s*Math\\.max\\(\\s*0\\s*,\\s*Number\\(e\\.target\\.value\\)`)
  if (!re.test(src)) fail(`LineItemsEditor ${field} input must clamp to >= 0 (Math.max(0, Number(e.target.value)…)), not store a raw negative`)
}

if (failed) { console.error(`\nline-item non-negative: ${failed} check(s) FAILED`); process.exit(1) }
console.log('line-item non-negative: quantity + unit price are clamped to >= 0 at the input (display == payload)')
