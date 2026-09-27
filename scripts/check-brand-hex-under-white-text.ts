// CI guard: the RAW customer brand colour may never sit under white text.
//
// Why this exists, and why it is separate from check-contrast-measured.ts.
//
// The tenant's brand colour is a free `<input type="color">` with no validation, and it is used for
// two different jobs. Most uses are correct BRIGHT and must never be clamped: the browser theme-color
// meta, a 1px accent rule with no text on it, a 15%/20% wash carrying dark text, an icon on such a
// wash. One use has a contrast bar: a SURFACE that white text sits on (and its mirror, the brand used
// as ink on white — the same condition, since both are "brand versus white").
//
// generatePalette clamps shades 500/600, so `bg-*-500 text-white` is safe and measured by
// check-contrast-measured.ts. But that only covers code written as a Tailwind CLASS. Code that paints
// `company.primaryColor` or the `{{PRIMARY_COLOR}}` token DIRECTLY — an inline style, or CSS baked at
// generation — bypasses Tailwind entirely and keeps the raw, possibly unreadable hex. That is how the
// portal's avatar tile and every email header/button shipped at ~1.1:1 for a bright brand while every
// className-reading guard stayed green.
//
// So this guard does not measure colours — it cannot, the colour is the customer's and unknown at
// build time. It asserts the STRUCTURE: wherever the brand goes under white text, the value must come
// from the clamp rather than from the raw hex.
//
//   frontend : brandSurfaceUnderWhite(...) — packages/tenant-ui/src/brand.ts
//   generated: {{PRIMARY_COLOR_ON_WHITE}}  — apps/api/src/services/generator.ts
//
//   bun scripts/check-brand-hex-under-white-text.ts
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

// CLAUDE.md: these are parked. Reported, never enforced.
const PARKED = ['crm-automotive', 'crm-homecare']

/**
 * The clamped forms. A paint under white text must use one of these.
 * Kept as substrings rather than a regex so a reader can see exactly what is accepted.
 */
const CLAMPED = ['brandSurfaceUnderWhite', 'brandInkOn', 'primaryOnWhiteText', '{{PRIMARY_COLOR_ON_WHITE}}']

/**
 * Raw brand-colour paints that are CORRECT bright, with the reason. Anything here is exempt; anything
 * not here that puts the raw hex under white text fails. Each entry is a file suffix + a marker on the
 * line, so it cannot silently widen to a whole file.
 */
const BRIGHT_BY_DESIGN: Array<{ file: string; marker: string; why: string }> = [
  { file: 'frontend/index.html', marker: 'name="theme-color"', why: 'browser chrome tint — no text of ours sits on it' },
  { file: 'templates/website-preview.html', marker: '--color-primary', why: 'declares CSS variables for arbitrary website themes; a different substitution path, and the website surface, not the CRM' },
  { file: 'templates/website-preview.html', marker: '--primary-color', why: 'as above' },
  { file: 'cms/src/styles/main.css', marker: '--gold', why: 'website CMS theme variable — its own surface, with its own contrast pass' },
]

const files: string[] = []
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === 'dist' || e === 'build' || e === '.git') continue
    const p = join(d, e)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p)
    else if (/\.(tsx?|css|html)$/.test(e)) files.push(p)
  }
}
for (const r of ['templates', 'packages']) { const p = join(ROOT, r); if (existsSync(p)) walk(p) }

/** The raw brand colour, as it appears in code: the runtime identifier or the generation token. */
const RAW_BRAND = /\{\{PRIMARY_COLOR\}\}|\bprimaryColor\b/
/** …at 12% / 15% / 20% etc. A translucent wash is a different surface and carries dark text. */
const IS_WASH = /\$\{primaryColor\}[0-9a-fA-F]{2}|\{\{PRIMARY_COLOR\}\}[0-9a-fA-F]{2}/
/** White or near-white ink. */
const WHITE_INK = /\btext-white\b|\btext-slate-50\b|\btext-gray-50\b|color:\s*(white|#fff\b|#ffffff)/i

let checkedFiles = 0, parkedFiles = 0, sitesOk = 0
const exempt = (rel: string, line: string) =>
  BRIGHT_BY_DESIGN.find((e) => rel.endsWith(e.file) && line.includes(e.marker))

for (const abs of files) {
  const rel = relative(ROOT, abs).split('\\').join('/')
  let src: string
  try { src = readFileSync(abs, 'utf8') } catch { continue }
  if (!RAW_BRAND.test(src)) continue
  const isParked = PARKED.some((p) => rel.includes('/' + p + '/'))
  if (isParked) { parkedFiles++; continue }
  checkedFiles++
  const lines = src.replace(/\r/g, '').split('\n')

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    if (!RAW_BRAND.test(L)) continue
    if (IS_WASH.test(L)) continue
    if (CLAMPED.some((c) => L.includes(c))) { sitesOk++; continue }
    if (exempt(rel, L)) { sitesOk++; continue }

    // ---- a CSS rule painting the brand as a background, with its ink on the SAME line
    if (/background(-color)?:\s*\{\{PRIMARY_COLOR\}\}/.test(L) && WHITE_INK.test(L)) {
      fail(`${rel}:${i + 1} — white text on the RAW brand colour. Use {{PRIMARY_COLOR_ON_WHITE}} here; {{PRIMARY_COLOR}} is the customer's unvalidated pick and can be 1.1:1 under white.\n        ${L.trim().slice(0, 110)}`)
      continue
    }
    // ---- the brand used as INK where the ground is white (the email body is #fff)
    if (/color:\s*\{\{PRIMARY_COLOR\}\}/.test(L) && /\/services\/email\.ts$/.test(rel)) {
      fail(`${rel}:${i + 1} — the brand used as ink on the white email body. Use {{PRIMARY_COLOR_ON_WHITE}}: brand-on-white is the same condition as white-on-brand.\n        ${L.trim().slice(0, 110)}`)
      continue
    }
    // ---- a JSX inline style painting the brand, with white ink on the element's own className
    if (/backgroundColor:\s*primaryColor\b/.test(L)) {
      // the className is normally on this line or the 3 above it
      const ctx = lines.slice(Math.max(0, i - 3), i + 1).join(' ')
      if (WHITE_INK.test(ctx)) {
        fail(`${rel}:${i + 1} — white text on the RAW brand colour. Wrap it: brandSurfaceUnderWhite(primaryColor), from '../shared'.\n        ${L.trim().slice(0, 110)}`)
        continue
      }
    }
    sitesOk++
  }
}

if (checkedFiles === 0) fail('no file referenced the brand colour at all — this guard measured nothing, which means its detection broke rather than that the repo is clean')

if (failed) { console.error(`\nbrand hex under white text: ${failed} site(s) using the customer's raw colour where white text sits on it`); process.exit(1) }
console.log(`brand hex under white text: ${checkedFiles} file(s) paint the brand colour, ${sitesOk} site(s) either clamped or documented bright-by-design (${BRIGHT_BY_DESIGN.length} exemptions); ${parkedFiles} parked file(s) not enforced`)
