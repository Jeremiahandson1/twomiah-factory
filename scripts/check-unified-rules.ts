/**
 * The rulebook's checks (docs/RULEBOOK.md) over the unified app. Fails the build on any violation.
 *
 *   bun run scripts/check-unified-rules.ts            check apps/unified
 *   checkUnified(root)                                 the same, for a copy (apps/unified/tests/rules.test.ts plants
 *                                                      one violation of each rule in a copy and expects it caught)
 *
 * Each check reads what the code DOES, not a keyword: a reply is any `.json(` call given arguments (a Response's
 * `.json()` takes none), a mount is any `.route(` call, schema drift is "does generating migrations produce a new
 * one", a copied engine file is byte-identical content wherever it sits.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

export interface Violation { rule: string; file: string; detail: string }

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-demo', '.turbo', '.suite'])

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** Source with comments removed, so a rule is never tripped (or satisfied) by prose. Strings are kept. */
function code(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1]
    if (ch === '/' && nx === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue }
    if (ch === '/' && nx === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++ } i++; continue }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; out += ch; i++
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i++] } out += src[i++] }
      out += q; continue
    }
    out += ch
  }
  return out
}

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length

export function checkUnified(root: string, opts: { drift?: boolean; repoRoot?: string } = {}): Violation[] {
  const v: Violation[] = []
  const rel = (p: string) => path.relative(root, p).replace(/\\/g, '/')
  const files = walk(root).filter((f) => !rel(f).startsWith('server/db/migrations/'))
  const ts = files.filter((f) => /\.tsx?$/.test(f))
  const add = (rule: string, file: string, detail: string) => v.push({ rule, file: rel(file), detail })

  // §1 One language.
  for (const f of files) if (/\.(js|jsx|mjs|cjs)$/.test(f)) add('§1 language', f, 'JavaScript source file; TypeScript only')

  // §2 Raw SQL only in server/data/.
  for (const f of ts) {
    const r = rel(f)
    if (r.startsWith('server/data/') || r.startsWith('tests/')) continue
    const c = code(fs.readFileSync(f, 'utf8'))
    for (const m of c.matchAll(/\bsql\s*`|\bsql\.raw\s*\(|\.execute\s*\(/g)) add('§2 raw SQL', f, `line ${lineOf(c, m.index!)}: raw SQL outside server/data/`)
  }

  // §3 Replies only through server/http/reply.ts: any `.json(` call WITH arguments is a reply.
  for (const f of ts) {
    const r = rel(f)
    if (!r.startsWith('server/') || r === 'server/http/reply.ts') continue
    const c = code(fs.readFileSync(f, 'utf8'))
    for (const m of c.matchAll(/\.\s*json\s*\((?!\s*\))/g)) add('§3 reply shape', f, `line ${lineOf(c, m.index!)}: replies go through server/http/reply.ts`)
  }

  // §4 names, §5 ids: every table in the schema.
  const FORBIDDEN = new Set(['companies', 'users', 'agency', 'agencies', 'tenant', 'tenants'])
  const COLUMN = /^\s*([A-Za-z0-9_$]+)\s*:\s*(text|varchar|integer|bigint|smallint|serial|bigserial|boolean|timestamp|date|time|json|jsonb|decimal|numeric|real|doublePrecision|uuid|char|interval)\s*\(\s*(['"`])([^'"`]*)\3/gm
  const ID = "id: text('id').primaryKey().$defaultFn(() => createId())"
  for (const f of ts.filter((x) => rel(x).startsWith('server/db/schema/'))) {
    const c = code(fs.readFileSync(f, 'utf8'))
    for (const m of c.matchAll(/pgTable\s*\(\s*(?:(['"`])([^'"`]*)\1)?/g)) {
      if (!m[2] && m[2] !== '') { add('§4 names', f, `line ${lineOf(c, m.index!)}: a table name must be a string literal`); continue }
      const name = m[2]
      if (!/^[a-z][a-z0-9_]*$/.test(name)) add('§4 names', f, `table '${name}' is not snake_case`)
      if (FORBIDDEN.has(name)) add('§4 names', f, `table '${name}' forks company/user; use the one name`)
    }
    for (const m of c.matchAll(/\bjsonb\s*\(/g)) add('§2 column types', f, `line ${lineOf(c, m.index!)}: json, not jsonb`)
    for (const m of c.matchAll(/withTimezone\s*:\s*true/g)) add('§2 column types', f, `line ${lineOf(c, m.index!)}: timestamp without a time zone, holding UTC`)
    for (const m of c.matchAll(COLUMN)) {
      if (!/^[a-z][a-zA-Z0-9]*$/.test(m[1])) add('§2 naming', f, `line ${lineOf(c, m.index!)}: property '${m[1]}' is not camelCase`)
      if (!/^[a-z][a-z0-9_]*$/.test(m[4])) add('§2 naming', f, `line ${lineOf(c, m.index!)}: column '${m[4]}' is not snake_case`)
    }
    const tables = [...c.matchAll(/pgTable\s*\(/g)].length
    const ids = c.split(ID).length - 1
    const keys = [...c.matchAll(/\.primaryKey\s*\(|\bprimaryKey\s*\(\s*\{/g)].length
    if (ids !== tables) add('§5 ids', f, `${tables} tables but ${ids} carry the standard id (${ID})`)
    if (keys !== ids) add('§5 ids', f, `a primary key other than the standard id (${keys} primary keys, ${ids} standard)`)
  }

  // §6 Mounting only through server/http/registry.ts; no /api route declared by hand. web/ is the browser: it CALLS
  // routes (api.get('/api/…')) and declares none.
  for (const f of ts) {
    const r = rel(f)
    if (r === 'server/http/registry.ts' || r.startsWith('tests/') || r.startsWith('web/')) continue
    const c = code(fs.readFileSync(f, 'utf8'))
    // A router may compose another at its own root (.route('/', inner)): that adds no path. Any other mount is the registry's.
    for (const m of c.matchAll(/\.\s*route\s*\(\s*(?!(['"`])\/\1\s*,)/g)) add('§6 mounting', f, `line ${lineOf(c, m.index!)}: mount routers through server/http/registry.ts`)
    for (const m of c.matchAll(/\.\s*(get|post|put|patch|delete|all|on)\s*\(\s*(['"`])\/api/g)) add('§6 mounting', f, `line ${lineOf(c, m.index!)}: an /api route declared outside a registered router`)
  }

  // §7 Migrations only. What runs: the server, the verticals, the start scripts and config (tests hold fixtures).
  for (const f of files.filter((x) => /\.(ts|json)$/.test(x) && !rel(x).startsWith('tests/'))) {
    const c = fs.readFileSync(f, 'utf8')
    if (/drizzle-kit\s+push|db:push/.test(code(c))) add('§7 migrations', f, 'drizzle-kit push; change the database with a migration')
  }
  const journalPath = path.join(root, 'server/db/migrations/meta/_journal.json')
  if (fs.existsSync(journalPath)) {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
    for (const e of journal.entries || []) {
      if (!fs.existsSync(path.join(root, 'server/db/migrations', `${e.tag}.sql`))) add('§7 migrations', journalPath, `journal entry ${e.tag} has no .sql file`)
    }
  } else add('§7 migrations', journalPath, 'no migration journal')
  if (opts.drift !== false) {
    const drift = schemaDrift(root)
    if (drift) add('§7 migrations', path.join(root, 'server/db/schema'), drift)
  }

  // §8 Verticals: settings.ts and addons/ only; no copies of engine files; no imports across verticals.
  const vdir = path.join(root, 'verticals')
  const engineHashes = new Map<string, string>()
  const hash = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  for (const f of walk(path.join(root, 'server'))) engineHashes.set(hash(f), rel(f))
  const repoRoot = opts.repoRoot ?? path.resolve(root, '..', '..')
  for (const pkg of fs.existsSync(path.join(repoRoot, 'packages')) ? fs.readdirSync(path.join(repoRoot, 'packages')) : []) {
    for (const f of walk(path.join(repoRoot, 'packages', pkg, 'src'))) engineHashes.set(hash(f), 'packages/' + path.relative(path.join(repoRoot, 'packages'), f).replace(/\\/g, '/'))
  }
  if (fs.existsSync(vdir)) {
    for (const id of fs.readdirSync(vdir)) {
      const dir = path.join(vdir, id)
      if (!fs.statSync(dir).isDirectory()) { add('§8 verticals', dir, 'only vertical folders belong in verticals/'); continue }
      for (const f of walk(dir)) {
        const inside = path.relative(dir, f).replace(/\\/g, '/')
        if (inside !== 'settings.ts' && !inside.startsWith('addons/')) add('§8 verticals', f, 'a vertical holds settings.ts and addons/ only')
        const twin = engineHashes.get(hash(f))
        if (twin) add('§8 verticals', f, `a copy of engine file ${twin}`)
        if (/\.tsx?$/.test(f)) {
          const c = code(fs.readFileSync(f, 'utf8'))
          for (const m of c.matchAll(/(?:from|import)\s*\(?\s*(['"`])([^'"`]+)\1/g)) {
            const target = path.resolve(path.dirname(f), m[2])
            const relToV = path.relative(vdir, target).replace(/\\/g, '/')
            if (m[2].startsWith('.') && !relToV.startsWith('..') && relToV.split('/')[0] !== id) add('§8 verticals', f, `imports another vertical (${m[2]})`)
          }
        }
      }
    }
  }
  return v
}

/** Does the schema have changes no migration records? Generates into a scratch copy and looks for a new file. */
export function schemaDrift(root: string): string | null {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-drift-'))
  try {
    fs.cpSync(path.join(root, 'server/db/schema'), path.join(tmp, 'server/db/schema'), { recursive: true })
    // The schema's partial-index conditions live in server/data/indexWhere.ts (raw SQL stays in server/data/).
    fs.cpSync(path.join(root, 'server/data'), path.join(tmp, 'server/data'), { recursive: true })
    if (fs.existsSync(path.join(root, 'server/db/migrations'))) fs.cpSync(path.join(root, 'server/db/migrations'), path.join(tmp, 'server/db/migrations'), { recursive: true })
    fs.copyFileSync(path.join(root, 'drizzle.config.ts'), path.join(tmp, 'drizzle.config.ts'))
    const modules = fs.realpathSync(path.join(root, 'node_modules'))
    fs.symlinkSync(modules, path.join(tmp, 'node_modules'), 'junction')
    const before = new Set(fs.existsSync(path.join(tmp, 'server/db/migrations')) ? fs.readdirSync(path.join(tmp, 'server/db/migrations')) : [])
    const run = spawnSync(process.execPath, ['x', 'drizzle-kit', 'generate'], { cwd: tmp, encoding: 'utf8', timeout: 120_000 })
    if (run.status !== 0) return 'could not generate migrations to compare: ' + (run.stderr || run.stdout || '').trim().split('\n').pop()
    // drizzle-kit stops to ask when it can't tell a rename from a drop-and-create, writes nothing, and exits 0 — which
    // read as "no changes", so any schema change at all passed this check while a rename was pending.
    if (/created or renamed|renamed from another/i.test((run.stdout || '') + (run.stderr || ''))) {
      return 'drizzle-kit cannot tell whether a table or column was renamed: write that migration by hand, and its snapshot (as 0005_website_rename did)'
    }
    const added = fs.readdirSync(path.join(tmp, 'server/db/migrations')).filter((f) => !before.has(f) && f.endsWith('.sql'))
    return added.length ? `the schema has changes no migration records (generated ${added.join(', ')}); run bun run db:generate and commit it` : null
  } finally {
    removeScratch(tmp)
  }
}

/**
 * Remove a scratch copy: its node_modules link first (so the delete never walks into the real dependencies), then the
 * rest, retrying while Windows still holds a file the generator just closed (EBUSY; runs on a developer's machine left
 * these behind and failed the check). Never fails the check itself.
 */
export function removeScratch(dir: string): void {
  try { fs.unlinkSync(path.join(dir, 'node_modules')) } catch { /* no link */ }
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* the OS's temp sweep takes it */ }
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, '..', 'apps', 'unified')
  const violations = checkUnified(root)
  for (const x of violations) console.log(`${x.rule}  ${x.file}  ${x.detail}`)
  console.log(violations.length ? `\n${violations.length} rulebook violation(s) — docs/RULEBOOK.md` : 'Rulebook: every check passes.')
  process.exit(violations.length ? 1 : 0)
}
