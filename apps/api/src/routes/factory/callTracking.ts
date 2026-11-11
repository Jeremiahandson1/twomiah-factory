// Call tracking numbers sold by Twomiah — services/callTrackingNumbers.ts has the rules. The business's own CRM asks, with its
// own Factory key (the same door as texting's registration, routes/factory/a2p.ts):
//
//   GET  /internal/calltracking/self/:tenantId/numbers                 its numbers, the price, whether it is subscribed
//   POST /internal/calltracking/self/:tenantId/numbers                 a number: bought now, or a checkout for the first one
//   POST /internal/calltracking/self/:tenantId/numbers/:sid/release    give one back (the subscription's count goes down)
//   POST /internal/calltracking/bill                                   cron: each call charged to the wallet, once
import { supabase } from '../../middleware/auth'
import { type FactoryApp, UUID_RE, parseJsonBody, logTenantAudit, checkCronSecret, checkFactoryKey } from './shared'
import { activeLines, buyProblem, requestLine, releaseLine, syncQuantity, billCalls, type BuyRequest } from '../../services/callTrackingNumbers'
import { CALLTRACK_NUMBER_MONTHLY_CENTS } from '../../config/messagingCosts'

/** The business's own app's addresses: its Render service, and its own domain (with and without www). */
export function crmOrigins(t: any): string[] {
  const out: string[] = []
  const add = (u: unknown) => { const s = String(u || '').trim().replace(/\/+$/, ''); if (/^https:\/\/[^/]+$/.test(s)) out.push(s) }
  add(t?.render_backend_url)
  const d = String(t?.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (d) { add('https://' + d); if (!d.startsWith('www.')) add('https://www.' + d) }
  return [...new Set(out)]
}
/** Every URL given is on one of the business's own origins. */
const onOwnOrigin = (t: any, ...urls: unknown[]) => { const o = crmOrigins(t); return urls.every((u) => typeof u === 'string' && o.some((x) => u === x || u.startsWith(x + '/'))) }

export function registerCallTrackingRoutes(factory: FactoryApp) {
  const self = async (c: any) => {
    const tenantId = c.req.param('tenantId') || ''
    if (!UUID_RE.test(tenantId)) return { err: c.json({ error: 'Invalid tenant ID format' }, 400) }
    const { data: t } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (!t || !checkFactoryKey(c, t)) return { err: c.json({ error: 'Unauthorized' }, 401) }
    return { t }
  }

  factory.get('/internal/calltracking/self/:tenantId/numbers', async (c) => {
    const { t, err } = await self(c); if (err) return err
    try {
      return c.json({ monthlyCents: CALLTRACK_NUMBER_MONTHLY_CENTS, subscribed: !!t.calltrack_sub_id, lines: await activeLines(t.id) })
    } catch (e: any) { return c.json({ error: e.message }, 500) }
  })

  factory.post('/internal/calltracking/self/:tenantId/numbers', async (c) => {
    const { t, err } = await self(c); if (err) return err
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const body = parsed.data || {}
    // The call addresses go to Twilio: they must be the business's own app, as must the page the checkout returns to.
    const origin = crmOrigins(t).find((o) => typeof body.voiceUrl === 'string' && body.voiceUrl.startsWith(o + '/')) || null
    const problem = buyProblem(body, origin)
    if (problem) return c.json({ error: problem, code: 'validation_failed' }, 400)
    if (!onOwnOrigin(t, body.returnUrl)) return c.json({ error: 'The page to come back to must be on this business\'s own app.', code: 'validation_failed' }, 400)
    const req: BuyRequest = { label: body.label, forwardTo: body.forwardTo, areaCode: body.areaCode || undefined, voiceUrl: body.voiceUrl, statusUrl: body.statusUrl }
    try {
      const sep = String(body.returnUrl).includes('?') ? '&' : '?'
      const r = await requestLine(t, req, { successUrl: body.returnUrl + sep + 'number=paid', cancelUrl: body.returnUrl + sep + 'number=cancelled' })
      if (r.line) await logTenantAudit(t.id, 'calltrack_number_bought', { number: { old: null, new: r.line.phoneNumber } }, 'business owner (CRM)', `Call tracking number for ${r.line.label}`)
      return c.json(r, r.line ? 201 : 200)
    } catch (e: any) {
      const status = Number(e?.status) === 409 ? 409 : 502
      return c.json({ error: e?.message || 'The number could not be bought' }, status)
    }
  })

  factory.post('/internal/calltracking/self/:tenantId/numbers/:sid/release', async (c) => {
    const { t, err } = await self(c); if (err) return err
    const sid = c.req.param('sid') || ''
    if (!/^PN[0-9a-f]{32}$/i.test(sid)) return c.json({ error: 'Not a number of this business' }, 404)
    try {
      if (!(await releaseLine(t.id, sid))) return c.json({ error: 'Not a number of this business' }, 404)
      await syncQuantity(t.id).catch((e: any) => console.error('[CallTracking] count not updated', t.id, e?.message))
      await logTenantAudit(t.id, 'calltrack_number_released', { number: { old: sid, new: null } }, 'business owner (CRM)', 'Call tracking number given back')
      return c.json({ success: true })
    } catch (e: any) { return c.json({ error: e?.message || 'The number could not be given back' }, 502) }
  })

  factory.post('/internal/calltracking/bill', async (c) => {
    if (!checkCronSecret(c)) return c.json({ error: 'Invalid cron secret' }, 401)
    try { return c.json({ success: true, ...(await billCalls()) }) } catch (e: any) { return c.json({ error: e.message }, 500) }
  })
}
