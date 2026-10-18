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
