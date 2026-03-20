import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import {
  ediBatches, referralSources, claims, clients, users,
  caregiverProfiles, authorizations, evvVisits, agencies,
} from '../../db/schema.ts'
import { eq, count, desc, sql } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { generate837P, getProviderInfo } from '../services/edi837Generator.ts'
import { routeClaim } from '../services/payerRouter.ts'
import { generateMidasExport, generateIRISExport, generateHMOExport } from '../services/payerRouter.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

app.get('/batches', async (c) => {
  const rows = await db.select({
    batch: ediBatches,
    payerName: referralSources.name,
    claimCount: sql<number>`(select count(*) from claims where claims.edi_batch_id = ${ediBatches.id})`.as('claim_count'),
  })
    .from(ediBatches)
    .leftJoin(referralSources, eq(ediBatches.payerId, referralSources.id))
    .orderBy(desc(ediBatches.createdAt))

  const result = rows.map(r => ({
    ...r.batch,
    payer: r.payerName ? { name: r.payerName } : null,
    _count: { claims: Number(r.claimCount) },
  }))

  return c.json(result)
})

app.post('/batches', async (c) => {
  const body = await c.req.json()
  const user = c.get('user')
  const [{ value: cnt }] = await db.select({ value: count() }).from(ediBatches)

  const [batch] = await db.insert(ediBatches).values({
    ...body,
    batchNumber: `EDI-${String(cnt + 1).padStart(5, '0')}`,
    createdById: user.userId,
  }).returning()

  return c.json(batch, 201)
})

app.patch('/batches/:id/submit', async (c) => {
  const id = c.req.param('id')
  const [batch] = await db.update(ediBatches)
    .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(ediBatches.id, id))
    .returning()

  return c.json(batch)
})

// Generate EDI 837P file for a batch
app.post('/batches/:id/generate-837', async (c) => {
  const batchId = c.req.param('id')

  // Get batch with payer info
  const batchRows = await db
    .select({ batch: ediBatches, payer: referralSources })
    .from(ediBatches)
    .leftJoin(referralSources, eq(ediBatches.payerId, referralSources.id))
    .where(eq(ediBatches.id, batchId))

  if (!batchRows.length) {
    return c.json({ error: 'Batch not found' }, 404)
  }

  const { batch, payer } = batchRows[0]

  // Get claims in this batch with full data
  const claimRows = await db
    .select({
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
      cgFirstName: users.firstName,
      cgLastName: users.lastName,
      caregiverNpi: caregiverProfiles.npiNumber,
      taxonomyCode: caregiverProfiles.taxonomyCode,
      authNumber: authorizations.authNumber,
      sandataVisitId: evvVisits.sandataVisitId,
    })
    .from(claims)
    .innerJoin(clients, eq(claims.clientId, clients.id))
    .innerJoin(users, eq(claims.caregiverId, users.id))
    .leftJoin(caregiverProfiles, eq(caregiverProfiles.caregiverId, users.id))
    .leftJoin(authorizations, eq(claims.authorizationId, authorizations.id))
    .leftJoin(evvVisits, eq(claims.evvVisitId, evvVisits.id))
    .where(eq(claims.ediBatchId, batchId))

  if (!claimRows.length) {
    return c.json({ error: 'No claims in this batch' }, 400)
  }

  // Get agency info for provider
  const [agency] = await db.select().from(agencies).limit(1)
  const provider = getProviderInfo(agency || undefined)

  const payerInfo = {
    name: payer?.name || 'Unknown',
    edi_payer_id: payer?.ediPayerId || undefined,
  }

  // Map claim rows to EDI format
  const ediClaims = claimRows.map(r => ({
    id: r.claim.id,
    claim_number: r.claim.claimNumber,
    client_last_name: r.clientLastName,
    client_first_name: r.clientFirstName,
    medicaid_id: r.medicaidId,
    client_address: r.clientAddress,
    client_city: r.clientCity,
    client_state: r.clientState,
    client_zip: r.clientZip,
    date_of_birth: r.dateOfBirth,
    gender: r.gender,
    caregiver_last_name: r.cgLastName,
    caregiver_first_name: r.cgFirstName,
    caregiver_npi: r.caregiverNpi,
    taxonomy_code: r.taxonomyCode,
    charge_amount: r.claim.billedAmount,
    service_date: r.claim.serviceDate,
    place_of_service: '12',
    procedure_code: r.claim.serviceCode,
    units_billed: r.claim.unitsBilled,
    diagnosis_code: r.primaryDiagnosisCode,
    auth_number: r.authNumber,
    sandata_visit_id: r.sandataVisitId,
  }))

  const ediContent = generate837P({
    claims: ediClaims,
    provider,
    payer: payerInfo,
    interchangeControlNum: batch.batchNumber?.replace(/\D/g, ''),
  })

  // Store EDI content on batch
  await db.update(ediBatches).set({
    ediContent,
    claimCount: claimRows.length,
    totalBilled: String(claimRows.reduce((sum, r) => sum + parseFloat(r.claim.billedAmount || '0'), 0)),
    updatedAt: new Date(),
  }).where(eq(ediBatches.id, batchId))

  return c.json({
    batchId,
    claimCount: claimRows.length,
    ediContent,
    contentLength: ediContent.length,
  })
})

// Download EDI file
app.get('/batches/:id/download', async (c) => {
  const batchId = c.req.param('id')
  const [batch] = await db.select().from(ediBatches).where(eq(ediBatches.id, batchId))

  if (!batch?.ediContent) {
    return c.json({ error: 'No EDI content generated for this batch' }, 404)
  }

  return new Response(batch.ediContent, {
    headers: {
      'Content-Type': 'text/plain',
      'Content-Disposition': `attachment; filename="${batch.batchNumber || 'edi-batch'}.837"`,
    },
  })
})

// Route claim to determine submission method
app.post('/route-claim', async (c) => {
  const { payerId } = await c.req.json()

  if (!payerId) {
    return c.json({ error: 'Payer ID is required' }, 400)
  }

  const [payer] = await db
    .select()
    .from(referralSources)
    .where(eq(referralSources.id, payerId))

  if (!payer) {
    return c.json({ error: 'Payer not found' }, 404)
  }

  const route = routeClaim({
    payer_type: payer.payerType,
    payer_id_number: payer.payerIdNumber,
    name: payer.name,
    submission_method: payer.submissionMethod,
  })

  return c.json(route)
})

// Generate payer-specific export (MIDAS, IRIS, HMO)
app.post('/batches/:id/export', async (c) => {
  const batchId = c.req.param('id')
  const { format } = await c.req.json()

  const [batch] = await db
    .select()
    .from(ediBatches)
    .where(eq(ediBatches.id, batchId))

  if (!batch) return c.json({ error: 'Batch not found' }, 404)

  // Get claims with full data
  const claimRows = await db
    .select({
      claim: claims,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      medicaidId: clients.medicaidId,
      mcoMemberId: clients.mcoMemberId,
      cgFirstName: users.firstName,
      cgLastName: users.lastName,
      caregiverNpi: caregiverProfiles.npiNumber,
      authNumber: authorizations.authNumber,
    })
    .from(claims)
    .innerJoin(clients, eq(claims.clientId, clients.id))
    .innerJoin(users, eq(claims.caregiverId, users.id))
    .leftJoin(caregiverProfiles, eq(caregiverProfiles.caregiverId, users.id))
    .leftJoin(authorizations, eq(claims.authorizationId, authorizations.id))
    .where(eq(claims.ediBatchId, batchId))

  const [agency] = await db.select().from(agencies).limit(1)
  const provider = getProviderInfo(agency || undefined)

  const exportClaims = claimRows.map(r => ({
    client_first_name: r.clientFirstName,
    client_last_name: r.clientLastName,
    medicaid_id: r.medicaidId,
    mco_member_id: r.mcoMemberId,
    service_date: r.claim.serviceDate,
    procedure_code: r.claim.serviceCode,
    units_billed: r.claim.unitsBilled,
    charge_amount: r.claim.billedAmount,
    auth_number: r.authNumber,
    caregiver_npi: r.caregiverNpi,
    caregiver_first_name: r.cgFirstName,
    caregiver_last_name: r.cgLastName,
  }))

  let csv: string
  let filename: string

  switch (format) {
    case 'midas':
      csv = generateMidasExport(exportClaims, provider)
      filename = `midas-${batch.batchNumber}.csv`
      break
    case 'iris':
      csv = generateIRISExport(exportClaims)
      filename = `iris-${batch.batchNumber}.csv`
      break
    case 'hmo':
      csv = generateHMOExport(exportClaims, provider)
      filename = `hmo-${batch.batchNumber}.csv`
      break
    default:
      return c.json({ error: 'Invalid format. Use: midas, iris, hmo' }, 400)
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

export default app
