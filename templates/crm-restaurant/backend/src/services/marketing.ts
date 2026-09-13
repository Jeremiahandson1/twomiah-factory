// Email marketing — shared implementation (packages/tenant-backend/src/marketing/marketing.ts), vendored into this tenant as
// ../shared. This file only wires the template's tables and mail sender in; index.ts starts the processor from here.
import { createMarketingService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { campaign, contact, emailLog } from '../../db/schema.ts'
import { sendRaw } from './email.ts'

const marketing = createMarketingService({ db, tables: { campaign, contact, emailLog }, sendRaw })

export const startMarketingProcessor = () => marketing.startMarketingProcessor()
export default marketing
