// CI guard: every package the shared code imports is declared by every template that vendors it.
//
// The Factory copies packages/tenant-ui/src and packages/tenant-backend/src into each CRM template at
// generation (backend/src/shared, frontend/src/shared) and the template imports from './shared'. Bun
// installs from the TEMPLATE's package.json, so a bare import added to a shared package (e.g.
// @stripe/react-stripe-js in the portal, sharp in the files module) silently breaks every template that
// never declared it — the failure only shows up as a Render build/boot error on the next tenant deploy
// (crm-roof and crm-homecare shipped that way after #62/#69). This fails the build instead.
//
// Only real import/export statements count (not comments), only templates that actually import from
// './shared' are checked, and node built-ins / bun are ignored.
//
//   bun run check:shared-deps
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dir, '..')
const BUILTINS = new Set(['fs', 'path', 'crypto', 'http', 'https', 'url', 'stream', 'os', 'child_process', 'util', 'events', 'zlib', 'buffer', 'net', 'dns', 'tls', 'assert', 'querystring', 'readline', 'worker_threads', 'perf_hooks', 'string_decoder', 'timers', 'bun'])

const walk = (d: string, out: string[] = []): string[] => {
  if (!fs.existsSync(d)) return out
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out) } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}
const packageName = (spec: string) => {
  if (spec.startsWith('node:')) return null
  const parts = spec.split('/')
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  return BUILTINS.has(name) ? null : name
}
/** Bare module names imported by real import/export statements (and dynamic imports) under a source dir. */
const bareImports = (srcDir: string) => {
  const names = new Map<string, string>() // name → first file that imports it
  for (const f of walk(srcDir)) {
    const src = fs.readFileSync(f, 'utf8')
    for (const line of src.split('\n')) {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
      const statics = t.match(/^(?:import|export)\b[^'"]*from\s*['"]([^'"]+)['"]/) || t.match(/^import\s*['"]([^'"]+)['"]/)
      const dynamics = Array.from(t.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)).map((m) => m[1])
      for (const spec of [...(statics ? [statics[1]] : []), ...dynamics]) {
        if (spec.startsWith('.') || spec.startsWith('/')) continue
        const name = packageName(spec)
        if (name && !names.has(name)) names.set(name, path.relative(ROOT, f).replace(/\\/g, '/'))
      }
    }
  }
  return names
}
const importsShared = (srcDir: string) => walk(srcDir).some((f) => /from\s+['"](\.\.?\/)+shared(\/|['"])/.test(fs.readFileSync(f, 'utf8')))
const declared = (pkgFile: string) => {
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  return new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})])
}

const SIDES = [
  { side: 'frontend', shared: 'packages/tenant-ui/src' },
  { side: 'backend', shared: 'packages/tenant-backend/src' },
] as const

const errors: string[] = [], infos: string[] = []
for (const { side, shared } of SIDES) {
  const needed = bareImports(path.join(ROOT, shared))
  infos.push(`${shared} imports: ${Array.from(needed.keys()).sort().join(', ') || '(none)'}`)
  for (const t of fs.readdirSync(path.join(ROOT, 'templates')).filter((d) => d.startsWith('crm')).sort()) {
    const srcDir = path.join(ROOT, 'templates', t, side, 'src')
    const pkgFile = path.join(ROOT, 'templates', t, side, 'package.json')
    if (!fs.existsSync(pkgFile) || !fs.existsSync(srcDir)) continue
    if (!importsShared(srcDir)) { infos.push(`${t}/${side}: does not import from ./shared — skipped`); continue }
    const have = declared(pkgFile)
    for (const [name, firstFile] of needed) {
      if (!have.has(name)) errors.push(`templates/${t}/${side}/package.json does not declare "${name}" (imported by ${firstFile}, vendored into ${t}/${side}/src/shared)`)
    }
  }
}

for (const i of infos) console.log(`INFO  ${i}`)
for (const e of errors) console.log(`ERROR ${e}`)
console.log(errors.length ? `\n${errors.length} missing dependenc${errors.length === 1 ? 'y' : 'ies'} — add them to the template's package.json (the same version range the crm template uses).` : '\nOK — every template that vendors the shared packages declares what they import.')
process.exit(errors.length ? 1 : 0)
