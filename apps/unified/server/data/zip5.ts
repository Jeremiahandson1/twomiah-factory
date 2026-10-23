// A ZIP column as its five-digit ZIP (54701-1234 → 54701), for matching an area by ZIP whatever form the row was saved in
// (packages/tenant-backend address.ts stores 12345 or 12345-6789). Used by storm leads (crm/roof/field/stormData.ts).
import { sql, type SQL } from 'drizzle-orm'
import type { AnyColumn } from 'drizzle-orm'

export const zip5Of = (column: AnyColumn): SQL => sql`left(trim(${column}), 5)`
