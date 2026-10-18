// RULEBOOK §10, the fence: the engine branch adds in its own places, may improve the shared code, and leaves the
// templates and the Factory alone.
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
/** A tiny build-check.yml: its trigger branches and one job's command. */
const workflow = (branches: string, command: string) =>
  ['name: x', 'on:', '  push:', `    branches: [${branches}]`, 'jobs:', '  a:', `    run: ${command}`, ''].join(String.fromCharCode(10))

describe('allowed', () => {
  test('new files in the unified app, its tests, its checks, its workflow and docs', () => {
    expect(run([
      { status: 'A', path: 'apps/unified/server/app.ts' },
      { status: 'A', path: 'tests/unified/x.test.ts' },
      { status: 'A', path: 'scripts/check-unified-rules.ts' },
      { status: 'A', path: '.github/workflows/unified.yml' },
      { status: 'A', path: 'docs/RULEBOOK.md' },
      { status: 'A', path: 'apps/api/src/unified/provision.ts' },
    ])).toEqual([])
  })

  test('the shared code itself (changed or added), and build-check.yml running on engine too', () => {
    files['.github/workflows/build-check.yml'] = { base: workflow('main', 'one'), head: workflow('main, engine', 'one') }
    expect(run([
      { status: 'M', path: 'packages/tenant-ui/src/api/client.ts' },
      { status: 'A', path: 'packages/tenant-ui/src/site/PagesPage.tsx' },
      { status: 'M', path: '.github/workflows/build-check.yml' },
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
  test('changing live code: a template, the Factory, the platform', () => {
    const v = run([
      { status: 'M', path: 'templates/crm/backend/src/index.ts' },
      { status: 'M', path: 'apps/api/src/services/generator.ts' },
      { status: 'M', path: 'apps/platform/src/App.tsx' },
    ])
    expect(v.map((x) => x.path)).toEqual(['templates/crm/backend/src/index.ts', 'apps/api/src/services/generator.ts', 'apps/platform/src/App.tsx'])
  })

  test('build-check.yml changing a job, not just its trigger', () => {
    files['.github/workflows/build-check.yml'] = { base: workflow('main', 'one'), head: workflow('main', 'two') }
    expect(run([{ status: 'M', path: '.github/workflows/build-check.yml' }])[0].detail).toContain('only the trigger')
  })

  test('a new file dropped into live code', () => {
    expect(run([{ status: 'A', path: 'templates/crm/backend/src/routes/new.ts' }]).length).toBe(1)
    // The Factory takes new files only in its unified/ folder, and none of its existing files may change to use them.
    expect(run([{ status: 'A', path: 'apps/api/src/services/newDeploy.ts' }]).length).toBe(1)
    expect(run([{ status: 'M', path: 'apps/api/src/routes/factory.ts' }]).length).toBe(1)
  })

  test('deleting anything, shared code included', () => {
    expect(run([{ status: 'D', path: 'templates/crm-salon/backend/src/index.ts' }]).length).toBe(1)
    expect(run([{ status: 'D', path: 'packages/tenant-ui/src/api/client.ts' }]).length).toBe(1)
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
