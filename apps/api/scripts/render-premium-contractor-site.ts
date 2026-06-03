// Runs the multi-page composer on a sample intake and renders all four
// pages (home, about, services, contact) as standalone HTML files with
// working nav between them. Open index.html in a browser — you can
// navigate the whole site locally.
//
// Run from apps/api:
//   bun run scripts/render-premium-contractor-site.ts
//
// Outputs:
//   templates/website-premium-contractor/index.html
//   templates/website-premium-contractor/about.html
//   templates/website-premium-contractor/services.html
//   templates/website-premium-contractor/contact.html
//
// Needs ANTHROPIC_API_KEY (loaded from apps/api/.env or shell).
import fs from 'fs'
import path from 'path'
import ejs from 'ejs'
import { composeSite, type ComposerInput } from '../src/services/sectionComposer'

const ROOT = path.resolve(__dirname, '../../../templates/website-premium-contractor')
const viewsDir = path.join(ROOT, 'views')
const dataDir = path.join(ROOT, 'data')
const buildDir = path.join(ROOT, 'build')

// Same Westridge Builders intake as the single-page sample so we can
// judge the AI's multi-page output against the single-page output too.
const intake: ComposerInput = {
  businessName: 'Westridge Builders',
  businessType: 'general contractor / design-build firm',
  city: 'Madison',
  state: 'WI',
  description:
    "Family-run design-build firm working across Madison, Verona, and the Driftless region since 2008. " +
    'Cap projects at six at a time on purpose — every build is run by the partner the client hired. ' +
    'Known for fixed-fee feasibility studies, transparent construction billing, and energy-recovery ' +
    'ventilation standard on every home. 62 homes built, 4.9-star rating, average change orders of $0.',
  services: [
    'Design-build custom homes (14–18 month projects)',
    'Whole-house renovations on older buildings',
    'Detached studios, guest cottages, ADUs',
  ],
  goals: [
    'Book design-build consultations from qualified leads',
    'Demonstrate calmness, craft, and longevity vs flashier competitors',
    'Make it clear we are not a mass-production builder',
  ],
  ownerName: 'partner-led',
  phone: '608-555-0142',
  email: 'build@westridgebuilders.com',
  nearbyCities: ['Verona', 'Middleton', 'Sun Prairie'],
  primaryColor: '#1a2e22',
}

const PAGE_FILES: Record<string, string> = {
  home: 'index.html',
  about: 'about.html',
  services: 'services.html',
  contact: 'contact.html',
}

;(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — cannot run the composer.')
    process.exit(1)
  }

  console.log('Composing 4-page site with Claude…')
  const t0 = Date.now()
  const site = await composeSite(intake)
  console.log('Composer took:', Date.now() - t0, 'ms')

  if (site.rationale) console.log('\nModel rationale:\n  ', site.rationale)

  console.log('\nSections per page:')
  for (const [pageName, page] of Object.entries(site.pages)) {
    console.log('  ' + pageName + ':')
    for (const s of page.sections) console.log('    •', s.type + '/' + s.variant)
  }

  const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))

  for (const [pageName, page] of Object.entries(site.pages)) {
    const outName = PAGE_FILES[pageName]
    if (!outName) continue
    const homepage = { sections: page.sections }
    const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), { homepage, settings }) as string
    const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings, currentPath: outName }) as string

    const inlined = html.replace(/<link\s+rel=["']stylesheet["']\s+href=["']\/styles\/([^"']+)["']\s*\/?>/i, (_m, p) => {
      const cssPath = path.join(buildDir, 'styles', p)
      try { return '<style>\n' + fs.readFileSync(cssPath, 'utf8') + '\n</style>' }
      catch { return _m }
    })

    const outPath = path.join(ROOT, outName)
    fs.writeFileSync(outPath, inlined)
    console.log('Rendered', outName, '(' + inlined.length + ' bytes)')
  }

  console.log('\nOpen the site in a browser:')
  console.log('  ', path.join(ROOT, 'index.html'))
  console.log('  Nav across about / services / contact uses relative .html links.')
})()
