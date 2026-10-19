// The plan's seat cap, ONE rule for every place that makes an active login: the team screen's add (company.ts), and a
// vertical's own (home care's caregiver, a hire from an application, an office login). Home care made caregivers
// without it, so a plan's seat count held on the team screen and nowhere else.
//
// SEAT_LIMIT (env, written by the Factory) wins; settings.seatLimit lets staff change it without a redeploy; neither
// set => no cap. Call it inside the transaction that inserts, AFTER locking the company row (select … for update),
// so two concurrent adds cannot both pass the count.
import { and, eq } from 'drizzle-orm'

export interface SeatTables { company: any; user: any }

/** The seat count this company is held to, or null for none. */
export function seatLimitOf(companyRow: { settings?: unknown } | null | undefined): number | null {
  const envSeats = Number.parseInt(process.env.SEAT_LIMIT || '', 10)
  const settingSeats = Number.parseInt(String((companyRow?.settings as any)?.seatLimit ?? ''), 10)
  return Number.isInteger(envSeats) && envSeats > 0 ? envSeats : (Number.isInteger(settingSeats) && settingSeats > 0 ? settingSeats : null)
}

/**
 * The refusal when one more active login would pass the plan's seats, else null. `companyRow` is the row the caller
 * locked; `tx` the transaction it holds.
 */
export async function seatRefusal(tx: any, t: SeatTables, companyRow: { id: string; settings?: unknown }): Promise<{ error: string; seatLimit: number; activeSeats: number } | null> {
  const seatLimit = seatLimitOf(companyRow)
  if (!seatLimit) return null
  const active = await tx.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.companyId, companyRow.id), eq(t.user.isActive, true)))
  if (active.length < seatLimit) return null
  return {
    error: `Your plan includes ${seatLimit} user${seatLimit === 1 ? '' : 's'} and ${active.length} are already active. Deactivate someone or upgrade to add more.`,
    seatLimit, activeSeats: active.length,
  }
}
