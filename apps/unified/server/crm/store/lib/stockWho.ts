// Who changed the stock, for the stock history (data/storeStockMoves.ts): the person signed in, by the shared actor name (first
// and last name, else email). A door with no person (checkout, a webhook) passes nothing.
import { createActorName } from '@twomiah/tenant-backend'
import { user } from '../../../db/schema/index.ts'

export function createStockWho(db: any) {
  const actorName = createActorName({ db, tables: { user } })
  return async (c: any): Promise<{ byUserId: string | null; byName: string | null }> => {
    const u = c?.get?.('user') as { userId?: string } | undefined
    if (!u?.userId) return { byUserId: null, byName: null }
    return { byUserId: u.userId, byName: (await actorName(u as any)) || null }
  }
}
