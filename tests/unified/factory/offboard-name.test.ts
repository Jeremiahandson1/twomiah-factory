// Security review S5-6 (owner 2026-11-13): when a business is fully offboarded, its free <slug>.twomiah.app name is
// removed with it. The service the name points at is left for a person to delete; a name still pointing at a deleted
// host is one somebody else can claim. Read from the sweep's own code (it runs against the live Factory database).
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../../../apps/api/src/routes/factory/lifecycle.ts'), 'utf8')

test('the offboarding sweep removes the twomiah.app name before it marks the business offboarded', () => {
  const start = src.indexOf('// Teardown pickup: tenants whose grace period has ended.')
  expect(start).toBeGreaterThan(0)
  const sweep = src.slice(start, src.indexOf('results.teardowns++', start))
  expect(sweep).toMatch(/\.select\('[^']*\bslug\b[^']*'\)/)
  const detach = sweep.indexOf('detachTwomiahSubdomain(t.slug)')
  const marked = sweep.indexOf("status: 'offboarded'")
  expect(detach).toBeGreaterThan(0)
  expect(marked).toBeGreaterThan(detach)
})
