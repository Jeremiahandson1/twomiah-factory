// CI guard: each CRM template's render.yaml.template builds THAT template.
//
// The generator writes it to the bundle root as render.yaml (services/generator.ts) — the Blueprint a customer
// who self-hosts would deploy, and what the bundle's README points at. crm-basic was cloned from crm-fieldservice
// and kept its Blueprint: rootDir crm-fieldservice/backend, services named -wrench-api — a directory the basic
// bundle does not even contain. crm-rv and crm-vet pointed at the contractor CRM (crm/backend). Found when the
// bar vertical (crm-bar, cloned from crm-basic) shipped a bundle saying "wrench" (10/17). The Factory's own deploy
// creates services through the Render API (services/deploy.ts), so no live tenant ran on these — but the file
// shipped with every bundle and was wrong.
//   bun scripts/check-crm-render-yaml-own-template.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0, checked = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

for (const t of readdirSync(join(ROOT, 'templates')).filter((n) => /^crm($|-)/.test(n)).sort()) {
  const p = join(ROOT, 'templates', t, 'render.yaml.template')
  if (!existsSync(p)) continue
  checked++
  const s = readFileSync(p, 'utf8')
  const dirs = [...s.matchAll(/rootDir:\s*(\S+)/g)].map((m) => m[1])
  if (!dirs.length) fail(`${t}: render.yaml.template has no rootDir`)
  for (const d of dirs) if (d !== `${t}/backend` && d !== `${t}/frontend`) fail(`${t}: render.yaml.template builds "${d}" — it must build ${t}/backend (its own template)`)
}
if (checked < 13) fail(`expected every CRM template to carry a render.yaml.template, found ${checked}`)

if (failed) { console.error(`\ncrm render.yaml own template: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`crm render.yaml own template: ${checked} CRM Blueprints each build their own template`)
