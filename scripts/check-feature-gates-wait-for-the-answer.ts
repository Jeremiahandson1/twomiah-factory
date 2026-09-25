// A feature gate must not act before it knows the answer.
//
// `hasFeature(x)` is `company?.enabledFeatures?.includes(x) ?? false`. `company` arrives from
// /api/auth/me a moment AFTER mount, so during that moment hasFeature() answers **false for every
// feature**. A gate that redirects on that answer redirects on "don't know yet".
//
// It does not show up in normal clicking, because by the time you click a nav link the company has
// long since landed. It shows up on a HARD LOAD — a refresh, a bookmark, a link pasted from an email,
// a tester typing the URL. roof T18 M7 gated 15 routes this way and shipped it: on rooftest, a tenant
// with `insurance_workflow` switched ON could not open /crm/jobs/:id/insurance or /crm/adjusters at
// all. They redirected to the pipeline board, with `replace`, so Back could not even undo it. The
// whole insurance workflow was unreachable by URL on a tenant that pays for it.
//
// The fix is one line, and OnboardingGate in the same file had it right the whole time: wait for
// `company` (or the shared context's `loading`) before deciding. Rendering nothing for that moment is
// the safe side — rendering the children would flash a module the tenant may not have.
//
// This guard fails any component that decides a route from hasFeature() without waiting first.
//
//   bun run scripts/check-feature-gates-wait-for-the-answer.ts
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SCAN = [join(ROOT, 'templates'), join(ROOT, 'packages', 'tenant-ui', 'src')]

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'shared') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(name)) out.push(p)
  }
  return out
}

/** Pull out each top-level `function Name(...) { ... }` body by brace depth. */
function functions(text: string): Array<{ name: string; body: string; line: number }> {
  const out: Array<{ name: string; body: string; line: number }> = []
  const re = /^(?:export\s+)?function\s+([A-Za-z0-9_]+)\s*\(/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    // Walk the parameter list to its matching `)` before looking for the body brace. Taking the
    // first `{` instead lands on a destructured parameter — `function Gate({ feature, children })`
    // — and the guard then inspects the parameter object and passes every gate vacuously.
    let p = text.indexOf('(', m.index), depth = 0, close = -1
    for (let k = p; k < text.length; k++) {
      if (text[k] === '(') depth++
      else if (text[k] === ')') { depth--; if (depth === 0) { close = k; break } }
    }
    if (close < 0) continue
    const open = text.indexOf('{', close)
    if (open < 0) continue
    depth = 0
    let i = open
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) break }
    }
    out.push({ name: m[1], body: text.slice(open, i + 1), line: text.slice(0, m.index).split('\n').length })
  }
  return out
}

/** The gate has waited if it bails out on the auth load before it reads hasFeature(). */
const WAITS = [
  /if\s*\(\s*!\s*company\s*\)\s*return/,
  /if\s*\(\s*loading\s*\)\s*return/,
  /if\s*\(\s*!\s*company\s*\)\s*\{/,
  /if\s*\(\s*loading\s*\)\s*\{/,
  /if\s*\(\s*company\s*(?:&&|\))/,          // OnboardingGate's shape: only acts when company is present
]

const files: string[] = []
for (const root of SCAN) {
  if (!existsSync(root)) continue
  for (const t of readdirSync(root)) {
    if (t === 'crm-automotive') continue          // parked
    const p = join(root, t)
    if (statSync(p).isDirectory()) walk(p, files)
    else if (/\.tsx$/.test(t)) files.push(p)
  }
}

let checked = 0
for (const abs of files) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/')
  const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
  if (!text.includes('hasFeature')) continue

  for (const fn of functions(text)) {
    /**
     * A route gate is one where the FEATURE ANSWER decides where the user goes — not merely a component
     * that happens to do both.
     *
     * "reads hasFeature() anywhere && calls navigate() anywhere" caught JobsPage, which navigates to a job
     * on row click and separately asks whether the tenant has projects before fetching them. Nothing there
     * routes on a feature. Flagging it pushed toward a pointless `if (!company) return` in a list page, and
     * a guard that asks for the wrong change is worse than one that stays quiet: the next person satisfies
     * it rather than thinking. (Field Service T29)
     *
     * <Navigate> and blockedRoute() are route decisions wherever they appear. A bare navigate() counts only
     * when the feature answer is close enough to be plausibly controlling it.
     */
    const reads = /hasFeature\s*\(/.test(fn.body)
    const routesOutright = /<Navigate\b/.test(fn.body) || /blockedRoute\s*\(/.test(fn.body)
    const navigatesOnTheAnswer = (() => {
      for (const m of fn.body.matchAll(/hasFeature\s*\(/g)) {
        const near = fn.body.slice(m.index ?? 0, (m.index ?? 0) + 300)
        if (/\bnavigate\s*\(/.test(near)) return true
      }
      return false
    })()
    const decides = routesOutright || navigatesOnTheAnswer
    if (!reads || !decides) continue
    checked++
    if (!WAITS.some((r) => r.test(fn.body))) {
      fail(`${rel}:${fn.line} ${fn.name}() decides a route from hasFeature() without waiting for the company to load — on a hard page load it answers false for every feature`)
    }
  }

  // AppShell computes its gate inside a useMemo rather than a named function.
  const memo = text.match(/const gatedItem = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\)/)
  if (memo) {
    checked++
    if (!WAITS.some((r) => r.test(memo[0]))) fail(`${rel} gatedItem useMemo blocks a route from hasFeature() without waiting for the company to load`)
    if (!/\bcompany\b/.test(memo[0].slice(memo[0].lastIndexOf('}, ['))))
      fail(`${rel} gatedItem useMemo does not list \`company\` in its dependencies, so it never recomputes when the company lands`)
  }
}

console.log(failures ? `\n${failures} problem(s).` : `every feature route gate waits for the answer (${checked} gate(s) across ${files.length} files)`)
process.exit(failures ? 1 : 0)
