// Branded email addresses saved before a domain exists get set up once it does (E2E Run 5, 10/16).
//
// The onboarding wizard saves support@ / admin@ in the CRM before any domain is connected; the per-change
// push to the Factory answered 400 and nothing replayed it, so support@<their domain> never forwarded.
// Now the Factory reads the CRM's addresses back and makes Cloudflare match (services/emailAliasSync.ts).
// Driven here against a fake Cloudflare and a fake CRM — no network, no real account:
//   1. no domain → every address "waiting for your domain"; nothing written to Cloudflare
//   2. domain attached, zone pending → "waiting for nameservers" with the nameservers; still nothing written
//   3. zone active → Email Routing turned on, one rule per enabled address (forward + into-CRM), each
//      destination registered, the switched-off address's rule removed, a stale alias_ rule removed, a
//      rule this module did not make left alone; states live / confirm the inbox
//   4. a second run changes nothing; a duplicate rule collapses to one; a changed forward-to updates
//   5. a CRM built before the read-back → "crm_needs_update"; a CRM that errors → "error"; never throws
//   6. resend: a confirmed inbox is left alone; an unconfirmed one is removed and added again
//   7. a website-only premium tenant (no CRM): the addresses are read back from ITS SITE (the site we serve,
//      never the intake's old website_url) and set up; a tenant whose products include a CRM but whose CRM URL
//      was never recorded is NOT read from the site (that would delete the CRM's rules) — nothing is touched;
//      a CRM, when there is one, always wins; a site built before the read-back says "update it"
// The CRM side (the internal list, /status, resend) runs in the home care suite against the real routes
// and table: tests/homecare/email-alias-readback.test.ts.
//   bun tests/shared/email-alias-sync.test.ts

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 700)) }
}

const ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const sync = await import(ROOT + 'apps/api/src/services/emailAliasSync.ts')

const TENANT = '0123abcd-0000-4000-8000-00000000beef'
const PARSE = 'parse.twomiah.test'
const COMPACT = TENANT.replace(/-/g, '') // the tenant id without dashes, as the parse address carries it

// ── a fake Cloudflare account: zone status, Email Routing, rules, destination addresses ──────────────
function fakeCloudflare(opts: { zone?: string; routingOn?: boolean } = {}) {
  const st = {
    zone: opts.zone || 'pending', routingOn: !!opts.routingOn, enables: 0,
    rules: [] as Array<{ tag: string; name: string; matcherValue: string; forwardTo: string[] }>,
    destinations: [] as Array<{ id: string; email: string; verified: boolean }>,
    writes: [] as string[], seq: 0,
  }
  const cf = {
    isCloudflareConfigured: () => true,
    getCloudflareZoneStatus: async () => ({ status: st.zone, nameServers: ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'], domain: 'pat-care.com' }),
    getEmailRoutingSettings: async () => ({ enabled: st.routingOn, status: st.routingOn ? 'ready' : 'unconfigured' }),
    enableEmailRouting: async () => { st.enables++; st.routingOn = true; st.writes.push('enable') },
    listEmailRoutingRules: async () => st.rules.map((r) => ({ ...r, forwardTo: [...r.forwardTo] })),
    addEmailRoutingRule: async (_z: string, r: any) => { const tag = 'r' + (++st.seq); st.rules.push({ tag, name: r.name, matcherValue: r.matcherValue, forwardTo: [r.forwardTo] }); st.writes.push('add ' + r.matcherValue); return { tag } },
    updateEmailRoutingRule: async (_z: string, tag: string, r: any) => { const x = st.rules.find((y) => y.tag === tag)!; x.name = r.name; x.forwardTo = [r.forwardTo]; st.writes.push('update ' + r.matcherValue) },
    deleteEmailRoutingRule: async (_z: string, tag: string) => { const x = st.rules.find((y) => y.tag === tag); st.rules = st.rules.filter((y) => y.tag !== tag); st.writes.push('delete ' + (x?.matcherValue || tag)) },
    listEmailDestinationAddresses: async () => st.destinations.map((d) => ({ ...d })),
    addEmailDestinationAddress: async (email: string) => { const id = 'd' + (++st.seq); st.destinations.push({ id, email, verified: false }); st.writes.push('destination ' + email); return { tag: id, verified: false } },
    deleteEmailDestinationAddress: async (id: string) => { st.destinations = st.destinations.filter((d) => d.id !== id); st.writes.push('destination-delete ' + id) },
  }
  return { st, cf }
}

// ── a fake CRM answering GET /api/internal/email-aliases ─────────────────────────────────────────────
let crmAliases: any[] = []
let crmStatus = 200
const crmCalls: Array<{ url: string; key: string | null }> = []
const fakeFetch = (async (url: any, init?: any) => {
  crmCalls.push({ url: String(url), key: init?.headers?.['X-Factory-Key'] ?? null })
  if (crmStatus !== 200) return new Response(JSON.stringify({ error: 'nope' }), { status: crmStatus })
  return new Response(JSON.stringify({ aliases: crmAliases }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as any

const tenant = (o: Record<string, unknown> = {}) => ({ id: TENANT, slug: 'pat-care', domain: null, cloudflare_zone_id: null, render_backend_url: 'https://pat-care-care-api.onrender.com', factory_sync_key: 'k-123', ...o })
crmAliases = [
  { localPart: 'support', routingMode: 'forward', forwardTo: 'Owner@Gmail.com', enabled: true },
  { localPart: 'admin', routingMode: 'forward', forwardTo: 'owner@gmail.com', enabled: true },
  { localPart: 'care', routingMode: 'crm', forwardTo: null, enabled: true },
  { localPart: 'billing', routingMode: 'forward', forwardTo: 'books@example.com', enabled: false },
]

// ── 1. no domain ──────────────────────────────────────────────────────────────────────────────────
{
  const { st, cf } = fakeCloudflare()
  const r = await sync.reconcileTenantAliases(tenant(), { cf, fetch: fakeFetch, parseHost: PARSE })
  check(`no domain: "waiting for your domain" (${r.state})`, r.state === 'waiting_for_domain' && r.domain === null, r)
  check('…every saved address is listed, the switched-off one as off', r.aliases.length === 4 && r.aliases.filter((a: any) => a.state === 'waiting_for_domain').length === 3 && r.aliases.find((a: any) => a.localPart === 'billing')?.state === 'off', r.aliases)
  check('…the CRM was asked with its own Factory key', crmCalls.at(-1)?.url === 'https://pat-care-care-api.onrender.com/api/internal/email-aliases' && crmCalls.at(-1)?.key === 'k-123', crmCalls.at(-1))
  check('…and nothing was written to Cloudflare', st.writes.length === 0, st.writes)
}

// ── 2. domain attached, nameservers not changed yet ──────────────────────────────────────────────────
{
  const { st, cf } = fakeCloudflare({ zone: 'pending' })
  const r = await sync.reconcileTenantAliases(tenant({ domain: 'Pat-Care.com', cloudflare_zone_id: 'z1' }), { cf, fetch: fakeFetch, parseHost: PARSE })
  check(`pending zone: "waiting for nameservers", naming them (${r.state})`, r.state === 'waiting_for_nameservers' && r.nameservers?.length === 2 && r.domain === 'pat-care.com', r)
  check('…addresses shown on the domain', r.aliases.find((a: any) => a.localPart === 'support')?.address === 'support@pat-care.com', r.aliases)
  check('…nothing written while Cloudflare cannot route', st.writes.length === 0, st.writes)
}

// ── 3. zone active: the addresses saved in onboarding are set up ──────────────────────────────────────
const live = fakeCloudflare({ zone: 'active', routingOn: false })
live.st.rules.push(
  { tag: 'old', name: 'alias_sales', matcherValue: 'sales@pat-care.com', forwardTo: ['owner@gmail.com'] },        // deleted in the CRM while the push could not land
  { tag: 'billing-rule', name: 'alias_billing', matcherValue: 'billing@pat-care.com', forwardTo: ['books@example.com'] }, // switched off in the CRM
  { tag: 'theirs', name: 'catch all', matcherValue: 'hello@pat-care.com', forwardTo: ['someone@else.com'] },     // not ours
)
live.st.destinations.push({ id: 'dg', email: 'owner@gmail.com', verified: true })
const T = tenant({ domain: 'pat-care.com', cloudflare_zone_id: 'z1' })
{
  const r = await sync.reconcileTenantAliases(T, { cf: live.cf, fetch: fakeFetch, parseHost: PARSE })
  const by = (lp: string) => r.aliases.find((a: any) => a.localPart === lp)
  check('Email Routing is turned on (attach time could not: the zone was pending)', live.st.enables === 1, live.st)
  check('one rule per enabled address, forward-to lower-cased', ['support', 'admin'].every((lp) => live.st.rules.some((x) => x.matcherValue === lp + '@pat-care.com' && x.forwardTo[0] === 'owner@gmail.com' && x.name === 'alias_' + lp)), live.st.rules)
  check('the into-CRM address forwards to its inbound-parse address', live.st.rules.some((x) => x.matcherValue === 'care@pat-care.com' && x.forwardTo[0] === COMPACT + '-care@' + PARSE), live.st.rules)
  check('the switched-off address\'s rule is removed', !live.st.rules.some((x) => x.matcherValue === 'billing@pat-care.com'), live.st.rules)
  check('a stale alias_ rule (address deleted in the CRM) is removed', !live.st.rules.some((x) => x.tag === 'old'), live.st.rules)
  check('a rule this module did not make is left alone', live.st.rules.some((x) => x.tag === 'theirs'), live.st.rules)
  check('an inbox already confirmed is not registered again; a new one is (Cloudflare emails it)', live.st.writes.filter((w) => w.startsWith('destination ')).join() === 'destination ' + COMPACT + '-care@' + PARSE, live.st.writes)
  check(`states: confirmed inbox → live (${by('support')?.state}, ${by('admin')?.state})`, by('support')?.state === 'live' && by('admin')?.state === 'live', r.aliases)
  check(`…unconfirmed → confirm the inbox, said where (${by('care')?.state})`, by('care')?.state === 'confirm_destination' && /CRM inbox/.test(by('care')?.detail || ''), by('care'))
  check(`…overall "action needed" while one waits (${r.state})`, r.state === 'action_needed', r)
}

// ── 4. idempotent; duplicates collapse; a changed forward-to updates ─────────────────────────────────
{
  live.st.writes = []
  live.st.destinations.find((d) => d.email.endsWith('@' + PARSE))!.verified = true
  const r = await sync.reconcileTenantAliases(T, { cf: live.cf, fetch: fakeFetch, parseHost: PARSE })
  check(`a second run writes nothing (${JSON.stringify(live.st.writes)})`, live.st.writes.length === 0, live.st.writes)
  check(`…and once every inbox has confirmed: live (${r.state})`, r.state === 'live' && r.aliases.filter((a: any) => a.state === 'live').length === 3, r)

  live.st.rules.push({ tag: 'dupe', name: 'alias_support', matcherValue: 'support@pat-care.com', forwardTo: ['owner@gmail.com'] })
  crmAliases[0] = { ...crmAliases[0], forwardTo: 'office@pat-care-mail.com' }
  live.st.writes = []
  const r2 = await sync.reconcileTenantAliases(T, { cf: live.cf, fetch: fakeFetch, parseHost: PARSE })
  check('two rules for one address collapse to one', live.st.rules.filter((x) => x.matcherValue === 'support@pat-care.com').length === 1, live.st.rules)
  check('a changed forward-to updates the rule and registers the new inbox', live.st.rules.find((x) => x.matcherValue === 'support@pat-care.com')?.forwardTo[0] === 'office@pat-care-mail.com' && live.st.writes.includes('destination office@pat-care-mail.com'), live.st.writes)
  check('…which waits for its confirmation', r2.aliases.find((a: any) => a.localPart === 'support')?.state === 'confirm_destination', r2.aliases)
}

// ── 5. a CRM that cannot answer ─────────────────────────────────────────────────────────────────────
{
  const { cf } = fakeCloudflare({ zone: 'active', routingOn: true })
  crmStatus = 404
  const old = await sync.reconcileTenantAliases(T, { cf, fetch: fakeFetch, parseHost: PARSE })
  check(`a CRM built before the read-back: "crm_needs_update" (${old.state})`, old.state === 'crm_needs_update', old)
  crmStatus = 500
  const bad = await sync.reconcileTenantAliases(T, { cf, fetch: fakeFetch, parseHost: PARSE })
  check(`a CRM that errors: "error", with the reason (${bad.state})`, bad.state === 'error' && /500/.test(bad.detail || ''), bad)
  crmStatus = 200
  const throwing = { ...cf, getCloudflareZoneStatus: async () => { throw new Error('Cloudflare API 503: down') } }
  const cfDown = await sync.reconcileTenantAliases(T, { cf: throwing as any, fetch: fakeFetch, parseHost: PARSE })
  check('Cloudflare down: an "error" report, not a throw', cfDown.state === 'error' && /503/.test(cfDown.detail || ''), cfDown)
  const noParse = await sync.reconcileTenantAliases(T, { cf, fetch: fakeFetch, parseHost: '' })
  check('into-CRM with no parse host configured: that address alone says why', noParse.aliases.find((a: any) => a.localPart === 'care')?.state === 'error' && /SENDGRID_INBOUND_PARSE_HOSTNAME/.test(noParse.aliases.find((a: any) => a.localPart === 'care')?.detail || ''), noParse.aliases)
}

// ── 6. resend a confirmation ──────────────────────────────────────────────────────────────────────
{
  const { st, cf } = fakeCloudflare({ zone: 'active', routingOn: true })
  st.destinations.push({ id: 'ok1', email: 'owner@gmail.com', verified: true }, { id: 'no1', email: 'office@pat-care-mail.com', verified: false })
  const a = await sync.resendDestinationConfirmation('Owner@Gmail.com', { cf, fetch: fakeFetch, parseHost: PARSE })
  check('a confirmed inbox is left alone', a.ok && a.alreadyConfirmed === true && st.writes.length === 0, { a, writes: st.writes })
  const b = await sync.resendDestinationConfirmation('office@pat-care-mail.com', { cf, fetch: fakeFetch, parseHost: PARSE })
  check('an unconfirmed one is removed and added again (Cloudflare re-sends)', b.ok && st.writes.join() === 'destination-delete no1,destination office@pat-care-mail.com', st.writes)
}

// ── 7. a website-only premium tenant: the addresses live on its site ─────────────────────────────────────
{
  const SITE = 'https://pat-care-site.onrender.com'
  const siteTenant = (o: Record<string, unknown> = {}) => tenant({
    render_backend_url: null, products: ['website-premium'], website_url: SITE + '/',
    domain: 'pat-care.com', cloudflare_zone_id: 'z9', ...o,
  })
  crmAliases = [{ localPart: 'support', routingMode: 'forward', forwardTo: 'Pat@Gmail.com', enabled: true }]
  crmStatus = 200
  const { st, cf } = fakeCloudflare({ zone: 'active', routingOn: true })
  st.destinations.push({ id: 'pg', email: 'pat@gmail.com', verified: true })
  st.rules.push({ tag: 'stale', name: 'alias_old', matcherValue: 'old@pat-care.com', forwardTo: ['pat@gmail.com'] })
  crmCalls.length = 0
  const r = await sync.reconcileTenantAliases(siteTenant(), { cf, fetch: fakeFetch, parseHost: PARSE })
  check("no CRM: the site we serve is asked, with the tenant's key", crmCalls.length === 1 && crmCalls[0].url === SITE + '/api/internal/email-aliases' && crmCalls[0].key === 'k-123', crmCalls)
  check(`…and its address is set up and live (${r.state})`, r.state === 'live' && st.rules.some((x) => x.matcherValue === 'support@pat-care.com' && x.forwardTo[0] === 'pat@gmail.com' && x.name === 'alias_support'), { r, rules: st.rules })
  check('…a stale alias_ rule the site no longer lists is removed', !st.rules.some((x) => x.tag === 'stale'), st.rules)

  // Before the domain exists: listed as waiting — the replay this fallback exists for.
  crmCalls.length = 0
  const early = await sync.reconcileTenantAliases(siteTenant({ domain: null, cloudflare_zone_id: null }), { cf, fetch: fakeFetch, parseHost: PARSE })
  check(`no domain yet: the site's address is listed as waiting (${early.state})`, early.state === 'waiting_for_domain' && early.aliases.length === 1 && early.aliases[0].state === 'waiting_for_domain' && crmCalls.length === 1, early)

  // The intake's OLD website is never sent the key.
  crmCalls.length = 0
  st.writes = []
  const old = await sync.reconcileTenantAliases(siteTenant({ website_url: 'https://patcare-wordpress.com' }), { cf, fetch: fakeFetch, parseHost: PARSE })
  check(`website_url still the old site: nobody is asked (${old.state})`, crmCalls.length === 0 && old.state === 'error' && /website is not deployed/.test(old.detail || ''), { old, crmCalls })
  check('…and nothing on Cloudflare changes', st.writes.length === 0, st.writes)

  // A CRM bought but its URL never recorded (the add-on did not record it before 10/17): never the site.
  st.rules.push({ tag: 'crm-made', name: 'alias_billing', matcherValue: 'billing@pat-care.com', forwardTo: ['books@example.com'] })
  crmCalls.length = 0
  st.writes = []
  const noUrl = await sync.reconcileTenantAliases(siteTenant({ products: ['website-premium', 'crm'] }), { cf, fetch: fakeFetch, parseHost: PARSE })
  check(`a CRM with no recorded URL: the site is NOT read (${noUrl.state})`, crmCalls.length === 0 && noUrl.state === 'error' && /CRM is not provisioned/.test(noUrl.detail || ''), { noUrl, crmCalls })
  check('…so the CRM\'s rules are left alone', st.writes.length === 0 && st.rules.some((x) => x.tag === 'crm-made'), st.writes)
  const vertical = await sync.reconcileTenantAliases(siteTenant({ products: ['website-premium', 'crm-homecare'] }), { cf, fetch: fakeFetch, parseHost: PARSE })
  check('…a vertical CRM product (crm-homecare) counts as a CRM too', vertical.state === 'error' && crmCalls.length === 0, vertical)

  // A CRM, when recorded, wins over the site.
  crmCalls.length = 0
  await sync.reconcileTenantAliases(siteTenant({ products: ['website-premium', 'crm'], render_backend_url: 'https://pat-care-api.onrender.com/' }), { cf, fetch: fakeFetch, parseHost: PARSE })
  check('with a CRM URL the CRM is read, not the site', crmCalls.length === 1 && crmCalls[0].url === 'https://pat-care-api.onrender.com/api/internal/email-aliases', crmCalls)

  // A caller that did not select products: the old rule (CRM or nothing).
  crmCalls.length = 0
  const unknown = await sync.reconcileTenantAliases(siteTenant({ products: undefined }), { cf, fetch: fakeFetch, parseHost: PARSE })
  check('products not selected: nothing is read (no guessing)', crmCalls.length === 0 && unknown.state === 'error', unknown)

  // A standard (non-premium) website has no address book.
  const std = await sync.reconcileTenantAliases(siteTenant({ products: ['website'] }), { cf, fetch: fakeFetch, parseHost: PARSE })
  check('a standard website: nothing read, said why', crmCalls.length === 0 && std.state === 'error' && /no CRM or premium website/.test(std.detail || ''), std)

  // A site built before the read-back: "update it", in the website's words.
  crmStatus = 404
  const before = await sync.reconcileTenantAliases(siteTenant(), { cf, fetch: fakeFetch, parseHost: PARSE })
  check(`a site built before the read-back: "crm_needs_update", naming the website (${before.state})`, before.state === 'crm_needs_update' && /This website was built before/.test(before.detail || ''), before)
  crmStatus = 500
  const bad = await sync.reconcileTenantAliases(siteTenant(), { cf, fetch: fakeFetch, parseHost: PARSE })
  check('a site that errors: "error", naming the website', bad.state === 'error' && /The website answered 500/.test(bad.detail || ''), bad)
  crmStatus = 200

  // aliasSource itself: one decision, every caller.
  check('aliasSource: the site origin, normalised', JSON.stringify(sync.aliasSource(siteTenant())) === JSON.stringify({ kind: 'site', origin: SITE }), sync.aliasSource(siteTenant()))
  check('ALIAS_TENANT_COLUMNS carries what aliasSource reads', ['slug', 'products', 'website_url', 'domain', 'render_backend_url', 'factory_sync_key', 'cloudflare_zone_id'].every((c) => sync.ALIAS_TENANT_COLUMNS.split(/\s*,\s*/).includes(c)), sync.ALIAS_TENANT_COLUMNS)
}

// Perch and Prarie (10/29): Cloudflare REFUSES a rule to an inbox it does not have / that is not confirmed ("Destination
// address is not verified"). The inbox was registered only after the rule, so it never was — no confirmation email was
// ever sent, and every address showed "Not set up" with Cloudflare's raw error.
{
  const strict = fakeCloudflare({ zone: 'active', routingOn: true })
  const realAdd = strict.cf.addEmailRoutingRule
  strict.cf.addEmailRoutingRule = async (z: string, r: any) => {
    const d = strict.st.destinations.find((x) => x.email === String(r.forwardTo).toLowerCase())
    if (!d || !d.verified) throw new Error('Cloudflare API 400: Destination address is not verified')
    return realAdd(z, r)
  }
  const saved = crmAliases
  crmAliases = [{ localPart: 'support', routingMode: 'forward', forwardTo: 'shop@gmail.com', enabled: true }]
  const r = await sync.reconcileTenantAliases(tenant({ domain: 'pat-care.com', cloudflare_zone_id: 'z1' }), { cf: strict.cf, fetch: fakeFetch, parseHost: PARSE })
  const a = r.aliases.find((x: any) => x.localPart === 'support')
  check('the inbox is registered even though the rule is refused (that is what makes Cloudflare send its confirmation email)', strict.st.destinations.some((d) => d.email === 'shop@gmail.com'), strict.st)
  check('a refused rule to an unconfirmed inbox is "confirm the inbox", not an error, and says which inbox', a?.state === 'confirm_destination' && /shop@gmail.com/.test(a?.detail || '') && !/API 400/.test(a?.detail || ''), a)
  strict.st.destinations.find((d) => d.email === 'shop@gmail.com')!.verified = true
  const again = await sync.reconcileTenantAliases(tenant({ domain: 'pat-care.com', cloudflare_zone_id: 'z1' }), { cf: strict.cf, fetch: fakeFetch, parseHost: PARSE })
  check('once confirmed, the next check turns it on by itself', again.aliases.find((x: any) => x.localPart === 'support')?.state === 'live', again.aliases)
  crmAliases = saved
}

console.log(`\nemail-alias-sync: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
