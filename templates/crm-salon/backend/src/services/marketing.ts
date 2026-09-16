// Email marketing — shared implementation (packages/tenant-backend/src/marketing/marketing.ts), vendored into this tenant as
// ../shared. This file only wires the template's tables and mail sender in; index.ts starts the processor from here.
import { createMarketingService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { campaign, contact, emailLog } from '../../db/schema.ts'
import { sendRaw } from './email.ts'
import { isFeatureEnabled } from '../middleware/enabledFeature.ts'

// isFeatureEnabled: a campaign or drip due after Email Marketing was switched off is not sent (T15 M5).
const marketing = createMarketingService({ db, tables: { campaign, contact, emailLog }, sendRaw, isFeatureEnabled })

export const startMarketingProcessor = () => marketing.startMarketingProcessor()
export default marketing
