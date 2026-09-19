// Pairing and identifying a kiosk tablet.
//
// The kiosk API is used by a customer standing at a device, with nobody to sign in as — so authentication
// cannot be a user session, and the whole API was simply open: anyone with the hostname could create real
// orders. The credential therefore belongs to the DEVICE, which is what Stripe Terminal, Square and Toast all
// do with their terminals: pair once, revoke individually. (Dispensary T21 B1)
//
// Rollout is deliberately in two steps, because a required credential would black out every kiosk already
// running the moment it deployed. `kioskEnforcement()` reads the company's own setting: 'warn' (the default)
// records unpaired use and lets it through, 'enforce' refuses it. An operator pairs their real tablets, sees
// the warnings stop, and flips the switch.
import { createHash, randomBytes } from 'node:crypto'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'

const rows = (r: any): any[] => ((r as any)?.rows || r) as any[]

export const hashToken = (token: string) => createHash('sha256').update(String(token)).digest('hex')

/** Unambiguous on a touchscreen: no O/0, no I/1/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const newPairingCode = (): string => {
  const bytes = randomBytes(6)
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}
export const newDeviceToken = (): string => randomBytes(32).toString('hex')

export const PAIRING_TTL_MS = 24 * 60 * 60 * 1000

export type KioskEnforcement = 'warn' | 'enforce'

/**
 * How strictly this company wants the kiosk credential applied.
 *
 * An explicit Settings → company.settings.kioskEnforcement always wins, in either direction. With
 * nothing set, HAVING PAIRED A TABLET is the switch: a company with at least one active device is
 * enforcing, and one with none is still warning.
 *
 * The first version of this defaulted to 'warn' full stop, so that turning the credential on could
 * never black out a shop mid-trade — which was right about the risk and wrong about the outcome. It
 * left the switch to be found, nobody found it, and the kiosk chain went on completing unauthenticated
 * for four more test runs: an order created with no token at all. Pairing is the moment an operator
 * says "these are my tablets", and it is the only moment at which enforcing can cost them nothing —
 * the paired device works, and nothing else does. A shop that has not paired yet still warns, so the
 * blackout this was protecting against still cannot happen. (Dispensary B1, four runs open)
 */
export async function kioskEnforcement(companyId: string): Promise<KioskEnforcement> {
  try {
    const r = await db.execute(sql`SELECT settings FROM company WHERE id = ${companyId} LIMIT 1`)
    const s = rows(r)?.[0]?.settings
    const mode = (typeof s === 'string' ? JSON.parse(s) : s)?.kioskEnforcement
    if (mode === 'enforce' || mode === 'warn') return mode
    return (await hasPairedDevice(companyId)) ? 'enforce' : 'warn'
  } catch {
    return 'warn'
  }
}

/** Has this company ever paired a tablet that is still active? */
export async function hasPairedDevice(companyId: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`SELECT 1 FROM kiosk_devices WHERE company_id = ${companyId} AND status = 'active' LIMIT 1`)
    return (rows(r)?.length || 0) > 0
  } catch {
    return false
  }
}

export interface PairedDevice { id: string; companyId: string; name: string; locationId: string | null }

/** The device behind this request, or null when it carries no usable token. */
export async function deviceForToken(token: string | null | undefined): Promise<PairedDevice | null> {
  if (!token) return null
  const r = await db.execute(sql`
    SELECT id, company_id, name, location_id FROM kiosk_devices
    WHERE token_hash = ${hashToken(token)} AND status = 'active' LIMIT 1
  `)
  const row = rows(r)?.[0]
  if (!row) return null
  // Best-effort: a manager wants to see which tablets are actually in use.
  db.execute(sql`UPDATE kiosk_devices SET last_seen_at = NOW(), updated_at = NOW() WHERE id = ${row.id}`).catch(() => {})
  return { id: row.id, companyId: row.company_id, name: row.name, locationId: row.location_id ?? null }
}

/** Exchange a one-time pairing code for this device's own token. The code is spent either way. */
export async function claimPairingCode(code: string): Promise<{ token: string; device: PairedDevice } | { error: string }> {
  const trimmed = String(code || '').trim().toUpperCase()
  if (!trimmed) return { error: 'Enter the pairing code from Settings → Kiosks.' }
  const r = await db.execute(sql`
    SELECT id, company_id, name, location_id, pairing_expires_at, status
    FROM kiosk_devices WHERE pairing_code = ${trimmed} LIMIT 1
  `)
  const row = rows(r)?.[0]
  if (!row) return { error: 'That pairing code is not recognised.' }
  if (row.status === 'revoked') return { error: 'That kiosk has been removed. Add it again in Settings → Kiosks.' }
  if (row.pairing_expires_at && new Date(row.pairing_expires_at).getTime() < Date.now()) {
    return { error: 'That pairing code has expired. Generate a new one in Settings → Kiosks.' }
  }
  const token = newDeviceToken()
  await db.execute(sql`
    UPDATE kiosk_devices
    SET token_hash = ${hashToken(token)}, token_last4 = ${token.slice(-4)}, status = 'active',
        pairing_code = NULL, pairing_expires_at = NULL, paired_at = NOW(), last_seen_at = NOW(), updated_at = NOW()
    WHERE id = ${row.id}
  `)
  return { token, device: { id: row.id, companyId: row.company_id, name: row.name, locationId: row.location_id ?? null } }
}
