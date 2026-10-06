/**
 * GUARD #210 — the toast container must sit ABOVE every modal in its own template.
 *
 * T51 follow-up, owner: "when Schedule Payment is refused, the message now goes to a browser pop-up
 * instead of showing on the page. In this browser nothing visible appeared at all."
 *
 * The refusal was new (the sub-cent rule). The reason nothing appeared was not: EventDetailPage
 * reports errors with `alert()`, ToastContext intercepts that into an in-app toast, and the toast
 * container was `z-50` — the SAME z-index as the modal the error came from (`fixed inset-0 z-50`).
 * Two fixed elements at the same z-index are painted in DOM order, so whether the message was
 * visible at all was luck, and in the owner's browser it lost.
 *
 * Every toast container in the fleet was z-50 and every modal is z-50, so this was never an Events
 * problem: any error raised from inside any modal, in any vertical, was a coin-flip. A new refusal
 * only made one of them reachable.
 *
 * A toast is the ONLY report a user gets that their action failed. It must never be coverable.
 *
 * THE RULE: in each template, the toast container's z-index > the highest z-index on any element
 * that also carries `fixed inset-0` (i.e. a full-viewport overlay — a modal, a drawer, a lightbox).
 */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = process.argv[2] || process.cwd()
const TEMPLATES_DIR = path.join(ROOT, 'templates')
/** Parked; not generated for any tenant. */
const SKIP = new Set(['crm-automotive'])

const read = (f: string) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }

/** `z-50` → 50, `z-[100]` → 100. Tailwind's named steps plus the bracket escape. */
const zOf = (cls: string): number | null => {
  const b = cls.match(/\bz-\[(\d+)\]/); if (b) return Number(b[1])
  const n = cls.match(/\bz-(\d+)\b/); if (n) return Number(n[1])
  return null
}

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
let checked = 0

const templates = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !SKIP.has(e.name))
  .map((e) => e.name)

for (const tpl of templates) {
  const srcDir = path.join(TEMPLATES_DIR, tpl, 'frontend', 'src')
  if (!fs.existsSync(srcDir)) continue

  const files: string[] = []
  ;(function walk(dir: string) {
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'shared') walk(p) }
      else if (e.name.endsWith('.tsx')) files.push(p)
    }
  })(srcDir)

  // the toast container: a fixed, corner-anchored box inside the toast context
  let toastZ: number | null = null
  let toastFile = ''
  for (const f of files) {
    if (!/Toast/.test(path.basename(f))) continue
    for (const m of read(f).matchAll(/className="(fixed (?:bottom|top)-\d+ (?:right|left)-\d+ [^"]*)"/g)) {
      const z = zOf(m[1])
      if (z != null && (toastZ == null || z > toastZ)) { toastZ = z; toastFile = f }
    }
  }
  if (toastZ == null) continue // no toast container in this template; nothing to rank
  checked++

  // the highest full-viewport overlay in the whole template
  let worst = { z: -1, file: '', cls: '' }
  for (const f of files) {
    const src = read(f)
    for (const m of src.matchAll(/className=(?:"|\{`)([^"`]*\bfixed inset-0\b[^"`]*)(?:"|`\})/g)) {
      const cls = m[1]
      // a backdrop with no z of its own inherits the overlay's stacking context — not a ranking risk
      const z = zOf(cls)
      if (z != null && z > worst.z) worst = { z, file: f, cls }
    }
  }
  if (worst.z < 0) continue // no overlays; nothing to be covered by

  if (toastZ <= worst.z) {
    fail(`${tpl}: the toast container is z-${toastZ} (${path.relative(ROOT, toastFile)}) but ` +
      `${path.relative(ROOT, worst.file)} has a full-viewport overlay at z-${worst.z}.`)
    console.error(`        At the same or a lower z-index, which one paints on top is DOM order — so`)
    console.error(`        an error raised from inside that overlay may never be seen at all.`)
    console.error(`        Raise the toast container above every overlay (z-[100] is the fleet's).`)
  }
}

if (failed) {
  console.error(`\ncheck-toast-outranks-modals: ${failed} template(s) can hide their own error messages\n`)
  process.exit(1)
}
console.log(`check-toast-outranks-modals: ok — ${checked} template(s), every toast outranks every full-viewport overlay`)
