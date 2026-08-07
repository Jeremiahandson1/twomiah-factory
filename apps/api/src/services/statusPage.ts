// Status page (item 17).
//
// Every component state here is measured at request time against the real
// dependency. Nothing is hardcoded green, and where we genuinely cannot
// measure something the page says so rather than implying health:
//
//   api          — this process answered, plus how long the checks took
//   database     — a real Supabase query, not a ping
//   tenants      — the daily health sweep's stored verdicts (item 13). Says
//                  "not reporting yet" until 2026-08-07_tenants_health.sql is
//                  applied, because an unmeasured fleet is not a healthy one
//   provisioning — factory_jobs in the last 24h; "no recent builds" when the
//                  window is empty, which is not a fault
//   email        — Resend credential check (the send path's actual dependency)
//   payments     — Stripe credential check
//
// Open incidents from status_incidents override a measured state upward, so a
// problem we already know about can never sit behind a green tick.

import { supabase } from '../middleware/auth'

export type ComponentState = 'operational' | 'degraded' | 'down' | 'unknown'

export interface StatusComponent {
  key: string
  name: string
  state: ComponentState
  detail: string
  /** Operator-only hint. The public page never renders this; the staff Status
   *  page does. Keeps runbook steps off a page customers read. */
  operatorNote?: string
}

export interface StatusIncident {
  id: string
  component: string
  impact: string
  title: string
  body: string | null
  started_at: string
  resolved_at: string | null
}

export interface StatusPayload {
  overall: ComponentState
  summary: string
  checkedAt: string
  components: StatusComponent[]
  incidents: { open: StatusIncident[]; recent: StatusIncident[] }
}

const RANK: Record<ComponentState, number> = { operational: 0, unknown: 1, degraded: 2, down: 3 }
const worst = (a: ComponentState, b: ComponentState) => (RANK[b] > RANK[a] ? b : a)

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(onTimeout), ms) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function checkDatabase(): Promise<StatusComponent> {
  const started = Date.now()
  try {
    const { error } = await supabase.from('tenants').select('id', { count: 'exact', head: true })
    const ms = Date.now() - started
    if (error) return { key: 'database', name: 'Database', state: 'down', detail: error.message }
    // A database that answers slowly is a customer-visible problem, so it is
    // reported as degraded rather than quietly counted as up.
    if (ms > 2000) return { key: 'database', name: 'Database', state: 'degraded', detail: `Responding slowly (${ms}ms)` }
    return { key: 'database', name: 'Database', state: 'operational', detail: `${ms}ms` }
  } catch (err: any) {
    return { key: 'database', name: 'Database', state: 'down', detail: err?.message || 'Unreachable' }
  }
}

async function checkTenants(): Promise<StatusComponent> {
  const name = 'Customer sites & CRMs'
  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('health_status, health_checked_at')
      .eq('status', 'active')

    if (error) {
      if (/health_status|health_checked_at/.test(error.message || '')) {
        return {
          key: 'tenants', name, state: 'unknown',
          detail: 'Monitoring is not reporting yet',
          operatorNote: 'Run apps/api/migrations/2026-08-07_tenants_health.sql',
        }
      }
      return { key: 'tenants', name, state: 'unknown', detail: error.message }
    }

    const rows = data || []
    if (rows.length === 0) return { key: 'tenants', name, state: 'operational', detail: 'No active sites' }

    const down = rows.filter(r => r.health_status === 'down').length
    const degraded = rows.filter(r => r.health_status === 'degraded').length
    const healthy = rows.filter(r => r.health_status === 'healthy').length
    const unchecked = rows.length - down - degraded - healthy

    // A sweep that stopped running is itself an outage signal — stale verdicts
    // must not be presented as current.
    const newest = rows
      .map(r => (r.health_checked_at ? new Date(r.health_checked_at).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0)
    const ageHours = newest ? (Date.now() - newest) / 3600000 : Infinity

    if (!newest || unchecked === rows.length) {
      return { key: 'tenants', name, state: 'unknown', detail: 'Awaiting the first health sweep' }
    }
    if (ageHours > 36) {
      return {
        key: 'tenants', name, state: 'unknown',
        detail: `Last checked ${Math.round(ageHours)}h ago — monitoring may have stopped`,
      }
    }

    const detail = `${healthy}/${rows.length} healthy` +
      (degraded ? `, ${degraded} degraded` : '') +
      (down ? `, ${down} down` : '') +
      (unchecked ? `, ${unchecked} not yet checked` : '')

    if (down > 0) return { key: 'tenants', name, state: 'down', detail }
    if (degraded > 0) return { key: 'tenants', name, state: 'degraded', detail }
    return { key: 'tenants', name, state: 'operational', detail }
  } catch (err: any) {
    return { key: 'tenants', name, state: 'unknown', detail: err?.message || 'Unavailable' }
  }
}

async function checkProvisioning(): Promise<StatusComponent> {
  const name = 'New builds & provisioning'
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  try {
    const { data, error } = await supabase
      .from('factory_jobs')
      .select('status, created_at')
      .gte('created_at', since)
    if (error) return { key: 'provisioning', name, state: 'unknown', detail: error.message }

    const rows = data || []
    // Quiet is not broken: most days nobody signs up, and reporting that as an
    // outage would train everyone to ignore this page.
    if (rows.length === 0) return { key: 'provisioning', name, state: 'operational', detail: 'No builds in the last 24h' }

    const failed = rows.filter(r => ['failed', 'error'].includes(String(r.status))).length
    const done = rows.filter(r => ['complete', 'completed', 'deployed', 'ok'].includes(String(r.status))).length
    const detail = `${rows.length} build${rows.length === 1 ? '' : 's'} in 24h` +
      (done ? `, ${done} completed` : '') + (failed ? `, ${failed} failed` : '')

    if (failed && failed === rows.length) return { key: 'provisioning', name, state: 'down', detail }
    if (failed) return { key: 'provisioning', name, state: 'degraded', detail }
    return { key: 'provisioning', name, state: 'operational', detail }
  } catch (err: any) {
    return { key: 'provisioning', name, state: 'unknown', detail: err?.message || 'Unavailable' }
  }
}

async function checkEmail(): Promise<StatusComponent> {
  const name = 'Email delivery'
  const key = process.env.RESEND_API_KEY
  if (!key) return { key: 'email', name, state: 'unknown', detail: 'Not configured' }
  try {
    // Cheapest authenticated call Resend offers; proves the credential the
    // send path actually uses is still good.
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
    })
    if (res.status === 401 || res.status === 403) {
      return { key: 'email', name, state: 'down', detail: 'Provider rejected our credentials' }
    }
    if (!res.ok) return { key: 'email', name, state: 'degraded', detail: `Provider returned ${res.status}` }
    return { key: 'email', name, state: 'operational', detail: 'Provider reachable' }
  } catch (err: any) {
    return { key: 'email', name, state: 'degraded', detail: err?.name === 'TimeoutError' ? 'Provider slow to respond' : 'Provider unreachable' }
  }
}

async function checkPayments(): Promise<StatusComponent> {
  const name = 'Payments'
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return { key: 'payments', name, state: 'unknown', detail: 'Not configured' }
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
    })
    if (res.status === 401) return { key: 'payments', name, state: 'down', detail: 'Stripe rejected our credentials' }
    if (!res.ok) return { key: 'payments', name, state: 'degraded', detail: `Stripe returned ${res.status}` }
    return { key: 'payments', name, state: 'operational', detail: 'Stripe reachable' }
  } catch (err: any) {
    return { key: 'payments', name, state: 'degraded', detail: err?.name === 'TimeoutError' ? 'Stripe slow to respond' : 'Stripe unreachable' }
  }
}

async function loadIncidents(): Promise<{ open: StatusIncident[]; recent: StatusIncident[] }> {
  try {
    const { data, error } = await supabase
      .from('status_incidents')
      .select('id, component, impact, title, body, started_at, resolved_at')
      .order('started_at', { ascending: false })
      .limit(40)
    // Missing table (migration not applied) is not worth failing the page over.
    if (error) return { open: [], recent: [] }
    const rows = (data || []) as StatusIncident[]
    return {
      open: rows.filter(r => !r.resolved_at),
      recent: rows.filter(r => r.resolved_at).slice(0, 10),
    }
  } catch {
    return { open: [], recent: [] }
  }
}

export async function buildStatus(): Promise<StatusPayload> {
  const started = Date.now()

  const [database, tenants, provisioning, email, payments, incidents] = await Promise.all([
    withTimeout(checkDatabase(), 8000, { key: 'database', name: 'Database', state: 'degraded' as ComponentState, detail: 'Check timed out' }),
    withTimeout(checkTenants(), 8000, { key: 'tenants', name: 'Customer sites & CRMs', state: 'unknown' as ComponentState, detail: 'Check timed out' }),
    withTimeout(checkProvisioning(), 8000, { key: 'provisioning', name: 'New builds & provisioning', state: 'unknown' as ComponentState, detail: 'Check timed out' }),
    withTimeout(checkEmail(), 8000, { key: 'email', name: 'Email delivery', state: 'degraded' as ComponentState, detail: 'Check timed out' }),
    withTimeout(checkPayments(), 8000, { key: 'payments', name: 'Payments', state: 'degraded' as ComponentState, detail: 'Check timed out' }),
    loadIncidents(),
  ])

  const api: StatusComponent = {
    key: 'api',
    name: 'Factory API',
    state: 'operational',
    detail: `Serving (${Date.now() - started}ms to run all checks)`,
  }

  const components = [api, database, tenants, provisioning, email, payments]

  // An open incident can only make a component look worse, never better.
  for (const incident of incidents.open) {
    const target = components.find(c => c.key === incident.component)
    if (!target) continue
    const forced: ComponentState = incident.impact === 'down' ? 'down' : 'degraded'
    target.state = worst(target.state, forced)
  }

  const overall = components.reduce<ComponentState>((acc, c) => worst(acc, c.state), 'operational')
  const summary =
    overall === 'operational' ? 'All systems operational'
    : overall === 'unknown' ? 'Some systems are not reporting'
    : overall === 'degraded' ? 'Some systems are degraded'
    : 'We are having an outage'

  return {
    overall,
    summary,
    checkedAt: new Date().toISOString(),
    components,
    incidents,
  }
}
