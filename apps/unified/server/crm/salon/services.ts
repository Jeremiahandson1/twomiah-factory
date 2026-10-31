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
import { createVisitClosing } from './visit.ts'
import { createBookScope } from './bookScope.ts'
import { createCardOnFile } from './cardOnFile.ts'
import { createPatchTests } from './patchTests.ts'

export function createSalonServices(d: CrmDeps) {
  const clock = createSalonClock(d.db)
  const checkout = createSalonCheckout(d)
  const loyalty = createLoyaltyAward(d.db)
  const cards = createCardOnFile(d, clock)
  return {
    clock,
    checkout,
    formulas: createClientFormulas(d.db),
    loyalty,
    /** Closing a visit, one way, for the appointment and the logged service (visit.ts). */
    visits: createVisitClosing(d, checkout, loyalty),
    memberships: createMembershipBilling(d, clock, checkout, cards),
    rebooking: createRebookingDue(d.db, clock),
    /** Whose chairs a seat sees in The Book: the owner's "own appointments only" switch (bookScope.ts). */
    book: createBookScope(d.db, d.permissions),
    /** A client's patch tests, as a history (patchTests.ts). */
    patchTests: createPatchTests(d.db, clock),
    /** Cards kept on file and the no-show / late-cancel fees charged to them (cardOnFile.ts). */
    cards,
  }
}

export type SalonServices = ReturnType<typeof createSalonServices>
