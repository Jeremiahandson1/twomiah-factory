// A quote's or an invoice's own private link — /d/<token> — the link every quote and invoice email carries (2026-10-22).
//
// Live testers found a quote email with no way to accept it (the Approve button only appeared when the customer's client
// portal was switched on) and an invoice email with no way to pay it (only home care made a payment link). Pros send
// every quote and invoice with a secure link to view it and act on it; this is that link. It opens ONE document — the
// one it was minted for — and nothing else of the customer's: the portal's pages answer it through the same handlers
// they use for the portal (portal.ts, `/d/:token/...`), so approving, declining and paying are recorded one way.
//
// One rule for every email: the document's own link, whether or not the customer has a portal. It always works (the
// portal link depends on the Client Portal feature, the contact's switch and its 90-day expiry), and an email about one
// quote never carries the key to the customer's whole account.
//
// The token is minted the first time the document is sent and never changes, so an earlier email's link keeps working.
// A template whose table has no public_token column gets no token and its email says how to reply, as before.
import crypto from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'

/** Same strength as a portal token: 32 random bytes, hex. */
export const newDocumentToken = () => crypto.randomBytes(32).toString('hex')
export const isDocumentToken = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

/** The path the email links to (the app's address in front). */
export const documentLinkPath = (token: string) => `/d/${token}`

/** The document's token, minted now if it has none. Null when the table has no public_token column. */
export async function documentLinkToken(db: any, table: any, id: string): Promise<string | null> {
  if (!table?.publicToken) return null
  const read = async () => (await db.select({ token: table.publicToken }).from(table).where(eq(table.id, id)).limit(1))[0]?.token ?? null
  const existing = await read()
  if (existing) return existing
  // Only where it is still empty: two sends at once keep the one that landed first.
  await db.update(table).set({ publicToken: newDocumentToken() }).where(and(eq(table.id, id), isNull(table.publicToken)))
  return read()
}

// ---- Preview as the client (Jobber "Preview as client") ----
//
// The office opens the customer's own page for a quote — the same page /d/<token> shows, options, ticks, deposit, the sign
// button — without sending it and without minting the customer's link. The preview link is a note naming the quote and its
// end, signed (HMAC-SHA256 with the server's JWT_SECRET), that lasts 30 minutes; the door it opens (/v/<token>, portal.ts) has no write routes at all, so nothing in a preview can
// sign, tick, choose or decline, and opening it never marks the quote viewed. Feature `quote_preview` (hidden, not ready).
export const QUOTE_PREVIEW_FEATURE = 'quote_preview'
const PREVIEW_PURPOSE = 'quote_preview'
export const PREVIEW_MINUTES = 30

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url')
const previewSig = (body: string) => crypto.createHmac('sha256', `${process.env.JWT_SECRET || ''}:${PREVIEW_PURPOSE}`).update(body).digest('base64url')

/** A preview link's token for one quote of one business: what it opens and until when, signed with the server's secret. */
export function quotePreviewToken(companyId: string, quoteId: string, now = Date.now()): string {
  const body = b64(JSON.stringify({ c: companyId, q: quoteId, e: Math.floor(now / 1000) + PREVIEW_MINUTES * 60 }))
  return `${body}.${previewSig(body)}`
}

/** The quote a preview token names, or null when it is not one (tampered, expired, or another kind of token). */
export function readQuotePreviewToken(token: unknown, now = Date.now()): { companyId: string; quoteId: string } | null {
  if (typeof token !== 'string' || !process.env.JWT_SECRET) return null
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return null
  const want = Buffer.from(previewSig(body)), got = Buffer.from(sig)
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof v?.c !== 'string' || typeof v?.q !== 'string' || typeof v?.e !== 'number' || v.e * 1000 < now) return null
    return { companyId: v.c, quoteId: v.q }
  } catch { return null }
}

/** The path the office opens (the app's address in front). */
export const quotePreviewPath = (token: string) => `/v/${token}`

// ---- "Book a visit" from the portal: a code for the booking form's fill-in, never the portal's own key ----
//
// The portal's Book a visit button opened the website's booking page as /book?portal=<the customer's portal token>, so
// the key to the whole portal sat in a website address — in the browser's history, in analytics hits and in the Referer
// of whatever the page loads (security review S2-10, 2026-11-13). The address now carries a CODE: a signed note naming
// the customer and its end (two hours), good for one thing — reading back the name, email, phone and address the form
// is filled in with (portal.ts GET /prefill/:code). It opens nothing else. Letters, digits, - and _ only, no separator
// (the signature is the last 43 characters), so the booking pages carry it as they carried the token.
const PREFILL_PURPOSE = 'book_prefill'
export const PREFILL_MINUTES = 120
const prefillSig = (body: string) => crypto.createHmac('sha256', `${process.env.JWT_SECRET || ''}:${PREFILL_PURPOSE}`).update(body).digest('base64url')

export function bookPrefillCode(companyId: string, contactId: string, now = Date.now()): string {
  const body = b64(JSON.stringify({ c: companyId, k: contactId, e: Math.floor(now / 1000) + PREFILL_MINUTES * 60 }))
  return `${body}${prefillSig(body)}`
}

/** The customer a prefill code names, or null (tampered, run out, or not one). */
export function readBookPrefillCode(code: unknown, now = Date.now()): { companyId: string; contactId: string } | null {
  if (typeof code !== 'string' || !process.env.JWT_SECRET || !/^[A-Za-z0-9_-]{60,400}$/.test(code)) return null
  const body = code.slice(0, -43), sig = code.slice(-43)
  const want = Buffer.from(prefillSig(body)), got = Buffer.from(sig)
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof v?.c !== 'string' || typeof v?.k !== 'string' || typeof v?.e !== 'number' || v.e * 1000 < now) return null
    return { companyId: v.c, contactId: v.k }
  } catch { return null }
}
