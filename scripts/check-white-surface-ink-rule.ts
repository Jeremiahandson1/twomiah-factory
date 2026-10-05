// CI guard: a base rule that pins dark ink on `.bg-white` must exempt surfaces that go dark.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// Two rounds, two templates, one rule:
//
//     .bg-white, .card { @apply text-gray-900; }
//
// It is written for a real fault — dark mode half-applied, a white card left white on a dark page,
// and any text on it inheriting the body's light ink and vanishing. The premise is "a white surface
// always carries dark text", and it is true of a surface that STAYS white.
//
// It is not true of `bg-white … dark:bg-slate-900`, which is how most cards in the fleet are written.
// That element keeps its `.bg-white` class in dark mode, so the rule goes on pinning gray-900 on a
// slate-900 ground: 1.01:1. Not low contrast — no text at all, and invisible to every contrast sweep
// that reads classNames, because the className is innocent and the CSS is what breaks it.
//
//   crm-rv            the Accounting table, 129 labels, found and fixed in an earlier round
//   crm-restaurant    the Events modals — every pop-up TITLE and every Cancel button, because those
//                     elements carry no colour of their own and inherit. (T42)
//
// The second one is the reason this is a guard and not a fix. crm-rv's comment already explained the
// problem and the answer; the sibling template with the identical rule kept it for two more rounds
// and the owner reported it twice.
//
// THE RULE: if a selector mentions .bg-white and the body pins a near-black text colour, the selector
// must exclude elements declaring a dark background of their own — `:not([class*="dark:bg-"])`. In the
// DOM a Tailwind dark variant really is a class literally named `dark:bg-slate-900`, so the attribute
// match is exact, not a trick.
//
// A template with no such rule passes; this does not require anybody to add one.
//
//   bun scripts/check-white-surface-ink-rule.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/** Ink dark enough that it is unreadable on any dark surface. The same shade set as #206's rule. */
const NEAR_BLACK = /\btext-(?:black|(?:gray|slate|zinc|neutral)-(?:800|900|950))\b/
/** The exemption that makes the premise true. */
const EXEMPTS_DARK = /\.bg-white:not\(\s*\[class\*=["']dark:bg-["']\]\s*\)/

const files: string[] = []
for (const t of readdirSync(`${ROOT}templates`)) {
  const p = `templates/${t}/frontend/src/index.css`
  if (existsSync(ROOT + p)) files.push(p)
}
for (const p of ['packages/tenant-ui/src/index.css', 'packages/tenant-ui/src/styles.css']) {
  if (existsSync(ROOT + p)) files.push(p)
}

let checked = 0, carrying = 0
for (const rel of files) {
  checked++
  const src = readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n')
  // COMMENTS ARE NOT CSS. Both templates explain this rule in a comment directly above it — and
  // crm-restaurant's explanation quotes `.bg-white` several times. A guard that reads its own
  // documentation as code fails on the very file that documents the fix best.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ')

  // Each rule as "selector { body }". Enough for a stylesheet of flat @layer rules, which is what
  // these are; a nested @layer block's braces are not matched into a selector because a selector
  // cannot contain a brace.
  for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim(), body = m[2]
    if (!/\.bg-white\b/.test(selector)) continue
    if (!NEAR_BLACK.test(body)) continue
    carrying++
    if (EXEMPTS_DARK.test(selector)) continue
    fail(
      `${rel}: \`${selector.replace(/\s+/g, ' ').slice(0, 90)}\` pins near-black ink on .bg-white ` +
      `without exempting surfaces that go dark. An element written \`bg-white … dark:bg-slate-900\` ` +
      `keeps this ink in dark mode — gray-900 on slate-900 is 1.01:1. Write it as ` +
      `\`.bg-white:not([class*="dark:bg-"])\`, and drop any class (.card) whose own rule already ` +
      `declares a dark background.`,
    )
  }
}

if (failed) { console.error(`\nwhite-surface ink rule: ${failed} rule(s) FAILED`); process.exit(1) }
console.log(`white-surface ink rule: ${checked} stylesheet(s) checked, ${carrying} pin ink on .bg-white and all exempt surfaces that go dark`)
