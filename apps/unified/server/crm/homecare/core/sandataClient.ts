// Transport for the Sandata intake API (alternate EVV: Sandata third-party spec v7.6; the state addendum supplies
// payer codes). Moved from templates/crm-homecare/backend/src/services/sandataClient.ts. Two-step protocol: POST
// records -> ACK with a transaction UUID -> GET /status?uuid= to learn per-record accept/reject.
//
// Endpoints:
//   UAT:  https://uat-api.sandata.com/interfaces/intake/{clients|employees|visits}/rest/api/v1.1
//   Prod: https://api.sandata.com/interfaces/intake/{clients|employees|visits}/rest/api/v1.1
//
// The account is the agency's own data (Integrations → EVV → Sandata account), with the SANDATA_* environment
// variables as a fallback. Entirely dormant until username, password, account id and provider id are all present:
// every caller checks isConfigured first.
//
// One change: the account is read from the company's own row (getConfig takes its id); the template read its
// database's only `agencies` row. postRecords / getStatus are unchanged and pure (network only).
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import { decrypt } from './encryption.ts'
import { resolveTimezone } from './agencyTime.ts'

export const UAT_BASE = 'https://uat-api.sandata.com/interfaces/intake'
export const PROD_BASE = 'https://api.sandata.com/interfaces/intake'

const STATE_NAMES: Record<string, string> = { WISCONSIN: 'WI' }

export function stateCode(state: string | null | undefined): string {
  const s = String(state || '').trim().toUpperCase()
  return STATE_NAMES[s] || s.slice(0, 2)
}

// Sandata's VisitTimeZone / ClientTimezone vocabulary.
export function sandataTimeZone(iana: string): string {
  if (/^US\//.test(iana)) return iana
  const z = iana
  if (z === 'America/Phoenix') return 'US/Arizona'
  if (z === 'America/Anchorage' || z === 'America/Juneau' || z === 'America/Nome' || z === 'America/Sitka') return 'US/Alaska'
  if (z === 'Pacific/Honolulu') return 'US/Hawaii'
  if (/^America\/(Los_Angeles)$/.test(z)) return 'US/Pacific'
  if (/^America\/(Denver|Boise)$/.test(z)) return 'US/Mountain'
  if (/^America\/(New_York|Detroit|Indiana\/|Kentucky\/)/.test(z)) return 'US/Eastern'
  return 'US/Central'
}

export interface SandataConfig {
  baseUrl: string
  username: string | null
  password: string | null
  accountId: string | null
  providerId: string | null
  isConfigured: boolean
  /** Two-letter agency state, '' when unknown. */
  state: string
  isWisconsin: boolean
  /** IANA zone used for EVV weeks and visit dates. */
  timezone: string
  /** The same zone in Sandata's vocabulary (US/Central …). */
  sandataTimeZone: string
  /** The agency id caregivers pick in Sandata Mobile Connect (shown in the caregiver help). */
  agencyId: string | null
}

export function entityUrl(cfg: SandataConfig, entity: 'clients' | 'employees' | 'visits'): string {
  return `${cfg.baseUrl}/${entity}/rest/api/v1.1`
}

function headers(cfg: SandataConfig): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`,
    Account: String(cfg.accountId),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

export interface PostResult { ok: boolean; status: number; data: any; uuid: string | null }

// POST one or more records (the spec allows 1–5000 per transaction; we send arrays).
export async function postRecords(cfg: SandataConfig, entity: 'clients' | 'employees' | 'visits', records: any): Promise<PostResult> {
  if (!cfg.isConfigured) throw new Error('Sandata not configured (username, password, account id and provider id)')
  const body = Array.isArray(records) ? records : [records]
  const response = await fetch(entityUrl(cfg, entity), {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  let data: any = null
  try { data = await response.json() } catch { /* non-JSON error body */ }
  const uuid = data?.uuid || data?.UUID || data?.id || null
  return { ok: response.ok, status: response.status, data, uuid }
}

export interface StatusResult {
  ok: boolean
  status: number
  /** false = Sandata is still processing ("not ready yet") — poll again later. */
  ready: boolean
  /** true when no record-level rejection came back. */
  accepted: boolean | null
  rejects: any[]
  records: any[]
  data: any
}

// GET the processing status for a prior POST's UUID.
export async function getStatus(cfg: SandataConfig, entity: 'clients' | 'employees' | 'visits', uuid: string): Promise<StatusResult> {
  if (!cfg.isConfigured) throw new Error('Sandata not configured')
  const response = await fetch(`${entityUrl(cfg, entity)}/status?uuid=${encodeURIComponent(uuid)}`, {
    method: 'GET',
    headers: headers(cfg),
    signal: AbortSignal.timeout(30_000),
  })
  let data: any = null
  try { data = await response.json() } catch { /* non-JSON */ }

  const text = JSON.stringify(data || '')
  if (/not ready/i.test(text)) return { ok: true, status: response.status, ready: false, accepted: null, rejects: [], records: [], data }

  // Response shape (spec 2.11): an array (or {records: []}) of
  // {AgencyIdentifier, ProviderID, RecordType, RecordOtherID, Reason}.
  const records = Array.isArray(data) ? data
    : Array.isArray(data?.records) ? data.records
    : Array.isArray(data?.data) ? data.data
    : []
  const rejects = records.filter((r: any) => {
    const reason = String(r.Reason || r.reason || '')
    return reason && !/transaction received|success|accepted/i.test(reason)
  })
  return { ok: response.ok, status: response.status, ready: true, accepted: response.ok && rejects.length === 0, rejects, records, data }
}

export function createSandataClient(d: CrmDeps) {
  /** The company's Sandata account (its own row, then the SANDATA_* fallback). */
  async function getConfig(companyId: string): Promise<SandataConfig> {
    let agency: any = null
    try { [agency] = await d.db.select().from(company).where(eq(company.id, companyId)).limit(1) } catch { agency = null }
    const env = process.env
    const username = agency?.sandataUsername || env.SANDATA_USERNAME || null
    const password = (agency?.sandataPasswordEncrypted ? decrypt(agency.sandataPasswordEncrypted) : null) || env.SANDATA_PASSWORD || null
    const accountId = agency?.sandataAccountId || env.SANDATA_ACCOUNT_ID || null
    const providerId = agency?.medicaidId || env.SANDATA_PROVIDER_ID || env.AGENCY_MEDICAID_ID || null
    const baseUrl = String(agency?.sandataApiUrl || env.SANDATA_API_URL || UAT_BASE).replace(/\/+$/, '')
    const state = stateCode(agency?.state)
    // EVV weeks and visit dates are on the agency's one clock (core/agencyTime.ts).
    const timezone = resolveTimezone(agency ? { timezone: agency.timezone, state } : null)
    return {
      baseUrl, username, password, accountId, providerId,
      isConfigured: !!(username && password && accountId && providerId),
      state,
      isWisconsin: state === 'WI',
      timezone,
      sandataTimeZone: sandataTimeZone(timezone),
      agencyId: agency?.sandataAgencyId || null,
    }
  }

  return { getConfig, postRecords, getStatus, entityUrl }
}

export type SandataClient = ReturnType<typeof createSandataClient>
