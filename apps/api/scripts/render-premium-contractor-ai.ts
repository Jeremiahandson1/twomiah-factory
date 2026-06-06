// Runs the AI section composer on a sample intake, then renders the
// resulting sections[] through the premium-contractor template. Saves
// the result next to the hand-authored composition-a/b HTML files so
// they can all be opened side by side.
//
// Run from apps/api:
//   bun run scripts/render-premium-contractor-ai.ts
//
// Output:
//   templates/website-premium-contractor/composition-ai.html
//
// Needs ANTHROPIC_API_KEY (loaded from apps/api/.env or shell).
import fs from 'fs'
import path from 'path'
import ejs from 'ejs'
import { composeHomepageSections, type ComposerInput } from '../src/services/sectionComposer'

const ROOT = path.resolve(__dirname, '../../../templates/website-premium-contractor')
const viewsDir = path.join(ROOT, 'views')
const dataDir = path.join(ROOT, 'data')
const buildDir = path.join(ROOT, 'build')

// Same business as the hand-authored composition-a/b samples so we can
// compare AI output against human-authored output for the SAME intake.
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

;(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — cannot run the composer.')
    process.exit(1)
  }

  console.log('Composing homepage with Claude…')
  const t0 = Date.now()
  const composed = await composeHomepageSections(intake)
  console.log('Composer took:', Date.now() - t0, 'ms')

  if (composed.rationale) {
    console.log('\nModel rationale:')
    console.log('  ', composed.rationale)
  }

  console.log('\nSections produced:')
  for (const s of composed.sections) {
    console.log('  •', s.type + '/' + s.variant)
  }

  // Save the JSON for inspection alongside composition-a.json / -b.json.
  const composedPath = path.join(dataDir, 'samples', 'composition-ai.json')
  fs.writeFileSync(composedPath, JSON.stringify({ _note: 'AI-composed homepage for Westridge Builders.', sections: composed.sections }, null, 2))
  console.log('\nSaved AI composition JSON:', composedPath)

  // Render with the same pipeline render-premium-contractor-samples.ts uses.
  const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))
  const homepage = { sections: composed.sections }
  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), { homepage, settings }) as string
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings }) as string

  const inlined = html.replace(/<link\s+rel=["']stylesheet["']\s+href=["']\/styles\/([^"']+)["']\s*\/?>/i, (_m, p) => {
    const cssPath = path.join(buildDir, 'styles', p)
    try { return '<style>\n' + fs.readFileSync(cssPath, 'utf8') + '\n</style>' }
    catch { return _m }
  })

  const outPath = path.join(ROOT, 'composition-ai.html')
  fs.writeFileSync(outPath, inlined)
  console.log('Rendered HTML:', outPath, '(' + inlined.length + ' bytes)')

  console.log('\nCompare all three side by side:')
  console.log('  ', path.join(ROOT, 'composition-a.html'))
  console.log('  ', path.join(ROOT, 'composition-b.html'))
  console.log('  ', path.join(ROOT, 'composition-ai.html'))
})()
