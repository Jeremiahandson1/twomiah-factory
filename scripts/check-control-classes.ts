// CI guard: a shared form control must carry exactly one width, and callers must not try to override it by
// appending a utility. Tailwind emits .w-auto before .w-full and .py-1.5 before .py-2, so whichever rule the
// sheet prints last wins no matter what order the class names are written in the element. `${inputCls} w-auto`
// therefore rendered a filter dropdown FULL width and squeezed the search box beside it to 54px on every CRM
// (vet T12 M1, reported four runs running), and `${inputCls} py-1.5` was quietly ignored. The fix is a
// vocabulary — inputCls / selectCls / controlCompactCls / controlNoWidthCls — composed from one skin that
// carries no width or padding of its own.
//   bun scripts/check-control-classes.ts
import { readFileSync, readdirSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const UI = 'packages/tenant-ui/src/invoicing/ui.tsx'
const ui = read(UI)
if (!ui) fail(`${UI} is missing`)

// the skin itself must set neither width nor padding, or every variant inherits the trap again
const skin = ui.match(/const controlSkin = '([^']*)'/)?.[1]
if (!skin) fail('invoicing/ui.tsx must build its controls from a single controlSkin string')
else if (/(^|\s)(w-|p-|px-|py-)[\w.\-/]+/.test(skin)) fail(`controlSkin must carry no width or padding of its own — it has: ${skin.split(' ').filter(c => /^(w-|p-|px-|py-)/.test(c)).join(' ')}`)

const variants: Array<[string, string[], string[]]> = [
  // name, expected widths, expected vertical padding
  ['inputCls', ['w-full'], ['py-2']],
  ['selectCls', ['w-auto'], ['py-2']],
  ['controlCompactCls', ['w-auto'], ['py-1.5']],
  ['controlNoWidthCls', [], ['py-2']],
]
for (const [name, widths, pads] of variants) {
  const m = ui.match(new RegExp(`export const ${name} = \`([^\`]*)\\$\\{controlSkin\\}\``))
  if (!m) { fail(`invoicing/ui.tsx must export ${name}, built from controlSkin`); continue }
  const own = m[1].trim().split(/\s+/).filter(Boolean)
  const w = own.filter(c => /^w-/.test(c))
  const p = own.filter(c => /^(py-|p-)/.test(c))
  if (JSON.stringify(w) !== JSON.stringify(widths)) fail(`${name} must carry exactly ${widths.length ? widths.join(' ') : 'no width'} — it carries "${w.join(' ') || '(none)'}"`)
  if (JSON.stringify(p) !== JSON.stringify(pads)) fail(`${name} must carry ${pads.join(' ')} — it carries "${p.join(' ') || '(none)'}"`)
}

// the portal has its own control skin; it needs the same split (its filter select sits beside a file list)
const portal = read('packages/tenant-ui/src/portal/common.tsx')
if (!/const portalControlCls = '/.test(portal)) fail('portal/common.tsx must build its controls from one portalControlCls string')
if (!/export const inputCls = `w-full \$\{portalControlCls\}`/.test(portal)) fail('portal inputCls must be w-full + the shared skin')
if (!/export const selectCls = `w-auto \$\{portalControlCls\}`/.test(portal)) fail('portal selectCls must be w-auto + the shared skin — a portal filter must not render full width')

// and nowhere may a caller append a width or a padding to one of them
const APPEND = /\$\{(inputCls|selectCls|controlCompactCls)\}\s+(w-|p-|px-|py-)[\w.\-/]+/g
const offenders: string[] = []
const walk = (dir: string) => {
  for (const e of readdirSync(ROOT + dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { walk(rel); continue }
    if (!/\.tsx?$/.test(e.name)) continue
    if (rel.endsWith('invoicing/ui.tsx')) continue // the comment describing the trap
    for (const m of read(rel).matchAll(APPEND)) offenders.push(`${rel}: ${m[0]}`)
  }
}
walk('packages/tenant-ui/src')
for (const o of offenders) fail(`a width/padding appended to a control class is ignored by Tailwind — use the right variant: ${o}`)

if (failed) { console.error(`\ncontrol classes: ${failed} check(s) FAILED`); process.exit(1) }
console.log('control classes: one width per control, and no caller appending one Tailwind will ignore')
