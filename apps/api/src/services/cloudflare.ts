// Cloudflare service — zone creation, DNS records, Email Routing rules.
// API reference: https://developers.cloudflare.com/api/
//
// IMPORTANT: Render + SendGrid CNAMEs must be DNS-only (proxied=false).
// - Render terminates TLS at their edge; proxying through Cloudflare would
//   cause a cert mismatch and 525s on the tenant's app.<domain> and website.
// - SendGrid domain-auth CNAMEs must resolve to SendGrid's hostnames
//   directly for DKIM verification.
// Apex/www records also need proxied=false unless we also terminate TLS at
// Cloudflare, which we don't. Keep the default off across the board.

const CF_API = 'https://api.cloudflare.com/client/v4'
const FETCH_TIMEOUT = 30_000

function headers(): Record<string, string> {
  return {
    'Authorization': 'Bearer ' + (process.env.CLOUDFLARE_API_TOKEN || ''),
    'Content-Type': 'application/json',
  }
}

function accountId(): string {
  return process.env.CLOUDFLARE_ACCOUNT_ID || ''
}

export function isCloudflareConfigured(): boolean {
  return !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
}

async function cfFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(CF_API + path, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || data.success === false) {
    const err = Array.isArray(data?.errors) && data.errors.length ? data.errors.map((e: any) => e.message).join('; ') : res.statusText
    throw new Error('Cloudflare API ' + res.status + ': ' + err)
  }
  return data.result
}

export interface CreatedZone {
  zoneId: string
  domain: string
  nameServers: string[]
  status: string
}

export async function createZone(domain: string): Promise<CreatedZone> {
  // jump_start=false: don't attempt to import existing records; we're going
  // to write everything ourselves. Default plan is free.
  const result = await cfFetch('/zones', {
    method: 'POST',
    body: JSON.stringify({
      name: domain,
      account: { id: accountId() },
      jump_start: false,
      type: 'full',
    }),
  })
  return {
    zoneId: result.id,
    domain: result.name,
    nameServers: result.name_servers || [],
    status: result.status,
  }
}

export async function deleteZone(zoneId: string): Promise<void> {
  await cfFetch('/zones/' + zoneId, { method: 'DELETE' })
}

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX'

export interface DnsRecordSpec {
  type: DnsRecordType
  name: string          // e.g. "@" for apex, "app" for subdomain, "_dmarc" for DMARC
  content: string
  priority?: number     // MX only
  ttl?: number          // Default 1 = auto
  proxied?: boolean     // Always false for our V1 use cases; see file-header comment
}

export async function addDnsRecord(zoneId: string, rec: DnsRecordSpec): Promise<{ id: string }> {
  const body: any = {
    type: rec.type,
    name: rec.name,
    content: rec.content,
    ttl: rec.ttl ?? 1,
    proxied: rec.proxied ?? false,
  }
  if (rec.type === 'MX') body.priority = rec.priority ?? 10
  const result = await cfFetch('/zones/' + zoneId + '/dns_records', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return { id: result.id }
}

export async function listDnsRecords(zoneId: string): Promise<Array<{ id: string; type: string; name: string; content: string; proxied: boolean }>> {
  const result = await cfFetch('/zones/' + zoneId + '/dns_records?per_page=100')
  return Array.isArray(result) ? result : []
}

export async function deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
  await cfFetch('/zones/' + zoneId + '/dns_records/' + recordId, { method: 'DELETE' })
}

// ─── Email Routing ───────────────────────────────────────────────────────────
// Enabling Email Routing provisions Cloudflare's MX records automatically.
// After enabling we add destination addresses (each tenant email forwarder
// target) and rules (one per alias: localPart → destination).

export async function enableEmailRouting(zoneId: string): Promise<void> {
  await cfFetch('/zones/' + zoneId + '/email/routing/enable', { method: 'POST' })
}

export async function addEmailDestinationAddress(destination: string): Promise<{ tag: string; verified: boolean }> {
  // Account-scoped, not zone-scoped — destinations are reusable across zones
  // on the same account and must be verified before a rule can send to them.
  const result = await cfFetch('/accounts/' + accountId() + '/email/routing/addresses', {
    method: 'POST',
    body: JSON.stringify({ email: destination }),
  })
  return { tag: result.tag, verified: !!result.verified }
}

export interface EmailRoutingRule {
  ruleTag?: string
  matcherValue: string        // e.g. "support@theirbusiness.com"
  forwardTo: string           // verified destination email
  enabled?: boolean
  name?: string
  priority?: number
}

export async function addEmailRoutingRule(zoneId: string, rule: EmailRoutingRule): Promise<{ tag: string }> {
  const body = {
    name: rule.name || ('alias_' + rule.matcherValue.split('@')[0]),
    enabled: rule.enabled ?? true,
    priority: rule.priority ?? 0,
    matchers: [
      { type: 'literal', field: 'to', value: rule.matcherValue },
    ],
    actions: [
      { type: 'forward', value: [rule.forwardTo] },
    ],
  }
  const result = await cfFetch('/zones/' + zoneId + '/email/routing/rules', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return { tag: result.tag }
}

export async function updateEmailRoutingRule(zoneId: string, ruleTag: string, rule: EmailRoutingRule): Promise<void> {
  const body = {
    name: rule.name || ('alias_' + rule.matcherValue.split('@')[0]),
    enabled: rule.enabled ?? true,
    priority: rule.priority ?? 0,
    matchers: [
      { type: 'literal', field: 'to', value: rule.matcherValue },
    ],
    actions: [
      { type: 'forward', value: [rule.forwardTo] },
    ],
  }
  await cfFetch('/zones/' + zoneId + '/email/routing/rules/' + ruleTag, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function deleteEmailRoutingRule(zoneId: string, ruleTag: string): Promise<void> {
  await cfFetch('/zones/' + zoneId + '/email/routing/rules/' + ruleTag, { method: 'DELETE' })
}

export async function listEmailRoutingRules(zoneId: string): Promise<Array<{ tag: string; name: string; matcherValue: string; forwardTo: string[] }>> {
  const result = await cfFetch('/zones/' + zoneId + '/email/routing/rules?per_page=100')
  if (!Array.isArray(result)) return []
  return result.map((r: any) => ({
    tag: r.tag,
    name: r.name,
    matcherValue: r.matchers?.[0]?.value || '',
    forwardTo: r.actions?.[0]?.value || [],
  }))
}
