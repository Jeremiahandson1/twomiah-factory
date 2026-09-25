/**
 * lib/register/managers.ts — who may OK a void.
 *
 * Voiding food that's already on the grill, voiding a payment, and voiding a
 * check with sent food on it take a manager. Either the person signed in is a
 * manager, or a manager types their PIN on the spot. Until the bar has set up
 * a single manager PIN, nobody is blocked (every void still records who and
 * why), so going live never locks the bartender out.
 */
import bcrypt from 'bcryptjs'
import { and, eq } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { staffPins } from '../../db/schema'

export type ManagerCheck = { ok: true; by: string } | { ok: false; error: string }

// Five wrong manager PINs per signed-in phone per ten minutes, then wait.
const attempts = new Map<string, number[]>()
const WINDOW = 10 * 60 * 1000

export async function managerApproval(db: typeof DB, staff: { id: string; label: string; sessionId: string }, managerPin: unknown): Promise<ManagerCheck> {
  const managers = await db.select().from(staffPins).where(and(eq(staffPins.isActive, true), eq(staffPins.role, 'manager')))
  if (!managers.length) return { ok: true, by: staff.label }
  if (managers.some(m => m.id === staff.id)) return { ok: true, by: staff.label }
  const pin = String(managerPin ?? '').replace(/\D/g, '')
  if (!pin) return { ok: false, error: 'A manager needs to OK that.' }
  const now = Date.now()
  const tries = (attempts.get(staff.sessionId) || []).filter(t => now - t < WINDOW)
  if (tries.length >= 5) return { ok: false, error: 'Too many wrong PINs. Wait a few minutes.' }
  for (const m of managers) if (await bcrypt.compare(pin, m.pinHash)) return { ok: true, by: `${staff.label} (OK'd by ${m.label})` }
  tries.push(now); attempts.set(staff.sessionId, tries)
  return { ok: false, error: 'That is not a manager PIN.' }
}
