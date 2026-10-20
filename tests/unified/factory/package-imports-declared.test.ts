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

export function undeclared(pkgDir: string): string[] {
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies }))
  const out = new Set<string>()
  if (!existsSync(join(pkgDir, 'src'))) return []
  for (const f of walk(join(pkgDir, 'src'))) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    const specs = [
      ...src.matchAll(/^\s*import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm),
      ...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
      ...src.matchAll(/^\s*export\s+[^'"]*?from\s+['"]([^'"]+)['"]/gm),
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
