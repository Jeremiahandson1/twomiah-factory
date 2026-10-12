// Every write leaves an audit row naming its record, unless its handler wrote its own — the shared floor
// (packages/tenant-backend/src/audit/writeFloor.ts), wired to this template's db, schema and audit service.
// Mounted in index.ts directly after requestScope opens, so it can see audit.log's mark. (T59; store T3)
//
// What is particular to the store, each an option the floor takes:
//   tenantless       one business per database — users carry no companyId
//   nameColumns      an order is called by its orderNumber, a variant by its sku, a code by its code
//   unwrapSingleKey  replies wrap the record: { order: {…} }, { product: {…} }
//   entityOf         the tables are plural (orders, productVariants); the log files them singular
import { createWriteAuditFloor } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import * as schema from '../../db/schema.ts'
import audit, { requestScope } from '../services/audit.ts'

const KEEP_PLURAL = new Set(['storeSettings'])
export const entityOf = (tableKey: string) =>
  (KEEP_PLURAL.has(tableKey) ? tableKey : tableKey.replace(/s$/, '')).replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase())

export const writeAudit = createWriteAuditFloor({
  db, schema, log: audit.log, scope: requestScope,
  tenantless: true,
  nameColumns: ['orderNumber', 'sku', 'code'],
  unwrapSingleKey: true,
  entityOf,
})
