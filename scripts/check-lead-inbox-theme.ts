// CI guard: the shared Lead Inbox + Lead Sources pages are inline-styled (not Tailwind class-based like
// the sibling shared pages), so they can't rely on `dark:` variants. They must colour their structural
// chrome from useLeadPalette() (leads/theme.ts), which resolves from the live theme. Before this fix both
// pages hardcoded a light palette (#fff surfaces, #666/#999 text, #e5e7eb borders) and rendered unreadable
// light-on-light in dark mode across all 7 CRMs that vendor the shared UI.
//
// This guard fails if either page reintroduces a structural-light literal, or stops using the palette, or
// the palette helper loses its dark branch. Semantic colours (platform hues, status/active green, error
// red, blue links, white text on solid coloured buttons) are intentionally allowed.
//   bun scripts/check-lead-inbox-theme.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (f: string) => strip(readFileSync(new URL('../' + f, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const pages = [
  'packages/tenant-ui/src/leads/LeadInboxPage.tsx',
  'packages/tenant-ui/src/leads/LeadSourcesPage.tsx',
]

// Structural-light literals that break dark mode. These patterns match ONLY page chrome (surfaces, text
// tiers, control borders) — not the semantic constants (STATUS_COLORS uses `bg:`, platform dots use the
// platform hue) and not white text on solid coloured buttons (`color: '#fff'`).
const banned: { re: RegExp; what: string }[] = [
  { re: /background:\s*'#fff'/, what: "light surface background: '#fff' (use c.surface)" },
  { re: /background:\s*'#fafafa'/, what: "light hover background: '#fafafa' (use c.hover)" },
  { re: /color:\s*'#666'/, what: "light muted text color: '#666' (use c.muted)" },
  { re: /color:\s*'#999'/, what: "light faint text color: '#999' (use c.faint)" },
  { re: /1px solid #(?:e5e7eb|f0f0f0|ddd|e0e0e0)/, what: "light hardcoded border (use c.border / c.divider / c.inputBorder)" },
]

for (const file of pages) {
  const src = read(file)
  if (!/useLeadPalette\s*\(/.test(src)) fail(`${file}: must colour itself via useLeadPalette() so it follows the theme`)
  for (const b of banned) if (b.re.test(src)) fail(`${file}: reintroduced ${b.what}`)
}

// The palette helper must keep both branches — a light-only helper would defeat the whole guard.
const theme = read('packages/tenant-ui/src/leads/theme.ts')
if (!/const\s+DARK\s*:/.test(theme) || !/const\s+LIGHT\s*:/.test(theme)) {
  fail('packages/tenant-ui/src/leads/theme.ts: must define both LIGHT and DARK palettes')
}
if (!/useIsDark\s*\(/.test(theme)) {
  fail('packages/tenant-ui/src/leads/theme.ts: useLeadPalette must resolve from the live theme via useIsDark()')
}

if (failed) { console.error(`\nlead inbox theme: ${failed} check(s) FAILED`); process.exit(1) }
console.log('lead inbox theme: Lead Inbox + Lead Sources colour from useLeadPalette() (dark-mode safe)')
