// Who may OK a void or close the night, and the till PIN that lets a manager OK it on someone else's screen.
//
// Voiding food already sent to the grill, voiding a payment, voiding a check with sent food on it, and closing
// the night are bar:manage (managers and up; packages/tenant-backend/src/auth/permissions.ts). A bartender
// without it can still do them when a manager types their till PIN on the bartender's register — the record
// then says both names ("Jess (OK'd by Pat)"). The PIN is never a sign-in by itself: it only vouches for an
// action someone signed in is already taking.
//
// Moved from templates/crm-bar/backend/src/services/barManagers.ts (ported there from website-premium-bar's
// lib/register/managers.ts, Amber Inn 9/26), made with the app's database and permissions. The PIN is the same
// user.pin_hash, hashed and checked with Bun's bcrypt exactly as the template did.
import { and, eq, isNotNull } from 'drizzle-orm'
import { user } from '../../db/schema/index.ts'
import type { BarDb } from './db.ts'

export interface Actor { id: string; name: string; companyId: string; role: string }
export type ManagerCheck = { ok: true; byName: string; approverId: string } | { ok: false; error: string }

const MANAGE = 'bar:manage'

export class PinError extends Error { constructor(message: string, public status = 400) { super(message) } }

export function createBarManagers(db: BarDb,permissions: { hasPermission: (role: string, permission: string, extra?: string[]) => boolean; getExtraPermissions: (userId: string) => Promise<string[]> }) {
  const { hasPermission, getExtraPermissions } = permissions

  /** The signed-in person, with the name every record carries. */
  async function actorOf(c: any): Promise<Actor> {
    const u = c.get('user') as { userId: string; companyId: string; role: string }
    const [row] = await db.select({ firstName: user.firstName, lastName: user.lastName, email: user.email }).from(user)
      .where(and(eq(user.id, u.userId), eq(user.companyId, u.companyId))).limit(1)
    const name = row ? [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email : 'Staff'
    return { id: u.userId, name, companyId: u.companyId, role: u.role }
  }

  async function mayManage(a: { id: string; role: string }): Promise<boolean> {
    return hasPermission(a.role, MANAGE, await getExtraPermissions(a.id))
  }

  // Five wrong manager PINs per signed-in person per ten minutes, then wait.
  const attempts = new Map<string, number[]>()
  const WINDOW = 10 * 60 * 1000

  async function managerApproval(actor: Actor, managerPin: unknown): Promise<ManagerCheck> {
    if (await mayManage(actor)) return { ok: true, byName: actor.name, approverId: actor.id }
    const rows: Array<{ id: string; role: string; pinHash: string | null; firstName: string; lastName: string }> = await db
      .select({ id: user.id, role: user.role, pinHash: user.pinHash, firstName: user.firstName, lastName: user.lastName })
      .from(user).where(and(eq(user.companyId, actor.companyId), eq(user.isActive, true), isNotNull(user.pinHash)))
    const managers: typeof rows = []
    for (const r of rows) if (await mayManage({ id: r.id, role: r.role })) managers.push(r)
    if (!managers.length) return { ok: false, error: 'A manager needs to OK that, and no manager has set a till PIN yet (My till PIN, on the register).' }
    const pin = String(managerPin ?? '').replace(/\D/g, '')
    if (!pin) return { ok: false, error: 'A manager needs to OK that. Ask them to type their till PIN.' }
    const now = Date.now()
    const tries = (attempts.get(actor.id) || []).filter(t => now - t < WINDOW)
    if (tries.length >= 5) return { ok: false, error: 'Too many wrong PINs. Wait a few minutes.' }
    for (const m of managers) {
      if (m.pinHash && await Bun.password.verify(pin, m.pinHash)) {
        attempts.delete(actor.id)
        const who = [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || 'a manager'
        return { ok: true, byName: `${actor.name} (OK'd by ${who})`, approverId: m.id }
      }
    }
    tries.push(now); attempts.set(actor.id, tries)
    return { ok: false, error: 'That is not a manager PIN.' }
  }

  /** Set (or change) your own till PIN: 4 to 8 digits, and not one somebody else at this bar already uses. */
  async function setOwnPin(actor: Actor, pinIn: unknown): Promise<void> {
    const pin = String(pinIn ?? '').trim()
    if (!/^\d{4,8}$/.test(pin)) throw new PinError('A till PIN is 4 to 8 digits.')
    const others: Array<{ id: string; pinHash: string | null }> = await db.select({ id: user.id, pinHash: user.pinHash }).from(user)
      .where(and(eq(user.companyId, actor.companyId), isNotNull(user.pinHash)))
    for (const o of others) {
      if (o.id !== actor.id && o.pinHash && await Bun.password.verify(pin, o.pinHash)) throw new PinError('Somebody here already uses that PIN. Pick another.', 409)
    }
    await db.update(user).set({ pinHash: await Bun.password.hash(pin, 'bcrypt'), updatedAt: new Date() })
      .where(and(eq(user.id, actor.id), eq(user.companyId, actor.companyId)))
  }

  async function clearOwnPin(actor: Actor): Promise<void> {
    await db.update(user).set({ pinHash: null, updatedAt: new Date() }).where(and(eq(user.id, actor.id), eq(user.companyId, actor.companyId)))
  }

  async function hasOwnPin(actor: Actor): Promise<boolean> {
    const [r] = await db.select({ pinHash: user.pinHash }).from(user).where(and(eq(user.id, actor.id), eq(user.companyId, actor.companyId))).limit(1)
    return !!r?.pinHash
  }

  return { actorOf, mayManage, managerApproval, setOwnPin, clearOwnPin, hasOwnPin }
}
export type BarManagers = ReturnType<typeof createBarManagers>
