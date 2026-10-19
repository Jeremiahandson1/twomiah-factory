// The store's loyalty row lock, on a REAL Postgres with real concurrent connections — what the in-memory test database
// (one connection) cannot show: two paid orders that both spend the same member's points, settled at the same moment,
// must leave a balance that agrees with the ledger (server/data/storeCore.ts lockLoyaltyMember, SELECT … FOR UPDATE).
// Without the lock both read the same balance and the second write throws the first one's movement away (the salon's
// LY0928 B1, found again in the store's own wiring).
//
// Runs only when TEST_PG_URL names a Postgres server this test may create a database on (e.g. a local throwaway one):
//   TEST_PG_URL=postgres://postgres:pgpass@localhost:54329/postgres bun test tests/store-loyalty-lock.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq, sql } from 'drizzle-orm'
import * as schema from '../server/db/schema/index.ts'
import { MIGRATIONS } from '../server/db/migrate.ts'
import { createStoreCore } from '../server/crm/store/core.ts'

const ADMIN = process.env.TEST_PG_URL
const NAME = 'storelock_' + Date.now().toString(36)
let pool: pg.Pool
let db: any
let core: ReturnType<typeof createStoreCore>
let companyId = ''

describe.skipIf(!ADMIN)('loyalty settled at the same moment, on real Postgres', () => {
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${NAME}`)
    await admin.end()
    const url = new URL(ADMIN!)
    url.pathname = '/' + NAME
    pool = new pg.Pool({ connectionString: url.toString(), max: 10, options: '-c TimeZone=UTC' })
    db = drizzle(pool, { schema })
    await migrate(db, { migrationsFolder: MIGRATIONS })
    const [co] = await db.insert(schema.company).values({ name: 'Lock Store', slug: 'lock-store', settings: { loyalty: { enabled: true, pointsPerDollar: 1 } } }).returning()
    companyId = co.id
    core = createStoreCore({ db, logger: { info() {}, warn() {}, error() {} }, services: { emailService: { register() {}, send: async () => ({}) } } } as any)
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
    if (!ADMIN) return
    const admin = new pg.Client({ connectionString: ADMIN })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`)
    await admin.end()
  })

  test('two orders spending one balance at once: the balance always agrees with the ledger, and is never spent twice', async () => {
    for (let round = 0; round < 8; round++) {
      const [who] = await db.insert(schema.contact).values({ companyId, type: 'customer', name: 'Shopper ' + round, email: `lock${round}@example.com` }).returning()
      const [member] = await db.insert(schema.loyaltyMember).values({ companyId, contactId: who.id, pointsBalance: 100, lifetimePoints: 100 }).returning()
      const [reward] = await db.insert(schema.loyaltyReward).values({ companyId, name: '$10 off', pointsCost: 60, type: 'fixed', valueCents: 1000 }).returning()
      const orders = await Promise.all([0, 1].map(async (i) => (await db.insert(schema.storeOrder).values({
        companyId, contactId: who.id, provider: 'stripe', providerSessionId: `cs_lock_${round}_${i}`, status: 'paid', customerEmail: who.email,
        subtotalCents: 5000, discountCents: 1000, loyaltyRewardId: reward.id, loyaltyDiscountCents: 1000, totalCents: 4000,
      }).returning())[0]))
      await Promise.all(orders.map((o) => core.settleLoyaltyForPaidOrder(companyId, o.id)))
      const [after] = await db.select().from(schema.loyaltyMember).where(eq(schema.loyaltyMember.id, member.id))
      const [{ moved }] = await db.select({ moved: sql<number>`coalesce(sum(${schema.loyaltyTransaction.points}), 0)::int` }).from(schema.loyaltyTransaction).where(eq(schema.loyaltyTransaction.memberId, member.id))
      // 100 to start; every movement is in the ledger; nothing lost to a stale write.
      expect([round, after.pointsBalance]).toEqual([round, 100 + Number(moved)])
      // Never more spent than there was.
      const [{ spent }] = await db.select({ spent: sql<number>`coalesce(-sum(${schema.loyaltyTransaction.points}) filter (where ${schema.loyaltyTransaction.points} < 0), 0)::int` }).from(schema.loyaltyTransaction).where(eq(schema.loyaltyTransaction.memberId, member.id))
      expect(Number(spent)).toBeLessThanOrEqual(100 + 40)
      expect(after.pointsBalance).toBeGreaterThanOrEqual(0)
    }
  }, 120_000)
})
