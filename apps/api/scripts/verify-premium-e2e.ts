// End-to-end smoke test for the premium-website flow without hitting
// Stripe, Render, or Supabase: composer runs against Claude, all four
// pages get rendered via the premium template, every section that
// Claude emitted resolves to a registered EJS partial, and the
// rendered HTML contains the expected scaffold (header, footer,
// nav links, body content).
//
// What this catches:
//   - Composer returning empty or invalid section arrays
//   - A section type the template doesn't have a partial for
//   - The renderer crashing on an unexpected JSON shape
//   - Visible scaffold missing from the rendered HTML
//
// What this does NOT cover:
//   - Stripe Checkout API serialization (no Stripe call)
//   - Supabase row reads/writes (no database)
//   - Render service deployment (no actual deploy)
//   - The seed-photos endpoint behaviour
//
// Needs ANTHROPIC_API_KEY. Run from apps/api:
//   bun run scripts/verify-premium-e2e.ts
import { composeSite, type ComposerInput } from '../src/services/sectionComposer'
import { renderPremiumPage } from '../src/services/premiumSiteRenderer'

const intake: ComposerInput = {
  businessName: 'Westridge Builders',
  businessType: 'general contractor / design-build firm',
  city: 'Madison',
  state: 'WI',
  description:
    "Family-run design-build firm working across Madison, Verona, and the Driftless region since 2008. " +
    'Cap projects at six at a time on purpose — every build is run by the partner the client hired.',
  services: [
    'Design-build custom homes',
    'Whole-house renovations',
    'Detached studios and ADUs',
  ],
  goals: ['Book consultations from qualified leads'],
  ownerName: 'partner-led',
  phone: '608-555-0142',
  email: 'build@westridgebuilders.com',
  nearbyCities: ['Verona', 'Middleton', 'Sun Prairie'],
  primaryColor: '#1a2e22',
}

const PAGES: Array<'home' | 'about' | 'services' | 'contact'> = ['home', 'about', 'services', 'contact']
const PAGE_TITLES: Record<string, string> = { home: 'Home', about: 'About', services: 'Services', contact: 'Contact' }

interface FailureReport { stage: string; detail: string }

;(async () => {
  const fails: FailureReport[] = []

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY required.')
    process.exit(1)
  }

  console.log('[1/3] Composing with Claude…')
  let composed
  try {
    composed = await composeSite(intake)
  } catch (e: any) {
    console.error('FAIL — composer threw:', e.message)
    process.exit(1)
  }

  console.log('[2/3] Validating composition shape…')
  for (const pageName of PAGES) {
    const page = composed.pages[pageName]
    if (!page) { fails.push({ stage: 'composition', detail: pageName + ' missing from composed.pages' }); continue }
    if (!Array.isArray(page.sections)) { fails.push({ stage: 'composition', detail: pageName + ' has no sections array' }); continue }
    if (page.sections.length === 0) { fails.push({ stage: 'composition', detail: pageName + ' has 0 sections' }); continue }
    console.log('  ' + pageName + ': ' + page.sections.map(s => s.type + '/' + s.variant).join(', '))
  }

  console.log('[3/3] Rendering each page through the template…')
  const settings = {
    companyName: intake.businessName,
    phone: intake.phone,
    email: intake.email,
    seoTitle: intake.businessName,
    seoDescription: intake.description,
  }

  for (const pageName of PAGES) {
    try {
      const rendered = await renderPremiumPage(
        { slug: pageName, title: PAGE_TITLES[pageName], sections: composed.pages[pageName].sections },
        settings,
        '/premium-preview-test'  // dummy base path
      )
      const html = rendered.html
      const checks = [
        { test: html.length > 5000, label: 'HTML > 5KB' },
        { test: html.includes('<header'), label: 'has header' },
        { test: html.includes('<footer'), label: 'has footer' },
        { test: html.includes('<main>'), label: 'has main' },
        { test: html.includes(intake.businessName), label: 'includes business name' },
      ]
      for (const c of checks) {
        if (!c.test) fails.push({ stage: 'render-' + pageName, detail: 'missing — ' + c.label })
      }
      console.log('  ' + pageName + '.html → ' + html.length + ' bytes')
    } catch (e: any) {
      fails.push({ stage: 'render-' + pageName, detail: e.message })
    }
  }

  if (fails.length === 0) {
    console.log('\nOK — premium E2E flow passed end-to-end.')
    process.exit(0)
  }
  console.log('\nFAIL — ' + fails.length + ' issue(s):')
  for (const f of fails) console.log('  [' + f.stage + '] ' + f.detail)
  process.exit(1)
})()
