// Recurring invoices — shared implementation (packages/tenant-backend/src/recurring/recurring.ts), vendored as ../shared.
import { createRecurringService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { invoice, invoiceLineItem } from '../../db/schema.ts'
import emailService from './email.ts'

const service = createRecurringService({ db, tables: { invoice, invoiceLineItem }, emailService })
export default service
