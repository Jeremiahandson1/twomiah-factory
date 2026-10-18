// A vertical is a setting (SPEC §8, RULEBOOK §8): which industry this tenant is, and the handful of things that
// differ by industry. Everything here feeds an option the shared modules already take, so a vertical changes
// words and switches, never code paths.
export interface VerticalSettings {
  /** Stable id, reported to the screens and the mobile app as company.vertical. */
  id: string
  /** What the industry is called, for people. */
  label: string
  /** What this vertical calls each role rung (owner, admin, manager, field, viewer); unset rungs use the shared defaults. */
  roleLabels?: Record<string, string>
  /** Permissions added to a rung's base list, e.g. `{ field: ['contacts:create'] }`. */
  extraRolePermissions?: Record<string, string[]>
  /** What the authenticator app lists two-factor under. */
  mfaIssuer: string
  /**
   * The vertical's feature list in the shared feature registry (packages/tenant-backend featureRegistry), which is
   * keyed by the CRM template name it grew up with ('crm', 'crm-salon'…). Until the registry is keyed by vertical.
   */
  featureSet: string
  /** Exterior Visualizer address, for the verticals that offer it. */
  visionUrl?: () => string | null
  /** The public website. */
  site: SiteSettings
  /**
   * The CRM screens' settings for this vertical: what each shared screen (packages/tenant-ui) is configured with —
   * labels, which sections a record shows, presets. Plain data, handed to the browser in the admin page
   * (http/adminScreens.ts) and typed there (web/src/crm/vertical.ts). The CRM templates kept these as
   * frontend/src/*Config.ts, one copy per template.
   */
  screens: Record<string, unknown>
}

/**
 * The site designs: the distinct looks of the premium template families (site/designs/<id>.css on top of the base).
 * 'classic' is the base alone — the contractor, RV and vet templates all served it, so it is one look, not three.
 */
export const SITE_DESIGNS = ['classic', 'dispensary', 'fieldservice', 'homecare', 'landscaping', 'roofing', 'showcase'] as const
export type SiteDesign = typeof SITE_DESIGNS[number]

/** What the website settings call each design. */
export const SITE_DESIGN_LABELS: Record<SiteDesign, string> = {
  classic: 'Classic', dispensary: 'Dispensary', fieldservice: 'Field service', homecare: 'Home care',
  landscaping: 'Landscaping', roofing: 'Roofing', showcase: 'Showcase',
}

export interface SiteSettings {
  /** The design a new site starts with; the owner's site row can choose another. */
  design: SiteDesign
  /** The words that differ between verticals on the public site. */
  words: {
    /** The contact section's label for the address: "Office" for the trades, "Address" elsewhere. */
    contactAddressLabel: string
    /** What the contact form's message box asks. */
    contactMessageLabel: string
    /** The reply when the message box is sent empty. */
    contactMessageRequired: string
  }
  /** A text-size control in the corner of every page (home care: readers who want larger type). */
  textSizeToggle?: boolean
}

/**
 * The tenant's vertical, from the VERTICAL setting the Factory puts on every tenant (RULEBOOK §9). Production
 * refuses to start without a known one rather than run a business as the wrong industry.
 */
export async function loadVertical(id = process.env.VERTICAL): Promise<VerticalSettings> {
  const known: Record<string, () => Promise<{ default: VerticalSettings }>> = {
    contractor: () => import('../../verticals/contractor/settings.ts'),
  }
  if (!id) {
    if (process.env.NODE_ENV === 'production') throw new Error('VERTICAL is not set')
    id = 'contractor'
  }
  const load = known[id]
  if (!load) throw new Error(`Unknown VERTICAL '${id}'`)
  return (await load()).default
}
