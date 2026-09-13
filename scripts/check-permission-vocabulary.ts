// CI guard: ONE permission vocabulary.
//
// Every resource a route gates on (requirePermission('resource:action') / requireAnyPermission([...]))
// must be granted to at least one role in BASE_ROLE_PERMISSIONS (packages/tenant-backend/src/auth/permissions.ts),
// OR be listed in OWNER_ONLY below with a reason. Otherwise the gate is unreachable for everyone except the
// account owner (who holds '*') — which is almost always an accidental omission, not a decision. This is the
// class of bug that left equipment/fleet/warranties/inventory/agreements/selections/takeoffs/calltracking/
// reports/settings/payments owner-only until PR (this one).
//
//   bun run scripts/check-permission-vocabulary.ts
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dir, '..')
const PERM_FILE = path.join(ROOT, 'packages/tenant-backend/src/auth/permissions.ts')

// Resources that are intentionally owner-only (+ whatever the owner explicitly grants per user).
// Keep each with a reason so the exception stays a decision, not a silent gap.
const OWNER_ONLY: Record<string, string> = {
  users: 'per-user grant handed out by the owner in Settings › Users (extraPermissions:[users:read]); never a role default',
}

// Resources granted to some role in the matrix. Parsed from the BASE_ROLE_PERMISSIONS object literal as
// text (importing the module would pull in drizzle-orm, which isn't resolvable when this runs standalone).
const granted = new Set<string>()
{
  const src = fs.readFileSync(PERM_FILE, 'utf8')
  const start = src.indexOf('BASE_ROLE_PERMISSIONS')
  if (start < 0) { console.error('ERROR could not find BASE_ROLE_PERMISSIONS in', PERM_FILE); process.exit(1) }
  // slice from the opening brace of the object to its matching close (brace counting)
  const open = src.indexOf('{', start)
  let depth = 0, end = open
  for (let i = open; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) { end = i; break } }
  const block = src.slice(open, end + 1)
  for (const m of block.matchAll(/['"]([a-z0-9_-]+):[a-z0-9*_-]+['"]/gi)) granted.add(m[1])
  if (granted.size === 0) { console.error('ERROR parsed 0 granted resources — the parser may be stale'); process.exit(1) }
}

// Scan sources that gate routes: the shared package + every template backend.
const scanRoots = [path.join(ROOT, 'packages/tenant-backend/src')]
const tplDir = path.join(ROOT, 'templates')
for (const t of fs.readdirSync(tplDir)) {
  const be = path.join(tplDir, t, 'backend', 'src')
  if (fs.existsSync(be)) scanRoots.push(be)
}

const used = new Map<string, string>() // resource -> first file it was seen in (repo-relative)
function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'shared') continue // shared/ inside a template is a vendored copy of the package we already scan
      walk(p)
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      const src = fs.readFileSync(p, 'utf8')
      for (const m of src.matchAll(/require(?:Any)?Permission\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g)) {
        for (const lit of m[1].matchAll(/['"]([a-z0-9_-]+):[a-z0-9_*-]+['"]/gi)) {
          const res = lit[1]
          if (!used.has(res)) used.set(res, path.relative(ROOT, p).replace(/\\/g, '/'))
        }
      }
    }
  }
}
for (const r of scanRoots) walk(r)

const errors: string[] = []
for (const [res, file] of [...used].sort()) {
  if (granted.has(res)) continue
  if (res in OWNER_ONLY) continue
  errors.push(`resource '${res}:' is gated (first seen ${file}) but no role in BASE_ROLE_PERMISSIONS grants it — only the owner can pass. Add it to the matrix, or to OWNER_ONLY with a reason.`)
}

// A stale OWNER_ONLY entry (no longer gated anywhere) is worth cleaning up, but don't fail the build for it.
const infos: string[] = []
for (const res of Object.keys(OWNER_ONLY)) {
  if (!used.has(res)) infos.push(`OWNER_ONLY '${res}' is no longer gated anywhere — consider removing it.`)
}

for (const i of infos) console.log('INFO ', i)
if (errors.length) {
  for (const e of errors) console.error('ERROR', e)
  console.error(`\npermission vocabulary: ${used.size} gated resource(s), ${errors.length} error(s)`)
  process.exit(1)
}
console.log(`\npermission vocabulary: ${used.size} gated resource(s), ${granted.size} granted in matrix, ${Object.keys(OWNER_ONLY).length} owner-only — OK`)
