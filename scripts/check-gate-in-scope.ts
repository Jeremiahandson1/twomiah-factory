// CI guard: a permission flag must be USED in the component that DECLARES it.
//
// WHY. T41 gated several hundred controls by inserting `{mayX && …}` around a button and declaring
// `const mayX = …` at the top of the file's main component. On RFIDPage the button lived in
// `TagsTab`, a sibling component in the same module, so the name was simply not in scope:
//
//     ReferenceError: mayRegister is not defined
//
// and /crm/rfid threw for EVERY role — owner included — the moment the tab rendered. T42 found it on
// the live tenant and called it a regression, correctly.
//
// Nothing in this repo could have caught it. No template is typechecked (TypeScript would have said
// "Cannot find name"), esbuild does no scope analysis, the contrast and width guards read class
// names, and a test would have to render that specific tab. So the check has to exist on its own.
//
// WHAT IS CHECKED. For every `const may… = ` / `const can… = ` declaration, the function that
// encloses it; then every use of that name in the same file. A use inside a DIFFERENT top-level
// function is the bug. Declarations at module scope are fine (a constant, or a helper), and so is a
// name passed as a prop — a use inside a component that takes it as a parameter is not flagged.
//
//   bun scripts/check-gate-in-scope.ts
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const PARKED = ['crm-automotive', 'crm-homecare']
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (['node_modules', 'dist', 'shared', '.git'].includes(name) || PARKED.includes(name)) continue
    const p = join(dir, name)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(name)) out.push(p)
  }
  return out
}

const files: string[] = []
let templatesWalked = 0
for (const t of readdirSync(join(ROOT, 'templates'))) {
  if (!/^crm(-|$)/.test(t) || PARKED.includes(t)) continue
  templatesWalked++
  walk(join(ROOT, 'templates', t, 'frontend', 'src'), files)
}
if (templatesWalked < 10) fail(`only ${templatesWalked} CRM template(s) walked — this guard is looking in the wrong place`)
walk(join(ROOT, 'packages', 'tenant-ui', 'src'), files)

/**
 * The top-level functions in a module, by the line they start on. Only column-0 declarations count:
 * a nested arrow or a callback shares its parent's scope, which is exactly what makes it legal.
 */
function topLevelFunctions(lines: string[]): Array<{ name: string; from: number; to: number }> {
  const starts: Array<{ name: string; from: number }> = []
  lines.forEach((line, i) => {
    const m = /^(?:export\s+)?(?:default\s+)?function\s+([A-Za-z0-9_]+)/.exec(line)
      || /^(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*(?::[^=]*)?=>/.exec(line)
    if (m) starts.push({ name: m[1], from: i })
  })
  return starts.map((s, i) => ({ ...s, to: i + 1 < starts.length ? starts[i + 1].from - 1 : lines.length - 1 }))
}

let checked = 0, flags = 0
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  if (!/(?:const|let)\s+(?:may|can)[A-Z]/.test(src)) continue
  const lines = src.split('\n')
  const fns = topLevelFunctions(lines)
  if (!fns.length) continue
  const owning = (i: number) => fns.find((f) => i >= f.from && i <= f.to)

  // every gate flag declared INSIDE a top-level function
  const decls: Array<{ name: string; line: number; fn: string }> = []
  lines.forEach((line, i) => {
    const m = /^\s+(?:const|let)\s+((?:may|can)[A-Za-z0-9_]*)\s*=/.exec(line)
    if (!m) return
    const fn = owning(i)
    if (fn) decls.push({ name: m[1], line: i + 1, fn: fn.name })
  })
  if (!decls.length) continue
  checked++

  for (const d of decls) {
    const uses: number[] = []
    const re = new RegExp(`(?<![\\w.$])${d.name}(?![\\w$])`, 'g')
    lines.forEach((line, i) => {
      if (i + 1 === d.line) return
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return
      if (re.test(line)) uses.push(i)
      re.lastIndex = 0
    })
    for (const u of uses) {
      const fn = owning(u)
      if (!fn || fn.name === d.fn) continue
      // passed in as a prop / parameter of that component? then it is its own binding, not a leak
      const header = lines.slice(fn.from, Math.min(fn.from + 12, lines.length)).join(' ')
      if (new RegExp(`[({,]\\s*${d.name}\\s*[,)}:]`).test(header)) continue
      // declared again inside that function?
      if (new RegExp(`(?:const|let)\\s+${d.name}\\s*=`).test(lines.slice(fn.from, fn.to + 1).join('\n'))) continue
      flags++
      fail(`${rel}:${u + 1} uses \`${d.name}\` inside ${fn.name}(), but it is declared in ${d.fn}() at line ${d.line} — not in scope, so this throws "ReferenceError: ${d.name} is not defined" the moment ${fn.name} renders.\n`
        + `       Declare the gate in ${fn.name}() itself, or pass it in as a prop.\n`
        + `       ${lines[u].trim().slice(0, 120)}`)
    }
  }
}

if (failed) { console.error(`\ngate in scope: ${failed} out-of-scope permission flag(s)`); process.exit(1) }
console.log(`gate in scope: every permission flag in ${checked} gated screen(s) is used inside the component that declares it`)
