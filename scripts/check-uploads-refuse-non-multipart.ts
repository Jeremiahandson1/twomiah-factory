// CI guard: an upload route must not call c.req.formData() directly.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// Every one of these handlers already refused a missing file properly:
//
//     const formData = await c.req.formData()
//     const file = formData.get('file') as File | null
//     if (!file) return c.json({ error: 'No file uploaded' }, 400)
//
// but `c.req.formData()` THROWS when the content-type is not multipart — "Can't decode form data
// from body because of incorrect MIME type/boundary" — so the refusal below it never ran and the
// route answered 500. The guard was written; it was unreachable. Seven endpoints per template, in
// eleven templates.
//
// `utils/upload.ts` exports `uploadedForm(c)`, which returns an EMPTY form when the body cannot be
// decoded, so the handler's own 400 answers as its author intended. No new error text, no second
// vocabulary for the same condition.
//
// crm-dispensary is exempt by inspection, not by accident: it wraps formData() in its own try/catch
// per handler and returns 400 with its own wording. Two implementations of the same idea, and that
// one predates this; it is listed rather than rewritten.
//
// ── the rule ────────────────────────────────────────────────────────────────────────────────────
//
// In a template's backend/src, `await c.req.formData()` appears only inside utils/upload.ts.
//
//   bun scripts/check-uploads-refuse-non-multipart.ts
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/** Files allowed to call formData() directly, with the reason. */
const ALLOWED = [
  /utils[\\/]upload\.ts$/,                       // the helper itself
  /crm-dispensary[\\/].*routes[\\/]import\.ts$/, // its own per-handler try/catch, predates the helper
]

const SKIP = new Set(['node_modules', 'dist', 'build'])
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith('.ts')) out.push(p)
  }
  return out
}
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, '$1')

let templates = 0, helpers = 0
for (const t of readdirSync(join(ROOT, 'templates'))) {
  const dir = join(ROOT, 'templates', t, 'backend/src')
  if (!existsSync(dir)) continue
  templates++
  let usesUploads = false
  for (const f of walk(dir)) {
    const src = strip(readFileSync(f, 'utf8'))
    if (!/c\.req\.formData\(\)/.test(src)) continue
    usesUploads = true
    if (ALLOWED.some((re) => re.test(f))) continue
    const line = src.slice(0, src.indexOf('c.req.formData()')).split('\n').length
    fail(`${f.slice(f.indexOf('templates'))}:${line} calls c.req.formData() directly, which THROWS on a non-multipart body and answers 500 before the handler's own "no file" 400 can run. Use uploadedForm(c) from utils/upload.ts.`)
  }
  if (usesUploads && existsSync(join(dir, 'utils/upload.ts'))) helpers++
}

if (templates === 0) fail('no template backend/src was found — this guard has stopped looking at anything')
console.log(failed === 0
  ? `OK: ${templates} template(s), ${helpers} with an upload helper — every upload refuses a non-multipart body with 400`
  : `${failed} problem(s)`)
process.exit(failed ? 1 : 0)
