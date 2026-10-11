// CI guard: a template frontend that writes dark: classes switches them on by CLASS, never by the operating system.
//
// Store QA T1, B1 (blocker): "the admin UI is largely unreadable because content text is near-white on white cards"
// — and the sign-in screen first. crm-store's tailwind.config.js set no darkMode, and Tailwind's default is 'media':
// every dark:text-slate-100 in the pages turned on whenever the person's computer was in dark mode, while the base
// classes (.card, .input) and `color-scheme: light` stayed light. Every other CRM says darkMode: 'class' and turns
// dark mode on with a toggle; the store had copied the dark: classes without the setting that makes them safe.
//
// The rule: a frontend whose source uses a dark: variant must declare darkMode: 'class' in its tailwind config.
//
//   bun scripts/check-tailwind-dark-mode-is-class.ts
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
// Parked, not shipped: it has the same gap and is left for the day it is picked up again.
const PARKED: Record<string, string> = { 'crm-homecare': 'parked (not developed) — same media default; fix when it is picked up' }

let failed = 0, checked = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const usesDark = (dir: string): boolean => {
  for (const e of readdirSync(dir)) {
    const p = `${dir}/${e}`
    if (statSync(p).isDirectory()) { if (e !== 'node_modules' && e !== 'shared' && usesDark(p)) return true; continue }
    if (/\.(tsx|ts|jsx|js|css|html)$/.test(e) && /\bdark:[a-z]/.test(readFileSync(p, 'utf8'))) return true
  }
  return false
}

for (const t of readdirSync(`${ROOT}templates`).sort()) {
  const fe = `${ROOT}templates/${t}/frontend`
  const cfg = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs'].map((f) => `${fe}/${f}`).find(existsSync)
  if (!cfg || !existsSync(`${fe}/src`) || !usesDark(`${fe}/src`)) continue
  if (PARKED[t]) { console.log(`skip ${t}: ${PARKED[t]}`); continue }
  checked++
  const src = readFileSync(cfg, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  if (!/\bdarkMode\s*:\s*\[?\s*['"]class['"]/.test(src))
    fail(`templates/${t}: its pages use dark: classes but ${cfg.slice(ROOT.length)} does not set darkMode: 'class' — Tailwind's default ('media') turns them on from the OPERATING SYSTEM, and any light-only base class then carries near-white text`)
}
if (checked < 10) fail(`only ${checked} template frontends checked — the walk is broken`)
if (failed) { console.error(`\ntailwind dark mode: ${failed} problem(s)`); process.exit(1) }
console.log(`tailwind dark mode: ${checked} template frontends with dark: classes all switch them on by class`)
