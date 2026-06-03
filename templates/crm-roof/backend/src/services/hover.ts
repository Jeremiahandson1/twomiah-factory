import { db } from '../../db/index.ts'
import { providerIntegration, measurementReport, job } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import logger from './logger.ts'

const HOVER_AUTH_URL = 'https://hover.to/oauth/authorize'
const HOVER_TOKEN_URL = 'https://hover.to/oauth/token'
const HOVER_API_BASE = 'https://api.hover.to/api/v3'

const PROVIDER = 'hover'

async function getIntegration(companyId: string) {
  const [integration] = await db.select().from(providerIntegration)
    .where(and(
      eq(providerIntegration.companyId, companyId),
      eq(providerIntegration.provider, PROVIDER),
    )).limit(1)
  return integration
}

export function getAuthUrl(companyId: string, clientId: string, redirectUri: string) {
  const state = Buffer.from(JSON.stringify({ companyId, provider: PROVIDER })).toString('base64url')
  return `${HOVER_AUTH_URL}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`
}

export async function handleCallback(code: string, companyId: string) {
  const integration = await getIntegration(companyId)
  if (!integration?.clientId || !integration?.clientSecret) {
    throw new Error('HOVER credentials not configured')
  }

  const redirectUri = process.env.HOVER_REDIRECT_URI || `${process.env.APP_URL || ''}/api/integrations/hover/callback`

  const res = await fetch(HOVER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: integration.clientId,
      client_secret: integration.clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  })

  if (!res.ok) {
    const errText = await res.text()
    logger.error('HOVER token exchange failed', { status: res.status, body: errText })
    throw new Error('Failed to exchange HOVER token')
  }

  const data = await res.json()
  const tokenExpiresAt = new Date(Date.now() + (data.expires_in || 7200) * 1000)

  await db.update(providerIntegration).set({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    tokenExpiresAt,
    connected: true,
    updatedAt: new Date(),
  }).where(eq(providerIntegration.id, integration.id))

  return data
}

export async function refreshTokenIfNeeded(companyId: string) {
  const integration = await getIntegration(companyId)
  if (!integration || !integration.connected) throw new Error('HOVER not connected')

  if (integration.tokenExpiresAt && new Date() < integration.tokenExpiresAt) {
    return integration
  }

  if (!integration.refreshToken) throw new Error('HOVER token expired and no refresh token available. Please reconnect in Settings.')

  const res = await fetch(HOVER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integration.refreshToken,
      client_id: integration.clientId || '',
      client_secret: integration.clientSecret || '',
    }).toString(),
  })

  if (!res.ok) {
    logger.error('HOVER token refresh failed', { companyId })
    await db.update(providerIntegration).set({ connected: false, updatedAt: new Date() })
      .where(eq(providerIntegration.id, integration.id))
    throw new Error('HOVER connection expired. Please reconnect in Settings.')
  }

  const data = await res.json()
  const tokenExpiresAt = new Date(Date.now() + (data.expires_in || 7200) * 1000)

  await db.update(providerIntegration).set({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || integration.refreshToken,
    tokenExpiresAt,
    updatedAt: new Date(),
  }).where(eq(providerIntegration.id, integration.id))

  return { ...integration, accessToken: data.access_token }
}

export async function disconnect(companyId: string) {
  await db.update(providerIntegration).set({
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    connected: false,
    updatedAt: new Date(),
  }).where(and(
    eq(providerIntegration.companyId, companyId),
    eq(providerIntegration.provider, PROVIDER),
  ))
}

export async function getStatus(companyId: string) {
  const integration = await getIntegration(companyId)
  return {
    connected: !!integration?.connected,
    hasCredentials: !!(integration?.clientId && integration?.clientSecret),
    lastSyncedAt: integration?.lastSyncedAt || null,
    connectedSince: integration?.connected ? integration.createdAt : null,
  }
}

export async function createCaptureJob(
  companyId: string,
  data: {
    address: string; city: string; state: string; zip: string;
    contactEmail?: string; contactPhone?: string; contactName?: string;
    jobId?: string;
  }
) {
  const integration = await refreshTokenIfNeeded(companyId)

  const captureBody = {
    deliverable_id: 1, // Standard 3D model
    location_address: `${data.address}, ${data.city}, ${data.state} ${data.zip}`,
    name: data.contactName || 'Property Owner',
    email: data.contactEmail || undefined,
    phone: data.contactPhone || undefined,
  }

  const res = await fetch(`${HOVER_API_BASE}/capture_requests`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${integration.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(captureBody),
  })

  if (!res.ok) {
    const errText = await res.text()
    logger.error('HOVER capture request failed', { companyId, status: res.status, body: errText })
    throw new Error(`HOVER capture request failed: ${res.status}`)
  }

  const captureResult = await res.json()
  const externalOrderId = String(captureResult.id || captureResult.job_id || '')

  // Create measurement report
  const [report] = await db.insert(measurementReport).values({
    companyId,
    jobId: data.jobId || null,
    address: data.address,
    city: data.city,
    state: data.state,
    zip: data.zip,
    provider: PROVIDER,
    status: 'processing',
    cost: '0.00',
    externalProvider: PROVIDER,
    externalOrderId,
    externalStatus: 'capture_requested',
  }).returning()

  // Link to job if provided
  if (data.jobId) {
    await db.update(job).set({
      measurementReportId: report.id,
      updatedAt: new Date(),
    }).where(and(eq(job.id, data.jobId), eq(job.companyId, companyId)))
  }

  logger.info('HOVER capture requested', { companyId, reportId: report.id, externalOrderId })
  return report
}

export async function getJobMeasurements(companyId: string, jobId: string) {
  const integration = await refreshTokenIfNeeded(companyId)

  const res = await fetch(`${HOVER_API_BASE}/jobs/${jobId}`, {
    headers: {
      Authorization: `Bearer ${integration.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error(`HOVER job fetch failed: ${res.status}`)
  }

  return res.json()
}

export function mapToMeasurementReport(hoverData: any) {
  const measurements = hoverData.measurements || hoverData.roof_measurements || {}
  const facets = measurements.facets || measurements.roof_facets || []

  const totalAreaSqft = facets.reduce((sum: number, f: any) => sum + (f.area_sqft || f.area || 0), 0)
  const totalSquares = totalAreaSqft / 100

  const segments = facets.map((f: any, i: number) => ({
    name: f.name || `Facet ${i + 1}`,
    area: f.area_sqft || f.area || 0,
    pitch: f.pitch || '',
    pitchDegrees: f.pitch_degrees || null,
    azimuthDegrees: f.azimuth_degrees || null,
  }))

  const pitchDegrees = segments
    .map((s: any) => s.pitchDegrees)
    .filter((p: any) => p != null)

  return {
    totalSquares: String(totalSquares.toFixed(2)),
    totalArea: String(totalAreaSqft.toFixed(2)),
    segments,
    pitchDegrees,
    rawData: hoverData,
  }
}
