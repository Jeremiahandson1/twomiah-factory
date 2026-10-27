// Home care's own company columns on the shared /api/company (packages/tenant-backend company/company.ts `fields` and
// `describe`), wired for the home-care vertical by server/modules/company.ts. Moved from
// templates/crm-homecare/backend/src/routes/company.ts, whose GET / and PUT / served the agency row.
//
//   · timezone: every report counts days on it and hands it to Postgres' AT TIME ZONE, so a zone Postgres does not know
//     is refused; '' or null clears it (the state then decides — core/agencyTime.ts resolveTimezone);
//   · mileageRate: what every caregiver trip is paid at (core/mileageRate.ts);
//   · legalName, npi, medicaidId: what claims and the payer letters print.
//   · effectiveTimezone, on every answer: the zone the reports actually count days on.
//
// One change: the template's PUT stored whatever the body held (any column, including the encrypted Sandata
// password, which it deleted by name); the shared PUT takes the named fields only. The Sandata settings are written
// through their own route, and the password never leaves the server (it is one of the shared COMPANY_SECRETS).
import { z } from 'zod'
import { isValidTimezone, resolveTimezone } from '../core/agencyTime.ts'
import { parseMileageRate, MILEAGE_RATE_REFUSAL } from '../core/mileageRate.ts'

export const homecareCompanyFields: Record<string, z.ZodTypeAny> = {
  timezone: z.union([z.string(), z.null()]).optional()
    .refine((v) => v === undefined || v === null || v === '' || isValidTimezone(v), { error: (iss) => `"${String(iss.input).slice(0, 64)}" is not a time zone — use an IANA name such as America/Chicago` })
    .transform((v) => (v === '' ? null : v)),
  mileageRate: z.union([z.string(), z.number()]).optional()
    .refine((v) => v === undefined || parseMileageRate(v) !== null, MILEAGE_RATE_REFUSAL)
    .transform((v) => (v === undefined ? undefined : String(parseMileageRate(v)))),
  legalName: z.string().trim().nullable().optional(),
  npi: z.string().trim().nullable().optional(),
  medicaidId: z.string().trim().nullable().optional(),
}

/** What every company answer carries for a home-care agency. */
export const describeAgency = (row: any) => ({ effectiveTimezone: resolveTimezone(row ?? null) })
