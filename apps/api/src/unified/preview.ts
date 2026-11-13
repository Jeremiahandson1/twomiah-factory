/**
 * The free preview on twomiah.com for a trade the unified app is open to: drawn by the unified renderer, so the visitor
 * sees the page a signup really gets, in the look they chose (apps/unified/server/site/signupPreview.ts renderSitePreview).
 *
 * The page is composed the way the signup's build composes it (unified/factory.ts provisionSite: the template composer's
 * pages, nav and settings for the same facts), and the business starts with the colour a signup starts with.
 *
 * The preview — and only the preview — is then filled with clearly marked SAMPLE sections (config/previewSamples.ts) so it
 * looks like a full site; the build above never sees them, and the page carries a banner saying so.
 *
 * The renderer is loaded when the first preview asks, not when the Factory starts: the Factory's other routes never wait
 * on it, and a problem in it is a failed preview, not a Factory that does not boot.
 */
import { engineForSignup, provisionSite, unifiedFeatures, unifiedVerticalFor } from './factory'
import { SAMPLE_BANNER, sampleSetFor, withPreviewSamples } from '../config/previewSamples'
import { collectImageUrls, heroCreditsForUrls, pickHeroGroup } from '../config/heroLibrary'
import { lookForVertical } from '../config/siteLooks'
import { nameSeed } from '../services/instantComposer'
import type { SiteDesign } from '../../../unified/server/core/vertical'

/** The colour a signup starts with when the form sends none (routes/factory/intake.ts POST /public/signup). */
export const SIGNUP_DEFAULT_COLOUR = '#FF3D00'

/**
 * The unified vertical a preview for this trade is drawn as, or null: the trade is not one the unified app is open to
 * (UNIFIED_SIGNUPS and UNIFIED_LIVE_VERTICALS, as a real signup of it would be decided), so it keeps the preview it has.
 */
export function unifiedPreviewVertical(businessType: string): string | null {
  const vertical = unifiedVerticalFor(businessType)
  if (!vertical) return null
  return engineForSignup({ industry: businessType, email: null }) === 'unified' ? vertical : null
}

/**
 * A bar's Tonight board reads the night as it is (kitchen, bar, taps, the game, today's special): the preview has no bar
 * behind it, so the board is filled with a SAMPLE night — every value says so, and none is a fact about a business.
 * Only the preview passes it; a real bar's board reads its own CRM.
 */
const SAMPLE_BAR_NIGHT = {
  site: {},
  live: {
    timezone: 'America/Chicago', generatedAt: new Date(0).toISOString(), updatedBy: 'Sample board',
    kitchen: { isOpen: true, short: 'Sample hours', countdown: '', closesAt: '', opensAt: '' },
    bar: { isOpen: true, short: 'Sample hours', countdown: '', closesAt: '', opensAt: '' },
    taps: { count: 3, featured: [{ name: 'Sample lager' }, { name: 'Sample ale' }, { name: 'Sample stout' }] },
    game: { isToday: true, away: 'Sample team', home: 'Sample team', startsAtLabel: 'sample time', note: 'the game you put on the screens' },
    special: { title: 'Sample special', price: 'Sample price', description: 'your own, set from behind the bar' },
    room: { status: 'steady', label: 'Sample: how busy it is' },
    note: 'Sample board — a real one shows your own hours, taps and specials, live.',
  },
}

export async function renderUnifiedPreview(i: { businessName: string; businessType: string; city?: string; state?: string; vertical: string; design: string | null }): Promise<string> {
  const tenant = { name: i.businessName, industry: i.businessType, city: i.city || null, state: i.state || null, primary_color: SIGNUP_DEFAULT_COLOUR, intake_data: {}, products: ['website'] }
  const site: any = provisionSite(tenant)
  const home = (site.pages as any[]).find((p) => p.slug === 'home')
  if (!home) throw new Error('the composer made no home page')
  // The samples are the trade's own (a food truck runs as a restaurant and a painter as field service, but neither looks
  // like one), and vary with the business's name as its real page does: two bars are not the same page.
  const set = sampleSetFor(pickHeroGroup(i.businessType), i.vertical)
  const samples = withPreviewSamples(home.sections, set, undefined, nameSeed(i.businessName.trim()))
  // The self-hosted stock the samples use must be credited like anywhere else it is shown.
  const credits = heroCreditsForUrls(collectImageUrls(samples.imageUrls))
  const { renderSitePreview } = await import('../../../unified/server/site/signupPreview')
  return renderSitePreview({
    // A bar is drawn in the bar look nearest the one chosen, as its signup is built (config/siteLooks.ts).
    vertical: i.vertical, design: lookForVertical(i.vertical, i.design as SiteDesign | null),
    ...(i.vertical === 'bar' ? { facts: SAMPLE_BAR_NIGHT } : {}),
    company: { name: i.businessName, primaryColor: SIGNUP_DEFAULT_COLOUR },
    settings: { nav: site.nav, photoCredits: [...(site.photoCredits || []), ...credits], contentGaps: site.contentGaps, serviceAreas: site.serviceAreas, contactCtaLabel: site.contactCtaLabel, accentColor: site.accentColor },
    sections: samples.sections, features: unifiedFeatures(tenant, {}), banner: SAMPLE_BANNER,
  })
}
