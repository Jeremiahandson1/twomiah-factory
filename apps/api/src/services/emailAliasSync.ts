// A tenant's branded email addresses (support@, admin@ …) on Cloudflare Email Routing.
//
// The addresses live in ONE place per business (aliasSource): the CRM's email_alias table when the tenant has a
// CRM, otherwise — a website-only premium tenant — the premium site's own email_alias table (its admin's Email
// page). Every change there is pushed one at a time
// (POST /customers/:id/email-alias-sync), but a push is lost whenever it cannot apply: the onboarding
// wizard saves the addresses before there is any domain, so every new signup's pushes answered 400 and
// nothing ever replayed them (E2E Run 5, 10/16). Mail to support@<their domain> would have gone nowhere.
//
// reconcileTenantAliases() closes that: it reads the addresses back from that one place (GET
// /api/internal/email-aliases on the CRM or on the premium site, X-Factory-Key) and makes Cloudflare match — Email Routing on, one rule per enabled address, each
// destination registered, rules for removed or switched-off addresses deleted. It is idempotent and runs
//   - when a domain is attached, bought or wired at deploy,
//   - when the Email Domain page sees the zone active,
//   - every hour (POST /internal/email-alias-sweep),
//   - each time the CRM's address page asks for the status.
// For mail to arrive, Cloudflare needs three things, so the answer names whichever is missing:
//   1. the zone ACTIVE (the domain's nameservers point at Cloudflare) — Email Routing works only on Cloudflare DNS;
//   2. Email Routing enabled on the zone (it writes the MX records);
//   3. the destination address CONFIRMED — a rule forwarding to an unconfirmed address stays off.
import * as cloudflareService from './cloudflare'
import { ourPremiumSiteOrigin } from './premiumSiteUrl'

export const LOCAL_PART_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/
/** Rules this module owns are named alias_<localPart>; nothing else on the zone is touched. */
export const RULE_PREFIX = 'alias_'

export interface CrmAlias { localPart: string; routingMode: 'forward' | 'crm'; forwardTo?: string | null; enabled: boolean }

export type AliasState = 'live' | 'confirm_destination' | 'waiting_for_domain' | 'waiting_for_nameservers' | 'off' | 'error'

export interface AliasStatusReport {
  state: 'live' | 'action_needed' | 'waiting_for_domain' | 'waiting_for_nameservers' | 'crm_needs_update' | 'error'
  domain: string | null
  nameservers?: string[]
  detail?: string
  aliases: Array<{ localPart: string; address: string | null; state: AliasState; destination?: string | null; detail?: string }>
}

export interface TenantForAliases {
  id: string
  domain?: string | null
  cloudflare_zone_id?: string | null
  render_backend_url?: string | null
  factory_sync_key?: string | null
  /** With slug + website_url, lets a website-only premium tenant's addresses be read from its site (aliasSource). */
  products?: string[] | null
  slug?: string | null
  website_url?: string | null
}

/** What every caller selects so aliasSource can decide — scripts/check-email-alias-readback.ts holds each select to it. */
export const ALIAS_TENANT_COLUMNS = 'id, slug, domain, products, website_url, factory_sync_key, cloudflare_zone_id, render_backend_url'

type Cf = Pick<typeof cloudflareService,
  'isCloudflareConfigured' | 'getCloudflareZoneStatus' | 'getEmailRoutingSettings' | 'enableEmailRouting' |
  'listEmailRoutingRules' | 'addEmailRoutingRule' | 'updateEmailRoutingRule' | 'deleteEmailRoutingRule' |
  'listEmailDestinationAddresses' | 'addEmailDestinationAddress' | 'deleteEmailDestinationAddress'>

export interface AliasSyncDeps {
  cf: Cf
  fetch: typeof fetch
  /** SENDGRID_INBOUND_PARSE_HOSTNAME — where "route into the CRM" addresses forward to. */
  parseHost: string
}

export const defaultDeps = (): AliasSyncDeps => ({
  cf: cloudflareService,
  fetch: globalThis.fetch.bind(globalThis),
  parseHost: process.env.SENDGRID_INBOUND_PARSE_HOSTNAME || '',
})

/** Where an address's mail goes: the forward-to inbox, or the CRM's inbound-parse address. */
export function aliasDestination(tenantId: string, alias: CrmAlias, parseHost: string): { destination: string } | { error: string } {
  if (alias.routingMode === 'crm') {
    if (!parseHost) return { error: 'Into-the-CRM mail is not set up on the Factory (SENDGRID_INBOUND_PARSE_HOSTNAME)' }
    return { destination: tenantId.replace(/-/g, '') + '-' + alias.localPart + '@' + parseHost }
  }
  const to = String(alias.forwardTo || '').trim().toLowerCase()
  if (!to.includes('@')) return { error: 'No forward-to address' }
  return { destination: to }
}

const matcherOf = (localPart: string, domain: string) => (localPart + '@' + domain).toLowerCase()
const localPartOf = (matcher: string, domain: string) => {
  const m = String(matcher || '').toLowerCase()
  return m.endsWith('@' + domain.toLowerCase()) ? m.slice(0, -(domain.length + 1)) : null
}

const hasCrmProduct = (products: string[]) => products.some((p) => p === 'crm' || String(p).startsWith('crm-'))

/**
 * Where this tenant's addresses are kept — ONE place per business, never both:
 *   - a CRM (render_backend_url) → the CRM. Its address page is where the owner manages them; the premium
 *     site's Email page sends the owner there.
 *   - products include a CRM but no CRM URL is recorded → nothing (an error). Reading the site instead
 *     would delete, as "removed", every rule the CRM's addresses made.
 *   - no CRM, a premium website → the site we serve (ourPremiumSiteOrigin; never the intake's old website_url).
 * products unknown (a caller that did not select it) → the CRM or nothing, as before.
 */
export function aliasSource(tenant: TenantForAliases): { kind: 'crm' | 'site'; origin: string } | { error: string } {
  if (tenant.render_backend_url) return { kind: 'crm', origin: tenant.render_backend_url.replace(/\/+$/, '') }
  const products = Array.isArray(tenant.products) ? tenant.products : null
  if (!products || hasCrmProduct(products)) return { error: 'The CRM is not provisioned yet' }
  if (!products.includes('website-premium')) return { error: 'This company has no CRM or premium website to keep addresses in' }
  const site = ourPremiumSiteOrigin(tenant)
  if (!site) return { error: 'The website is not deployed yet' }
  return { kind: 'site', origin: site }
}

/**
 * The tenant's addresses, read from aliasSource. A reason when they cannot be read; 'missing' when that CRM
 * or site predates the endpoint.
 */
export async function readTenantAliases(tenant: TenantForAliases, deps: AliasSyncDeps): Promise<{ aliases: CrmAlias[]; source: 'crm' | 'site' } | { missing: true; source: 'crm' | 'site' } | { error: string }> {
  const src = aliasSource(tenant)
  if ('error' in src) return src
  const who = src.kind === 'crm' ? 'The CRM' : 'The website'
  if (!tenant.factory_sync_key) return { error: who + ' has no Factory key yet' }
  try {
    const res = await deps.fetch(src.origin + '/api/internal/email-aliases', {
      headers: { 'X-Factory-Key': tenant.factory_sync_key },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) return { missing: true, source: src.kind }
    if (!res.ok) return { error: who + ' answered ' + res.status }
    const body: any = await res.json().catch(() => null)
    const list = Array.isArray(body?.aliases) ? body.aliases : null
    if (!list) return { error: who + ' sent no address list' }
    return {
      source: src.kind,
      aliases: list
        .map((a: any) => ({
          localPart: String(a?.localPart || '').trim().toLowerCase(),
          routingMode: a?.routingMode === 'crm' ? 'crm' as const : 'forward' as const,
          forwardTo: a?.forwardTo ?? null,
          enabled: a?.enabled !== false,
        }))
        .filter((a: CrmAlias) => LOCAL_PART_RE.test(a.localPart)),
    }
  } catch (e: any) {
    return { error: who + ' did not answer: ' + (e?.message || 'network error') }
  }
}

/**
 * Make one address's rule match the CRM (the per-change push and the reconcile both come here).
 * `rules` is the zone's current rule list when the caller already has it.
 */
export async function applyAliasRule(
  deps: AliasSyncDeps, zoneId: string, domain: string, tenantId: string, alias: CrmAlias,
  rules?: Array<{ tag: string; name: string; matcherValue: string; forwardTo: string[] }>,
): Promise<{ action: 'created' | 'updated' | 'unchanged' | 'removed' | 'noop'; destination?: string; error?: string; ruleTag?: string }> {
  const matcher = matcherOf(alias.localPart, domain)
  const all = rules || await deps.cf.listEmailRoutingRules(zoneId)
  const same = all.filter((r) => String(r.matcherValue || '').toLowerCase() === matcher)
  if (!alias.enabled) {
    for (const r of same) await deps.cf.deleteEmailRoutingRule(zoneId, r.tag)
    return { action: same.length ? 'removed' : 'noop' }
  }
  const d = aliasDestination(tenantId, alias, deps.parseHost)
  if ('error' in d) return { action: 'noop', error: d.error }
  const rule = { matcherValue: matcher, forwardTo: d.destination, enabled: true, name: RULE_PREFIX + alias.localPart }
  const [keep, ...dupes] = same
  for (const r of dupes) await deps.cf.deleteEmailRoutingRule(zoneId, r.tag) // two writers raced once: one rule per address
  if (!keep) {
    const created = await deps.cf.addEmailRoutingRule(zoneId, rule)
    return { action: 'created', destination: d.destination, ruleTag: created.tag }
  }
  const current = (keep.forwardTo || []).map((x) => String(x).toLowerCase())
  if (current.length === 1 && current[0] === d.destination && keep.name === rule.name) return { action: 'unchanged', destination: d.destination, ruleTag: keep.tag }
  await deps.cf.updateEmailRoutingRule(zoneId, keep.tag, rule)
  return { action: 'updated', destination: d.destination, ruleTag: keep.tag }
}

/** Register a destination with Cloudflare (which emails it a confirmation link) unless it already is. */
async function ensureDestination(deps: AliasSyncDeps, known: Map<string, { id: string; verified: boolean }>, destination: string) {
  if (known.has(destination)) return
  try {
    const added = await deps.cf.addEmailDestinationAddress(destination)
    known.set(destination, { id: added.tag, verified: added.verified })
  } catch (e: any) {
    if (!String(e?.message || '').toLowerCase().includes('already')) throw e
    known.set(destination, { id: '', verified: false })
  }
}

/** Bring Cloudflare in line with the CRM's addresses and say where each one stands. Never throws. */
export async function reconcileTenantAliases(tenant: TenantForAliases, deps: AliasSyncDeps = defaultDeps()): Promise<AliasStatusReport> {
  const domain = tenant.domain ? String(tenant.domain).trim().toLowerCase() : null
  const read = await readTenantAliases(tenant, deps)
  if ('missing' in read) {
    return {
      state: 'crm_needs_update', domain, aliases: [],
      detail: read.source === 'site'
        ? 'This website was built before addresses could be read back; update it from the Factory to set them up'
        : 'This CRM was built before addresses could be read back; update it from the Factory to set them up',
    }
  }
  const crmAliases = 'aliases' in read ? read.aliases : []
  const rows = (state: AliasState, detail?: string) => crmAliases.map((a) => ({
    localPart: a.localPart, address: domain ? a.localPart + '@' + domain : null,
    state: a.enabled ? state : 'off' as AliasState, ...(a.enabled && detail ? { detail } : {}),
  }))

  if (!domain || !tenant.cloudflare_zone_id) {
    return { state: 'waiting_for_domain', domain, aliases: rows('waiting_for_domain'), ...('error' in read ? { detail: read.error } : {}) }
  }
  if ('error' in read) return { state: 'error', domain, aliases: [], detail: read.error }
  if (!deps.cf.isCloudflareConfigured()) return { state: 'error', domain, aliases: rows('error', 'Cloudflare is not configured on the Factory'), detail: 'Cloudflare is not configured on the Factory' }

  const zoneId = tenant.cloudflare_zone_id
  try {
    const zone = await deps.cf.getCloudflareZoneStatus(zoneId)
    if (zone.status !== 'active') {
      return { state: 'waiting_for_nameservers', domain, nameservers: zone.nameServers, aliases: rows('waiting_for_nameservers') }
    }

    // 2. Email Routing on (wiring tried it at attach time, when a customer's own domain is still pending).
    const settings = await deps.cf.getEmailRoutingSettings(zoneId).catch(() => ({ enabled: false, status: '' }))
    if (!settings.enabled) {
      try { await deps.cf.enableEmailRouting(zoneId) } catch (e: any) {
        if (!String(e?.message || '').toLowerCase().includes('already')) {
          return { state: 'error', domain, aliases: rows('error', 'Email Routing could not be turned on'), detail: 'Email Routing could not be turned on: ' + e.message }
        }
      }
    }

    // 3. Rules + destinations.
    const rules = await deps.cf.listEmailRoutingRules(zoneId)
    let known = new Map<string, { id: string; verified: boolean }>()
    let confirmationsKnown = true
    try {
      for (const a of await deps.cf.listEmailDestinationAddresses()) known.set(a.email, { id: a.id, verified: a.verified })
    } catch { confirmationsKnown = false }

    const out: AliasStatusReport['aliases'] = []
    for (const a of crmAliases) {
      const address = a.localPart + '@' + domain
      // The inbox is registered FIRST — that is what makes Cloudflare send its confirmation email. Cloudflare refuses a
      // rule to an inbox it does not have, so registering it after the rule never ran: the owner was told to click an
      // email that was never sent (Perch and Prarie, 10/29: three addresses "Not set up", "Destination address is not
      // verified").
      const pre = a.enabled ? aliasDestination(tenant.id, a, deps.parseHost) : null
      if (pre && !('error' in pre)) await ensureDestination(deps, known, pre.destination).catch(() => {})
      const waitingOn = (dest: string) => ({
        localPart: a.localPart, address, destination: dest, state: 'confirm_destination' as const,
        detail: a.routingMode === 'crm'
          ? 'Cloudflare sent a confirmation email to this address\'s CRM inbox — open it there and click "Verify email address"'
          : 'Cloudflare sent a confirmation email to ' + dest + ' — open it and click "Verify email address" (check spam). This address turns on by itself after that.',
      })
      try {
        const r = await applyAliasRule(deps, zoneId, domain, tenant.id, a, rules)
        if (!a.enabled) { out.push({ localPart: a.localPart, address, state: 'off' }); continue }
        if (r.error || !r.destination) { out.push({ localPart: a.localPart, address, state: 'error', detail: r.error }); continue }
        await ensureDestination(deps, known, r.destination)
        const confirmed = known.get(r.destination)?.verified === true
        out.push({
          localPart: a.localPart, address, destination: r.destination,
          state: confirmed ? 'live' : 'confirm_destination',
          ...(confirmed ? {} : {
            detail: !confirmationsKnown
              ? 'Could not check whether ' + r.destination + ' has confirmed'
              : a.routingMode === 'crm'
                ? 'Cloudflare sent a confirmation email to this address\'s CRM inbox — open it there and click "Verify email address"'
                : 'Cloudflare sent a confirmation email to ' + r.destination + ' — open it and click "Verify email address"',
          }),
        })
      } catch (e: any) {
        // An inbox not confirmed yet is the owner's one step, not a failure.
        if (pre && !('error' in pre) && /not verified|unverified/i.test(String(e?.message || ''))) { out.push(waitingOn(pre.destination)); continue }
        out.push({ localPart: a.localPart, address, state: 'error', detail: e?.message || 'Cloudflare refused the rule' })
      }
    }

    // Rules this module made for addresses the CRM no longer has (deleted while the push could not land).
    const wanted = new Set(crmAliases.map((a) => a.localPart))
    for (const r of rules) {
      const lp = localPartOf(r.matcherValue, domain)
      if (lp && String(r.name || '').startsWith(RULE_PREFIX) && !wanted.has(lp)) {
        await deps.cf.deleteEmailRoutingRule(zoneId, r.tag).catch(() => {})
      }
    }

    const needs = out.some((a) => a.state === 'confirm_destination' || a.state === 'error')
    return { state: needs ? 'action_needed' : 'live', domain, aliases: out }
  } catch (e: any) {
    return { state: 'error', domain, aliases: rows('error', 'Cloudflare did not answer'), detail: e?.message || 'Cloudflare did not answer' }
  }
}

/** Send a destination's confirmation email again (Cloudflare has no resend: remove the unconfirmed entry and add it back). */
export async function resendDestinationConfirmation(destination: string, deps: AliasSyncDeps = defaultDeps()): Promise<{ ok: boolean; alreadyConfirmed?: boolean; error?: string }> {
  const email = destination.trim().toLowerCase()
  const existing = (await deps.cf.listEmailDestinationAddresses()).find((a) => a.email === email)
  if (existing?.verified) return { ok: true, alreadyConfirmed: true }
  if (existing?.id) await deps.cf.deleteEmailDestinationAddress(existing.id)
  await deps.cf.addEmailDestinationAddress(email)
  return { ok: true }
}

/** Reconcile without holding up the caller (domain attach, buy, deploy, the Email Domain page). Logs the outcome. */
export function reconcileAliasesInBackground(tenant: TenantForAliases & { slug?: string }): void {
  reconcileTenantAliases(tenant)
    .then((r) => console.log('[EmailAliases]', tenant.slug || tenant.id, r.state, r.aliases.filter((a) => a.state === 'live').length + '/' + r.aliases.length, 'live'))
    .catch((e: any) => console.warn('[EmailAliases] reconcile failed for', tenant.slug || tenant.id, '-', e?.message))
}
