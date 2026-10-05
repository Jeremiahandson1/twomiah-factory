// CI guard: every name imported from db/schema.ts must actually be exported by it.
//
//   bun run scripts/check-schema-imports-resolve.ts
//
// crm-homecare's src/services/audit.ts does `import { auditLog } from '../../db/schema.ts'` while its
// schema exports `auditLogs`. The named import throws at load. routes/leads.ts is the only homecare
// route that imports the audit service, and index.ts mounts it as
//
//     try { leadsRoutes = (await import('./routes/leads.ts')).default } catch {}
//
// so the error was swallowed and `if (leadsRoutes) app.route('/api/leads', ...)` never fired.
// /api/leads has never existed on a homecare tenant, while the frontend shipped LeadInboxPage and
// LeadSourcesPage calling it. Nothing noticed: no template is type-checked, the route answers 404
// like any unknown path, and the mount is wrapped in a catch that discards the reason.
//
// A named import that does not resolve is always a bug. It is a LOUD bug in a plainly mounted file
// (the server fails to boot) and a SILENT one behind try/catch — the second kind is reported first
// below, because that is the kind that ships.
//
// Deliberately static. Actually importing each file would need every template's node_modules and a
// database, which is what the behaviour suites are for; this needs to run on a bare checkout.
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dir, '..')
const TPL = path.join(ROOT, 'templates')
const read = (p: string) => fs.readFileSync(p, 'utf8').split('\r').join('')

// Templates this guard does not police, with the reason. Not "known failures to ignore" — a template
// nobody may edit cannot be held to a rule.
const SKIP_TEMPLATES: Record<string, string> = {
  'crm-automotive': 'PARKED. CLAUDE.md: "Do NOT modify crm-automotive". It has 11 unresolved schema '
    + 'imports (subscription, addonPurchase, job, project, quote, invoice, teamMember) across '
    + 'featureGate/contacts/dashboard/team — real, and unfixable while the template is frozen. '
    + 'Delete this entry the day it is unparked; the errors are waiting.',
}

// Individual imports that are known-broken and whose fix is a decision, not a typo. Each must name
// what the decision is. Anything NOT listed here fails the build, which is the point.
//
// Empty, and that is the intended steady state. The entry this started with —
// crm-homecare services/audit.ts importing 'auditLog' — was fixed by DEFINING the table rather than
// renaming the import, because homecare's existing `auditLogs` is a separate clinical/HIPAA record
// that four other modules write to. Adding an entry here should feel like a last resort.
const KNOWN: Array<{ template: string; file: string; name: string; why: string }> = []

/** Every name db/schema.ts exports. */
function schemaExports(file: string): Set<string> {
  const src = read(file)
  const out = new Set<string>()
  for (const m of src.matchAll(/^export\s+(?:const|let|var|function|class)\s+(\w+)/gm)) out.add(m[1])
  for (const m of src.matchAll(/^export\s+type\s+(\w+)/gm)) out.add(m[1])
  for (const m of src.matchAll(/^export\s+enum\s+(\w+)/gm)) out.add(m[1])
  // re-export lists: export { a, b as c } from './x'  /  export { a, b }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) out.add(name)
    }
  }
  return out
}

/** Which route files does index.ts mount inside a try/catch (i.e. silently)? */
function silentlyMounted(indexFile: string): Set<string> {
  if (!fs.existsSync(indexFile)) return new Set()
  const src = read(indexFile)
  const out = new Set<string>()
  for (const m of src.matchAll(/try\s*\{[^}]*await\s+import\(\s*['"]\.\/routes\/([\w.-]+?)(?:\.ts)?['"]\s*\)[^}]*\}\s*catch/g)) out.add(m[1])
  return out
}

/** Files reachable from a route file through relative imports inside src/ — one hop is enough here. */
function localDeps(file: string): string[] {
  if (!fs.existsSync(file)) return []
  const dir = path.dirname(file)
  const out: string[] = []
  for (const m of read(file).matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const p = path.resolve(dir, m[1])
    for (const cand of [p, p + '.ts', path.join(p, 'index.ts')]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) { out.push(cand); break }
    }
  }
  return out
}

type Bad = { template: string; file: string; name: string; schema: string; silent: string | null }
const bad: Bad[] = []
const skipped: string[] = []
let templates = 0, checkedFiles = 0

for (const t of fs.readdirSync(TPL).sort()) {
  const be = path.join(TPL, t, 'backend')
  const schemaFile = path.join(be, 'db', 'schema.ts')
  const srcDir = path.join(be, 'src')
  if (!fs.existsSync(schemaFile) || !fs.existsSync(srcDir)) continue
  if (SKIP_TEMPLATES[t]) { skipped.push(t); continue }
  templates++

  const exports = schemaExports(schemaFile)
  if (exports.size === 0) { console.error(`ERROR ${t}: parsed 0 exports from db/schema.ts — the parser may be stale`); process.exit(1) }

  const silent = silentlyMounted(path.join(srcDir, 'index.ts'))
  // route file -> the silently-mounted route that reaches it (one hop), for severity
  const reachedBySilent = new Map<string, string>()
  for (const base of silent) {
    const rf = path.join(srcDir, 'routes', `${base}.ts`)
    reachedBySilent.set(rf, base)
    for (const dep of localDeps(rf)) if (!reachedBySilent.has(dep)) reachedBySilent.set(dep, base)
  }

  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'shared') walk(p); continue }
      if (!/\.ts$/.test(e.name)) continue
      const src = read(p)
      checkedFiles++
      for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]*db\/schema(?:\.ts)?)['"]/g)) {
        // A COMMENT INSIDE THE BRACES IS NOT AN IMPORT NAME. (T42)
        //
        // A multi-line import list with a line comment above one of its names is legal TypeScript,
        // and a sentence saying why that table is needed belongs exactly there. Splitting the brace
        // body on commas read the prose itself as two unresolved names, so the build failed over a
        // comment — which is how people learn to stop writing them. Comments go before the split.
        const names = m[1].replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
        for (const part of names.split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0].trim().replace(/^type\s+/, '')
          if (!name || exports.has(name)) continue
          bad.push({
            template: t,
            file: path.relative(ROOT, p).replace(/\\/g, '/'),
            name,
            schema: path.relative(ROOT, schemaFile).replace(/\\/g, '/'),
            silent: reachedBySilent.get(p) ?? null,
          })
        }
      }
    }
  }
  walk(srcDir)
}

const near = (name: string, t: string) => {
  const ex = schemaExports(path.join(TPL, t, 'backend', 'db', 'schema.ts'))
  const hit = [...ex].find((e) => e.toLowerCase() === name.toLowerCase() + 's' || e.toLowerCase() + 's' === name.toLowerCase() || e.toLowerCase() === name.toLowerCase())
  return hit ? ` — did you mean '${hit}'?` : ''
}

const isKnown = (b: Bad) => KNOWN.some((k) => k.template === b.template && k.file === b.file && k.name === b.name)
const fresh = bad.filter((b) => !isKnown(b))
const known = bad.filter(isKnown)

for (const b of fresh.filter((x) => x.silent)) {
  console.error(`ERROR ${b.template}: ${b.file} imports '${b.name}' from db/schema.ts, which does not export it${near(b.name, b.template)}`)
  console.error(`      index.ts mounts routes/${b.silent}.ts inside try/catch, so this fails SILENTLY and that API never mounts.`)
}
for (const b of fresh.filter((x) => !x.silent)) {
  console.error(`ERROR ${b.template}: ${b.file} imports '${b.name}' from db/schema.ts, which does not export it${near(b.name, b.template)}`)
}

for (const t of skipped) console.log(`SKIP  ${t} — ${SKIP_TEMPLATES[t].split('.')[0]}.`)
for (const b of known) console.log(`KNOWN ${b.template}: ${b.file} imports '${b.name}'${b.silent ? ` (silently disables /api/${b.silent})` : ''} — allowlisted, see the entry for why`)
// A stale allowlist entry is worth cleaning up, but is not worth failing a build over.
for (const k of KNOWN) {
  if (!bad.some((b) => b.template === k.template && b.file === k.file && b.name === k.name)) {
    console.log(`INFO  allowlist entry for ${k.template} '${k.name}' no longer matches anything — it was probably fixed; remove it.`)
  }
}

console.log(`\nschema imports: ${templates} template(s) checked${skipped.length ? ` (${skipped.length} skipped)` : ''}, ${checkedFiles} file(s), ${fresh.length} new unresolved, ${known.length} allowlisted`)
if (fresh.length) process.exit(1)
