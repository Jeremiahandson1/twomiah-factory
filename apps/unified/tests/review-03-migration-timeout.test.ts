// Code review 03-1, 2026-11-13: migrations run with their own statement limit, not a request's 30 seconds.
import { test, expect } from 'bun:test'
import { createDb } from '../server/db/client.ts'
import { MIGRATION_STATEMENT_MS } from '../server/db/migrate.ts'

test('a request has 30 seconds a statement; a migration has far longer', async () => {
  const url = 'postgres://nobody:nothing@127.0.0.1:1/none'
  const request = createDb(url)
  const migration = createDb(url, { statementTimeoutMs: MIGRATION_STATEMENT_MS })
  expect((request.pool as any).options.statement_timeout).toBe(30_000)
  expect((migration.pool as any).options.statement_timeout).toBe(MIGRATION_STATEMENT_MS)
  expect(MIGRATION_STATEMENT_MS).toBeGreaterThanOrEqual(10 * 60_000)
  await request.pool.end(); await migration.pool.end()
})
