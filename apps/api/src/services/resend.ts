// Resend factory-side service for domain authentication (DKIM/SPF).
// API docs: https://resend.com/docs/api-reference/domains
//
// We swapped from SendGrid to Resend in 2026-06 because SendGrid killed
// their free tier post-trial. This module is the API-shape match for
// services/sendgrid.ts — same DomainAuthResult interface so callers don't
// know or care which provider is underneath.

const RESEND_API = 'https://api.resend.com'
const FETCH_TIMEOUT = 30_000

function rsHeaders(): Record<string, string> {
  return {
    'Authorization': 'Bearer ' + (process.env.RESEND_API_KEY || process.env.TWOMIAH_RESEND_API_KEY || ''),
    'Content-Type': 'application/json',
  }
}

export function isResendConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY || process.env.TWOMIAH_RESEND_API_KEY)
}

async function rsFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(RESEND_API + path, {
    ...init,
    headers: { ...rsHeaders(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = data?.message || data?.error || text || res.statusText
    throw new Error('Resend API ' + res.status + ': ' + msg)
  }
  return data
}

// ─── Domain Authentication ───────────────────────────────────────────────

export interface DomainAuthRecord {
  type: 'cname' | 'txt' | 'mx'
  host: string
  data: string
  valid?: boolean
  priority?: number
}

export interface DomainAuthResult {
  // Resend uses string UUIDs; the sendgrid.ts shape uses number. The DB
  // column is jsonb-friendly, so we store the id as-is and let the caller
  // treat it as an opaque token.
  id: string
  domain: string
  valid: boolean
  records: DomainAuthRecord[]
}

/**
 * Registers the tenant's domain with Resend. Returns the DNS records that
 * must land on Cloudflare for verification to succeed. Resend's records
 * are usually 3-4 TXT entries (SPF, DKIM, DMARC suggestion) plus an
 * optional MX for receiving.
 */
export async function authenticateDomain(domain: string, opts: { region?: string } = {}): Promise<DomainAuthResult> {
  const body: any = { name: domain }
  if (opts.region) body.region = opts.region
  const data = await rsFetch('/domains', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return parseDomainAuth(data)
}

export async function pollDomainAuth(id: string): Promise<DomainAuthResult> {
  const data = await rsFetch('/domains/' + id)
  return parseDomainAuth(data)
}

/** Trigger Resend to re-check DNS after the tenant points records at us. */
export async function validateDomainAuth(id: string): Promise<DomainAuthResult> {
  await rsFetch('/domains/' + id + '/verify', { method: 'POST' })
  return pollDomainAuth(id)
}

export async function deleteDomainAuth(id: string): Promise<void> {
  await rsFetch('/domains/' + id, { method: 'DELETE' })
}

function parseDomainAuth(data: any): DomainAuthResult {
  // Resend's response shape:
  // { id, name, status: 'pending'|'verified'|'failed', records: [{ type, name, value, ttl, priority, status }] }
  const records: DomainAuthRecord[] = []
  for (const r of (data.records || [])) {
    const type = String(r.type || '').toLowerCase()
    if (type !== 'cname' && type !== 'txt' && type !== 'mx') continue
    records.push({
      type: type as DomainAuthRecord['type'],
      host: r.name || r.host || '',
      data: r.value || r.data || '',
      valid: r.status === 'verified',
      priority: typeof r.priority === 'number' ? r.priority : undefined,
    })
  }
  return {
    id: String(data.id || ''),
    domain: data.name || data.domain || '',
    valid: data.status === 'verified',
    records,
  }
}
