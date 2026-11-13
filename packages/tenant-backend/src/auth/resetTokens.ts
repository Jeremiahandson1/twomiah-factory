// RESET AND INVITE LINKS ARE STORED HASHED (security review S1-10, 2026-11-12).
//
// The token in a "choose your password" link — Forgot password (1 hour) or a team invite (7 days) — was kept in
// user.reset_token exactly as emailed, so anyone who could read the table (a database backup, the connection string)
// could take over every login with a link pending. The column now holds the token's SHA-256; the token itself exists
// only in the email. It is 122 random bits, so a plain hash is enough: there is nothing to guess.
//
// A link emailed BEFORE this shipped is stored as it was sent, and still works until it runs out: the stored value is
// also compared with the token as given — unless what was given has the shape of a stored hash (64 hex characters),
// so a hash read out of the table is never itself a way in.
import crypto from 'crypto'
import { eq, or } from 'drizzle-orm'

/** What goes in the column for a token that goes in the email. */
export function storedResetToken(token: string): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

/** A condition on the reset-token column: this is the row the presented token belongs to. */
export function resetTokenIs(column: any, presented: string): any {
  const given = String(presented || '')
  const hashed = eq(column, storedResetToken(given))
  return /^[0-9a-f]{64}$/i.test(given) ? hashed : or(hashed, eq(column, given))
}
