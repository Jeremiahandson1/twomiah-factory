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

/** Read current zone state — used by the customer-facing domain page
 * to tell the customer "your nameservers are still pending" vs "active". */
export async function getCloudflareZoneStatus(zoneId: string): Promise<{ status: string; nameServers: string[]; domain: string }> {
  const result = await cfFetch('/zones/' + zoneId)
  return {
    status: result.status,
    nameServers: result.name_servers || [],
    domain: result.name,
  }
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

// ─── Twomiah subdomain auto-attach ──────────────────────────────────────────
// Every premium tenant gets a `<slug>.twomiah.app` URL pointed at their
// Render website service. Customers can keep this as their public URL
// indefinitely, or layer their own BYOD domain on top of it later — both
// can coexist on the same Render service.
//
// Requires the twomiah.app zone to exist in Cloudflare under our account and
// its zone id set in env var TWOMIAH_APP_ZONE_ID. Returns null when the env
// var is unset so deploys still succeed in dev environments without the
// zone configured (caller logs but doesn't fail the deploy).

export function twomiahAppZoneId(): string | null {
  return process.env.TWOMIAH_APP_ZONE_ID || null
}

export function isTwomiahSubdomainConfigured(): boolean {
  return !!(twomiahAppZoneId() && isCloudflareConfigured())
}

/**
 * Idempotently create `<slug>.twomiah.app CNAME → <renderHost>`. If a record
 * already exists with that exact name, we keep it (re-deploy of the same
 * tenant won't duplicate records). If a record exists pointing to a
 * different target — e.g. tenant rotated Render services — we delete and
 * recreate so the new host wins.
 *
 * Returns the full subdomain (e.g. "acme-cleaning-mq2v.twomiah.app") on
 * success, null when not configured, throws on Cloudflare API error.
 */
export async function attachTwomiahSubdomain(
  slug: string,
  renderHost: string,
): Promise<string | null> {
  const zoneId = twomiahAppZoneId()
  if (!zoneId) return null
  // Cloudflare wants the FULL hostname here, not the leaf — listDnsRecords
  // returns names like "acme.twomiah.app" and addDnsRecord accepts the same.
  const fullName = slug + '.twomiah.app'

  const existing = await listDnsRecords(zoneId)
  const match = existing.find(r => r.type === 'CNAME' && r.name === fullName)
  if (match && match.content === renderHost) return fullName  // already wired
  if (match) await deleteDnsRecord(zoneId, match.id)  // stale target — recreate

  await addDnsRecord(zoneId, {
    type: 'CNAME',
    name: fullName,
    content: renderHost,
    proxied: false,  // Render terminates TLS at their edge; never proxy
  })
  return fullName
}

export async function detachTwomiahSubdomain(slug: string): Promise<void> {
  const zoneId = twomiahAppZoneId()
  if (!zoneId) return
  const fullName = slug + '.twomiah.app'
  const existing = await listDnsRecords(zoneId)
  for (const r of existing) {
    if (r.type === 'CNAME' && r.name === fullName) {
      await deleteDnsRecord(zoneId, r.id).catch(() => {})  // best-effort
    }
  }
}

// ─── WAF custom rules (Rulesets API) ────────────────────────────────────────
// We push our standard tenant ruleset to each customer zone idempotently —
// list the http_request_firewall_custom rulesets, find ours by description,
// then upsert the rule set. Reference:
// https://developers.cloudflare.com/ruleset-engine/

const WAF_RULESET_NAME = 'Twomiah tenant WAF rules'

interface WafRule {
  description: string
  expression: string
  action: 'block' | 'managed_challenge' | 'js_challenge' | 'log'
  enabled: boolean
}

const STANDARD_WAF_RULES: WafRule[] = [
  {
    description: 'Block obvious path traversal probes',
    expression: '(http.request.uri.path contains "..") or (http.request.uri.path contains "%2e%2e")',
    action: 'block',
    enabled: true,
  },
  {
    description: 'Block unverified bots',
    expression: '(cf.client.bot) and (not cf.verified_bot)',
    action: 'block',
    enabled: true,
  },
  {
    description: 'Challenge high-threat-score login attempts',
    expression: '(http.request.uri.path eq "/api/admin/login") and (cf.threat_score gt 10)',
    action: 'managed_challenge',
    enabled: true,
  },
  {
    description: 'Challenge medium-threat-score admin path access',
    // No reference to $cf_known_abusers — that's not a built-in Cloudflare list;
    // customers can add their own IP list rules separately if they want one.
    expression: '(starts_with(http.request.uri.path, "/api/admin/") or starts_with(http.request.uri.path, "/admin")) and (cf.threat_score gt 20)',
    action: 'managed_challenge',
    enabled: true,
  },
]

export async function applyTenantWafRules(zoneId: string): Promise<{ rulesetId: string; applied: number }> {
  // Find or create our custom ruleset for the zone
  const lists: any = await cfFetch('/zones/' + zoneId + '/rulesets')
  const existing = Array.isArray(lists) ? lists.find((r: any) => r.name === WAF_RULESET_NAME && r.phase === 'http_request_firewall_custom') : null

  const body = {
    name: WAF_RULESET_NAME,
    description: 'Managed by Twomiah Factory — do not edit manually; changes will be overwritten on next sync.',
    kind: 'zone' as const,
    phase: 'http_request_firewall_custom' as const,
    rules: STANDARD_WAF_RULES.map(r => ({
      description: r.description,
      expression: r.expression,
      action: r.action,
      enabled: r.enabled,
    })),
  }

  if (existing) {
    const updated = await cfFetch('/zones/' + zoneId + '/rulesets/' + existing.id, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    return { rulesetId: updated.id || existing.id, applied: STANDARD_WAF_RULES.length }
  } else {
    const created = await cfFetch('/zones/' + zoneId + '/rulesets', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { rulesetId: created.id, applied: STANDARD_WAF_RULES.length }
  }
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
