// Every write leaves an audit row naming its record, unless its handler wrote its own — the shared floor
// (packages/tenant-backend/src/audit/writeFloor.ts), wired to this template's db, schema and audit
// service. Mounted in index.ts directly after requestScope opens, so it can see audit.log's mark. (T59)
import { createWriteAuditFloor } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import * as schema from '../../db/schema.ts'
import audit, { requestScope } from '../services/audit.ts'

export const writeAudit = createWriteAuditFloor({ db, schema, log: audit.log, scope: requestScope })
