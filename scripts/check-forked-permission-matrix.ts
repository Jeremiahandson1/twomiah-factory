// CI guard: a template that FORKS the permission matrix must grant every resource it gates on.
//
//   bun run scripts/check-forked-permission-matrix.ts
//
// check-permission-vocabulary.ts validates gated resources against the SHARED matrix
// (packages/tenant-backend/src/auth/permissions.ts). Most templates are a thin shim over
// createPermissions(), so that check is the whole story for them. crm-dispensary is not: it
// defines its own ROLE_PERMISSIONS and never reads the shared one. A resource added to the shared
// matrix therefore satisfies the build while remaining UNGRANTED inside the fork, where
// hasPermission falls back to that local list — so every role except the owner (who holds '*')
// is refused.
//
// That is not hypothetical: gating support.ts on support-kb:* / support-sla:* passed CI and
// silently made the dispensary knowledge base owner-only instead of admin-level.
//
// This guard closes that gap: for each forked template, every resource gated in its routes must
// appear in its OWN matrix, granted to at least one role that is not the owner.
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dir, '..')
const TPL = path.join(ROOT, 'templates')

// Resources deliberately reachable only by the owner (mirrors check-permission-vocabulary.ts).
const OWNER_ONLY = new Set(['users'])

const errors: string[] = []
let forks = 0

for (const t of fs.readdirSync(TPL).sort()) {
  const permFile = path.join(TPL, t, 'backend', 'src', 'middleware', 'permissions.ts')
  const routesDir = path.join(TPL, t, 'backend', 'src', 'routes')
  if (!fs.existsSync(permFile) || !fs.existsSync(routesDir)) continue

  const perm = fs.readFileSync(permFile, 'utf8')
  // A shim delegates to the shared factory; anything else that declares its own table is a fork.
  if (perm.includes('createPermissions')) continue
  if (!/ROLE_PERMISSIONS/.test(perm)) continue
  forks++

  // Resources granted in the fork's own matrix, to any role other than `owner`.
  const granted = new Set<string>()
  {
    const start = perm.indexOf('ROLE_PERMISSIONS')
    const open = perm.indexOf('{', start)
    let depth = 0, end = open
    for (let i = open; i < perm.length; i++) { if (perm[i] === '{') depth++; else if (perm[i] === '}' && --depth === 0) { end = i; break } }
    const block = perm.slice(open, end + 1)
    // Drop the owner entry — owner: ['*'] would otherwise "grant" everything.
    const withoutOwner = block.replace(/owner\s*:\s*\[[^\]]*\]\s*,?/, '')
    // Strip comment lines before pairing quotes: an apostrophe in prose shifts every later pair.
    const code = withoutOwner.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
    for (const m of code.matchAll(/'([a-z0-9_-]+):[a-z0-9*_-]+'/gi)) granted.add(m[1])
  }
  if (granted.size === 0) { errors.push(`${t}: parsed 0 granted resources from its own matrix — parser may be stale`); continue }

  // Resources this template's routes gate on.
  const used = new Map<string, string>()
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'shared') walk(p); continue }
      if (!/\.ts$/.test(e.name)) continue
      const src = fs.readFileSync(p, 'utf8')
      for (const m of src.matchAll(/require(?:Any)?Permission\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g)) {
        for (const lit of m[1].matchAll(/['"]([a-z0-9_-]+):[a-z0-9_*-]+['"]/gi)) {
          if (!used.has(lit[1])) used.set(lit[1], path.relative(ROOT, p).replace(/\\/g, '/'))
        }
      }
    }
  }
  walk(routesDir)

  for (const [res, file] of [...used].sort()) {
    if (granted.has(res) || OWNER_ONLY.has(res)) continue
    errors.push(
      `${t}: '${res}:' is gated (${file}) but ${t}'s OWN permissions.ts grants it to no role — ` +
      `only the owner can pass. Add it to ROLE_PERMISSIONS in ${path.relative(ROOT, permFile).replace(/\\/g, '/')}.`
    )
  }
}

for (const e of errors) console.error('ERROR', e)
console.log(`\nforked permission matrices: ${forks} checked, ${errors.length} problem(s)`)
if (errors.length) process.exit(1)
