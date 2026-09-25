/**
 * lib/square/state.ts — what the app learns about its Square connection at
 * runtime (the webhook subscription it created and its signature key).
 * Credentials themselves stay in env.
 */
import { eq } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { squareState } from '../../db/schema'

export async function upsertState(db: typeof DB, patch: Partial<typeof squareState.$inferInsert>) {
  const [row] = await db.select().from(squareState).limit(1)
  if (row) await db.update(squareState).set({ ...patch, updatedAt: new Date() }).where(eq(squareState.id, row.id))
  else await db.insert(squareState).values({ ...patch })
}

export async function getState(db: typeof DB) {
  const [row] = await db.select().from(squareState).limit(1)
  return row || null
}
