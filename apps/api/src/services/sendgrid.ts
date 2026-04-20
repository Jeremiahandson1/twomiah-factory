// SendGrid factory-side service.
// API docs: https://docs.sendgrid.com/api-reference
//
// Responsibilities:
//  - Domain Authentication (SPF/DKIM CNAME setup) so outbound email sent
//    from the tenant backend using the shared factory SendGrid key still
//    signs with the tenant's own domain.
//  - Inbound Parse registration (factory-wide, NOT per-tenant). One parse
//    hostname covers all "route-into-CRM" aliases. The webhook is
//    responsible for routing based on the recipient address.
//
// Why not per-tenant subusers in V1: SendGrid subusers isolate reputation
// per tenant, but cost more and add signup provisioning work. V1 uses a
// single shared account; we revisit at ~50 tenants.

const SG_API = 'https://api.sendgrid.com/v3'
const FETCH_TIMEOUT = 30_000

function sgHeaders(): Record<string, string> {
  return {
    'Authorization': 'Bearer ' + (process.env.TWOMIAH_SENDGRID_API_KEY || process.env.SENDGRID_API_KEY || ''),
    'Content-Type': 'application/json',
  }
}

export function isSendGridConfigured(): boolean {
  return !!(process.env.TWOMIAH_SENDGRID_API_KEY || process.env.SENDGRID_API_KEY)
}

async function sgFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(SG_API + path, {
    ...init,
    headers: { ...sgHeaders(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { /* non-JSON response */ }
  if (!res.ok) {
    const msg = (data?.errors && Array.isArray(data.errors)) ? data.errors.map((e: any) => e.message).join('; ') : (text || res.statusText)
    throw new Error('SendGrid API ' + res.status + ': ' + msg)
  }
  return data
}

// ─── Domain Authentication ───────────────────────────────────────────────────

export interface DomainAuthRecord {
  type: 'cname' | 'txt' | 'mx'
  host: string           // e.g. "em1234.theirbusiness.com"
  data: string           // CNAME target or TXT value
  valid?: boolean
  priority?: number
}

export interface DomainAuthResult {
  id: number
  domain: string
  valid: boolean
  records: DomainAuthRecord[]
}

/**
 * Registers the tenant's domain with SendGrid for sender authentication.
 * Returns the set of DNS records that must be added to Cloudflare for the
 * authentication to verify. After records are added, call pollDomainAuth
 * (or validateDomainAuth for a manual re-check) until valid=true.
 */
export async function authenticateDomain(domain: string, options: { subdomain?: string; customSpf?: boolean } = {}): Promise<DomainAuthResult> {
  const body: any = {
    domain,
    // Use 'em' as the default sending subdomain so our outbound goes from
    // e.g. em1234.theirbusiness.com — isolates their domain reputation
    // from non-SendGrid mail they might send independently.
    subdomain: options.subdomain ?? 'em',
    // custom_spf=false lets SendGrid manage its own SPF; we add our own
    // consolidated SPF TXT record separately at the apex.
    custom_spf: options.customSpf ?? false,
    default: false,
    // Manual validation — we poll ourselves after Cloudflare records land.
    automatic_security: true,
  }
  const data = await sgFetch('/whitelabel/domains', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return parseDomainAuth(data)
}

export async function pollDomainAuth(id: number): Promise<DomainAuthResult> {
  const data = await sgFetch('/whitelabel/domains/' + id)
  return parseDomainAuth(data)
}

/** Trigger SendGrid to re-check DNS. Call after tenant confirms records are live. */
export async function validateDomainAuth(id: number): Promise<DomainAuthResult> {
  // POST to /validate — returns a slightly different shape than GET /:id.
  const data = await sgFetch('/whitelabel/domains/' + id + '/validate', { method: 'POST' })
  // Validation response includes { id, valid, validation_results: {...} }.
  // Fetch the full record for the consistent shape the caller expects.
  return pollDomainAuth(data.id || id)
}

export async function deleteDomainAuth(id: number): Promise<void> {
  await sgFetch('/whitelabel/domains/' + id, { method: 'DELETE' })
}

function parseDomainAuth(data: any): DomainAuthResult {
  const records: DomainAuthRecord[] = []
  const dnsBlock = data.dns || {}
  for (const key of Object.keys(dnsBlock)) {
    const r = dnsBlock[key]
    if (!r || !r.type || !r.host) continue
    records.push({
      type: String(r.type).toLowerCase() as DomainAuthRecord['type'],
      host: r.host,
      data: r.data,
      valid: r.valid,
    })
  }
  return {
    id: data.id,
    domain: data.domain,
    valid: !!data.valid,
    records,
  }
}

// ─── Inbound Parse (factory-wide) ────────────────────────────────────────────
// Register once per parse hostname (e.g. "parse.twomiah.app"). All tenant
// "route-into-CRM" aliases forward via Cloudflare Email Routing to addresses
// on this hostname. The webhook routes by recipient address to the correct
// tenant backend.

export async function registerInboundParseHostname(hostname: string, webhookUrl: string): Promise<void> {
  await sgFetch('/user/webhooks/parse/settings', {
    method: 'POST',
    body: JSON.stringify({
      hostname,
      url: webhookUrl,
      spam_check: true,
      send_raw: false,
    }),
  })
}

export async function unregisterInboundParseHostname(hostname: string): Promise<void> {
  await sgFetch('/user/webhooks/parse/settings/' + encodeURIComponent(hostname), { method: 'DELETE' })
}

export async function listInboundParseSettings(): Promise<Array<{ hostname: string; url: string }>> {
  const data = await sgFetch('/user/webhooks/parse/settings')
  return Array.isArray(data?.result) ? data.result.map((r: any) => ({ hostname: r.hostname, url: r.url })) : []
}
