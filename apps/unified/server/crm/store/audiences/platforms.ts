// Sending a segment straight to the ad platforms (store_audiences, 2026-10-31, parity row 7), written to each platform's
// documented API and answered by a stand-in in the tests — NOT run against Meta or Google from here. What only the owner can do:
//   Meta   a token that may manage ads on the ad account (a System User token with ads_management, or an app in Live mode with
//          that permission approved by Meta's App Review for ad accounts that are not the app owner's).
//   Google a Google Ads developer token (applied for in the manager account's API Center and APPROVED by Google — "Basic" access),
//          an OAuth client and a refresh token for a user who can manage the account, and the customer id.
// A push makes a NEW audience each time (named for the segment and the day); the old ones stay on the platform until the owner removes them.
import type { MetaRow, GoogleRow } from './hashing.ts'

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0'
export const GOOGLE_ADS_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v21'
const BATCH = 5000

export class PlatformError extends Error {}

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { raw: text } }
}
const metaProblem = (j: any, status: number) => String(j?.error?.error_user_msg || j?.error?.message || `Meta answered ${status}`).slice(0, 300)
const googleProblem = (j: any, status: number) => String(j?.error?.message || `Google answered ${status}`).slice(0, 300)

/** The ad account id as Meta's API wants it (act_123): the owner may type it with or without act_. */
export const metaAccount = (id: string) => `act_${String(id).replace(/^act_/i, '').replace(/\D/g, '')}`

export async function pushToMeta(o: { adAccountId: string; token: string; name: string; rows: MetaRow[] }): Promise<{ audienceId: string; sent: number }> {
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`
  const made = await fetch(`${base}/${metaAccount(o.adAccountId)}/customaudiences`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: o.name, subtype: 'CUSTOM', description: 'Customers from the online store', customer_file_source: 'USER_PROVIDED_ONLY', access_token: o.token }),
  })
  const m = await readJson(made)
  if (!made.ok || !m.id) throw new PlatformError(metaProblem(m, made.status))
  const schema = ['EMAIL', 'PHONE', 'FN', 'LN', 'CT', 'ST', 'ZIP', 'COUNTRY']
  let sent = 0
  for (let i = 0; i < o.rows.length; i += BATCH) {
    const data = o.rows.slice(i, i + BATCH).map((r) => [r.em ?? '', r.ph ?? '', r.fn ?? '', r.ln ?? '', r.ct ?? '', r.st ?? '', r.zip ?? '', r.country ?? ''])
    const res = await fetch(`${base}/${m.id}/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: { schema, data }, access_token: o.token }) })
    const j = await readJson(res)
    if (!res.ok) throw new PlatformError(metaProblem(j, res.status))
    sent += Number(j.num_received ?? data.length)
  }
  return { audienceId: String(m.id), sent }
}

export interface GoogleCreds { customerId: string; loginCustomerId?: string | null; developerToken: string; clientId: string; clientSecret: string; refreshToken: string }
const digits = (s: string) => String(s).replace(/\D/g, '')

export async function pushToGoogle(o: { creds: GoogleCreds; name: string; rows: GoogleRow[] }): Promise<{ userList: string; sent: number }> {
  const c = o.creds
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }).toString(),
  })
  const t = await readJson(tok)
  if (!tok.ok || !t.access_token) throw new PlatformError(String(t?.error_description || t?.error || `Google sign-in answered ${tok.status}`).slice(0, 300))
  const headers: Record<string, string> = {
    authorization: `Bearer ${t.access_token}`, 'developer-token': c.developerToken, 'content-type': 'application/json',
    ...(c.loginCustomerId ? { 'login-customer-id': digits(c.loginCustomerId) } : {}),
  }
  const root = `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}`
  const cid = digits(c.customerId)
  const call = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    const j = await readJson(res)
    if (!res.ok) throw new PlatformError(googleProblem(j, res.status))
    return j
  }
  const list = await call(`${root}/customers/${cid}/userLists:mutate`, {
    operations: [{ create: { name: o.name, description: 'Customers from the online store', membershipLifeSpan: 540, crmBasedUserList: { uploadKeyType: 'CONTACT_INFO', dataSourceType: 'FIRST_PARTY' } } }],
  })
  const userList = list?.results?.[0]?.resourceName
  if (!userList) throw new PlatformError('Google did not create the list.')
  const job = await call(`${root}/customers/${cid}/offlineUserDataJobs:create`, { job: { type: 'CUSTOMER_MATCH_USER_LIST', customerMatchUserListMetadata: { userList } } })
  const jobName = job?.resourceName
  if (!jobName) throw new PlatformError('Google did not start the upload.')
  let sent = 0
  for (let i = 0; i < o.rows.length; i += BATCH) {
    const slice = o.rows.slice(i, i + BATCH)
    await call(`${root}/${jobName}:addOperations`, {
      enablePartialFailure: true,
      operations: slice.map((r) => ({ create: { userIdentifiers: [
        ...(r.email ? [{ hashedEmail: r.email }] : []), ...(r.phone ? [{ hashedPhoneNumber: r.phone }] : []),
        ...(r.first && r.last && r.country && r.zip ? [{ addressInfo: { hashedFirstName: r.first, hashedLastName: r.last, countryCode: r.country, postalCode: r.zip } }] : []),
      ] } })),
    })
    sent += slice.length
  }
  await call(`${root}/${jobName}:run`, {})
  return { userList: String(userList), sent }
}

/** One Purchase for Meta's Conversions API, de-duplicated against the browser pixel by `eventId` (the order number). */
export async function sendMetaPurchase(o: { pixelId: string; token: string; testCode?: string | null; eventId: string; at: Date; sourceUrl?: string; user: Record<string, string[]>; value: number; currency: string; orderNumber: string; contents: Array<{ id: string; quantity: number; item_price: number }> }): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(o.pixelId)}/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      access_token: o.token, ...(o.testCode ? { test_event_code: o.testCode } : {}),
      data: [{
        event_name: 'Purchase', event_time: Math.floor(o.at.getTime() / 1000), event_id: o.eventId, action_source: 'website', ...(o.sourceUrl ? { event_source_url: o.sourceUrl } : {}),
        user_data: o.user, custom_data: { currency: o.currency.toUpperCase(), value: o.value, order_id: o.orderNumber, content_type: 'product', contents: o.contents, num_items: o.contents.reduce((n, c) => n + c.quantity, 0) },
      }],
    }),
  })
  if (!res.ok) throw new PlatformError(metaProblem(await readJson(res), res.status))
}
