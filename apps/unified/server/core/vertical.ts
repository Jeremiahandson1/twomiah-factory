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
  /** Exterior Visualizer address, for the verticals that offer it. */
  visionUrl?: () => string | null
  /** The public website. */
  site: SiteSettings
}

/** The site designs: each premium template family's look (site/designs/<id>.css; contractor is the base alone). */
export const SITE_DESIGNS = ['contractor', 'dispensary', 'fieldservice', 'homecare', 'landscaping', 'roofing', 'rv', 'showcase', 'vet'] as const
export type SiteDesign = typeof SITE_DESIGNS[number]

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
