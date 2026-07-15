/**
 * Generates a STORE tenant (crm-store + website-store) locally and inspects the
 * output. Pure file-gen — no deploy, no creds, no external APIs.
 *
 * Run from TwomiahFactory/apps/api:
 *   bun run scripts/probe-store.ts
 */
import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import { generate, type GenerateConfig } from '../src/services/generator'

const OUT_DIR = process.env.STORE_PROBE_OUT || path.resolve(process.cwd(), 'generated', '_store-probe')

const config: GenerateConfig = {
  products: ['crm', 'website'],
  company: {
    name: 'Nord Supply Co',
    legalName: 'Nord Supply Co LLC',
    email: 'hello@nordsupply.com',
    adminEmail: 'admin@nordsupply.com',
    phone: '(612) 555-0142',
    address: '210 Lake St',
    city: 'Minneapolis',
    state: 'MN',
    stateFull: 'Minnesota',
    zip: '55408',
    domain: 'nordsupply.com',
    siteUrl: 'https://nordsupply.com',
    industry: 'ecommerce', // STORE_INDUSTRIES → crm-store + website-store
    ownerName: 'Sig Nord',
    description: 'Minnesota-made outdoor gear and apparel for cold-weather living.',
  },
  branding: {
    primaryColor: '#0f766e',
    secondaryColor: '#0b3b36',
  },
  features: {},
  content: {},
} as GenerateConfig

async function main() {
  console.log('=== Generating STORE tenant ===')
  console.log('industry:', config.company!.industry, '→ expect crm-store + website-store\n')

  let result
  try {
    result = await generate(config)
  } catch (err: any) {
    console.error('GENERATE FAILED:', err.message)
    console.error(err.stack)
    process.exit(1)
  }

  console.log('zip:', result.zipPath)
  console.log('slug:', result.slug, '\n')

  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  new AdmZip(result.zipPath).extractAllTo(OUT_DIR, true)
  console.log('extracted to:', OUT_DIR, '\n')

  const topDirs = fs.readdirSync(OUT_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  console.log('top-level dirs:', topDirs.join(', '), '\n')

  // ── Assertions ──
  const checks: [string, boolean][] = []
  const exists = (p: string) => fs.existsSync(path.join(OUT_DIR, p))
  const read = (p: string) => { try { return fs.readFileSync(path.join(OUT_DIR, p), 'utf8') } catch { return '' } }

  checks.push(['crm-store copied', exists('crm-store/backend/src/index.ts')])
  checks.push(['website-store copied', exists('website-store/src/app/page.tsx')])
  checks.push(['seed.template.ts consumed → seed.ts', exists('crm-store/backend/db/seed.ts') && !exists('crm-store/backend/db/seed.template.ts')])
  checks.push(['migration present', exists('crm-store/backend/db/migrations/0000_initial_store.sql')])
  checks.push(['render.yaml at root', exists('render.yaml')])
  checks.push(['crm-store payments adapter present', exists('crm-store/backend/src/payments/stripe.ts')])
  checks.push(['feature-manifest.json stripped', !exists('crm-store/feature-manifest.json')])

  const seed = read('crm-store/backend/db/seed.ts')
  checks.push(['seed has company name filled', seed.includes('Nord Supply Co')])
  checks.push(['seed has NO literal tokens', !/\{\{[A-Z_]+\}\}/.test(seed)])

  const backendEnv = read('crm-store/backend/.env')
  checks.push(['backend .env has DATABASE_URL', /DATABASE_URL=/.test(backendEnv)])
  checks.push(['backend .env has PAYMENT_ENC_KEY filled', /PAYMENT_ENC_KEY="[0-9a-f]{8,}/.test(backendEnv)])
  checks.push(['backend .env has JWT_REFRESH_SECRET filled', /JWT_REFRESH_SECRET="[0-9a-f]{8,}/.test(backendEnv)])
  checks.push(['backend .env STOREFRONT_ORIGIN set', /STOREFRONT_ORIGIN="https:\/\/nordsupply\.com"/.test(backendEnv)])

  const siteEnv = read('website-store/.env')
  checks.push(['storefront .env CRM_STORE_API_URL → shop-api', /CRM_STORE_API_URL="https:\/\/[a-z0-9-]+-shop-api\.onrender\.com"/.test(siteEnv)])

  const tailwind = read('crm-store/frontend/tailwind.config.js')
  checks.push(['admin tailwind primary color filled', tailwind.includes('#0f766e') && !tailwind.includes('{{PRIMARY_COLOR}}')])

  const globalsCss = read('website-store/src/app/globals.css')
  checks.push(['storefront globals.css color filled', !globalsCss.includes('{{PRIMARY_COLOR}}')])

  const layout = read('website-store/src/app/layout.tsx')
  checks.push(['storefront layout has company name', layout.includes('Nord Supply Co')])

  const rootRender = read('render.yaml')
  checks.push(['render.yaml is the storefront (Next.js) service', /website-store/.test(rootRender)])

  // crm-store render.yaml (per-service) should reference shop DB + rootDir
  const crmRender = read('crm-store/render.yaml')
  checks.push(['crm-store render.yaml rootDir crm-store/backend', /rootDir:\s*crm-store\/backend/.test(crmRender)])

  console.log('=== CHECKS ===')
  let pass = 0
  for (const [name, ok] of checks) {
    console.log((ok ? '✅' : '❌') + ' ' + name)
    if (ok) pass++
  }
  console.log(`\n${pass}/${checks.length} passed`)

  // Grep for any leftover literal tokens across the whole tree (excluding node_modules).
  const leftover: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx|js|jsx|json|css|env|yaml|yml|html|md)$/.test(e.name) && e.name !== '.env') continue
      const content = (() => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } })()
      const m = content.match(/\{\{[A-Z_]+\}\}/g)
      if (m) leftover.push(`${path.relative(OUT_DIR, p)}: ${[...new Set(m)].slice(0, 5).join(', ')}`)
    }
  }
  walk(OUT_DIR)
  console.log('\n=== leftover {{TOKENS}} (should be empty) ===')
  if (leftover.length === 0) console.log('(none)')
  else leftover.slice(0, 40).forEach((l) => console.log('  ' + l))

  if (pass < checks.length || leftover.length > 0) process.exit(2)
}

main()
