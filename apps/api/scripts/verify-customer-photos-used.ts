// Validates that customer-supplied photos actually appear in the
// composed section data. The composer prompt says 'Tier 1 customer
// photos beat Tier 2 stock', but until you check the rendered output
// you don't really know if the model is honoring the priority.
//
// We feed composeSite a small set of fake customer photo URLs with
// distinctive tags ('PHOTO_TIER_TEST_<n>'), then crawl every section
// in every page and count how many image fields reference them.
//
// Pass criterion: at least 50% of image fields use the customer photos
// when a relevant tag is provided. Fail prints which sections fell back
// to placeholders.
//
// Run: cd apps/api && bun run scripts/verify-customer-photos-used.ts
import { composeSite, type ComposerInput } from '../src/services/sectionComposer'

const customerPhotos = [
  { url: 'https://photos.test/CUSTOMER_HERO.jpg', tag: 'hero', alt: 'flagship project' },
  { url: 'https://photos.test/CUSTOMER_TEAM.jpg', tag: 'team', alt: 'crew portrait' },
  { url: 'https://photos.test/CUSTOMER_SERVICE_1.jpg', tag: 'services', alt: 'service example 1' },
  { url: 'https://photos.test/CUSTOMER_SERVICE_2.jpg', tag: 'services', alt: 'service example 2' },
  { url: 'https://photos.test/CUSTOMER_PROJECT.jpg', tag: 'projects', alt: 'recent project' },
]

const intake: ComposerInput = {
  businessName: 'Westridge Builders',
  businessType: 'general_contractor',
  city: 'Madison',
  state: 'WI',
  description: 'Partner-led design-build firm in Madison. We cap at six active projects.',
  services: ['Custom homes', 'Whole-house renovations', 'Detached studios + ADUs'],
  goals: ['Book consultations from qualified leads'],
  ownerName: 'Marta Holm',
  phone: '608-555-0142',
  email: 'hello@westridge.test',
  primaryColor: '#1a2e22',
  customerPhotos,
}

function collectImageFields(sectionData: any): string[] {
  if (!sectionData || typeof sectionData !== 'object') return []
  const urls: string[] = []
  if (typeof sectionData.image === 'string') urls.push(sectionData.image)
  if (typeof sectionData.portrait === 'string') urls.push(sectionData.portrait)
  if (Array.isArray(sectionData.items)) {
    for (const it of sectionData.items) if (typeof it?.image === 'string') urls.push(it.image)
  }
  if (Array.isArray(sectionData.members)) {
    for (const m of sectionData.members) if (typeof m?.portrait === 'string') urls.push(m.portrait)
  }
  return urls
}

async function main() {
  console.log('Composing with 5 customer photos…')
  const composed = await composeSite(intake)

  const customerUrls = new Set(customerPhotos.map(p => p.url))
  let total = 0, used = 0
  const placeholderSamples: Array<{ page: string; type: string; url: string }> = []

  for (const [pageName, page] of Object.entries(composed.pages)) {
    for (const section of (page.sections || [])) {
      const urls = collectImageFields(section.data)
      for (const u of urls) {
        total++
        if (customerUrls.has(u)) {
          used++
        } else {
          placeholderSamples.push({ page: pageName, type: section.type + '/' + section.variant, url: u })
        }
      }
    }
  }

  const pct = total ? Math.round((used / total) * 100) : 0
  console.log(`\nImage fields total: ${total}`)
  console.log(`Customer photos used: ${used} (${pct}%)`)
  console.log(`Placeholders used: ${total - used}\n`)

  if (placeholderSamples.length > 0) {
    console.log('Sections that fell back to non-customer URLs:')
    for (const s of placeholderSamples.slice(0, 12)) {
      console.log('  ' + s.page.padEnd(10) + ' ' + s.type.padEnd(28) + ' → ' + s.url)
    }
  }

  if (pct < 50) {
    console.log('\n✗ Customer photo usage below 50%. Composer is preferring placeholders over Tier 1 photos.')
    process.exit(1)
  }
  console.log('\n✓ Composer is honoring customer photos.')
}

main().catch(e => { console.error(e); process.exit(1) })
