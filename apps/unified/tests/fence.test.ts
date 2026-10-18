// RULEBOOK §10, the fence: the engine branch adds in its own places and leaves the live system alone.
import { describe, test, expect } from 'bun:test'
import { checkFence, type Change } from '../../../scripts/check-unified-fence.ts'

const pkgBase = JSON.stringify({ name: '@twomiah/tenant-backend', main: './src/index.ts', peerDependencies: { hono: '^4.0.0' } })
const files: Record<string, { base?: string; head?: string }> = {
  'packages/tenant-backend/package.json': { base: pkgBase },
}
const run = (changes: Change[], head?: string) => {
  if (head !== undefined) files['packages/tenant-backend/package.json'].head = head
  return checkFence(changes, (ref, p) => (ref === 'base' ? files[p]?.base : files[p]?.head) ?? null)
}

describe('allowed', () => {
  test('new files in the unified app, its tests, its checks, its workflow and docs', () => {
    expect(run([
      { status: 'A', path: 'apps/unified/server/app.ts' },
      { status: 'A', path: 'tests/unified/x.test.ts' },
      { status: 'A', path: 'scripts/check-unified-rules.ts' },
      { status: 'A', path: '.github/workflows/unified.yml' },
      { status: 'A', path: 'docs/RULEBOOK.md' },
    ])).toEqual([])
  })

  test('the spec, the lockfile, and a shared package declaring a library it already imports', () => {
    const head = JSON.stringify({ name: '@twomiah/tenant-backend', main: './src/index.ts', peerDependencies: { hono: '^4.0.0', 'drizzle-orm': '^0.36.4' } })
    expect(run([
      { status: 'M', path: 'docs/SPEC_UNIFIED_PRODUCT.md' },
      { status: 'M', path: 'bun.lock' },
      { status: 'M', path: 'packages/tenant-backend/package.json' },
    ], head)).toEqual([])
  })
})

describe('refused', () => {
  test('changing live code: a template, the Factory, shared package source', () => {
    const v = run([
      { status: 'M', path: 'templates/crm/backend/src/index.ts' },
      { status: 'M', path: 'apps/api/src/services/generator.ts' },
      { status: 'M', path: 'packages/tenant-backend/src/auth/auth.ts' },
    ])
    expect(v.map((x) => x.path)).toEqual(['templates/crm/backend/src/index.ts', 'apps/api/src/services/generator.ts', 'packages/tenant-backend/src/auth/auth.ts'])
  })

  test('a new file dropped into live code', () => {
    expect(run([{ status: 'A', path: 'templates/crm/backend/src/routes/new.ts' }]).length).toBe(1)
  })

  test('deleting anything', () => {
    expect(run([{ status: 'D', path: 'templates/crm-salon/backend/src/index.ts' }]).length).toBe(1)
  })

  test("a shared package's manifest changing more than its library list", () => {
    const head = JSON.stringify({ name: '@twomiah/tenant-backend', main: './src/other.ts', peerDependencies: { hono: '^4.0.0' } })
    expect(run([{ status: 'M', path: 'packages/tenant-backend/package.json' }], head)[0].detail).toContain('"main" changed')
  })

  test("a shared package's manifest changing an existing library", () => {
    const head = JSON.stringify({ name: '@twomiah/tenant-backend', main: './src/index.ts', peerDependencies: { hono: '^5.0.0' } })
    expect(run([{ status: 'M', path: 'packages/tenant-backend/package.json' }], head)[0].detail).toContain('peerDependencies.hono')
  })
})
