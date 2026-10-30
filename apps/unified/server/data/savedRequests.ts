// The saved answers behind Idempotency-Key (http/savedOnce.ts): claim a key, read what a claim holds, keep a success,
// let a failure go. One row per company + person + key (saved_request).
import { and, eq, lt } from 'drizzle-orm'
import { savedRequest } from '../db/schema/index.ts'

const KEEP_DAYS = 30
const where = (k: SavedKey) => and(eq(savedRequest.companyId, k.companyId), eq(savedRequest.userId, k.userId), eq(savedRequest.key, k.key))

export interface SavedKey { companyId: string; userId: string; key: string }

/** Claim the key for this try. true: this try does the work. false: another try has (or had) it. */
export async function claimSaved(db: any, k: SavedKey, route: string): Promise<boolean> {
  const rows = await db.insert(savedRequest).values({ ...k, route }).onConflictDoNothing().returning({ id: savedRequest.id })
  return rows.length > 0
}

/** What an earlier try with this key left: its route, and its answer once it finished (status null while running). */
export async function readSaved(db: any, k: SavedKey): Promise<{ route: string; status: number | null; response: string | null } | null> {
  const [row] = await db.select({ route: savedRequest.route, status: savedRequest.status, response: savedRequest.response }).from(savedRequest).where(where(k)).limit(1)
  return row ?? null
}

export async function keepSaved(db: any, k: SavedKey, status: number, response: string): Promise<void> {
  await db.update(savedRequest).set({ status, response }).where(where(k))
}

/** A refused or failed try keeps nothing, so the save can be fixed and sent again under the same key. */
export async function releaseSaved(db: any, k: SavedKey): Promise<void> {
  await db.delete(savedRequest).where(where(k))
}

/** Answers older than KEEP_DAYS go. */
export async function pruneSaved(db: any, now: number = Date.now()): Promise<void> {
  await db.delete(savedRequest).where(lt(savedRequest.createdAt, new Date(now - KEEP_DAYS * 86_400_000)))
}
