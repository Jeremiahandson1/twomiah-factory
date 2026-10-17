// CI guard: the bar's website speaks to a bar's guests and its header holds up at every width (Test Bar Run 2, 2026-10-17).
//   - /contact asked "What you're working on" (name="project"); the lead error said "your project".
//   - Every premium site admin's sign-in was headed "Premium-contractor admin".
//   - /taps showed one price although the CRM sends every pour size (Pint $5.50 · Pitcher $18).
//   - The sticky header was transparent (text scrolled visibly behind it), the name wrapped onto two lines
//     at ~800px, and hours ranges broke mid-range on a phone.
//
//   bun scripts/check-bar-site-words-and-header.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const BAR = join(ROOT, 'templates/website-premium-bar')
const read = (p: string) => readFileSync(join(BAR, p), 'utf8')
let failed = 0
const check = (ok: boolean, msg: string) => { if (!ok) { failed++; console.error('FAIL: ' + msg) } }

const contact = read('views/sections/contact/form-info.ejs')
check(!/working on/i.test(contact.replace(/<%#[\s\S]*?%>/g, '')), "contact form still asks \"What you're working on\"")
check(!/name="project"|id="cf-project"/.test(contact), 'contact form still posts a "project" field')
check(/name="message"/.test(contact), 'contact form has no message field (the server reads body.message)')
check(!/your project/i.test(read('server-static.ts')), 'the lead route still answers "Tell us a bit about your project"')

for (const t of readdirSync(join(ROOT, 'templates')).filter((d) => d.startsWith('website-premium-'))) {
  let src = ''
  try { src = readFileSync(join(ROOT, 'templates', t, 'admin/src/pages/LoginPage.tsx'), 'utf8') } catch { continue }
  check(!/Premium-contractor/.test(src), `${t} admin sign-in is headed "Premium-contractor admin"`)
}

const bar = read('lib/bar.ts'), wall = read('views/sections/taps/wall.ejs')
check(/sizes:\s*\(Array\.isArray\(t\.sizes\)/.test(bar), 'lib/bar.ts tapsFrom drops the CRM\'s tap sizes')
check(/pours\(t\)/.test(wall) && /tap__size/.test(wall), 'the tap wall does not print each pour size')

const css = read('build/styles/main.css'), base = read('views/base.ejs'), hours = read('views/sections/hours/table.ejs')
// The LAST .site-header rule that sets a background wins: it must not be transparent.
const headerBgs = [...css.matchAll(/(^|\n)[^{}\n]*\.site-header(?![-\w])[^{}\n]*\{([^}]*)\}/g)].map((m) => m[2]).filter((b) => /background\s*:/.test(b))
check(headerBgs.length > 0 && !/background\s*:\s*transparent/.test(headerBgs[headerBgs.length - 1]), 'the sticky header ends up with a transparent background')
check(/\.brand,\s*\.primary-nav a,\s*\.header-cta\s*\{\s*white-space:\s*nowrap/.test(css), 'the header name / links may wrap')
check(/\.site-header\.is-compact \.mobile-nav-toggle/.test(css) && /classList\.add\('is-compact'\)/.test(base), 'the header has no compact (menu button) mode for a row that does not fit')
check(/\.hours__range\s*\{\s*white-space:\s*nowrap/.test(css) && /class="hours__range"/.test(hours), 'hours ranges can break mid-range')

if (failed) { console.error(`\n${failed} failed`); process.exit(1) }
console.log('bar site words and header: ok')
