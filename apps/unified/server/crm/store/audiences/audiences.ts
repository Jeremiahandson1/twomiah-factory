// The store's audiences and purchase tags (store_audiences, 2026-10-31, parity row 7): the shop's settings for them (secrets
// encrypted, never read back), the log of what was exported or sent, and the server-side Purchase event (Meta Conversions API).
// The browser tags are the order-received page's own script (site/views/sections/shop/receipt.ejs), switched by the same settings.
import { and, desc, eq } from 'drizzle-orm'
import { website } from '../../../db/schema/site.ts'
import { storeAudienceLog, storeAudienceSetting, storeOrder, storeOrderItem } from '../../../db/schema/store.ts'
import { contact } from '../../../db/schema/index.ts'
import { decrypt, encrypt } from '../../../core/crypto.ts'
import type { CrmDeps } from '../../deps.ts'
import { normCity, normEmail, normName, normPhoneDigits, normState, normZip, sha256, splitName } from './hashing.ts'
import { sendMetaPurchase } from './platforms.ts'

type Settings = typeof storeAudienceSetting.$inferSelect
type FeatureCheck = { features?: { isFeatureEnabled: (c: string, f: string) => Promise<boolean> }; isFeatureEnabled?: (c: string, f: string) => Promise<boolean> }

/** Whether the shop has the audiences feature on — from either shape of dependency bag the store is built with. */
export const audiencesEnabled = (d: FeatureCheck, companyId: string): Promise<boolean> =>
  (d.features?.isFeatureEnabled ?? d.isFeatureEnabled)?.(companyId, 'store_audiences')?.catch(() => false) ?? Promise.resolve(false)

export async function settingsRow(db: any, companyId: string): Promise<Settings | null> {
  return (await db.select().from(storeAudienceSetting).where(eq(storeAudienceSetting.companyId, companyId)).limit(1))[0] ?? null
}
const secret = (enc: string | null | undefined): string | null => { try { return enc ? decrypt(enc) : null } catch { return null } }
export const googleCredsOf = (s: Settings | null) => {
  if (!s) return null
  const developerToken = secret(s.googleDeveloperTokenEnc), clientSecret = secret(s.googleClientSecretEnc), refreshToken = secret(s.googleRefreshTokenEnc)
  return s.googleCustomerId && s.googleClientId && developerToken && clientSecret && refreshToken
    ? { customerId: s.googleCustomerId, loginCustomerId: s.googleLoginCustomerId, developerToken, clientId: s.googleClientId, clientSecret, refreshToken } : null
}
export const metaPushOf = (s: Settings | null) => { const token = secret(s?.metaAccessTokenEnc); return s?.metaAdAccountId && token ? { adAccountId: s.metaAdAccountId, token } : null }

/** What the screen may see: which pieces are connected, never a secret. */
export async function settingsView(db: any, companyId: string) {
  const s = await settingsRow(db, companyId)
  const [site] = await db.select({ pixel: website.facebookPixelId, gtm: website.googleTagManagerId }).from(website).where(eq(website.companyId, companyId)).limit(1)
  return {
    purchaseEventsOn: !!s?.purchaseEventsOn,
    meta: {
      pixelId: site?.pixel || null, capiOn: !!s?.metaCapiOn, capiTokenSet: !!s?.metaCapiTokenEnc, testEventCode: s?.metaTestEventCode ?? null,
      adAccountId: s?.metaAdAccountId ?? null, accessTokenSet: !!s?.metaAccessTokenEnc, canPush: !!metaPushOf(s),
    },
    google: {
      tagManagerId: site?.gtm || null, customerId: s?.googleCustomerId ?? null, loginCustomerId: s?.googleLoginCustomerId ?? null, clientId: s?.googleClientId ?? null,
      developerTokenSet: !!s?.googleDeveloperTokenEnc, clientSecretSet: !!s?.googleClientSecretEnc, refreshTokenSet: !!s?.googleRefreshTokenEnc, canPush: !!googleCredsOf(s),
    },
  }
}

export async function recentLog(db: any, companyId: string, limit = 30) {
  return db.select().from(storeAudienceLog).where(eq(storeAudienceLog.companyId, companyId)).orderBy(desc(storeAudienceLog.createdAt)).limit(limit)
}
export async function writeLog(db: any, row: { companyId: string; segmentId?: string | null; platform: 'meta' | 'google' | 'meta_capi'; kind: 'download' | 'push' | 'event'; people?: number; status: 'ok' | 'failed'; detail?: string | null }) {
  await db.insert(storeAudienceLog).values({ companyId: row.companyId, segmentId: row.segmentId ?? null, platform: row.platform, kind: row.kind, people: row.people ?? 0, status: row.status, detail: row.detail?.slice(0, 500) ?? null })
}

/** The fields the owner may send; a secret left out or blank is kept, `null` clears it. */
export async function saveSettings(db: any, companyId: string, patch: Partial<{
  purchaseEventsOn: boolean; metaCapiOn: boolean; metaCapiToken: string | null; metaTestEventCode: string | null; metaAdAccountId: string | null; metaAccessToken: string | null
  googleCustomerId: string | null; googleLoginCustomerId: string | null; googleDeveloperToken: string | null; googleClientId: string | null; googleClientSecret: string | null; googleRefreshToken: string | null
}>) {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  const plain = (k: keyof typeof patch, col: string) => { if (patch[k] !== undefined) set[col] = patch[k] === null || patch[k] === '' ? null : patch[k] }
  const sealed = (k: keyof typeof patch, col: string) => { const v = patch[k]; if (v === null) set[col] = null; else if (typeof v === 'string' && v.trim()) set[col] = encrypt(v.trim()) }
  if (patch.purchaseEventsOn !== undefined) set.purchaseEventsOn = patch.purchaseEventsOn
  if (patch.metaCapiOn !== undefined) set.metaCapiOn = patch.metaCapiOn
  plain('metaTestEventCode', 'metaTestEventCode'); plain('metaAdAccountId', 'metaAdAccountId'); plain('googleCustomerId', 'googleCustomerId')
  plain('googleLoginCustomerId', 'googleLoginCustomerId'); plain('googleClientId', 'googleClientId')
  sealed('metaCapiToken', 'metaCapiTokenEnc'); sealed('metaAccessToken', 'metaAccessTokenEnc'); sealed('googleDeveloperToken', 'googleDeveloperTokenEnc')
  sealed('googleClientSecret', 'googleClientSecretEnc'); sealed('googleRefreshToken', 'googleRefreshTokenEnc')
  const cur = await settingsRow(db, companyId)
  if (cur) await db.update(storeAudienceSetting).set(set).where(eq(storeAudienceSetting.id, cur.id))
  else await db.insert(storeAudienceSetting).values({ companyId, ...set })
}

/**
 * A paid order → one Purchase to Meta's Conversions API, when the shop switched it on and gave a pixel (Website settings) and a
 * token. De-duplicated with the browser pixel by event id = the order number. Skips a customer who unsubscribed. One attempt; a
 * failure is written to the log (the owner sees it) and never touches the order. Never throws.
 */
export async function sendPurchaseEvent(d: Pick<CrmDeps, 'db' | 'logger'> & FeatureCheck, order: { id: string; companyId: string; contactId: string | null; orderNumber: string | null; customerEmail: string; customerName: string | null; customerPhone: string | null; shippingAddress: any; totalCents: number; currency: string }): Promise<void> {
  try {
    const s = await settingsRow(d.db, order.companyId)
    if (!s?.metaCapiOn) return
    if (!(await audiencesEnabled(d, order.companyId))) return
    const token = secret(s.metaCapiTokenEnc)
    const [site] = await d.db.select({ pixel: website.facebookPixelId }).from(website).where(eq(website.companyId, order.companyId)).limit(1)
    if (!token || !site?.pixel) return
    if (order.contactId) {
      const [c] = await d.db.select({ out: contact.emailOptOut }).from(contact).where(eq(contact.id, order.contactId)).limit(1)
      if (c?.out) return
    }
    const items = await d.db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, order.id))
    const em = normEmail(order.customerEmail), ph = normPhoneDigits(order.customerPhone)
    const n = splitName(order.customerName), a = order.shippingAddress || {}
    const put = (k: string, v: string | null) => (v ? { [k]: [sha256(v)] } : {})
    const user = { ...put('em', em), ...put('ph', ph), ...put('fn', normName(n.first)), ...put('ln', normName(n.last)), ...put('ct', normCity(a.city)), ...put('st', normState(a.state)), ...put('zp', normZip(a.postalCode)), ...put('country', normState(a.country)) }
    if (!Object.keys(user).length) return
    const eventId = order.orderNumber || order.id
    try {
      await sendMetaPurchase({
        pixelId: site.pixel, token, testCode: s.metaTestEventCode, eventId, at: new Date(), orderNumber: eventId, value: order.totalCents / 100, currency: order.currency, user,
        contents: items.map((i: any) => ({ id: i.sku, quantity: i.quantity, item_price: i.unitPriceCents / 100 })),
      })
      await writeLog(d.db, { companyId: order.companyId, platform: 'meta_capi', kind: 'event', people: 1, status: 'ok', detail: `Purchase ${eventId}` })
    } catch (e: any) {
      d.logger.warn('[store] purchase event not sent', { order: order.id, error: e?.message })
      await writeLog(d.db, { companyId: order.companyId, platform: 'meta_capi', kind: 'event', people: 1, status: 'failed', detail: `Purchase ${eventId}: ${e?.message}` })
    }
  } catch (e: any) { d.logger.warn('[store] purchase event skipped', { error: e?.message }) }
}
