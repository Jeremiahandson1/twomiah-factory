// Watching Netlify. Two things: (1) the team's credits — Netlify documents NO way to read them from its API, so this reads them only from
// an endpoint the owner names (WEB_PRESENCE_CREDITS_PATH) and otherwise says so, plainly, in the owner's alerts rather than guessing;
// (2) each site's usage, asked of the site itself (a signed request to its own function), which is what staff see.
import { signRequest, siteSecret } from './site/session.mjs'
import { requireWebPresence } from './switch.ts'
import type { Deps, SiteRow } from './service.ts'

export const CREDIT_WARN_AT = 0.75
export const CREDIT_URGENT_AT = 0.9

export type CreditReading = { state: 'ok' | 'warn' | 'urgent' | 'unreadable'; used?: number; total?: number }

export async function creditWatch(d: Deps): Promise<CreditReading> {
  requireWebPresence(d.env)
  let reading: { used: number; total: number } | null = null
  try { reading = await d.netlify().creditsFromEndpoint(d.env.WEB_PRESENCE_CREDITS_PATH) } catch { reading = null }
  if (!reading) {
    // No endpoint named: a known limit, not a failure — Netlify's own 50% / 75% / 100% emails cover it, and an alert here would
    // repeat every day forever (owner's alert rule: alert on something broken). Staff see "unreadable". Only an endpoint the owner
    // DID name that stops answering is news.
    if (d.env.WEB_PRESENCE_CREDITS_PATH) {
      await d.alert('web-presence:credits-unreadable', 'Web presence: the Netlify credit reading stopped working',
        "The credit endpoint set in WEB_PRESENCE_CREDITS_PATH did not answer. Watch credits in Netlify (Team › Billing) until it does; Netlify's own 50% / 75% / 100% emails still arrive.")
    }
    return { state: 'unreadable' }
  }
  const ratio = reading.used / reading.total
  if (ratio >= CREDIT_URGENT_AT) {
    await d.alert('web-presence:credits', 'Web presence: Netlify credits are nearly used up — customer pages may stop', `${Math.round(ratio * 100)}% of the team's credits are used (${reading.used} of ${reading.total}). Add credits in Netlify now.`)
    return { state: 'urgent', ...reading }
  }
  if (ratio >= CREDIT_WARN_AT) {
    await d.alert('web-presence:credits', 'Web presence: Netlify credits are running low', `${Math.round(ratio * 100)}% of the team's credits are used (${reading.used} of ${reading.total}). Plan to add credits.`)
    return { state: 'warn', ...reading }
  }
  return { state: 'ok', ...reading }
}

export type SiteUsage = { tenantId: string; siteId: string; name: string | null; status: string; origin: string | null; usage: null | { month: string; page: number; save: number; upload: number; lead: number; apply: number } }

/** Each live site's own counts for this month (page views served by its function, saves, uploads, leads, applications). */
export async function siteUsage(d: Deps): Promise<SiteUsage[]> {
  requireWebPresence(d.env)
  const master = String(d.env.WEB_PRESENCE_SECRET_KEY || '')
  const { data } = await d.db.from('web_presence_sites').select('*').in('status', ['live', 'canceling', 'upgrading'])
  const out: SiteUsage[] = []
  for (const r of (data as SiteRow[]) || []) {
    let usage: SiteUsage['usage'] = null
    if (master && r.origin) {
      try {
        const ts = String(Math.floor(d.now() / 1000))
        const sig = await signRequest(await siteSecret(master, r.id), ts, 'usage')
        const res = await d.fetch(r.origin.replace(/\/+$/, '') + '/api/usage', { method: 'GET', headers: { 'x-wp-ts': ts, 'x-wp-sig': sig } })
        if (res.ok) usage = (await res.json()) as any
      } catch { usage = null }
    }
    out.push({ tenantId: r.tenant_id, siteId: r.id, name: r.netlify_site_name, status: r.status, origin: r.origin, usage })
  }
  return out
}
