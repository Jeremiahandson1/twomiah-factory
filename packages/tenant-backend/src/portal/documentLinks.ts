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
