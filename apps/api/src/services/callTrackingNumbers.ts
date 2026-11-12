// Call tracking numbers sold by Twomiah (ServiceTitan's built-in tracking numbers — a business needs no CallRail account).
//
// Twomiah is the Twilio ISV (services/a2p.ts): it buys a local number per place the business advertises, on its own account,
// pointed at the business's CRM — the CRM answers each call by forwarding it to the business's real line (its /api/calltracking
// /voice route) and logs it from Twilio's status callback (its /webhook/twilio route). Twomiah never forwards a call itself.
//
// Money, as the owner set it (10/26 — config/messagingCosts.ts): the line is the subscription's, the usage the wallet's.
//   · $3 a month a number (CALLTRACK_NUMBER_MONTHLY_CENTS), on the business's own "Call tracking number" subscription, one unit
//     a number. The first number is bought once its checkout is paid (the number asked for waits in the session's metadata);
//     after that a number is bought at once and the count goes up, prorated. Releasing one takes it down; none left ends it.
//   · Each call, exactly what Twilio charged for it — the call in, the forward out (its child call) and its recording where the
//     business records calls — from the wallet, once
//     per call (the ledger's twilio_ref 'call:<CallSid>'), by billCalls() each hour. Twilio prices a call a little after it ends,
//     so a call not yet priced is left for the next pass.
//
// Factory table call_tracking_numbers (migrations/2026-11-11_call_tracking_numbers.sql); tenants.calltrack_sub_id.
import { supabase } from '../middleware/auth'
import { twilio, API2010, isvCreds } from './a2p'
import { debitHc } from './messagingWallet'
import { CALLTRACK_NUMBER_MONTHLY_CENTS, centsToHc } from '../config/messagingCosts'
import * as factoryStripe from './factoryStripe'

export interface TrackingLine { sid: string; phoneNumber: string; label: string; forwardTo: string | null; boughtAt: string }
export interface BuyRequest { areaCode?: string; label: string; forwardTo: string; voiceUrl: string; statusUrl: string }

const account = () => `${API2010}/Accounts/${isvCreds().sid}`
const lineOf = (r: any): TrackingLine => ({ sid: r.twilio_sid, phoneNumber: r.phone_number, label: r.label, forwardTo: r.forward_to ?? null, boughtAt: r.bought_at })

/** The business's numbers still held. */
export async function activeLines(tenantId: string): Promise<TrackingLine[]> {
  const { data, error } = await supabase.from('call_tracking_numbers').select('*').eq('tenant_id', tenantId).is('released_at', null).order('bought_at', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data as any[]) || []).map(lineOf)
}

/**
 * What a buy asks for, checked: a label, the business's line to forward to (a US number), and the CRM's own two https
 * addresses on the business's own app (never somewhere else — Twilio would send the business's calls there).
 */
export function buyProblem(req: any, crmOrigin: string | null): string | null {
  if (!req || typeof req !== 'object') return 'Say what the number is for.'
  if (typeof req.label !== 'string' || !req.label.trim() || req.label.trim().length > 60) return 'Name the number (what it is for — "Google Ads", "Yard signs"), up to 60 characters.'
  if (!e164(req.forwardTo)) return 'The number to ring must be a US phone number.'
  if (req.areaCode !== undefined && req.areaCode !== '' && !/^\d{3}$/.test(String(req.areaCode))) return 'An area code is three digits.'
  const origin = (crmOrigin || '').replace(/\/+$/, '')
  for (const u of [req.voiceUrl, req.statusUrl]) {
    if (typeof u !== 'string' || !/^https:\/\//.test(u) || !origin || !(u === origin || u.startsWith(origin + '/'))) return 'The call addresses must be on this business\'s own app.'
  }
  return null
}

/** A US number as +1XXXXXXXXXX, or null. */
export function e164(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return null
}

/** Buy one local number pointed at the business's CRM, and keep it. In its area code where Twilio has one. */
export async function buyLine(tenantId: string, req: BuyRequest): Promise<TrackingLine> {
  const tries = [req.areaCode ? `AreaCode=${req.areaCode}` : '', ''].filter((x, i, a) => a.indexOf(x) === i)
  let bought: any = null
  for (const f of tries) {
    const found = await twilio(account(), `/AvailablePhoneNumbers/US/Local.json?VoiceEnabled=true&Limit=1${f ? '&' + f : ''}`, 'GET').catch(() => null)
    const candidate = found?.available_phone_numbers?.[0]?.phone_number
    if (!candidate) continue
    bought = await twilio(account(), '/IncomingPhoneNumbers.json', 'POST', {
      PhoneNumber: candidate, FriendlyName: req.label.trim().slice(0, 64),
      VoiceUrl: req.voiceUrl, VoiceMethod: 'POST', StatusCallback: req.statusUrl, StatusCallbackMethod: 'POST',
    })
    break
  }
  if (!bought?.sid) throw Object.assign(new Error('Twilio had no number to sell in that area right now — try another area code.'), { status: 409 })
  const row = { tenant_id: tenantId, twilio_sid: bought.sid, phone_number: bought.phone_number, label: req.label.trim(), forward_to: e164(req.forwardTo), bought_at: new Date().toISOString() }
  const { error } = await supabase.from('call_tracking_numbers').insert(row)
  if (error) {
    // Kept nowhere: give it back rather than pay for a number nobody can see.
    await twilio(account(), `/IncomingPhoneNumbers/${bought.sid}.json`, 'DELETE').catch(() => null)
    throw new Error(error.message)
  }
  return lineOf(row)
}

/** Give a number back to Twilio and stop paying for it. */
export async function releaseLine(tenantId: string, sid: string): Promise<boolean> {
  const { data } = await supabase.from('call_tracking_numbers').select('*').eq('tenant_id', tenantId).eq('twilio_sid', sid).is('released_at', null).maybeSingle()
  if (!data) return false
  try { await twilio(account(), `/IncomingPhoneNumbers/${sid}.json`, 'DELETE') } catch (e: any) { if (e?.status !== 404) throw e }
  const { error } = await supabase.from('call_tracking_numbers').update({ released_at: new Date().toISOString() }).eq('twilio_sid', sid)
  if (error) throw new Error(error.message)
  return true
}

/** The subscription's count follows the numbers held; none held ends it (and the tenant's mark of it). */
export async function syncQuantity(tenantId: string): Promise<void> {
  const { data: t } = await supabase.from('tenants').select('id, calltrack_sub_id').eq('id', tenantId).single()
  if (!t?.calltrack_sub_id) return
  const n = (await activeLines(tenantId)).length
  const r = await factoryStripe.setCallTrackingQuantity(t.calltrack_sub_id, n)
  if (r === 'cancelled') await supabase.from('tenants').update({ calltrack_sub_id: null }).eq('id', tenantId)
}

/** The number asked for, as checkout metadata (Stripe: up to 500 characters a value) — and read back. */
export const pendingToMeta = (req: BuyRequest): Record<string, string> => ({
  ct_label: req.label.trim().slice(0, 60), ct_forward: e164(req.forwardTo) || '', ct_area: String(req.areaCode || ''),
  ct_voice: req.voiceUrl.slice(0, 500), ct_status: req.statusUrl.slice(0, 500),
})
export const pendingFromMeta = (m: any): BuyRequest | null =>
  m?.ct_label && m?.ct_forward && m?.ct_voice && m?.ct_status ? { label: m.ct_label, forwardTo: m.ct_forward, areaCode: m.ct_area || undefined, voiceUrl: m.ct_voice, statusUrl: m.ct_status } : null

/**
 * A business asks for a number. Subscribed: bought now, the count goes up. Not yet: a checkout for the first one — the
 * number is bought when it is paid (onCheckoutPaid).
 */
export async function requestLine(t: any, req: BuyRequest, urls: { successUrl: string; cancelUrl: string }): Promise<{ line?: TrackingLine; checkoutUrl?: string }> {
  if (t.calltrack_sub_id) {
    const line = await buyLine(t.id, req)
    try { await syncQuantity(t.id) } catch (e: any) { console.error('[CallTracking] count not updated', t.id, e?.message) }
    return { line }
  }
  const r = await factoryStripe.createCallTrackingCheckout({ id: t.id, email: t.email, name: t.name, phone: t.phone, stripeCustomerId: t.stripe_customer_id }, CALLTRACK_NUMBER_MONTHLY_CENTS, pendingToMeta(req), urls)
  if (r.stripeCustomerId && !t.stripe_customer_id) await supabase.from('tenants').update({ stripe_customer_id: r.stripeCustomerId }).eq('id', t.id)
  return { checkoutUrl: r.url || undefined }
}

/** The first number's checkout was paid: keep the subscription, buy the number it was for. */
export async function onCheckoutPaid(tenantId: string, subscriptionId: string | null, meta: any): Promise<TrackingLine | null> {
  if (subscriptionId) await supabase.from('tenants').update({ calltrack_sub_id: subscriptionId }).eq('id', tenantId)
  const req = pendingFromMeta(meta)
  if (!req) return null
  return buyLine(tenantId, req)
}

/** The subscription ended (cancelled or unpaid): every number goes back to Twilio. */
export async function onSubscriptionEnded(tenantId: string): Promise<number> {
  let n = 0
  for (const l of await activeLines(tenantId)) { if (await releaseLine(tenantId, l.sid).catch(() => false)) n++ }
  await supabase.from('tenants').update({ calltrack_sub_id: null }).eq('id', tenantId)
  return n
}

/** Twilio's price for a call ("-0.00850" USD), as hundredths of a cent; null until Twilio has priced it. */
export const priceHc = (p: unknown): number | null => {
  if (p === null || p === undefined || p === '') return null
  const n = Math.abs(Number(p))
  return Number.isFinite(n) ? Math.round(n * 10000) : null
}

/**
 * Each hour: every number's finished calls of the last three days (a number given back today still has calls to bill), each
 * charged once — the call in and every forward out of it, as Twilio priced them. A call whose legs are not all priced yet waits.
 */
export async function billCalls(): Promise<{ calls: number; hc: number }> {
  const since = new Date(Date.now() - 3 * 86_400_000)
  const { data: lines } = await supabase.from('call_tracking_numbers').select('*').or(`released_at.is.null,released_at.gte.${since.toISOString()}`)
  let calls = 0, total = 0
  for (const l of (lines as any[]) || []) {
    const list = await twilio(account(), `/Calls.json?To=${encodeURIComponent(l.phone_number)}&StartTime%3E=${since.toISOString().slice(0, 10)}&PageSize=200`, 'GET').catch(() => null)
    for (const call of (list?.calls as any[]) || []) {
      if (!['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(String(call.status))) continue
      const ref = 'call:' + call.sid
      const { data: seen } = await supabase.from('messaging_ledger').select('id').eq('tenant_id', l.tenant_id).eq('twilio_ref', ref).limit(1)
      if ((seen as any[])?.length) continue
      const legIn = priceHc(call.price)
      if (legIn === null && call.status === 'completed') continue
      const kids = await twilio(account(), `/Calls.json?ParentCallSid=${call.sid}&PageSize=20`, 'GET').catch(() => null)
      const out = ((kids?.calls as any[]) || []).map((k) => priceHc(k.price))
      if (out.some((x, i) => x === null && (kids.calls[i].status === 'completed'))) continue
      // A call the business records (its CRM's Call Tracking › Settings): each recording at Twilio's price, with the call. A
      // recording not priced yet keeps the whole call for the next pass.
      const recs = await twilio(account(), `/Recordings.json?CallSid=${call.sid}&PageSize=20`, 'GET').catch(() => null)
      const recHc = ((recs?.recordings as any[]) || []).map((r) => (String(r.status) === 'completed' ? priceHc(r.price) : 0))
      if (recHc.some((x) => x === null)) continue
      const hc = (legIn ?? 0) + out.reduce((a: number, x) => a + (x ?? 0), 0) + recHc.reduce((a: number, x) => a + (x ?? 0), 0)
      if (hc <= 0) continue // nothing to charge (a call Twilio priced at nothing)
      await debitHc(l.tenant_id, hc, 'call_tracking_call', { twilioRef: ref, allowNegative: true })
      calls++; total += hc
    }
  }
  return { calls, hc: total }
}

/** For the page: the price of a number, so the business sees it before it buys. */
export const lineMonthlyHc = () => centsToHc(CALLTRACK_NUMBER_MONTHLY_CENTS)
