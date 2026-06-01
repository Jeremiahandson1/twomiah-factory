/**
 * Brief Builder — the "be like me" decision core.
 *
 * Turns a plain-language intake into a verified-safe GenerateConfig the
 * factory can consume. Pure + deterministic (no I/O, no network) so it is
 * unit-testable and the LLM/wizard layers just call into it.
 *
 * SAFETY CONTRACT: every value this can emit is checked against an allowlist
 * derived from the audited factory enums. resolveWebsiteTemplate() mirrors
 * generator.ts EXACTLY so the validator and the generator never disagree.
 */
import type { GenerateConfig } from './generator'

// ── Verified enums (audited against generator.ts / themes on disk) ──────────────
export const SHOWCASE_INDUSTRIES = ['food', 'hospitality', 'fitness', 'beauty', 'events'] as const
export const KNOWN_INDUSTRIES = [
  'home_care', 'field_service', 'dispensary', 'landscaping', 'roofing',
  'general_contractor', 'automotive', 'other', ...SHOWCASE_INDUSTRIES,
] as const
export type IndustryToken = typeof KNOWN_INDUSTRIES[number]

// industry → website template — MUST mirror generator.ts:138-143 exactly.
export function resolveWebsiteTemplate(industry: string): string {
  if (industry === 'home_care') return 'website-homecare'
  if (['hvac', 'plumbing', 'electrical', 'field_service'].includes(industry)) return 'website-fieldservice'
  if (industry === 'dispensary') return 'website-dispensary'
  if (industry === 'landscaping') return 'website-landscaping'
  if ((SHOWCASE_INDUSTRIES as readonly string[]).includes(industry)) return 'website-showcase'
  if (industry && industry !== 'other') return 'website-contractor'
  return 'website-general'
}

// Valid theme ids per template (audited from templates/<t>/build/styles/themes).
export const THEME_ALLOW: Record<string, string[]> = {
  'website-showcase': ['warm-bold', 'midnight-neon', 'clean-spotlight'],
  'website-homecare': ['warm-community', 'clean-professional', 'family-modern'],
  'website-contractor': ['bold-industrial', 'modern-minimal', 'professional-corporate'],
  'website-fieldservice': ['bold-industrial', 'modern-minimal', 'professional-corporate'],
  'website-landscaping': ['bold-industrial', 'modern-minimal', 'professional-corporate'],
  'website-dispensary': ['glassmorphism-dark', 'botanical-organic', 'streetwear-bold'],
  'website-general': ['clean-minimal', 'bold-contrast', 'trade-professional'],
}
export const ALL_WEBSITE_FEATURES = ['blog', 'gallery', 'testimonials', 'services_pages', 'contact_form', 'visualizer'] as const
export const ALLOWED_PRODUCTS = ['website', 'crm', 'cms', 'pricing'] as const

// ── Intake (what the wizard/agent collects) ─────────────────────────────────────
export interface Intake {
  businessName: string
  businessType: string                 // free text: "food truck", "general contractor"…
  city?: string; state?: string; stateFull?: string
  phone?: string; email?: string; domain?: string; ownerName?: string
  serviceRegion?: string; description?: string; siteUrl?: string
  nearbyCities?: string[]              // manual "areas you serve" list; placeholders shown if empty
  goals?: string[]                     // e.g. ['orders','leads','bookings','info']
  competitors?: string[]
  branding?: { primaryColor?: string; secondaryColor?: string; accentColor?: string; offWhiteColor?: string; logo?: string }
  services?: string[]
  wantsCrm?: boolean                   // explicit opt-in; default by archetype
}

interface Decision {
  archetype: 'showcase' | 'trust' | 'care' | 'utilitarian' | 'transactional' | 'neutral'
  industry: IndustryToken
  websiteTemplate: string
  websiteTheme: string
  products: string[]
  websiteFeatures: string[]
  reason: string
}

// ── The policy ("be like me") ───────────────────────────────────────────────────
// Word-boundary (prefix) match so stems still hit ("landscap" → "landscaping")
// but substrings never false-positive ("remodeling" must NOT match "deli").
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const RX = (t: string, words: string[]) => words.some(w => new RegExp('\\b' + esc(w)).test(t))

function classify(businessType: string): { archetype: Decision['archetype']; industry: IndustryToken } {
  const t = (businessType || '').toLowerCase()
  if (RX(t, ['home care', 'homecare', 'senior', 'caregiv', 'in-home', 'assisted living'])) return { archetype: 'care', industry: 'home_care' }
  if (RX(t, ['hvac', 'plumb', 'electric', 'heating', 'cooling', 'furnace'])) return { archetype: 'utilitarian', industry: 'field_service' }
  if (RX(t, ['dispensary', 'cannabis', 'weed', 'marijuana', 'cbd'])) return { archetype: 'showcase', industry: 'dispensary' }
  if (RX(t, ['landscap', 'lawn', 'snow', 'tree service', 'hardscap'])) return { archetype: 'utilitarian', industry: 'landscaping' }
  if (RX(t, ['roof', 'gutter', 'siding'])) return { archetype: 'trust', industry: 'roofing' }
  if (RX(t, ['dealer', 'auto sales', 'used car', 'car lot', 'automotive'])) return { archetype: 'trust', industry: 'automotive' }
  // Construction/trade signals are unambiguous — checked BEFORE the showcase
  // buckets so "kitchen remodeling contractor" is a contractor, not a café.
  if (RX(t, ['contractor', 'construction', 'remodel', 'renovat', 'builder', 'handyman', 'concrete', 'painter', 'fenc', 'deck', 'flooring', 'drywall', 'mason', 'general trade'])) return { archetype: 'trust', industry: 'general_contractor' }
  if (RX(t, ['food', 'restaurant', 'cafe', 'coffee', 'bakery', 'food truck', 'catering', 'bbq', 'taco', 'pizza', 'eatery', 'deli', 'diner', 'grill'])) return { archetype: 'showcase', industry: 'food' }
  if (RX(t, ['hotel', 'bar', 'pub', 'brewery', 'nightclub', 'lounge', 'venue', 'hospitality', 'resort'])) return { archetype: 'showcase', industry: 'hospitality' }
  if (RX(t, ['gym', 'fitness', 'yoga', 'pilates', 'crossfit', 'training', 'studio', 'martial'])) return { archetype: 'showcase', industry: 'fitness' }
  if (RX(t, ['salon', 'spa', 'beauty', 'barber', 'nails', 'lash', 'esthet', 'tattoo', 'med spa'])) return { archetype: 'showcase', industry: 'beauty' }
  if (RX(t, ['event', 'dj', 'photograph', 'wedding', 'florist', 'planner', 'entertainment'])) return { archetype: 'showcase', industry: 'events' }
  return { archetype: 'neutral', industry: 'other' }
}

function pickTheme(industry: IndustryToken, template: string, goals: string[]): string {
  if (template === 'website-showcase') {
    if (industry === 'fitness' || industry === 'events') return 'midnight-neon'
    if (industry === 'beauty') return 'clean-spotlight'
    return 'warm-bold'
  }
  if (template === 'website-contractor' && industry === 'roofing') return 'professional-corporate'
  return THEME_ALLOW[template][0] // each template's first entry is its sensible default
}

export function decide(intake: Intake): Decision {
  const { archetype, industry } = classify(intake.businessType)
  const websiteTemplate = resolveWebsiteTemplate(industry)
  const goals = intake.goals || []
  const websiteTheme = pickTheme(industry, websiteTemplate, goals)

  // CRM: never auto-pair for showcase/neutral; never pair with automotive
  // (would route to the PARKED crm-automotive). Trust/care/utilitarian get a
  // CRM by default unless explicitly declined.
  const crmEligible = ['care', 'trust', 'utilitarian'].includes(archetype) && industry !== 'automotive'
  const wantsCrm = intake.wantsCrm ?? crmEligible
  const products = ['website', ...(wantsCrm && crmEligible ? ['crm'] : [])]

  // Feature set: showcase leans visual; everyone else uses the generator's
  // full default (we omit the array → generator enables all).
  const websiteFeatures = archetype === 'showcase'
    ? ['gallery', 'testimonials', 'contact_form', ...(intake.services?.length ? ['services_pages'] : [])]
    : [...ALL_WEBSITE_FEATURES]

  const reason =
    `"${intake.businessType}" → ${archetype} archetype → industry='${industry}' → ` +
    `${websiteTemplate} (theme '${websiteTheme}'), products=[${products.join(', ')}]` +
    (industry === 'automotive' ? '. CRM withheld — crm-automotive is parked.' : '')

  return { archetype, industry, websiteTemplate, websiteTheme, products, websiteFeatures, reason }
}

// ── Compose a GenerateConfig from the decision + intake ─────────────────────────
export function buildConfig(intake: Intake, d: Decision): GenerateConfig {
  return {
    products: d.products,
    websiteTheme: d.websiteTheme,
    company: {
      name: intake.businessName,
      email: intake.email,
      phone: intake.phone,
      city: intake.city,
      state: intake.state,
      stateFull: intake.stateFull,
      domain: intake.domain,
      ownerName: intake.ownerName,
      industry: d.industry,
      serviceRegion: intake.serviceRegion,
      nearbyCities: intake.nearbyCities,
      description: intake.description,
      siteUrl: intake.siteUrl,
    },
    branding: {
      primaryColor: intake.branding?.primaryColor,
      secondaryColor: intake.branding?.secondaryColor,
      logo: intake.branding?.logo,
      websiteTheme: d.websiteTheme,
    },
    features: { website: d.websiteFeatures },
    content: intake.services?.length ? { services: intake.services } : undefined,
  }
}

// ── Hard allowlist validator (defense-in-depth: /generate has no schema) ────────
export function validateConfig(cfg: GenerateConfig): { ok: boolean; errors: string[] } {
  const e: string[] = []
  if (!cfg.company?.name?.trim()) e.push('company.name is required')
  const ind = cfg.company?.industry || ''
  if (!(KNOWN_INDUSTRIES as readonly string[]).includes(ind)) e.push(`industry '${ind}' is not an allowed token`)
  const tpl = resolveWebsiteTemplate(ind)
  if (!THEME_ALLOW[tpl]) e.push(`resolved template '${tpl}' is unknown`)
  const theme = cfg.websiteTheme || cfg.branding?.websiteTheme
  if (theme && THEME_ALLOW[tpl] && !THEME_ALLOW[tpl].includes(theme))
    e.push(`theme '${theme}' is not valid for ${tpl} (would silently no-op)`)
  for (const p of cfg.products || []) {
    const base = p.startsWith('crm') ? 'crm' : p
    if (!(ALLOWED_PRODUCTS as readonly string[]).includes(base)) e.push(`product '${p}' not allowed`)
  }
  const hasCrm = (cfg.products || []).some(p => p === 'crm' || p.startsWith('crm-'))
  if (hasCrm && ind === 'automotive') e.push('refusing crm + automotive → parked crm-automotive template')
  for (const f of cfg.features?.website || [])
    if (!(ALL_WEBSITE_FEATURES as readonly string[]).includes(f)) e.push(`website feature '${f}' not allowed`)
  return { ok: e.length === 0, errors: e }
}

export function buildBrief(intake: Intake): {
  ok: boolean
  decision: Decision
  config: GenerateConfig
  validation: { ok: boolean; errors: string[] }
} {
  const decision = decide(intake)
  const config = buildConfig(intake, decision)
  const validation = validateConfig(config)
  return { ok: validation.ok, decision, config, validation }
}
