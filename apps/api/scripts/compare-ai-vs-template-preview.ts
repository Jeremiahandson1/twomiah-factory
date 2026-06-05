// Renders the same intake through the show-first preview pipeline TWICE —
// once with AI content baked in, once with template-only — so we can
// open both files side by side and judge whether the AI step actually
// improves the out-of-the-box output.
//
// Outputs:
//   ./preview-ai.html          — AI-customized preview
//   ./preview-template.html    — template-only preview
//
// Run from apps/api/. Needs ANTHROPIC_API_KEY (loaded from apps/api/.env
// automatically by Bun, or set in shell).
import fs from 'fs'
import path from 'path'
import { renderHomepagePreview } from '../src/services/previewRenderer'
import { generateWebsiteContent } from '../src/services/contentGenerator'
import { buildBrief, type Intake } from '../src/services/briefBuilder'

const intake: Intake = {
  businessName: 'Madison Lawn Pros',
  businessType: 'landscaping',
  city: 'Madison',
  state: 'WI',
  stateFull: 'Wisconsin',
  email: 'jamie@madisonlawnpros.com',
  phone: '608-555-0142',
  ownerName: 'Jamie Reyes',
  description:
    "Two-truck family-run lawn-care operation focused on Madison's west side. " +
    'Started in 2018, known for never missing a scheduled week and using zero-turn ' +
    'mowers with sharp blades — homeowners say lawns look noticeably cleaner than ' +
    'with the big national chains.',
  serviceRegion: 'Madison metro and surrounding suburbs',
  nearbyCities: ['Middleton', 'Verona', 'Fitchburg', 'Waunakee'],
  services: ['Weekly mowing', 'Spring and fall cleanup', 'Mulch + bed maintenance', 'Aeration and overseeding', 'Snow plowing and salting'],
  goals: ['Book recurring weekly mow customers', 'Win commercial property contracts', 'Look more professional than the one-person operations'],
  competitors: ['turfteamlandscaping.com', 'kgmlandscaping.com'],
  branding: { primaryColor: '#1b4332', secondaryColor: '#0f1a0f' },
} as any

;(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — cannot do the AI half of the comparison.')
    process.exit(1)
  }

  const brief = buildBrief(intake)
  if (!brief.ok) {
    console.error('buildBrief failed:', brief.validation)
    process.exit(1)
  }
  console.log('Template selected:', brief.decision.websiteTemplate, '(theme:', brief.decision.websiteTheme + ')')

  // ── Template-only preview ────────────────────────────────────────────
  console.log('\n[1/2] Rendering template-only preview…')
  const templateOnly = await renderHomepagePreview(JSON.parse(JSON.stringify(brief.config)))
  console.log('Template-only HTML size:', templateOnly.html.length, 'bytes')

  // ── AI-customized preview ────────────────────────────────────────────
  console.log('\n[2/2] Running AI content generation (this will hit Claude)…')
  const t0 = Date.now()
  const aiContent = await generateWebsiteContent({
    businessName: intake.businessName,
    businessType: brief.decision.industry || intake.businessType,
    location: { city: intake.city || '', state: intake.state || '', stateFull: intake.stateFull || '' },
    services: intake.services || [],
    description: intake.description || '',
    colorPalette: { primary: intake.branding?.primaryColor || '', secondary: intake.branding?.secondaryColor || '' },
    serviceRegion: intake.serviceRegion,
    nearbyCities: intake.nearbyCities,
    phone: intake.phone,
    email: intake.email,
    ownerName: intake.ownerName,
    domain: intake.domain,
  })
  const aiMs = Date.now() - t0
  console.log('Claude call took:', aiMs, 'ms')

  const aiConfig = JSON.parse(JSON.stringify(brief.config))
  aiConfig.content = { ...(aiConfig.content || {}), aiGenerated: aiContent }
  const aiPreview = await renderHomepagePreview(aiConfig)
  console.log('AI-customized HTML size:', aiPreview.html.length, 'bytes')

  // ── Save both ────────────────────────────────────────────────────────
  const outDir = path.resolve(__dirname, '..')
  fs.writeFileSync(path.join(outDir, 'preview-template.html'), templateOnly.html)
  fs.writeFileSync(path.join(outDir, 'preview-ai.html'), aiPreview.html)

  // Quick content diff at the JSON level — what did Claude actually
  // change vs the template defaults?
  console.log('\n── AI content summary ─────────────────────────────────')
  if (aiContent.homepage?.hero) {
    console.log('Hero tagline:    ', aiContent.homepage.hero.tagline)
    console.log('Hero title:      ', aiContent.homepage.hero.title)
    console.log('Hero subtitle:   ', aiContent.homepage.hero.subtitle)
  }
  if (Array.isArray(aiContent.services)) {
    console.log('AI services count:', aiContent.services.length)
    for (const s of aiContent.services.slice(0, 3)) {
      console.log('  •', s.name || s.title, '—', (s.shortDescription || s.description || '').slice(0, 90))
    }
  }
  if (aiContent.settings?.defaultMetaTitle) {
    console.log('Meta title:      ', aiContent.settings.defaultMetaTitle)
  }
  if (aiContent.settings?.defaultMetaDescription) {
    console.log('Meta description:', aiContent.settings.defaultMetaDescription)
  }

  console.log('\nOpen these to compare:')
  console.log('  ', path.join(outDir, 'preview-template.html'))
  console.log('  ', path.join(outDir, 'preview-ai.html'))
})()
