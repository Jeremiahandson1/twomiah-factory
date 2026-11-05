// Tips from another register (restaurant-bar parity #17, feature 'bar_tip_import'): a venue whose register is Toast or Square connects
// that account, and the tips it took join the same tip pool and tip-out rules as ours (barTips.ts reads barTipImport).
//
//   · Square: OAuth on Twomiah's Square developer app (SQUARE_OAUTH_CLIENT_ID / SQUARE_OAUTH_CLIENT_SECRET in the tenant's settings;
//     SQUARE_OAUTH_SANDBOX=true for Square's sandbox). The venue signs in at Square and allows Payments and Team read-only.
//     The state is signed (HMAC, 15 minutes), the tokens are kept encrypted (server/core/crypto.ts), the access token is renewed
//     once it is within 7 days of ending, and a refusal marks the connection "needs attention" instead of failing quietly.
//   · Toast: the venue makes its own read-only "Standard API" credentials in Toast Web and types them here with its restaurant GUID
//     and the API host Toast gave it; the secret is encrypted the moment it arrives and never sent back.
//   · What is read: tips on completed payments for one business day, with who took them. A day is pulled again whenever its tips are
//     counted (the tips page, the close-out) and once an hour for tonight and last night unless last night was closed; the same payment
//     twice changes nothing, a payment that stopped counting (voided, refunded) leaves the night.
//   · Staff: matched to our people by email, or by hand; tips of staff nobody matched are listed and never shared.
// Nothing here calls a provider except through packages/tenant-backend/src/integrations/{squareTips,toastTips}.ts.
import crypto from 'node:crypto'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import {
  squareAuthorizeUrl, squareExchangeCode, squareRefresh, squareStaff, squareTips, ProviderError, SQUARE_RENEW_WITHIN_MS,
  toastLogin, toastStaff, toastTips, cleanToastHost,
  type ProviderStaff,
} from '@twomiah/tenant-backend'
import { barTipImport, barTipPayout, barTipSource, barTipStaffMap, user } from '../../db/schema/index.ts'
import { decryptJSON, encryptJSON } from '../../core/crypto.ts'
import type { BarDb } from './db.ts'
import { addDays } from './barHours.ts'
import { businessDayOf, businessDayWindow, type BarLive } from './barLive.ts'

export class SourceError extends Error { constructor(message: string, public status = 400) { super(message) } }

const STATE_TTL_MS = 15 * 60 * 1000
const DAY = /^\d{4}-\d{2}-\d{2}$/
const nameOf = (u: { first: string | null; last: string | null; email: string }) => [u.first, u.last].filter(Boolean).join(' ').trim() || u.email
const PROVIDERS = ['toast', 'square'] as const
type Provider = (typeof PROVIDERS)[number]
const LABEL: Record<Provider, string> = { toast: 'Toast', square: 'Square' }

interface SquareCreds { accessToken: string; refreshToken: string; expiresAt: string }
interface ToastCreds { host: string; clientId: string; clientSecret: string; restaurantGuid: string; accessToken?: string; tokenExpiresAt?: string }

export function createBarTipSources(db: BarDb, live: BarLive, deps: { logger: { error: (m: string, x?: any) => void } }) {
  // ── Twomiah's Square developer app, set per tenant by the Factory. Missing = the venue is told to ask us, not shown a broken button.
  const squareApp = () => {
    const clientId = process.env.SQUARE_OAUTH_CLIENT_ID, clientSecret = process.env.SQUARE_OAUTH_CLIENT_SECRET
    return clientId && clientSecret ? { clientId, clientSecret, sandbox: process.env.SQUARE_OAUTH_SANDBOX === 'true' } : null
  }
  /** What the Square calls need besides the secret (the host); the same whether or not the app is set. */
  const squareCall = () => squareApp() ?? { clientId: '', clientSecret: '', sandbox: process.env.SQUARE_OAUTH_SANDBOX === 'true' }
  const stateSecret = () => process.env.TIP_SOURCE_STATE_SECRET || process.env.JWT_SECRET || ''
  const sign = (s: string) => crypto.createHmac('sha256', stateSecret()).update(`tip-source.square.${s}`).digest('hex')
  function signState(companyId: string, byName: string, now = Date.now()): string {
    if (!stateSecret()) throw new SourceError('Square can’t be connected right now. Email support@twomiah.com and we will fix it.', 503)
    const body = { companyId, by: byName, ts: now }
    return Buffer.from(JSON.stringify({ ...body, sig: sign(JSON.stringify(body)) })).toString('base64url')
  }
  function verifyState(state: unknown, now = Date.now()): { companyId: string; by: string } | null {
    if (!state || !stateSecret()) return null
    let p: any
    try { p = JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8')) } catch { return null }
    if (!p || typeof p.companyId !== 'string' || typeof p.by !== 'string' || typeof p.ts !== 'number' || typeof p.sig !== 'string') return null
    if (Math.abs(now - p.ts) > STATE_TTL_MS) return null
    const want = Buffer.from(sign(JSON.stringify({ companyId: p.companyId, by: p.by, ts: p.ts }))), got = Buffer.from(p.sig)
    return want.length === got.length && crypto.timingSafeEqual(want, got) ? { companyId: p.companyId, by: p.by } : null
  }

  type Source = typeof barTipSource.$inferSelect
  const view = (s: Source) => ({
    id: s.id, provider: s.provider as Provider, providerName: LABEL[s.provider as Provider] ?? s.provider, label: s.label, status: s.status, lastError: s.lastError,
    lastImportAt: s.lastImportAt?.toISOString() ?? null, connectedByName: s.connectedByName, locationId: s.locationId, restaurantGuid: s.provider === 'toast' ? s.externalAccountId : null,
  })
  const sourceOf = async (companyId: string, provider: string): Promise<Source | null> =>
    (await db.select().from(barTipSource).where(and(eq(barTipSource.companyId, companyId), eq(barTipSource.provider, provider))).limit(1))[0] ?? null

  async function list(companyId: string) {
    const rows = await db.select().from(barTipSource).where(eq(barTipSource.companyId, companyId))
    return { sources: rows.map(view), available: { square: !!squareApp() && !!stateSecret(), toast: true } }
  }

  // ── Connecting ────────────────────────────────────────────────────────────────────────────────────────────
  function squareAuthUrl(companyId: string, byName: string): string {
    const app = squareApp()
    if (!app) throw new SourceError('Square isn’t switched on for your account yet. Email support@twomiah.com and we will turn it on.', 503)
    return squareAuthorizeUrl(app, signState(companyId, byName))
  }

  async function save(companyId: string, provider: Provider, v: { creds: SquareCreds | ToastCreds; accountId: string | null; expiresAt: Date | null; byName: string | null; label?: string | null }) {
    const set = {
      credentialsEnc: encryptJSON(v.creds), externalAccountId: v.accountId, tokenExpiresAt: v.expiresAt, status: 'connected', lastError: null, updatedAt: new Date(),
      ...(v.byName ? { connectedByName: v.byName } : {}), ...(v.label !== undefined ? { label: v.label } : {}),
    }
    const cur = await sourceOf(companyId, provider)
    if (cur) { await db.update(barTipSource).set(set).where(eq(barTipSource.id, cur.id)); return cur.id }
    const [row] = await db.insert(barTipSource).values({ companyId, provider, ...set }).returning({ id: barTipSource.id })
    return row.id
  }

  /** Square sent the browser back with a code: check the state, trade the code, keep the tokens encrypted, read the staff. */
  async function squareReturn(q: { state?: string; code?: string; error?: string }): Promise<{ ok: boolean; why?: string }> {
    const s = verifyState(q.state)
    if (!s) return { ok: false, why: 'That link expired. Start again from the Tips page.' }
    if (q.error || !q.code) return { ok: false, why: q.error === 'access_denied' ? 'Square was not allowed to share the account.' : 'Square did not finish connecting.' }
    const app = squareApp()
    if (!app) return { ok: false, why: 'Square isn’t switched on for your account yet.' }
    try {
      const t = await squareExchangeCode(app, q.code)
      await save(s.companyId, 'square', { creds: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt }, accountId: t.merchantId || null, expiresAt: t.expiresAt ? new Date(t.expiresAt) : null, byName: s.by })
      await syncStaff((await sourceOf(s.companyId, 'square'))!).catch((e) => deps.logger.error('[tip-sources] square staff', { error: e?.message }))
      return { ok: true }
    } catch (e: any) {
      deps.logger.error('[tip-sources] square connect failed', { error: e?.message })
      return { ok: false, why: e instanceof ProviderError ? e.message : 'Square did not finish connecting.' }
    }
  }

  /** Toast: the venue's own read-only credentials. Tried once before they are kept, so a typo is caught here. */
  async function connectToast(companyId: string, byName: string, b: any) {
    const host = cleanToastHost(b?.host)
    if (!host) throw new SourceError('Type the API address Toast gave you; it ends in toasttab.com.')
    const clientId = String(b?.clientId ?? '').trim(), clientSecret = String(b?.clientSecret ?? '').trim(), restaurantGuid = String(b?.restaurantGuid ?? '').trim()
    if (!clientId || !clientSecret) throw new SourceError('Type the client ID and the client secret from Toast.')
    if (!/^[0-9a-fA-F-]{8,64}$/.test(restaurantGuid)) throw new SourceError('Type the restaurant ID (a long code with dashes) from the email Toast sent.')
    const creds: ToastCreds = { host, clientId, clientSecret, restaurantGuid }
    let t
    try { t = await toastLogin(creds) } catch (e: any) { throw new SourceError(e instanceof ProviderError ? e.message : 'Toast could not be reached.', e?.kind === 'auth' ? 400 : 502) }
    creds.accessToken = t.accessToken; creds.tokenExpiresAt = t.expiresAt
    const label = String(b?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null
    await save(companyId, 'toast', { creds, accountId: restaurantGuid, expiresAt: new Date(t.expiresAt), byName, label })
    await syncStaff((await sourceOf(companyId, 'toast'))!).catch((e) => deps.logger.error('[tip-sources] toast staff', { error: e?.message }))
    return view((await sourceOf(companyId, 'toast'))!)
  }

  async function disconnect(companyId: string, provider: string) {
    const s = await sourceOf(companyId, provider)
    if (!s) throw new SourceError('That is not connected.', 404)
    await db.delete(barTipSource).where(eq(barTipSource.id, s.id))   // its imports and staff matches go with it
    return view(s)
  }

  async function setLocation(companyId: string, provider: string, locationId: unknown) {
    const s = await sourceOf(companyId, provider)
    if (!s || provider !== 'square') throw new SourceError('Only a connected Square account has a location to choose.', 404)
    const id = String(locationId ?? '').trim()
    if (id && !/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new SourceError('That does not look like a Square location ID.')
    await db.update(barTipSource).set({ locationId: id || null, updatedAt: new Date() }).where(eq(barTipSource.id, s.id))
    return view((await sourceOf(companyId, provider))!)
  }

  // ── Reading ───────────────────────────────────────────────────────────────────────────────────────────────
  /** A token that works now: Square's is renewed inside its last 7 days, Toast's logged in again when it has ended. Re-encrypted when it changes. */
  async function access(s: Source): Promise<{ token: string; toast?: ToastCreds }> {
    let creds: SquareCreds | ToastCreds
    try { creds = decryptJSON(s.credentialsEnc) } catch { throw new ProviderError('The saved connection can no longer be read. Connect again.', 'auth') }
    if (s.provider === 'square') {
      const c = creds as SquareCreds, app = squareApp()
      const ends = c.expiresAt ? new Date(c.expiresAt).getTime() : 0
      if (ends && ends - Date.now() <= SQUARE_RENEW_WITHIN_MS) {
        if (!app || !c.refreshToken) throw new ProviderError('Square needs you to connect again.', 'auth')
        const t = await squareRefresh(app, c.refreshToken)
        const next = { accessToken: t.accessToken, refreshToken: t.refreshToken || c.refreshToken, expiresAt: t.expiresAt }
        await db.update(barTipSource).set({ credentialsEnc: encryptJSON(next), tokenExpiresAt: t.expiresAt ? new Date(t.expiresAt) : null, updatedAt: new Date() }).where(eq(barTipSource.id, s.id))
        return { token: next.accessToken }
      }
      return { token: c.accessToken }
    }
    const c = creds as ToastCreds
    if (c.accessToken && c.tokenExpiresAt && new Date(c.tokenExpiresAt).getTime() - Date.now() > 5 * 60 * 1000) return { token: c.accessToken, toast: c }
    const t = await toastLogin(c)
    const next = { ...c, accessToken: t.accessToken, tokenExpiresAt: t.expiresAt }
    await db.update(barTipSource).set({ credentialsEnc: encryptJSON(next), tokenExpiresAt: new Date(t.expiresAt), updatedAt: new Date() }).where(eq(barTipSource.id, s.id))
    return { token: t.accessToken, toast: next }
  }

  /** Keep the provider's staff list beside ours and match whoever has the same email as one of our people. A hand match is never undone. */
  async function syncStaff(s: Source) {
    const a = await access(s)
    const staff: ProviderStaff[] = s.provider === 'square' ? await squareStaff(squareCall(), a.token, s.locationId) : await toastStaff(a.toast!, a.token)
    const users = await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.companyId, s.companyId))
    const byEmail = new Map<string, string[]>()
    for (const u of users) { const k = u.email.toLowerCase(); byEmail.set(k, [...(byEmail.get(k) || []), u.id]) }
    const have = new Map((await db.select().from(barTipStaffMap).where(eq(barTipStaffMap.sourceId, s.id))).map((r) => [r.externalStaffId, r]))
    for (const p of staff) {
      const row = have.get(p.id)
      const hit = p.email ? byEmail.get(p.email.toLowerCase()) : undefined
      const auto = hit && hit.length === 1 ? hit[0] : null
      if (!row) await db.insert(barTipStaffMap).values({ companyId: s.companyId, sourceId: s.id, externalStaffId: p.id, externalName: p.name, externalEmail: p.email, userId: auto, matchedBy: auto ? 'email' : null })
      else await db.update(barTipStaffMap).set({ externalName: p.name, externalEmail: p.email, ...(row.matchedBy !== 'manual' && !row.userId && auto ? { userId: auto, matchedBy: 'email' } : {}) }).where(eq(barTipStaffMap.id, row.id))
    }
  }

  /** Pull one business day from one source and make that day's imported rows match what the provider says now. */
  async function pullDay(s: Source, day: string) {
    const a = await access(s)
    let found: Array<{ id: string; tipCents: number; staffId: string | null; paidAt: Date }>
    if (s.provider === 'square') {
      const { from, to } = businessDayWindow(day, (await live.hoursFor(s.companyId)).timezone!)
      found = await squareTips(squareCall(), a.token, { from, to, locationId: s.locationId })
    } else found = await toastTips(a.toast!, a.token, day)
    await db.transaction(async (tx: any) => {
      const ids = found.map((f) => f.id)
      const gone = and(eq(barTipImport.sourceId, s.id), eq(barTipImport.businessDay, day), ...(ids.length ? [notInArray(barTipImport.externalId, ids)] : []))
      await tx.delete(barTipImport).where(gone)
      for (const f of found) {
        await tx.insert(barTipImport).values({ companyId: s.companyId, sourceId: s.id, provider: s.provider, externalId: f.id, businessDay: day, externalStaffId: f.staffId, tipCents: f.tipCents, paidAt: f.paidAt })
          .onConflictDoUpdate({ target: [barTipImport.companyId, barTipImport.provider, barTipImport.externalId], set: { businessDay: day, externalStaffId: f.staffId, tipCents: f.tipCents, paidAt: f.paidAt, importedAt: new Date() } })
      }
    })
    // People who took tips but are not in the staff list yet (a team member added since) still get a row to match.
    const known = new Set((await db.select({ id: barTipStaffMap.externalStaffId }).from(barTipStaffMap).where(eq(barTipStaffMap.sourceId, s.id))).map((r) => r.id))
    for (const id of new Set(found.map((f) => f.staffId).filter((x): x is string => !!x))) {
      if (!known.has(id)) await db.insert(barTipStaffMap).values({ companyId: s.companyId, sourceId: s.id, externalStaffId: id, externalName: null, externalEmail: null, userId: null, matchedBy: null }).onConflictDoNothing()
    }
    return found.length
  }

  /** Import one day from every connected source (or the one named). Returns the sentences a manager should see when something could not be read. */
  async function importDay(companyId: string, day: string, only?: string): Promise<string[]> {
    if (!DAY.test(day)) throw new SourceError('Which night?')
    const rows = await db.select().from(barTipSource).where(and(eq(barTipSource.companyId, companyId), ...(only ? [eq(barTipSource.provider, only)] : [])))
    const notes: string[] = []
    for (const s of rows) {
      try {
        await syncStaff(s).catch((e) => { if (e instanceof ProviderError && e.kind === 'auth') throw e })
        await pullDay(s, day)
        await db.update(barTipSource).set({ lastImportAt: new Date(), status: 'connected', lastError: null }).where(eq(barTipSource.id, s.id))
      } catch (e: any) {
        const auth = e instanceof ProviderError && e.kind === 'auth'
        const why = e instanceof ProviderError ? e.message : `${LABEL[s.provider as Provider] ?? s.provider} could not be read.`
        if (!(e instanceof ProviderError)) deps.logger.error('[tip-sources] import failed', { provider: s.provider, error: e?.message })
        await db.update(barTipSource).set({ lastError: why, ...(auth ? { status: 'needs_attention' } : {}) }).where(eq(barTipSource.id, s.id))
        notes.push(`${LABEL[s.provider as Provider] ?? s.provider} tips are not up to date: ${why}`)
      }
    }
    return notes
  }

  /** The hourly pass: tonight and last night for every company with a source (last night skipped once it was closed). */
  async function runImports(now: Date, enabled: (companyId: string) => Promise<boolean>): Promise<number> {
    const ids = [...new Set((await db.select({ id: barTipSource.companyId }).from(barTipSource)).map((r) => r.id))]
    let n = 0
    for (const companyId of ids) {
      if (!(await enabled(companyId))) continue
      const today = businessDayOf(now, (await live.hoursFor(companyId)).timezone!)
      for (const day of [today, addDays(today, -1)]) {
        const [closed] = await db.select({ id: barTipPayout.id }).from(barTipPayout).where(and(eq(barTipPayout.companyId, companyId), eq(barTipPayout.businessDay, day))).limit(1)
        if (closed) continue
        await importDay(companyId, day); n++
      }
    }
    return n
  }

  // ── Matching staff ──────────────────────────────────────────────────────────────────────────────────────────
  async function staff(companyId: string) {
    const sources = await db.select().from(barTipSource).where(eq(barTipSource.companyId, companyId))
    const maps = sources.length ? await db.select().from(barTipStaffMap).where(inArray(barTipStaffMap.sourceId, sources.map((s) => s.id))) : []
    const users = await db.select({ id: user.id, first: user.firstName, last: user.lastName, email: user.email }).from(user).where(eq(user.companyId, companyId))
    return {
      sources: sources.map((s) => ({
        ...view(s),
        staff: maps.filter((m) => m.sourceId === s.id).map((m) => ({ externalStaffId: m.externalStaffId, name: m.externalName || 'Unnamed staff member', email: m.externalEmail, userId: m.userId, matchedBy: m.matchedBy }))
          .sort((a, b) => Number(!!a.userId) - Number(!!b.userId) || a.name.localeCompare(b.name)),
      })),
      people: users.map((u) => ({ id: u.id, name: nameOf(u) })).sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  async function matchStaff(companyId: string, b: any) {
    const sourceId = String(b?.sourceId ?? ''), staffId = String(b?.externalStaffId ?? '')
    const [row] = await db.select().from(barTipStaffMap).where(and(eq(barTipStaffMap.companyId, companyId), eq(barTipStaffMap.sourceId, sourceId), eq(barTipStaffMap.externalStaffId, staffId))).limit(1)
    if (!row) throw new SourceError('That staff member is not in the list.', 404)
    const userId = b?.userId ? String(b.userId) : null
    if (userId) {
      const [u] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, userId), eq(user.companyId, companyId))).limit(1)
      if (!u) throw new SourceError('Pick one of your own people.')
    }
    await db.update(barTipStaffMap).set({ userId, matchedBy: 'manual' }).where(eq(barTipStaffMap.id, row.id))
    return { externalStaffId: staffId, userId }
  }

  return { list, squareAuthUrl, squareReturn, connectToast, disconnect, setLocation, importDay, runImports, staff, matchStaff, signState, verifyState }
}
export type BarTipSources = ReturnType<typeof createBarTipSources>
