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

  test("a CRM template suite's own test file fixed — never its harness or the template", () => {
    expect(run([{ status: 'M', path: 'tests/homecare/visits.test.ts' }])).toEqual([])
    expect(run([{ status: 'M', path: 'tests/homecare/harness/run.ts' }]).length).toBe(1)
    expect(run([{ status: 'M', path: 'templates/crm-homecare/backend/src/routes/schedules.ts' }]).length).toBe(1)
    expect(run([{ status: 'D', path: 'tests/homecare/visits.test.ts' }]).length).toBe(1)
  })

  test('since the merge into main: the unified app\'s own files changed, moved and deleted', () => {
    expect(run([
      { status: 'M', path: 'apps/unified/server/app.ts' },
      { status: 'D', path: 'apps/unified/server/crm/store/lib/crypto.ts' },
      { status: 'A', path: 'apps/unified/server/core/crypto.ts' },
      { status: 'M', path: 'tests/unified/factory/factory.test.ts' },
      { status: 'D', path: 'tests/unified/factory/old.test.ts' },
      { status: 'M', path: 'apps/api/src/unified/build.ts' },
      { status: 'M', path: 'scripts/check-unified-fence.ts' },
      { status: 'M', path: '.github/workflows/unified.yml' },
      { status: 'M', path: 'docs/CUTOVER_LEDGER.md' },
    ])).toEqual([])
  })
})

describe('refused', () => {
  test('changing live code: a template (the Factory and its screens open at cutover, behind the switch)', () => {
    const v = run([
      { status: 'M', path: 'templates/crm/backend/src/index.ts' },
      { status: 'M', path: 'apps/api/src/services/generator.ts' },
      { status: 'M', path: 'apps/platform/src/App.tsx' },
      { status: 'M', path: 'apps/api/package.json' },
    ])
    expect(v.map((x) => x.path)).toEqual(['templates/crm/backend/src/index.ts', 'apps/api/package.json'])
  })

  test('build-check.yml changing a job, not just its trigger', () => {
    files['.github/workflows/build-check.yml'] = { base: workflow('main', 'one'), head: workflow('main', 'two') }
    expect(run([{ status: 'M', path: '.github/workflows/build-check.yml' }])[0].detail).toContain('only the trigger')
  })

  // Bun pinned (2026-10-26): the version a job sets up may change; the command beside it may not.
  test('build-check.yml pinning its Bun version is allowed; a command changed alongside it is not', () => {
    const bun = (version: string, command: string) => workflow('main', command).replace('    run:', `    bun-version: ${version}\n    run:`)
    files['.github/workflows/build-check.yml'] = { base: bun('latest', 'one'), head: bun('1.3.14', 'one') }
    expect(run([{ status: 'M', path: '.github/workflows/build-check.yml' }])).toEqual([])
    files['.github/workflows/build-check.yml'] = { base: bun('latest', 'one'), head: bun('1.3.14', 'two') }
    expect(run([{ status: 'M', path: '.github/workflows/build-check.yml' }])[0].detail).toContain('only the trigger')
  })

  test('a new file dropped into live code', () => {
    expect(run([{ status: 'A', path: 'templates/crm/backend/src/routes/new.ts' }]).length).toBe(1)
    // Cutover: the Factory's source takes the unified path (owner's go, 2026-10-20); a template still takes nothing.
    expect(run([{ status: 'A', path: 'apps/api/src/services/newDeploy.ts' }]).length).toBe(0)
    expect(run([{ status: 'M', path: 'apps/api/src/routes/factory.ts' }]).length).toBe(0)
    expect(run([{ status: 'D', path: 'apps/api/src/routes/factory.ts' }]).length).toBe(1)
  })

  test('deleting anything, shared code included', () => {
    expect(run([{ status: 'D', path: 'templates/crm-salon/backend/src/index.ts' }]).length).toBe(1)
    expect(run([{ status: 'D', path: 'packages/tenant-ui/src/api/client.ts' }]).length).toBe(1)
    // the unified app's own places opening up did not open the Factory's or the templates' scripts and workflow
    expect(run([{ status: 'D', path: 'scripts/check-feature-vocabulary.ts' }]).length).toBe(1)
    expect(run([{ status: 'A', path: 'scripts/check-anything.ts' }]).length).toBe(1)
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

// The security ledger (docs/SECURITY_UPGRADES.json, owner's yes 2026-10-28): an existing version may change ONLY for a
// published advisory naming that manifest, that package and exactly that new range.
describe('security upgrades through the ledger', () => {
  const MANIFEST = 'packages/tenant-backend/package.json'
  const ledger = (upgrades: any[]) => JSON.stringify({ upgrades })
  const fence = (changes: Change[], f: Record<string, { base?: string; head?: string }>) =>
    checkFence(changes, (ref, p) => (ref === 'base' ? f[p]?.base : f[p]?.head) ?? null)
  const pkg = (hono: string) => JSON.stringify({ name: '@twomiah/tenant-backend', main: './src/index.ts', peerDependencies: { hono } })
  const root = (o: Record<string, string>, extra: Record<string, unknown> = {}) => JSON.stringify({ name: 'twomiah', overrides: o, ...extra })
  const ok = { manifest: MANIFEST, package: 'hono', to: '^4.13.11', advisory: 'GHSA-mrhx-c7xc-m3w5' }

  test('a version raised for a ledgered advisory passes', () => {
    expect(fence([{ status: 'M', path: MANIFEST }], { [MANIFEST]: { base: pkg('^4.0.0'), head: pkg('^4.13.11') }, 'docs/SECURITY_UPGRADES.json': { head: ledger([ok]) } })).toEqual([])
  })
  test('no ledger entry, another range, another package, another manifest or no advisory id: refused', () => {
    for (const entry of [null, { ...ok, to: '^4.13.10' }, { ...ok, package: 'zod' }, { ...ok, manifest: 'packages/tenant-ui/package.json' }, { ...ok, advisory: 'CVE-2026-1234' }, { ...ok, advisory: '' }]) {
      const v = fence([{ status: 'M', path: MANIFEST }], { [MANIFEST]: { base: pkg('^4.0.0'), head: pkg('^4.13.11') }, 'docs/SECURITY_UPGRADES.json': { head: ledger(entry ? [entry] : []) } })
      expect([JSON.stringify(entry), v.length]).toEqual([JSON.stringify(entry), 1])
    }
  })
  test('a ledgered package removed is still refused (the ledger raises a version, it does not delete one)', () => {
    const head = JSON.stringify({ name: '@twomiah/tenant-backend', main: './src/index.ts', peerDependencies: {} })
    expect(fence([{ status: 'M', path: MANIFEST }], { [MANIFEST]: { base: pkg('^4.0.0'), head }, 'docs/SECURITY_UPGRADES.json': { head: ledger([ok]) } })).toHaveLength(1)
  })
  test('the root manifest: a ledgered override passes; an unledgered one, or any other key, is refused', () => {
    const L = { 'docs/SECURITY_UPGRADES.json': { head: ledger([{ manifest: 'package.json', package: 'basic-ftp', to: '^6.2.3', advisory: 'GHSA-c475-qrg2-pj4r' }]) } }
    expect(fence([{ status: 'M', path: 'package.json' }], { ...L, 'package.json': { base: root({ ws: '^8' }), head: root({ ws: '^8', 'basic-ftp': '^6.2.3' }, { '//overrides': 'note' }) } })).toEqual([])
    expect(fence([{ status: 'M', path: 'package.json' }], { ...L, 'package.json': { base: root({}), head: root({ 'basic-ftp': '^6.2.2' }) } })).toHaveLength(1)
    expect(fence([{ status: 'M', path: 'package.json' }], { ...L, 'package.json': { base: root({}), head: root({}, { scripts: { x: 'y' } }) } })).toHaveLength(1)
  })
})
