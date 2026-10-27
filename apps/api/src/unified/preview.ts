/**
 * The free preview on twomiah.com for a trade the unified app is open to: drawn by the unified renderer, so the visitor
 * sees the page a signup really gets, in the look they chose (apps/unified/server/site/signupPreview.ts renderSitePreview).
 *
 * The page is composed the way the signup's build composes it (unified/factory.ts provisionSite: the template composer's
 * pages, nav and settings for the same facts), and the business starts with the colour a signup starts with.
 *
 * The renderer is loaded when the first preview asks, not when the Factory starts: the Factory's other routes never wait
 * on it, and a problem in it is a failed preview, not a Factory that does not boot.
 */
import { engineForSignup, provisionSite, unifiedFeatures, unifiedVerticalFor } from './factory'

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

export async function renderUnifiedPreview(i: { businessName: string; businessType: string; city?: string; state?: string; vertical: string; design: string | null }): Promise<string> {
  const tenant = { name: i.businessName, industry: i.businessType, city: i.city || null, state: i.state || null, primary_color: SIGNUP_DEFAULT_COLOUR, intake_data: {}, products: ['website'] }
  const site: any = provisionSite(tenant)
  const home = (site.pages as any[]).find((p) => p.slug === 'home')
  if (!home) throw new Error('the composer made no home page')
  const { renderSitePreview } = await import('../../../unified/server/site/signupPreview')
  return renderSitePreview({
    vertical: i.vertical, design: i.design,
    company: { name: i.businessName, primaryColor: SIGNUP_DEFAULT_COLOUR },
    settings: { nav: site.nav, photoCredits: site.photoCredits, contentGaps: site.contentGaps, serviceAreas: site.serviceAreas, contactCtaLabel: site.contactCtaLabel, accentColor: site.accentColor },
    sections: home.sections, features: unifiedFeatures(tenant, {}),
  })
}
