// CI guard: a page that exists to SELL a feature must not be gated behind that feature.
//
// crm-fieldservice shipped a home tile that appears only when hasFeature('pricebook') is false, linking to
// /crm/pricebook-trial — and shellConfig gated that route on ['pricebook']. So the offer refused exactly
// the tenants it was written for: click FREE TRIAL, land on "Pricebook Trial isn't part of this CRM".
// It survived four QA runs as an open high because both halves read correctly on their own; only the pair
// is wrong. (Field Service T28 H2)
//
// The shape is general: find every tile rendered under !hasFeature('X') that navigates to /crm/Y, then
// refuse any routeGates entry for /crm/Y that requires X.
//   bun scripts/check-upsell-not-self-gated.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
/**
 * Comments out, before anything is parsed. The comment explaining why a gate was REMOVED quotes the
 * removed line, so the first version of this guard read its own explanation as a live gate and failed on
 * the file it had just certified. A guard that cannot tell code from prose about code is not a guard.
 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const templates = readdirSync(ROOT + 'templates').filter((d) => d.startsWith('crm-') && existsSync(`${ROOT}templates/${d}/frontend/src`))
let checked = 0, pairs = 0

for (const tpl of templates) {
  const base = `templates/${tpl}/frontend/src/`
  const shell = stripComments(read(base + 'shellConfig.ts'))
  if (!shell) continue
  checked++

  // routeGates: { '/crm/x': ['feature', …], … }
  const gates = new Map<string, string[]>()
  const gateBlock = /routeGates\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(shell)?.[1] || ''
  for (const m of gateBlock.matchAll(/(['"])(\/crm\/[^'"]+)\1\s*:\s*\[([^\]]*)\]/g)) {
    const feats = [...m[3].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
    gates.set(m[2], feats)
  }
  if (!gates.size) continue

  // Any page under this template that renders something only when a feature is ABSENT, and sends the
  // reader somewhere. CustomerPortal is where the promo tiles live, but scan every page.
  const pagesDir = base + 'pages'
  const files: string[] = []
  const walk = (rel: string) => {
    let entries: string[] = []
    try { entries = readdirSync(ROOT + rel) } catch { return }
    for (const e of entries) {
      if (/\.(tsx|ts)$/.test(e)) files.push(rel + '/' + e)
      else if (!/\./.test(e)) walk(rel + '/' + e)
    }
  }
  walk(pagesDir)

  for (const rel of files) {
    const src = stripComments(read(rel))
    if (!src.includes('hasFeature')) continue
    // !hasFeature('X') … navigate('/crm/Y')  — within the same block of JSX
    for (const m of src.matchAll(/!\s*hasFeature\(\s*['"]([^'"]+)['"]\s*\)([\s\S]{0,1600}?)(?:\n\s*\)\}|\n\s*\{\s*\/\*)/g)) {
      const feature = m[1]
      for (const nav of m[2].matchAll(/navigate\(\s*['"](\/crm\/[^'"]+)['"]\s*\)/g)) {
        const path = nav[1]
        const gate = gates.get(path)
        if (!gate) continue
        pairs++
        if (gate.includes(feature)) {
          fail(`${tpl}: ${rel.split('/').pop()} offers ${path} only when "${feature}" is OFF, and shellConfig gates that route on ["${gate.join('", "')}"] — the offer refuses everyone it is for`)
        }
      }
    }
  }
}

if (failed) { console.error(`\nupsell not self-gated: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`upsell not self-gated: ${checked} template(s) with route gates, ${pairs} promo/gate pair(s), none self-defeating`)
