// The CRM's seed and the Factory start a new company on ONE feature list. (Bar Run 1 follow-up, 10/17)
//
// The seed used to write the PLAN's full list (every feature a Starter may toggle) while the deploy synced the
// Factory's lean list over it a minute later; they agreed only when that sync landed. processCRM's "write the list
// back into config for runDeploy" wrote to a copy — generate() spreads its config — so nobody read it.
// Now: resolveCrmFeatures splits the list the company STARTS with (the Factory's, else the template's lean default)
// from the list whose CODE ships (the plan's plus that), and generate() hands the first back as crmFeatures, which the
// deploy saves and syncs. Checked on the pure rule and on a real build's seed file, for the bar and the base CRM.
//   bun run tests/shared/crm-feature-seed.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const OUT = mkdtempSync(path.join(tmpdir(), 'seed-test-'))
process.env.FACTORY_TEMPLATES_DIR = path.join(ROOT, 'templates')
process.env.FACTORY_OUTPUT_DIR = OUT
// adm-zip is apps/api's dependency (the generator zips with it), so resolve it from there.
const AdmZip = createRequire(new URL('../../apps/api/package.json', import.meta.url))('adm-zip')
const gen = await import(new URL('../../apps/api/src/services/generator.ts', import.meta.url).href)
const reg = await import(new URL('../../packages/tenant-backend/src/featureRegistry.ts', import.meta.url).href)

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

// ── the rule
{
  const lean = reg.getDefaultFeaturesForTemplate('crm-bar')
  const given = gen.resolveCrmFeatures('crm-bar', 'starter10', lean)
  check('the company starts on exactly the list the Factory gives', same(given.seed, lean), given.seed)
  check('…while the code shipped covers the whole plan, so a feature turned on later works', reg.getFeaturesForPlan('crm-bar', 'starter10').every((id: string) => given.code.includes(id)) && lean.every((id: string) => given.code.includes(id)))
  check('no list given: the template\'s lean default, not the plan\'s full list', same(gen.resolveCrmFeatures('crm-bar', 'starter10', []).seed, lean) && same(gen.resolveCrmFeatures('crm-bar', 'starter10', undefined).seed, lean))
  check('a not-ready feature never starts on, even when asked for', !gen.resolveCrmFeatures('crm', 'starter10', ['contacts', 'instant_estimator']).seed.includes('instant_estimator'))
  check('a staff-chosen list is kept as chosen (an extra add-on stays on)', gen.resolveCrmFeatures('crm', 'starter10', ['contacts', 'jobs', 'visualizer']).seed.includes('visualizer'))
}

// ── a real build: the seed file the CRM boots with holds that list, and generate() reports it
async function build(industry: string, template: string, features: string[]) {
  const r = await gen.generate({
    tenant_id: 't-' + template, tenant_slug: 'seed-' + template, products: ['crm'],
    company: { name: 'Seed Test ' + template, email: 'o@test.local', industry, state: 'WI', plan: 'starter10' },
    branding: { primaryColor: '#334155' }, features: { crm: features },
  })
  // Read it the way the Factory does: apps/api's adm-zip.
  const zip = new AdmZip(r.zipPath)
  const entry = zip.getEntries().find((e: any) => /backend\/db\/seed\.ts$/.test(e.entryName.replace(/\\/g, '/')))
  const seed = entry ? entry.getData().toString('utf8') : ''
  const json = seed.match(/const __FEATURES_RAW = `([\s\S]*?)`/)?.[1] || '[]'
  return { r, seeded: JSON.parse(json) as string[], unzipOk: zip.getEntries().length > 0 }
}
for (const [industry, template] of [['bar_and_grill', 'crm-bar'], ['general_contractor', 'crm']]) {
  const lean = reg.getDefaultFeaturesForTemplate(template)
  const { r, seeded, unzipOk } = await build(industry, template, lean)
  check(`${template}: the build unpacks and has a seed`, unzipOk && seeded.length > 0, seeded)
  check(`${template}: the seed starts the company on the Factory's list, not the plan's`, same(seeded, lean), { seeded, lean })
  check(`${template}: generate() reports the same list for the deploy to save and sync`, same(r.crmFeatures || [], seeded), r.crmFeatures)
}

rmSync(OUT, { recursive: true, force: true })
console.log(`\ncrm-feature-seed: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
