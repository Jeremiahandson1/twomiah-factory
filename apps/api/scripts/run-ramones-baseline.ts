/**
 * Runs the Factory generator with a Ramone's brief and extracts the result
 * for side-by-side comparison with the hand-built ramones-ice-cream-mockup.
 *
 * Run from TwomiahFactory/apps/api:
 *   bun run scripts/run-ramones-baseline.ts
 */

import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import { generate, type GenerateConfig } from '../src/services/generator'

const OUT_DIR = path.resolve(process.cwd(), '..', '..', '..', 'ramones-ice-cream-mockup', 'factory-baseline')

const config: GenerateConfig = {
  products: ['website'],
  // Real Ramone's info we already gathered
  company: {
    name: "Ramone's Ice Cream Parlor",
    legalName: "Ramone's Ice Cream Parlor",
    email: 'hello@ramonesicecream.com',
    adminEmail: 'admin@ramonesicecream.com',
    phone: '(715) 895-8186',
    address: '503 Galloway St',
    city: 'Eau Claire',
    state: 'WI',
    stateFull: 'Wisconsin',
    zip: '54703',
    domain: 'ramonesicecream.com',
    siteUrl: 'https://ramonesicecream.com',
    industry: 'food', // SHOWCASE_INDUSTRIES → routes to website-showcase
    serviceRegion: 'Eau Claire and the Chippewa Valley',
    nearbyCities: ['Altoona', 'Chippewa Falls', 'Menomonie'],
    description:
      "Family-owned old-fashioned ice cream parlor in downtown Eau Claire since 2017. " +
      "Serving super-premium Chocolate Shoppe of Madison ice cream (70+ rotating flavors), " +
      "fresh-baked waffle cones, hand-dipped sundaes, shakes, malts, ice cream pies, and Sprecher craft sodas.",
    heroTagline: 'Old-fashioned scoops with Wisconsin soul.',
  },
  branding: {
    // Sampled directly from the real logo
    primaryColor: '#C8302E',   // cherry red
    secondaryColor: '#1A1A1A', // brand black
    websiteTheme: 'warm-bold', // showcase theme option per memory
  },
  features: {
    website: ['blog', 'gallery', 'testimonials', 'services_pages', 'contact_form'],
  },
  content: {
    services: [
      'Hand-dipped Cones',
      'Sundaes',
      'Shakes & Malts',
      'Ice Cream Pies',
      'Sprecher Craft Sodas',
      'Catering',
    ],
  },
}

async function main() {
  console.log('=== Running Factory generator for Ramone\'s ===\n')
  console.log('Industry:', config.company.industry, '→ should route to website-showcase')
  console.log('Theme:', config.branding.websiteTheme)
  console.log('Brand colors:', config.branding.primaryColor, '+', config.branding.secondaryColor)
  console.log()

  let result
  try {
    result = await generate(config)
  } catch (err: any) {
    console.error('GENERATE FAILED:', err.message)
    console.error(err.stack)
    process.exit(1)
  }

  console.log('Factory output:')
  console.log('  zip:    ', result.zipPath)
  console.log('  name:   ', result.zipName)
  console.log('  buildId:', result.buildId)
  console.log('  slug:   ', result.slug)
  console.log()

  // Clear previous extract
  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const zip = new AdmZip(result.zipPath)
  zip.extractAllTo(OUT_DIR, true)
  console.log('Extracted to:', OUT_DIR)
  console.log()

  // Summarize what was produced
  function walk(dir: string, depth = 0, max = 3): string[] {
    if (depth > max) return []
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const p = path.join(dir, entry.name)
      const rel = path.relative(OUT_DIR, p)
      out.push((entry.isDirectory() ? '📁 ' : '   ') + rel)
      if (entry.isDirectory()) out.push(...walk(p, depth + 1, max))
    }
    return out
  }
  const tree = walk(OUT_DIR)
  console.log('=== Factory output tree (depth 3) ===')
  tree.slice(0, 80).forEach(l => console.log(l))
  if (tree.length > 80) console.log(`...and ${tree.length - 80} more entries`)
  console.log()
  console.log('Total files extracted:', tree.filter(l => !l.startsWith('📁')).length)
}

main()
