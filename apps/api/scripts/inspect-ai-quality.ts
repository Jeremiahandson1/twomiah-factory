// Renders the AI composer against 4 distinct industries with
// realistic intakes and prints a concise summary of what each
// composition picked. Useful for sanity-checking that the composer
// is producing differentiated, on-voice output before launch.
//
// Outputs to stdout — no DB writes, no Stripe, no Render. Just the
// composer's JSON. Token cost: ~4 calls @ ~5k tokens each.
//
// Run: cd apps/api && bun run scripts/inspect-ai-quality.ts
import { composeSite, type ComposerInput } from '../src/services/sectionComposer'

const intakes: ComposerInput[] = [
  {
    businessName: 'Ridge & Field',
    businessType: 'restaurant',
    city: 'Mineral Point',
    state: 'WI',
    description:
      '28-seat dinner house in a 1903 stone building. Driftless-sourced ingredients. Chef Anika Rasmussen runs a four-person line and answers her own phone. ' +
      'Five-course tasting menu, Tuesday through Saturday, $95 ($145 with wine pairings).',
    services: ['Five-course tasting menu', 'Wine pairings from upper-Midwest producers', 'Private events (max 28 guests)'],
    goals: ['Drive reservations'],
    ownerName: 'Anika Rasmussen',
    phone: '608-555-0142',
    email: 'reservations@ridgeandfield.com',
    primaryColor: '#1a1614',
  },
  {
    businessName: 'Northside Care Collective',
    businessType: 'home_care',
    city: 'Eau Claire',
    state: 'WI',
    description:
      'Independent home-care agency serving the Chippewa Valley since 2017. 22 caregivers, all background-checked, all paid above market. ' +
      'Specializes in dementia care and end-of-life support. Family-owned by two registered nurses.',
    services: ['Personal care + bathing', 'Dementia + memory care', 'Companion care', 'Respite for family caregivers', '24-hour support'],
    goals: ['Get inquiries from adult children researching options for aging parents'],
    ownerName: 'Mira + Anthony Lapinski, RN',
    phone: '715-555-0177',
    email: 'hello@northsidecare.com',
    primaryColor: '#6d8b73',
  },
  {
    businessName: 'Stem & Branch',
    businessType: 'dispensary',
    city: 'Ann Arbor',
    state: 'MI',
    description:
      'Cannabis dispensary on State Street since 2021. We curate flower from three small Michigan farms and run a tight rotating menu of edibles and concentrates. ' +
      'Budtenders trained, not just hired — every staff member has a year of cultivation or product background. No volume discounts, no race-to-the-bottom pricing.',
    services: ['Premium flower from MI farms', 'Concentrates + live rosin', 'House-curated edibles', 'Pre-rolls + accessories'],
    goals: ['Get foot traffic from quality-first customers'],
    ownerName: 'Renata Vargas',
    phone: '734-555-0190',
    email: 'hello@stemandbranch.shop',
    primaryColor: '#4a8a5e',
  },
  {
    businessName: 'A+ Services Landscape',
    businessType: 'landscaping',
    city: 'Madison',
    state: 'WI',
    description:
      'Full-service landscape design-build + maintenance crew. We do weekly mowing, paver patios, fall cleanups, and snow contracts. ' +
      "Started by Andre in 2011 after 12 years on someone else's crew. 9 trucks, 14 crew in season.",
    services: ['Weekly lawn maintenance', 'Patio + hardscape design-build', 'Landscape design', 'Snow + ice management', 'Fall + spring cleanups'],
    goals: ['Book design consultations', 'Sign weekly mow contracts'],
    ownerName: 'Andre Stiefel',
    phone: '608-555-0144',
    email: 'office@aplusservices.com',
    primaryColor: '#1f6b3e',
  },
]

function summarizeSections(pages: any) {
  if (!pages) return '(no pages)'
  const out: string[] = []
  for (const [slug, page] of Object.entries(pages)) {
    const p = page as any
    const variants = (p.sections || []).map((s: any) => s.type + '/' + s.variant).join(', ')
    out.push(`    ${slug}: ${variants}`)
  }
  return out.join('\n')
}

function extractFirstHeroCopy(pages: any): string {
  for (const page of Object.values(pages || {})) {
    const sections = (page as any).sections || []
    for (const s of sections) {
      if (s.type === 'hero') {
        const d = s.data || {}
        return `eyebrow: ${d.eyebrow || '(none)'}\n      title:   ${d.title || '(none)'}\n      sub:     ${d.subtitle || '(none)'}`
      }
    }
  }
  return '(no hero section)'
}

async function main() {
  console.log('Running composer against 4 industries…\n')
  for (const intake of intakes) {
    console.log('═══════════════════════════════════════════════════')
    console.log(`▸ ${intake.businessName} — ${intake.businessType}`)
    console.log('═══════════════════════════════════════════════════')
    const t0 = Date.now()
    try {
      const composed = await composeSite(intake)
      const ms = Date.now() - t0
      console.log(`  Composed in ${ms}ms\n`)
      console.log('  Sections per page:')
      console.log(summarizeSections(composed.pages))
      console.log('\n  Home hero copy:')
      console.log('      ' + extractFirstHeroCopy(composed.pages).split('\n').join('\n      '))
      console.log('')
    } catch (e: any) {
      console.log('  ✗ FAILED:', e.message)
    }
  }
  console.log('═══════════════════════════════════════════════════')
  console.log('Done. Eyeball the four heroes above — they should sound')
  console.log('like four genuinely different businesses, not generic SaaS.')
}

main().catch(e => { console.error(e); process.exit(1) })
