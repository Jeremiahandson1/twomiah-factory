// EDI batches: the service codes for claims setup, claim batches, their 837P file and download, payer routing, and the
// payer-specific exports (MIDAS, IRIS, HMO). Moved from templates/crm-homecare/backend/src/routes/edi.ts.
//
// Who: the template's router was requireAdmin. Reading (the codes, the batches, a download, where a payer routes, a
// payer export) is care-billing:read; making a batch is care-billing:create; submitting it or generating its 837P is
// care-billing:update.
//
// Changes from the template: the company's rows only; the lists are { data, pagination }; a new batch's body can no
// longer set its id, company or number (the template spread the body into the insert).
import { Hono } from 'hono'
import { and, eq, count, desc, asc, isNotNull } from 'drizzle-orm'
import {
  ediBatches, referralSources, claims, clients, user, caregiverProfiles, authorizations, evvVisits, company, serviceCodes,
} from '../../../db/schema/index.ts'
import { generate837P, getProviderInfo } from '../core/edi837Generator.ts'
import { routeClaim, generateMidasExport, generateIRISExport, generateHMOExport } from '../core/payerRouter.ts'
import type { HomecareCore } from '../core/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import { body, who, download, withoutOwnership } from './shared.ts'

export function createEdiRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const read = requirePermission('care-billing:read')
  const create = requirePermission('care-billing:create')
  const update = requirePermission('care-billing:update')

  async function provider(companyId: string) {
    const [agency] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    return getProviderInfo((agency as any) || undefined)
  }

  // GET /service-codes — HCPCS/service codes for claims setup. A list reply.
  app.get('/service-codes', read, async (c) => {
    const rows = await db.select().from(serviceCodes).where(eq(serviceCodes.companyId, who(c).companyId)).orderBy(asc(serviceCodes.code))
    return listAll(c, rows)
  })

  // GET /batches — a list reply.
  app.get('/batches', read, async (c) => {
    const { companyId } = who(c)
    const rows = await db.select({ batch: ediBatches, payerName: referralSources.name })
      .from(ediBatches)
      .leftJoin(referralSources, eq(ediBatches.payerId, referralSources.id))
      .where(eq(ediBatches.companyId, companyId))
      .orderBy(desc(ediBatches.createdAt))
    const counts = await db.select({ batchId: claims.ediBatchId, n: count() }).from(claims)
      .where(and(eq(claims.companyId, companyId), isNotNull(claims.ediBatchId))).groupBy(claims.ediBatchId)
    const claimsIn = new Map(counts.map((r: any) => [r.batchId, Number(r.n)]))
    const result = rows.map((r: any) => ({
      ...r.batch,
      payer: r.payerName ? { name: r.payerName } : null,
      _count: { claims: claimsIn.get(r.batch.id) ?? 0 },
    }))
    return listAll(c, result)
  })

  app.post('/batches', create, async (c) => {
    const { companyId, userId } = who(c)
    const b = withoutOwnership(await body(c))
    const [{ value: cnt }] = await db.select({ value: count() }).from(ediBatches).where(eq(ediBatches.companyId, companyId))
    const [batch] = await db.insert(ediBatches).values({
      ...b,
      companyId,
      batchNumber: `EDI-${String(cnt + 1).padStart(5, '0')}`,
      createdById: userId,
    }).returning()
    return one(c, batch, 201)
  })

  app.patch('/batches/:id/submit', update, async (c) => {
    const [batch] = await db.update(ediBatches)
      .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(ediBatches.id, c.req.param('id')), eq(ediBatches.companyId, who(c).companyId)))
      .returning()
    if (!batch) return fail(c, 404, 'Batch not found')
    return one(c, batch)
  })

  // POST /batches/:id/generate-837 — the batch's EDI 837P file, stored on the batch.
  app.post('/batches/:id/generate-837', update, async (c) => {
    const { companyId } = who(c)
    const batchId = c.req.param('id')
    const batchRows = await db.select({ batch: ediBatches, payer: referralSources })
      .from(ediBatches)
      .leftJoin(referralSources, eq(ediBatches.payerId, referralSources.id))
      .where(and(eq(ediBatches.id, batchId), eq(ediBatches.companyId, companyId)))
    if (!batchRows.length) return fail(c, 404, 'Batch not found')
    const { batch, payer } = batchRows[0]

    const claimRows = await db.select({
      claim: claims,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      medicaidId: clients.medicaidId,
      clientAddress: clients.address,
      clientCity: clients.city,
      clientState: clients.state,
      clientZip: clients.zip,
      dateOfBirth: clients.dateOfBirth,
      gender: clients.gender,
      primaryDiagnosisCode: clients.primaryDiagnosisCode,
      cgFirstName: user.firstName,
      cgLastName: user.lastName,
      caregiverNpi: caregiverProfiles.npiNumber,
      taxonomyCode: caregiverProfiles.taxonomyCode,
      authNumber: authorizations.authNumber,
      sandataVisitId: evvVisits.sandataVisitId,
    })
      .from(claims)
      .innerJoin(clients, eq(claims.clientId, clients.id))
      .innerJoin(user, eq(claims.caregiverId, user.id))
      .leftJoin(caregiverProfiles, eq(caregiverProfiles.caregiverId, user.id))
      .leftJoin(authorizations, eq(claims.authorizationId, authorizations.id))
      .leftJoin(evvVisits, eq(claims.evvVisitId, evvVisits.id))
      .where(and(eq(claims.ediBatchId, batchId), eq(claims.companyId, companyId)))
    if (!claimRows.length) return fail(c, 400, 'No claims in this batch')

    const ediClaims = claimRows.map((r: any) => ({
      id: r.claim.id,
      claimNumber: r.claim.claimNumber,
      clientLastName: r.clientLastName,
      clientFirstName: r.clientFirstName,
      medicaidId: r.medicaidId,
      clientAddress: r.clientAddress,
      clientCity: r.clientCity,
      clientState: r.clientState,
      clientZip: r.clientZip,
      dateOfBirth: r.dateOfBirth,
      gender: r.gender,
      caregiverLastName: r.cgLastName,
      caregiverFirstName: r.cgFirstName,
      caregiverNpi: r.caregiverNpi,
      taxonomyCode: r.taxonomyCode,
      chargeAmount: r.claim.billedAmount,
      serviceDate: r.claim.serviceDate,
      placeOfService: '12',
      procedureCode: r.claim.serviceCode,
      unitsBilled: r.claim.unitsBilled,
      diagnosisCode: r.primaryDiagnosisCode,
      authNumber: r.authNumber,
      sandataVisitId: r.sandataVisitId,
    }))
    const ediContent = generate837P({
      claims: ediClaims,
      provider: await provider(companyId),
      payer: { name: payer?.name || 'Unknown', ediPayerId: payer?.ediPayerId || undefined },
      interchangeControlNum: batch.batchNumber?.replace(/\D/g, ''),
    })
    await db.update(ediBatches).set({
      ediContent,
      claimCount: claimRows.length,
      totalBilled: String(claimRows.reduce((sum: number, r: any) => sum + parseFloat(r.claim.billedAmount || '0'), 0)),
      updatedAt: new Date(),
    }).where(and(eq(ediBatches.id, batchId), eq(ediBatches.companyId, companyId)))
    return one(c, { batchId, claimCount: claimRows.length, ediContent, contentLength: ediContent.length })
  })

  // GET /batches/:id/download — the batch's EDI file.
  app.get('/batches/:id/download', read, async (c) => {
    const [batch] = await db.select().from(ediBatches)
      .where(and(eq(ediBatches.id, c.req.param('id')), eq(ediBatches.companyId, who(c).companyId)))
    if (!batch?.ediContent) return fail(c, 404, 'No EDI content generated for this batch')
    return download(c, 'text/plain', `"${batch.batchNumber || 'edi-batch'}.837"`, batch.ediContent)
  })

  // POST /route-claim — how a payer's claims are submitted.
  app.post('/route-claim', read, async (c) => {
    const { payerId } = await body(c)
    if (!payerId) return fail(c, 400, 'Payer ID is required')
    const [payer] = await db.select().from(referralSources)
      .where(and(eq(referralSources.id, payerId), eq(referralSources.companyId, who(c).companyId)))
    if (!payer) return fail(c, 404, 'Payer not found')
    return one(c, routeClaim({
      payerType: payer.payerType,
      payerIdNumber: payer.payerIdNumber,
      name: payer.name,
      submissionMethod: payer.submissionMethod,
      claimPortal: payer.claimPortal,
    } as any))
  })

  // POST /batches/:id/export { format } — a payer-specific export (MIDAS, IRIS, HMO) of the batch's claims.
  app.post('/batches/:id/export', read, async (c) => {
    const { companyId } = who(c)
    const batchId = c.req.param('id')
    const { format } = await body(c)
    const [batch] = await db.select().from(ediBatches).where(and(eq(ediBatches.id, batchId), eq(ediBatches.companyId, companyId)))
    if (!batch) return fail(c, 404, 'Batch not found')

    const claimRows = await db.select({
      claim: claims,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      medicaidId: clients.medicaidId,
      mcoMemberId: clients.mcoMemberId,
      cgFirstName: user.firstName,
      cgLastName: user.lastName,
      caregiverNpi: caregiverProfiles.npiNumber,
      authNumber: authorizations.authNumber,
    })
      .from(claims)
      .innerJoin(clients, eq(claims.clientId, clients.id))
      .innerJoin(user, eq(claims.caregiverId, user.id))
      .leftJoin(caregiverProfiles, eq(caregiverProfiles.caregiverId, user.id))
      .leftJoin(authorizations, eq(claims.authorizationId, authorizations.id))
      .where(and(eq(claims.ediBatchId, batchId), eq(claims.companyId, companyId)))

    const exportClaims = claimRows.map((r: any) => ({
      clientFirstName: r.clientFirstName,
      clientLastName: r.clientLastName,
      medicaidId: r.medicaidId,
      mcoMemberId: r.mcoMemberId,
      serviceDate: r.claim.serviceDate,
      procedureCode: r.claim.serviceCode,
      unitsBilled: r.claim.unitsBilled,
      chargeAmount: r.claim.billedAmount,
      authNumber: r.authNumber,
      caregiverNpi: r.caregiverNpi,
      caregiverFirstName: r.cgFirstName,
      caregiverLastName: r.cgLastName,
    }))
    switch (format) {
      case 'midas': return download(c, 'text/csv', `"midas-${batch.batchNumber}.csv"`, generateMidasExport(exportClaims, await provider(companyId)))
      case 'iris': return download(c, 'text/csv', `"iris-${batch.batchNumber}.csv"`, generateIRISExport(exportClaims))
      case 'hmo': return download(c, 'text/csv', `"hmo-${batch.batchNumber}.csv"`, generateHMOExport(exportClaims, await provider(companyId)))
      default: return fail(c, 400, 'Invalid format. Use: midas, iris, hmo')
    }
  })

  return app
}
