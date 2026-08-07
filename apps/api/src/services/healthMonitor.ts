// Tenant health monitor.
//
// Nothing watched live tenants. Two incidents are the reason this exists:
//   - a WHOIS-verification suspension took a customer's domain down and the
//     first anyone knew was the customer noticing
//   - a CRM failed to boot against a cold database and sat broken until it was
//     opened by hand
//
// Runs from the daily lifecycle cron. For every active tenant it checks the
// things that actually take a site off the air, records the result, and alerts
// staff on the TRANSITION into unhealthy (plus one daily reminder while it
// stays down) rather than every pass — an alert that fires hourly gets muted,
// and a muted alert is the same as no alert.

import tls from 'tls'
import { supabase } from '../middleware/auth'
import { notifyProvisionFailure } from './email'

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped'

export interface HealthCheck {
  name: string
  status: CheckStatus
  detail: string
}

export interface TenantHealth {
  tenantId: string
  slug: string
  status: 'healthy' | 'degraded' | 'down'
  checks: HealthCheck[]
  checkedAt: string
}

const REQUEST_TIMEOUT_MS = 15_000
/** Renew well before a cert actually lapses — 14 days is the practical floor. */
const CERT_WARN_DAYS = 14

function hostOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    return new URL(raw.startsWith('http') ? raw : 'https://' + raw).hostname
  } catch {
    return null
  }
}

/** Is the URL serving anything at all? A 5xx is as down as a refused socket. */
async function checkHttp(name: string, url: string): Promise<HealthCheck> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Twomiah-HealthMonitor/1.0' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.status >= 500) return { name, status: 'fail', detail: `HTTP ${res.status}` }
    if (res.status >= 400) return { name, status: 'warn', detail: `HTTP ${res.status}` }
    return { name, status: 'ok', detail: `HTTP ${res.status}` }
  } catch (err: any) {
    return { name, status: 'fail', detail: err?.message || 'unreachable' }
  }
}

/**
 * TLS certificate expiry. fetch() will not tell us how many days are left, and
 * "the site is up today" is no comfort if the cert lapses on Saturday.
 */
function checkCert(host: string): Promise<HealthCheck> {
  return new Promise((resolve) => {
    let settled = false
    const done = (check: HealthCheck) => { if (!settled) { settled = true; resolve(check) } }

    try {
      const socket = tls.connect(
        { host, port: 443, servername: host, timeout: REQUEST_TIMEOUT_MS },
        () => {
          const cert = socket.getPeerCertificate()
          socket.end()
          if (!cert || !cert.valid_to) return done({ name: 'tls certificate', status: 'warn', detail: 'no certificate presented' })
          const expires = new Date(cert.valid_to)
          const days = Math.floor((expires.getTime() - Date.now()) / 86_400_000)
          if (days < 0) return done({ name: 'tls certificate', status: 'fail', detail: `expired ${Math.abs(days)}d ago` })
          if (days <= CERT_WARN_DAYS) return done({ name: 'tls certificate', status: 'warn', detail: `expires in ${days}d` })
          done({ name: 'tls certificate', status: 'ok', detail: `valid ${days}d` })
        },
      )
      socket.on('timeout', () => { socket.destroy(); done({ name: 'tls certificate', status: 'fail', detail: 'handshake timed out' }) })
      socket.on('error', (err: any) => done({ name: 'tls certificate', status: 'fail', detail: err?.message || 'handshake failed' }))
    } catch (err: any) {
      done({ name: 'tls certificate', status: 'fail', detail: err?.message || 'handshake failed' })
    }
  })
}

/**
 * Is the domain still delegated to us? This is the check that would have
 * caught the WHOIS suspension: the zone stops being active before the site
 * visibly dies.
 */
async function checkDelegation(zoneId: string | null): Promise<HealthCheck> {
  if (!zoneId) return { name: 'dns delegation', status: 'skipped', detail: 'no Cloudflare zone' }
  try {
    const { getCloudflareZoneStatus } = await import('./cloudflare')
    const zone = await getCloudflareZoneStatus(zoneId)
    if (zone.status === 'active') return { name: 'dns delegation', status: 'ok', detail: 'zone active' }
    return { name: 'dns delegation', status: 'fail', detail: `zone ${zone.status}` }
  } catch (err: any) {
    return { name: 'dns delegation', status: 'warn', detail: err?.message || 'zone lookup failed' }
  }
}

function rollUp(checks: HealthCheck[]): 'healthy' | 'degraded' | 'down' {
  if (checks.some(c => c.status === 'fail')) return 'down'
  if (checks.some(c => c.status === 'warn')) return 'degraded'
  return 'healthy'
}

export async function checkTenant(tenant: {
  id: string
  slug: string
  name?: string | null
  domain?: string | null
  website_url?: string | null
  render_frontend_url?: string | null
  render_backend_url?: string | null
  cloudflare_zone_id?: string | null
}): Promise<TenantHealth> {
  const checks: HealthCheck[] = []

  const siteUrl = tenant.domain
    ? 'https://' + String(tenant.domain).replace(/^https?:\/\//, '').replace(/\/$/, '')
    : (tenant.website_url || tenant.render_frontend_url || null)

  if (siteUrl) checks.push(await checkHttp('website', siteUrl))
  else checks.push({ name: 'website', status: 'skipped', detail: 'no site url on record' })

  if (tenant.render_backend_url) {
    const base = tenant.render_backend_url.replace(/\/$/, '')
    checks.push(await checkHttp('crm api', base + '/health'))
  } else {
    checks.push({ name: 'crm api', status: 'skipped', detail: 'no CRM' })
  }

  const host = hostOf(siteUrl)
  checks.push(host ? await checkCert(host) : { name: 'tls certificate', status: 'skipped', detail: 'no host' })
  checks.push(await checkDelegation(tenant.cloudflare_zone_id ?? null))

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    status: rollUp(checks),
    checks,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Sweep every live tenant. Alerts staff when a tenant BECOMES unhealthy, and
 * at most once a day while it stays that way.
 */
export async function sweepTenantHealth(): Promise<{
  checked: number
  healthy: number
  degraded: number
  down: number
  alerted: number
  errors: string[]
}> {
  const summary = { checked: 0, healthy: 0, degraded: 0, down: 0, alerted: 0, errors: [] as string[] }

  const COLUMNS = 'id, slug, name, email, admin_email, domain, website_url, render_frontend_url, render_backend_url, cloudflare_zone_id'
  let migrated = true

  let { data: tenants, error } = await supabase
    .from('tenants')
    .select(COLUMNS + ', health_status, health_alerted_at')
    .eq('status', 'active')

  if (error && /health_status|health_alerted_at/.test(error.message || '')) {
    // Migration not applied yet (apps/api/migrations/2026-08-07_tenants_health.sql).
    // Still run the checks and alert — just do not try to persist them.
    migrated = false
    summary.errors.push('health columns missing — run apps/api/migrations/2026-08-07_tenants_health.sql; checks ran but were not stored')
    const retry = await supabase.from('tenants').select(COLUMNS).eq('status', 'active')
    tenants = retry.data as any
    error = retry.error
  }

  if (error) {
    summary.errors.push('tenant query: ' + error.message)
    return summary
  }

  for (const tenant of tenants || []) {
    try {
      const health = await checkTenant(tenant as any)
      summary.checked++
      summary[health.status === 'healthy' ? 'healthy' : health.status === 'degraded' ? 'degraded' : 'down']++

      const previous = (tenant as any).health_status as string | null
      const lastAlert = (tenant as any).health_alerted_at ? new Date((tenant as any).health_alerted_at).getTime() : 0
      const worsened = health.status !== 'healthy' && previous !== health.status
      const stillBadAndQuiet = health.status === 'down' && Date.now() - lastAlert > 20 * 60 * 60 * 1000

      let alertedAt = (tenant as any).health_alerted_at ?? null
      if (worsened || stillBadAndQuiet) {
        const failing = health.checks.filter(c => c.status === 'fail' || c.status === 'warn')
        const detail = failing.map(c => `${c.name}: ${c.detail}`).join('; ') || 'unknown'
        // Staff-first, same as a failed deploy: the operator must find out
        // before the customer does.
        await notifyProvisionFailure(
          { name: (tenant as any).name || tenant.slug, email: (tenant as any).admin_email || (tenant as any).email, slug: tenant.slug } as any,
          health.status === 'down' ? 'Tenant DOWN' : 'Tenant degraded',
          detail,
        ).catch(() => {})
        alertedAt = new Date().toISOString()
        summary.alerted++
      }
      if (health.status === 'healthy') alertedAt = null

      if (migrated) {
        await supabase.from('tenants').update({
          health_status: health.status,
          health_checked_at: health.checkedAt,
          health_detail: health.checks,
          health_alerted_at: alertedAt,
        }).eq('id', tenant.id)
      }
    } catch (err: any) {
      summary.errors.push(`${tenant.slug}: ${err?.message || err}`)
    }
  }

  return summary
}
