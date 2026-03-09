import { Hono } from 'hono'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import {
  evvVisits, clients, caregiverProfiles,
  authorizations, referralSources,
} from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// ─── Constants ──────────────────────────────────────────────────────────────

const SANDATA_UAT_VISITS  = 'https://uat-api.sandata.com/interfaces/intake/visits/rest/api/v1.1'
const SANDATA_UAT_CLIENTS = 'https://uat-api.sandata.com/interfaces/intake/clients/rest/api/v1.1'
const SANDATA_PROD_VISITS = 'https://api.sandata.com/interfaces/intake/visits/rest/api/v1.1'
const SANDATA_PROD_CLIENTS = 'https://api.sandata.com/interfaces/intake/clients/rest/api/v1.1'

const VISIT_TZ = 'US/Central'
const STATUS_POLL_DELAY_MS = 5000
const STATUS_POLL_MAX_RETRIES = 3

// ─── Helpers ────────────────────────────────────────────────────────────────

function getEndpoints() {
  const isUat = process.env.SANDATA_ENV !== 'production'
  return {
    visits:  isUat ? SANDATA_UAT_VISITS  : SANDATA_PROD_VISITS,
    clients: isUat ? SANDATA_UAT_CLIENTS : SANDATA_PROD_CLIENTS,
  }
}

function getSandataAuth(): { username: string; password: string } | null {
  const username = process.env.SANDATA_USERNAME
  const password = process.env.SANDATA_PASSWORD
  if (!username || !password) return null
  return { username, password }
}

function getAgencyMedicaidId(): string {
  return process.env.AGENCY_MEDICAID_ID || ''
}

function providerBlock() {
  return {
    ProviderQualifier: 'MedicaidID',
    ProviderID: getAgencyMedicaidId(),
  }
}

/** YYYYMMDDHHMMSS integer from a Date (UTC) */
function makeSequenceId(d: Date = new Date()): number {
  const pad = (n: number) => String(n).padStart(2, '0')
  return parseInt(
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()),
    10,
  )
}

/** Convert a JS Date to UTC ISO string YYYY-MM-DDTHH:MM:SSZ */
function toUtcIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Determine PayerProgram from payer type / name */
function resolvePayerProgram(payerType?: string | null, payerName?: string | null): string {
  const pt = (payerType || '').toLowerCase()
  const pn = (payerName || '').toLowerCase()
  if (pt.includes('hmo') || pn.includes('hmo')) return 'WIHMO'
  if (pt.includes('ffs') || pn.includes('fee for service') || pt === 'medicaid') return 'FFS'
  // Default: MCO (My Choice Wisconsin, iCare, etc.)
  return 'WIMCO'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Sandata API Request ────────────────────────────────────────────────────

async function sandataRequest(
  endpoint: string,
  method: 'POST' | 'GET',
  payload?: any,
): Promise<{ ok: boolean; status: number; data: any }> {
  const auth = getSandataAuth()
  if (!auth) throw new Error('Sandata credentials not configured')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': 'Basic ' + Buffer.from(auth.username + ':' + auth.password).toString('base64'),
  }

  const res = await fetch(endpoint, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(30_000),
  })

  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

/** POST payload, then poll GET /status?uuid={uuid} until accepted or max retries */
async function submitAndPoll(
  endpoint: string,
  payload: any,
): Promise<{ uuid: string | null; accepted: boolean; response: any }> {
  const postResult = await sandataRequest(endpoint, 'POST', payload)
  if (!postResult.ok) {
    return { uuid: null, accepted: false, response: postResult.data }
  }

  // Sandata returns a UUID to poll for status
  const uuid = postResult.data?.uuid || postResult.data?.UUID || postResult.data?.id || null
  if (!uuid) {
    return { uuid: null, accepted: false, response: postResult.data }
  }

  // Poll for acceptance
  for (let attempt = 0; attempt < STATUS_POLL_MAX_RETRIES; attempt++) {
    await sleep(STATUS_POLL_DELAY_MS)
    try {
      const statusResult = await sandataRequest(endpoint + '/status?uuid=' + uuid, 'GET')
      const st = statusResult.data?.status || statusResult.data?.Status || ''
      if (st.toLowerCase() === 'accepted' || st.toLowerCase() === 'completed') {
        return { uuid, accepted: true, response: statusResult.data }
      }
      if (st.toLowerCase() === 'rejected' || st.toLowerCase() === 'error') {
        return { uuid, accepted: false, response: statusResult.data }
      }
    } catch (_e) { /* retry */ }
  }

  // Exhausted retries — mark as exception
  return { uuid, accepted: false, response: { status: 'poll_timeout', message: 'Status polling timed out after ' + STATUS_POLL_MAX_RETRIES + ' attempts' } }
}

// ─── Visit Payload Builder (WI Alt EVV Addendum v2.5) ───────────────────────

interface VisitData {
  visit: typeof evvVisits.$inferSelect
  client: { mcoMemberId: string | null }
  caregiver: { evvWorkerId: string | null }
  payer: { payerIdNumber: string | null; payerType: string | null; name: string | null } | null
  authorization: { procedureCode: string | null; modifier: string | null } | null
}

function buildVisitPayload(d: VisitData): any {
  const procedureCode = d.visit.serviceCode || d.authorization?.procedureCode || 'T1019'
  const clientMedicaidId = d.client.mcoMemberId || ''
  const hasGpsIn = d.visit.gpsInLat != null && d.visit.gpsInLng != null
  const hasGpsOut = d.visit.gpsOutLat != null && d.visit.gpsOutLng != null

  const calls: any[] = []

  // Time In call
  if (d.visit.actualStart) {
    const callIn: any = {
      CallExternalID: d.visit.id + '-IN',
      CallDateTime: toUtcIso(d.visit.actualStart),
      CallAssignment: 'Time In',
      CallType: hasGpsIn ? 'Mobile' : 'Manual',
      ProcedureCode: procedureCode,
    }
    if (hasGpsIn) {
      callIn.CallLatitude = parseFloat(String(d.visit.gpsInLat))
      callIn.CallLongitude = parseFloat(String(d.visit.gpsInLng))
    }
    calls.push(callIn)
  }

  // Time Out call
  if (d.visit.actualEnd) {
    const callOut: any = {
      CallExternalID: d.visit.id + '-OUT',
      CallDateTime: toUtcIso(d.visit.actualEnd),
      CallAssignment: 'Time Out',
      CallType: hasGpsOut ? 'Mobile' : 'Manual',
      ProcedureCode: procedureCode,
    }
    if (hasGpsOut) {
      callOut.CallLatitude = parseFloat(String(d.visit.gpsOutLat))
      callOut.CallLongitude = parseFloat(String(d.visit.gpsOutLng))
    }
    calls.push(callOut)
  }

  return {
    ProviderIdentification: providerBlock(),
    VisitOtherID: d.visit.id,
    SequenceID: makeSequenceId(),
    EmployeeQualifier: 'EmployeeCustomID',
    EmployeeIdentifier: d.caregiver.evvWorkerId || '',
    ClientIDQualifier: 'ClientCustomID',
    ClientID: clientMedicaidId,
    ClientOtherID: clientMedicaidId,
    VisitCancelledIndicator: false,
    PayerID: d.payer?.payerIdNumber || '',
    PayerProgram: resolvePayerProgram(d.payer?.payerType, d.payer?.name),
    ProcedureCode: procedureCode,
    VisitTimeZone: VISIT_TZ,
    Calls: calls,
  }
}

// ─── Visit Changes Segment (manual edits) ───────────────────────────────────

function buildVisitChanges(
  changedByEmail: string,
  reasonCode: string = '1',
  memo: string = 'Caregiver correction',
): any {
  const now = new Date()
  return {
    SequenceID: makeSequenceId(now),
    ChangeMadeBy: changedByEmail,
    ChangeDateTime: toUtcIso(now),
    ReasonCode: reasonCode,
    ChangeReasonMemo: memo,
  }
}

// ─── Client Payload Builder (WI Alt EVV Addendum v2.5) ──────────────────────

interface ClientData {
  client: typeof clients.$inferSelect
}

function buildClientPayload(d: ClientData): any {
  const medicaidId = d.client.mcoMemberId || d.client.evvClientId || ''

  const clientAddress: any[] = []
  if (d.client.address || d.client.city) {
    clientAddress.push({
      ClientAddressType: 'Other',
      ClientAddressIsPrimary: false,
      ClientAddressLine1: d.client.address || '',
      ClientCity: d.client.city || '',
      ClientState: d.client.state || 'WI',
      ClientZip: d.client.zip || '',
      ClientCounty: '',
    })
  }

  const clientPhone: any[] = []
  if (d.client.phone) {
    clientPhone.push({
      ClientPhoneType: 'Home',
      ClientPhoneNumber: d.client.phone.replace(/\D/g, ''),
    })
  }

  return {
    ProviderIdentification: providerBlock(),
    ClientFirstName: d.client.firstName,
    ClientLastName: d.client.lastName,
    ClientQualifier: 'ClientCustomID',
    ClientMedicaidID: medicaidId,
    ClientIdentifier: medicaidId,
    ClientCustomID: medicaidId,
    ClientOtherID: medicaidId,
    SequenceID: makeSequenceId(),
    ClientTimeZone: VISIT_TZ,
    ClientAddress: clientAddress,
    ClientPhone: clientPhone,
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/sandata/config
app.get('/config', async (c) => {
  const auth = getSandataAuth()
  const agencyMedicaidId = getAgencyMedicaidId()
  return c.json({
    sandataConfigured: !!auth,
    agencyMedicaidId: agencyMedicaidId ? '****' + agencyMedicaidId.slice(-4) : null,
    environment: process.env.SANDATA_ENV || 'uat',
    visitsEndpoint: getEndpoints().visits,
    clientsEndpoint: getEndpoints().clients,
  })
})

// GET /api/sandata/status
app.get('/status', async (c) => {
  const rows = await db
    .select({
      status: evvVisits.sandataStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(evvVisits)
    .groupBy(evvVisits.sandataStatus)

  const summary: Record<string, number> = {}
  for (const r of rows) summary[r.status] = r.count

  return c.json({
    summary,
    total: Object.values(summary).reduce((a, b) => a + b, 0),
  })
})

// POST /api/sandata/submit — Submit pending EVV visits to Sandata
app.post('/submit', async (c) => {
  const auth = getSandataAuth()
  if (!auth) {
    return c.json({ success: false, message: 'Sandata credentials not configured. Set SANDATA_USERNAME and SANDATA_PASSWORD env vars.' }, 400)
  }
  if (!getAgencyMedicaidId()) {
    return c.json({ success: false, message: 'AGENCY_MEDICAID_ID env var is not set.' }, 400)
  }

  const body = await c.req.json().catch(() => ({}))
  const visitIds: string[] | undefined = body.visitIds

  // Fetch pending visits (or specific IDs)
  const conditions = visitIds?.length
    ? [inArray(evvVisits.id, visitIds)]
    : [eq(evvVisits.sandataStatus, 'pending')]

  const pendingVisits = await db.select().from(evvVisits).where(and(...conditions))
  if (pendingVisits.length === 0) {
    return c.json({ success: true, message: 'No pending visits to submit', submitted: 0 })
  }

  // Gather all related data in bulk
  const clientIds = [...new Set(pendingVisits.map(v => v.clientId))]
  const caregiverIds = [...new Set(pendingVisits.map(v => v.caregiverId))]
  const authIds = pendingVisits.map(v => v.authorizationId).filter(Boolean) as string[]

  const [clientRows, profileRows, authRows] = await Promise.all([
    db.select().from(clients).where(inArray(clients.id, clientIds)),
    db.select().from(caregiverProfiles).where(inArray(caregiverProfiles.caregiverId, caregiverIds)),
    authIds.length > 0
      ? db.select().from(authorizations).where(inArray(authorizations.id, authIds))
      : Promise.resolve([]),
  ])

  // Fetch payers from authorizations
  const payerIds = [...new Set(authRows.map(a => a.payerId).filter(Boolean) as string[])]
  const payerRows = payerIds.length > 0
    ? await db.select().from(referralSources).where(inArray(referralSources.id, payerIds))
    : []

  // Build lookup maps
  const clientMap = new Map(clientRows.map(c => [c.id, c]))
  const profileMap = new Map(profileRows.map(p => [p.caregiverId, p]))
  const authMap = new Map(authRows.map(a => [a.id, a]))
  const payerMap = new Map(payerRows.map(p => [p.id, p]))

  const endpoints = getEndpoints()
  const results: Array<{ visitId: string; success: boolean; uuid?: string; error?: string }> = []

  for (const visit of pendingVisits) {
    const client = clientMap.get(visit.clientId)
    const profile = profileMap.get(visit.caregiverId)
    const auth = visit.authorizationId ? authMap.get(visit.authorizationId) : null
    const payer = auth?.payerId ? payerMap.get(auth.payerId) : null

    if (!client) {
      results.push({ visitId: visit.id, success: false, error: 'Client not found' })
      continue
    }

    const payload = buildVisitPayload({
      visit,
      client: { mcoMemberId: client.mcoMemberId },
      caregiver: { evvWorkerId: profile?.evvWorkerId || null },
      payer: payer ? { payerIdNumber: payer.payerIdNumber, payerType: payer.payerType, name: payer.name } : null,
      authorization: auth ? { procedureCode: auth.procedureCode, modifier: auth.modifier } : null,
    })

    try {
      // Mark as submitted before sending
      await db.update(evvVisits).set({
        sandataStatus: 'submitted',
        sandataSubmittedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(evvVisits.id, visit.id))

      const result = await submitAndPoll(endpoints.visits, payload)

      if (result.accepted) {
        await db.update(evvVisits).set({
          sandataStatus: 'accepted',
          sandataVisitId: result.uuid,
          sandataResponse: result.response,
          updatedAt: new Date(),
        }).where(eq(evvVisits.id, visit.id))
        results.push({ visitId: visit.id, success: true, uuid: result.uuid || undefined })
      } else {
        const exCode = result.response?.errorCode || result.response?.ExceptionCode || ''
        const exDesc = result.response?.message || result.response?.ExceptionDescription || JSON.stringify(result.response)
        await db.update(evvVisits).set({
          sandataStatus: 'exception',
          sandataVisitId: result.uuid,
          sandataResponse: result.response,
          sandataExceptionCode: exCode,
          sandataExceptionDesc: exDesc,
          updatedAt: new Date(),
        }).where(eq(evvVisits.id, visit.id))
        results.push({ visitId: visit.id, success: false, uuid: result.uuid || undefined, error: exDesc })
      }
    } catch (err: any) {
      await db.update(evvVisits).set({
        sandataStatus: 'exception',
        sandataExceptionCode: 'NETWORK_ERROR',
        sandataExceptionDesc: err.message,
        updatedAt: new Date(),
      }).where(eq(evvVisits.id, visit.id))
      results.push({ visitId: visit.id, success: false, error: err.message })
    }
  }

  const accepted = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  return c.json({ success: failed === 0, submitted: results.length, accepted, failed, results })
})

// POST /api/sandata/submit-visit-changes — Submit a VisitChanges segment for an edited visit
app.post('/submit-visit-changes', async (c) => {
  const auth = getSandataAuth()
  if (!auth) return c.json({ success: false, message: 'Sandata credentials not configured.' }, 400)

  const body = await c.req.json()
  const { visitId, changedByEmail, reasonCode, memo } = body
  if (!visitId) return c.json({ error: 'visitId is required' }, 400)

  const [visit] = await db.select().from(evvVisits).where(eq(evvVisits.id, visitId)).limit(1)
  if (!visit) return c.json({ error: 'Visit not found' }, 404)
  if (!visit.sandataVisitId) return c.json({ error: 'Visit has not been submitted to Sandata yet' }, 400)

  // Re-fetch related data for full payload
  const [client] = await db.select().from(clients).where(eq(clients.id, visit.clientId)).limit(1)
  const [profile] = await db.select().from(caregiverProfiles).where(eq(caregiverProfiles.caregiverId, visit.caregiverId)).limit(1)
  const auth2 = visit.authorizationId
    ? (await db.select().from(authorizations).where(eq(authorizations.id, visit.authorizationId)).limit(1))[0]
    : null
  const payer = auth2?.payerId
    ? (await db.select().from(referralSources).where(eq(referralSources.id, auth2.payerId)).limit(1))[0]
    : null

  const visitPayload = buildVisitPayload({
    visit,
    client: { mcoMemberId: client?.mcoMemberId || null },
    caregiver: { evvWorkerId: profile?.evvWorkerId || null },
    payer: payer ? { payerIdNumber: payer.payerIdNumber, payerType: payer.payerType, name: payer.name } : null,
    authorization: auth2 ? { procedureCode: auth2.procedureCode, modifier: auth2.modifier } : null,
  })

  // Attach VisitChanges segment
  visitPayload.VisitChanges = [buildVisitChanges(
    changedByEmail || 'admin@agency.com',
    reasonCode || '1',
    memo || 'Caregiver correction',
  )]

  const endpoints = getEndpoints()
  try {
    const result = await submitAndPoll(endpoints.visits, visitPayload)
    return c.json({ success: result.accepted, uuid: result.uuid, response: result.response })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500)
  }
})

// POST /api/sandata/sync-clients — Sync active clients to Sandata
app.post('/sync-clients', async (c) => {
  const auth = getSandataAuth()
  if (!auth) return c.json({ success: false, message: 'Sandata credentials not configured.' }, 400)
  if (!getAgencyMedicaidId()) return c.json({ success: false, message: 'AGENCY_MEDICAID_ID not set.' }, 400)

  const body = await c.req.json().catch(() => ({}))
  const clientIds: string[] | undefined = body.clientIds

  const conditions = clientIds?.length
    ? [inArray(clients.id, clientIds)]
    : [eq(clients.isActive, true)]

  const activeClients = await db.select().from(clients).where(and(...conditions))
  if (activeClients.length === 0) {
    return c.json({ success: true, message: 'No clients to sync', synced: 0 })
  }

  const endpoints = getEndpoints()
  const results: Array<{ clientId: string; name: string; success: boolean; uuid?: string; error?: string }> = []

  for (const client of activeClients) {
    if (!client.mcoMemberId && !client.evvClientId) {
      results.push({ clientId: client.id, name: client.firstName + ' ' + client.lastName, success: false, error: 'No Medicaid ID set on client' })
      continue
    }

    const payload = buildClientPayload({ client })

    try {
      const result = await submitAndPoll(endpoints.clients, payload)
      results.push({
        clientId: client.id,
        name: client.firstName + ' ' + client.lastName,
        success: result.accepted,
        uuid: result.uuid || undefined,
        error: result.accepted ? undefined : (result.response?.message || JSON.stringify(result.response)),
      })
    } catch (err: any) {
      results.push({ clientId: client.id, name: client.firstName + ' ' + client.lastName, success: false, error: err.message })
    }
  }

  const synced = results.filter(r => r.success).length
  return c.json({ success: true, synced, total: results.length, results })
})

export default app
