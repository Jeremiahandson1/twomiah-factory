// Every other contrast guard in this repo reads className strings. An inline style has no class, so a
// page written with `style={{ … }}` is invisible to all of them — which is how roof's Lead Inbox (57
// style objects, zero classNames) shipped a white panel that ignored the theme toggle completely. No
// `dark:` variant can reach a style attribute: the cascade can override a class, never an inline one.
//
// The rule that encodes the two ways this actually fails:
//
//   * a hard-coded near-WHITE background with no ink set in the same style object
//       its text inherits the body, and the body ink follows the theme, so the card keeps a light
//       ground while its text goes light — see check-inherited-ink-follows-theme.ts for that rule.
//
//   * a hard-coded near-BLACK ink with no background set in the same style object
//       it keeps its colour when the ground behind it flips to slate-900, and disappears.
//
// A style object setting BOTH is a self-contained pair — a status chip, a solid button — and is right
// in either theme, exactly like the bg-green-100/text-green-700 badges used across the fleet. A value
// read from a variable (`background: c.panel`) already follows the theme and is not matched at all.
//
// The fix is not to convert the page to utility classes wholesale. useIsDark() (packages/tenant-ui,
// shell/hooks) exists for precisely this: it tracks the `dark` class on <html> and re-renders, so a
// small palette function can feed theme-aware values into the same inline styles.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', 'templates')

// crm-homecare is built almost entirely from inline styles — 864 of them — and is parked pending the
// re-base from the live CVHC CRM, so it is not to be edited meanwhile. It is named here rather than
// silently skipped so the debt stays visible; the re-base should adopt this rule rather than inherit
// the problem. (Its own lead pages carry 19 of these, the same two pages fixed here for roof.)
const KNOWN_OPEN = new Set(['crm-homecare'])

const lum = (hex: string) => {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('')
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

const STYLE_OBJ = /style=\{\{([^}]*)\}\}/g
const BG = /(?:background|backgroundColor)\s*:\s*'(#[0-9a-fA-F]{3,6})'/
// `backgroundColor` also ends in "color"; the lookbehinds keep it out of the ink match
const INK = /(?<!background)(?<!Background)\bcolor\s*:\s*'(#[0-9a-fA-F]{3,6})'/

let failures = 0
const fail = (m: string) => { failures++; console.error(`FAIL: ${m}`) }

const templates = readdirSync(ROOT).filter((t) =>
  t.startsWith('crm') &&
  t !== 'crm-automotive' && // parked
  existsSync(join(ROOT, t, 'frontend', 'src')))

for (const t of templates) {
  if (KNOWN_OPEN.has(t)) continue
  const src = join(ROOT, t, 'frontend', 'src')

  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === 'node_modules' || e === 'dist') continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!p.endsWith('.tsx')) continue
      const rel = p.slice(src.length + 1).replace(/\\/g, '/')
      if (/\/pages\/portal\//.test('/' + rel)) continue // permanently dark by design
      readFileSync(p, 'utf8').split('\n').forEach((ln, i) => {
        for (const m of ln.matchAll(STYLE_OBJ)) {
          const body = m[1]
          const bg = body.match(BG)?.[1]
          const ink = body.match(INK)?.[1]
          if (bg && !ink && lum(bg) > 0.75) {
            fail(`${t}: ${rel}:${i + 1} pins a light background (${bg}) inline and sets no ink — its text follows the theme and the card does not`)
          }
          if (ink && !bg && lum(ink) < 0.18) {
            fail(`${t}: ${rel}:${i + 1} pins dark ink (${ink}) inline and sets no ground — it keeps that colour when the ground behind it goes slate-900`)
          }
        }
      })
    }
  }
  walk(src)
}

console.log(failures === 0
  ? `check-inline-styles-are-theme-aware: ok (${templates.length - KNOWN_OPEN.size} templates checked, ${KNOWN_OPEN.size} known-open)`
  : `check-inline-styles-are-theme-aware: ${failures} failure(s)`)
process.exit(failures ? 1 : 0)
