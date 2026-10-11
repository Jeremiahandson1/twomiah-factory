// CI guard: every pop-up window in packages/tenant-ui is announced as a dialog. (T69 viewer)
//
//   "Field service: the Agreement window isn't marked as a dialog for screen readers."
//
// Thirteen hand-rolled modals across Agreements, Equipment, Fleet, Inventory, Tasks and Warranties were a plain
// <div className="fixed inset-0 …"> — a screen reader announced nothing, and read the page behind as if it were
// still there. The rule, by PROPERTY rather than by the one frame string they shared:
//
//   a JSX element whose className covers the screen (`fixed inset-0`) and is NOT a click-away layer (no onClick,
//   not aria-hidden) is a dialog frame — it must carry role="dialog" (or "alertdialog"), aria-modal="true", and a
//   name: aria-label, or aria-labelledby naming an id that exists in the same file.
//
// Click-away layers (a backdrop or a menu's outside-click catcher) have onClick and are left alone.
//   bun scripts/check-shared-modals-are-dialogs.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const UI = join(ROOT, 'packages/tenant-ui/src')
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(f) ? [p] : [] })

let failed = 0, frames = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
for (const file of walk(UI)) {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  // every opening JSX tag (attributes may span lines; a `>` inside {…} is skipped by brace depth)
  for (let i = src.indexOf('<'); i >= 0; i = src.indexOf('<', i + 1)) {
    if (!/[a-zA-Z]/.test(src[i + 1] || '')) continue
    let depth = 0, j = i + 1, quote = ''
    for (; j < src.length; j++) {
      const ch = src[j]
      if (quote) { if (ch === quote) quote = ''; continue }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) break
    }
    const tag = src.slice(i, j + 1)
    const cls = tag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)
    const c = cls ? (cls[1] ?? cls[2]) : ''
    if (!/(^|\s)fixed(\s|$)/.test(c) || !/(^|\s)inset-0(\s|$)/.test(c)) continue
    if (/\bonClick=/.test(tag) || /aria-hidden=/.test(tag)) continue // a backdrop / click-away layer
    frames++
    const line = src.slice(0, i).split('\n').length
    const where = `${relative(ROOT, file).replace(/\\/g, '/')}:${line}`
    // the role may sit on the frame itself or on the panel just inside it (the portal's modals do that); the panel
    // is the first role-carrying tag before the next frame
    let dlg = tag
    if (!/role="(dialog|alertdialog)"/.test(tag)) {
      const rest = src.slice(j + 1, j + 900)
      const nextFrame = rest.search(/className="[^"]*\bfixed inset-0 z-/)
      const inner = rest.match(/<[a-z]+\s[^>]*role="(?:dialog|alertdialog)"[^>]*>/)
      if (!inner || (nextFrame >= 0 && rest.indexOf(inner[0]) > nextFrame)) { fail(`${where} — a full-screen frame with no role="dialog" on it or on its panel`); continue }
      dlg = inner[0]
    }
    if (!/aria-modal="true"/.test(dlg)) fail(`${where} — a dialog without aria-modal="true"`)
    const by = dlg.match(/aria-labelledby="([^"]+)"/)
    if (by) { if (!src.includes(`id="${by[1]}"`)) fail(`${where} — aria-labelledby="${by[1]}" names no element in this file`) }
    else if (!/aria-label=/.test(dlg)) fail(`${where} — a dialog with no name (aria-label or aria-labelledby)`)
  }
}
if (frames < 13) fail(`only ${frames} dialog frames found — the walk has lost files (expected the 13 fixed in T69 and more)`)
if (failed) { console.error(`\nshared modals: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`shared modals: all ${frames} full-screen frames in packages/tenant-ui are named, modal dialogs`)
