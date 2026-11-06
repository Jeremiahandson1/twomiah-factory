// Which roles see commissions, set per company (roofing parity row 4; docs/parity/roof-commissions-costing.md #12): AccuLynx lets a
// company choose. The owner and admin always see everyone's commissions and the pay structure; the roles below them see them when the
// company's money rules (roof_money_setting.commission_viewer_roles) list them — by default the manager, as it always was. Everyone
// always sees their OWN earnings, whatever is chosen.
//
// Done through the shared permissions (createPermissions' companyGrants), so every guard, the login payload and View As agree: a role
// in the list is granted commissions:read; a choosable role left out is refused it ("-commissions:read"). A person's own grants
// (Settings › Users) are not touched, and a role is never granted anything else.
import { eq } from 'drizzle-orm'
import { roofMoneySetting, user } from '../../db/schema/index.ts'
import { COMMISSION_VIEWER_CHOICES, DEFAULT_COMMISSION_VIEWERS } from './moneySettings.ts'

export function createCommissionViewerGrants(db: any, normalizeRole: (role: string) => string) {
  return async (userId: string): Promise<string[]> => {
    const [me] = await db.select({ role: user.role, companyId: user.companyId }).from(user).where(eq(user.id, userId)).limit(1)
    const role = me ? normalizeRole(me.role) : ''
    if (!me || !(COMMISSION_VIEWER_CHOICES as readonly string[]).includes(role)) return []
    const [row] = await db.select({ roles: roofMoneySetting.commissionViewerRoles }).from(roofMoneySetting).where(eq(roofMoneySetting.companyId, me.companyId)).limit(1)
    const chosen: string[] = Array.isArray(row?.roles) ? (row!.roles as string[]) : DEFAULT_COMMISSION_VIEWERS
    return chosen.includes(role) ? ['commissions:read'] : ['-commissions:read']
  }
}
