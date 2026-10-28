// The own-it licence, from the business's own app (Factory services/ownItLicense.ts holds the rules and the money):
//   GET  /api/license           the offer — price (36× the monthly), what comes with it, the terms, and any licence bought
//   POST /api/license/checkout  the owner's GitHub username + accepted terms → a Stripe checkout URL
//   POST /api/internal/handover-export   (the Factory only) the business's full data export, for the handover after payment
// Owner only: it is a purchase on the business's behalf. Stripe is never called from here; the Factory is.
import { Hono } from 'hono'
import { z } from 'zod'
import { buildBusinessExport, soleCompanyId } from '../data/exportAll.ts'
import { fail, one } from '../http/reply.ts'
import type { Audit } from '../core/audit.ts'

export interface LicenseDeps {
  db: any
  audit: Audit
  factoryApiClient: { getLicenseOffer(): Promise<any>; startLicenseCheckout(i: { githubUsername: string; acceptedTerms: boolean; termsVersion: string }): Promise<{ url: string }> }
}

const owner = (c: any, next: any) => {
  const u = c.get('user')
  if (!u || u.role !== 'owner') return fail(c, 403, 'Only the owner can buy the licence.', 'owner_only')
  return next()
}

const checkoutBody = z.object({
  githubUsername: z.string().trim().min(1, 'Your GitHub username is needed — it is the account we invite to your code').max(60),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'Read and accept what the licence is (and is not) before paying' }) }),
  termsVersion: z.string().min(1).max(40),
})

/** A Factory refusal keeps its sentence and status (a 4xx is the owner's to fix); anything else is "try again". */
const upstream = (c: any, e: any) => {
  const status = Number(e?.status)
  if (status >= 400 && status < 500 && status !== 401 && status !== 403) return fail(c, status as any, e.message, e.upstream?.code)
  return fail(c, 502, 'The licence could not be reached just now — try again in a moment.', 'factory_unavailable')
}

export function createLicenseRoutes(deps: LicenseDeps) {
  const app = new Hono()
  app.use('*', owner)
  app.get('/', async (c) => {
    try { return one(c, await deps.factoryApiClient.getLicenseOffer()) } catch (e: any) { return upstream(c, e) }
  })
  app.post('/checkout', async (c) => {
    const parsed = checkoutBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) {
      const fields: Record<string, string> = {}
      for (const i of parsed.error.issues) fields[String(i.path[0] ?? 'body')] = i.message
      return fail(c, 400, Object.values(fields)[0] || 'Check the form', 'validation_error', fields)
    }
    try { return one(c, await deps.factoryApiClient.startLicenseCheckout(parsed.data)) } catch (e: any) { return upstream(c, e) }
  })
  return app
}

/** The Factory's call after a licence is paid: this business's whole export as a ZIP (X-Export-Files / X-Export-Rows say what is in it). Audit-logged. */
export function createHandoverExportRoute(deps: { db: any; audit: Audit }) {
  const app = new Hono()
  app.post('/', async (c: any) => {
    // One business per database: the company the Factory built this app for.
    const companyId = await soleCompanyId(deps.db)
    if (!companyId) return fail(c, 404, 'No business here yet')
    const out = await buildBusinessExport(deps.db, companyId)
    deps.audit.log({
      req: c, action: deps.audit.ACTIONS.EXPORT, entity: 'handover', entityName: `${out.files.length} files, ${out.rows} rows`,
      metadata: { files: out.files.length, rows: out.rows, for: 'own-it licence handover' }, companyId,
    })
    return c.body(out.zip, 200, {
      'Content-Type': 'application/zip', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'X-Export-Files': String(out.files.length), 'X-Export-Rows': String(out.rows),
    })
  })
  return app
}
