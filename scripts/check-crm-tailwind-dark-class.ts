/**
 * GUARD: every CRM frontend's Tailwind config sets `darkMode: 'class'`.
 *
 * Without it Tailwind uses 'media': every `dark:` class follows the OS setting, whether or not the app has a theme.
 * Home care had no darkMode line (10/16): its own CSS paints .card and .modal-content white, nothing puts `dark` on
 * <html>, and on an OS in dark mode the shared components' `dark:text-slate-200` ink landed on those white grounds.
 * With 'class', `dark:` applies only when the app's theme switch (tenant-ui applyStoredTheme) sets it.
 *
 * The walk is every templates/crm* frontend with a tailwind.config; after it, this file mutation-tests itself.
 *
 *   bun scripts/check-crm-tailwind-dark-class.ts
 */
import { readdirSync, readFileSync, existsSync } from 'fs'

const ROOT = (process.argv[2] || process.cwd()).replace(/\\/g, '/').replace(/\/$/, '')

export function setsClassDarkMode(config: string): boolean {
  const c = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  return /\bdarkMode\s*:\s*\[?\s*['"]class['"]/.test(c) || /\bdarkMode\s*:\s*\[?\s*['"]selector['"]/.test(c)
}

let failed = 0, n = 0
for (const t of readdirSync(`${ROOT}/templates`).filter((x) => /^crm(-|$)/.test(x))) {
  const cfg = ['js', 'ts', 'cjs', 'mjs'].map((e) => `${ROOT}/templates/${t}/frontend/tailwind.config.${e}`).find(existsSync)
  if (!cfg) continue
  n++
  if (!setsClassDarkMode(readFileSync(cfg, 'utf8'))) { failed++; console.log(`FAIL ${t}: tailwind.config has no darkMode: 'class' — dark: classes would follow the OS`) }
}
if (n === 0) { failed++; console.log('FAIL found no CRM tailwind configs') }

const self: [string, string, boolean][] = [
  ['missing', "export default { content: [] }", false],
  ['media', "export default { darkMode: 'media' }", false],
  ['commented out', "export default { // darkMode: 'class',\n content: [] }", false],
  ['class', "export default { darkMode: 'class', content: [] }", true],
  ['selector array', "module.exports = { darkMode: ['selector', '[data-mode=dark]'] }", true],
]
for (const [name, src, want] of self) if (setsClassDarkMode(src) !== want) { failed++; console.log(`FAIL self-test "${name}"`) }

console.log(`${failed ? 'FAIL' : 'ok'} tailwind darkMode: ${n} CRM config(s), ${self.length} self-tests`)
process.exit(failed ? 1 : 0)
