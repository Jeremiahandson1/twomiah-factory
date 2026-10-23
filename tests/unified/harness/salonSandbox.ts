// The salon services and utils the salon tests import by the template's paths (server/crm/salon), for the suite
// (salon.ts) and its adapted copies (adapted.ts).
export const SALON_SANDBOX: Record<string, string> = {
  'src/services/loyaltyAward.ts': `
import { crmDeps } from './crmDeps.ts'
import { salonServicesFor } from '@app/server/crm/salon/index.ts'
export const { awardForCompletedVisit, reverseForCancelledVisit, priceForVisit } = salonServicesFor(crmDeps).loyalty
`,
  'src/services/clientFormulas.ts': `
import { crmDeps } from './crmDeps.ts'
import { salonServicesFor } from '@app/server/crm/salon/index.ts'
export { normaliseFormula, hasSubstance, AUTO_VISIT_NOTE, CANCELLED_VISIT_LABEL, REPAIR_MARK } from '@app/server/crm/salon/formulas.ts'
export const { listFormulas, keepFormula, forgetFormula, keepFromRecord, recordForKeeping } = salonServicesFor(crmDeps).formulas
`,
  // The CRM's reviews service by its functions, as the salon template exported them (the shared stub has the default).
  'src/services/reviews.ts': `
import { services } from '../unified.ts'
const s = services.crm.reviews
export const { getReviewSettings, updateReviewSettings, scheduleReviewRequest, scheduleReviewRequestForVisit, sendReviewRequest, processScheduledRequests, sendFollowUp, markReviewCompleted, getReviewStats, getReviewRequests, startReviewProcessor } = s
export default s
`,
  'src/utils/salonDate.ts': `
import { crmDeps } from '../services/crmDeps.ts'
import { salonServicesFor } from '@app/server/crm/salon/index.ts'
// DEFAULT_TZ is gone (fix-e ONE CLOCK): the shop's zone is the company's, companyTimeZone's default when it has none.
export { calendarDateIn, salonDayStart } from '@app/server/crm/salon/days.ts'
export const { salonTimezone, salonToday, salonDayWindows } = salonServicesFor(crmDeps).clock
`,
}
