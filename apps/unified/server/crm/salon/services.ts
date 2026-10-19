// The salon's own services, built once from the CRM's dependencies and shared by its routers: the shop's clock, the
// sale a visit raises, the client's kept formulas, loyalty on a visit, membership billing and who is due back.
// (templates/crm-salon/backend/src/services: salonCheckout, clientFormulas, loyaltyAward, membershipBilling, rebookingDue;
// utils/salonDate.)
import type { CrmDeps } from '../deps.ts'
import { createSalonClock } from './days.ts'
import { createSalonCheckout } from './checkout.ts'
import { createClientFormulas } from './formulas.ts'
import { createLoyaltyAward } from './loyaltyAward.ts'
import { createMembershipBilling } from './membershipBilling.ts'
import { createRebookingDue } from './rebookingDue.ts'

export function createSalonServices(d: CrmDeps) {
  const clock = createSalonClock(d.db)
  const checkout = createSalonCheckout(d)
  return {
    clock,
    checkout,
    formulas: createClientFormulas(d.db),
    loyalty: createLoyaltyAward(d.db),
    memberships: createMembershipBilling(d, clock, checkout),
    rebooking: createRebookingDue(d.db, clock),
  }
}

export type SalonServices = ReturnType<typeof createSalonServices>
