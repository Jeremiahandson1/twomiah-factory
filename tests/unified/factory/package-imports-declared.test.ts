// Every library a shared package's code imports is declared in that package's own package.json. (2026-10-20)
//
// A tenant installs the workspace with bun's isolated linker: a package sees only what it declares. packages/
// tenant-backend imported 'twilio' (integrations/twilio.ts) without declaring it — the unified app declared it, which
// did not help — so every text from a deployed unified tenant failed: "Cannot find package 'twilio' imported from
// packages/tenant-backend/src/integrations/twilio.ts" (found live on test tenant two, a booking confirmation). The test
// suites never send a real text, so nothing else saw it. Static, dynamic (`await import('x')`) and require() imports.
import { test, expect } from 'bun:test'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { builtinModules } from 'node:module'

const ROOT = join(import.meta.dir, '../../..')
const PKGS = join(ROOT, 'packages')
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => 'node:' + m), 'bun', 'bun:test', 'bun:sqlite'])
const walk = (d: string, out: string[] = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) { if (f !== 'node_modules' && f !== '__tests__') walk(p, out) }
    else if (/\.(ts|tsx|js|mjs)$/.test(f) && !/\.(test|spec)\.(ts|tsx|js)$/.test(f) && !/\.d\.ts$/.test(f)) out.push(p)
  }
  return out
}
/** 'stripe' → stripe, '@aws-sdk/client-s3/x' → @aws-sdk/client-s3, 'react-dom/client' → react-dom. */
const libOf = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])

export function undeclared(pkgDir: string, srcDir = 'src'): string[] {
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies }))
  const out = new Set<string>()
  if (!existsSync(join(pkgDir, srcDir))) return []
  for (const f of walk(join(pkgDir, srcDir))) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    const specs = [
      // No backtick before the `from`: `export async function f() { sql\`… substring(x from '^every_…')\` }` is not a re-export
      // (apps/unified/server/data/homecareCore.ts, 10/31); an import or export statement never holds a template string.
      ...src.matchAll(/^\s*import\s+(?:type\s+)?[^'"`]*?from\s+['"]([^'"]+)['"]/gm),
      ...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
      ...src.matchAll(/^\s*export\s+[^'"`]*?from\s+['"]([^'"]+)['"]/gm),
      ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...src.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].filter((m) => !/^\s*import\s+type\b/.test(m[0]) && !/^\s*export\s+type\b/.test(m[0])).map((m) => m[1])
    for (const s of specs) {
      if (s.startsWith('.') || s.startsWith('/') || builtins.has(s) || s.startsWith('node:')) continue
      const lib = libOf(s)
      if (lib === manifest.name || declared.has(lib)) continue
      out.add(lib + '  (' + f.slice(pkgDir.length + 1).replace(/\\/g, '/') + ')')
    }
  }
  return [...out].sort()
}

test('every shared package declares what its code imports (a tenant install gives a package only that)', () => {
  const problems: string[] = []
  for (const dir of readdirSync(PKGS)) {
    if (!existsSync(join(PKGS, dir, 'package.json'))) continue
    for (const u of undeclared(join(PKGS, dir))) problems.push(`packages/${dir}: ${u}`)
  }
  expect(problems).toEqual([])
})

// The Factory draws the free preview with the unified app's renderer (apps/api/src/unified/preview.ts imports
// apps/unified/server/site). The Factory's build installs the workspace (`cd apps/api && bun install` puts the unified
// app's own dependencies in apps/unified/node_modules — checked on a clean clone, 2026-10-27), and the renderer finds
// its libraries there. So everything the unified server imports must be declared by the unified app, never left to
// arrive by another package's hoisting.
test('the unified app declares every library its server imports (the Factory’s preview resolves them from its install)', () => {
  expect(undeclared(join(ROOT, 'apps', 'unified'), 'server').map((u) => 'apps/unified: ' + u)).toEqual([])
})
