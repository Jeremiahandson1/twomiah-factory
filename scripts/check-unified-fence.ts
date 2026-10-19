/**
 * RULEBOOK §10: while the unified app is under construction, the `engine` branch adds files in its own places, may
 * improve the shared code (packages/*\/src, guarded by every existing check running on engine too), and never
 * changes the templates or the Factory. Compares the branch with where it left main (the merge base).
 *
 *   bun run scripts/check-unified-fence.ts [base-ref]     default base: origin/main
 *   checkFence(changes, read)                             the rule itself (apps/unified/tests/fence.test.ts)
 */
import { spawnSync } from 'node:child_process'

export interface Change { status: 'A' | 'M' | 'D' | 'R' | string; path: string; from?: string }
export interface FenceViolation { path: string; detail: string }

/**
 * Where new files may go. apps/api/src/unified/ is the Factory's side of the unified app (each tenant's database server
 * and service, Update Code), added beside the Factory and wired in at cutover (owner's yes, 2026-10-18). No existing
 * Factory file may change (MODIFY_ALLOWED has none), so nothing live can import it before then.
 */
const ADD_ALLOWED = [/^apps\/unified\//, /^apps\/api\/src\/unified\//, /^tests\/unified\//, /^scripts\/check-unified-[^/]+\.ts$/, /^\.github\/workflows\/unified\.yml$/, /^docs\//, /^packages\/[^/]+\/src\//]
/** Existing files that may change: the shared code (the engine), its manifests, the lockfile, the spec, build-check's trigger. */
const MODIFY_ALLOWED = [/^packages\/[^/]+\/src\//, /^docs\/SPEC_UNIFIED_PRODUCT\.md$/, /^bun\.lock$/, /^packages\/[^/]+\/package\.json$/, /^\.github\/workflows\/build-check\.yml$/]
const DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

export function checkFence(changes: Change[], read: (ref: 'base' | 'head', path: string) => string | null): FenceViolation[] {
  const out: FenceViolation[] = []
  for (const ch of changes) {
    const s = ch.status[0]
    if (s === 'A') {
      if (!ADD_ALLOWED.some((r) => r.test(ch.path))) out.push({ path: ch.path, detail: 'a new file outside the unified app\'s places' })
    } else if (s === 'M') {
      if (!MODIFY_ALLOWED.some((r) => r.test(ch.path))) { out.push({ path: ch.path, detail: 'an existing file changed; the templates and the Factory are not touched during construction' }); continue }
      if (/^packages\/[^/]+\/package\.json$/.test(ch.path)) {
        const why = onlyDeclaresMore(read('base', ch.path), read('head', ch.path))
        if (why) out.push({ path: ch.path, detail: why })
      }
      if (ch.path === '.github/workflows/build-check.yml') {
        const why = onlyTriggerChanged(read('base', ch.path), read('head', ch.path))
        if (why) out.push({ path: ch.path, detail: why })
      }
    } else if (s === 'D') {
      out.push({ path: ch.path, detail: 'an existing file deleted; nothing is removed before cutover' })
    } else {
      out.push({ path: ch.path, detail: `change type ${ch.status}${ch.from ? ' from ' + ch.from : ''}: only additions and the listed edits are allowed` })
    }
  }
  return out
}

/** build-check.yml may only change its `on:` block (so the existing checks also run on engine); every job stays as it is. */
function onlyTriggerChanged(baseText: string | null, headText: string | null): string | null {
  if (baseText == null || headText == null) return 'could not read both versions'
  const jobs = (t: string) => {
    const i = t.search(/^jobs:/m)
    return i < 0 ? null : t.slice(i).split(/\r?\n/).join('\n')
  }
  const a = jobs(baseText), b = jobs(headText)
  if (a == null || b == null) return 'no jobs: block'
  return a === b ? null : 'a job changed; only the trigger may change'
}

/** A shared package's manifest may only gain library declarations: everything else, and every existing entry, unchanged. */
function onlyDeclaresMore(baseText: string | null, headText: string | null): string | null {
  if (baseText == null || headText == null) return 'could not read both versions'
  let base: any, head: any
  try { base = JSON.parse(baseText); head = JSON.parse(headText) } catch { return 'not valid JSON' }
  for (const k of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (DEP_KEYS.includes(k)) continue
    if (JSON.stringify(base[k]) !== JSON.stringify(head[k])) return `"${k}" changed; only library declarations may be added`
  }
  for (const k of DEP_KEYS) {
    for (const [name, range] of Object.entries(base[k] || {})) {
      if (!head[k] || head[k][name] !== range) return `${k}.${name} changed or removed; only additions are allowed`
    }
  }
  return null
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`)
  return r.stdout
}

if (import.meta.main) {
  const baseRef = process.argv[2] || 'origin/main'
  const base = git(['merge-base', baseRef, 'HEAD']).trim()
  const changes: Change[] = git(['diff', '--name-status', '--no-renames', base, 'HEAD']).split('\n').filter(Boolean).map((l) => {
    const [status, ...rest] = l.split('\t')
    return { status, path: rest[rest.length - 1] }
  })
  const read = (ref: 'base' | 'head', p: string) => {
    const r = spawnSync('git', ['show', `${ref === 'base' ? base : 'HEAD'}:${p}`], { encoding: 'utf8' })
    return r.status === 0 ? r.stdout : null
  }
  const v = checkFence(changes, read)
  for (const x of v) console.log(`§10 fence  ${x.path}  ${x.detail}`)
  console.log(v.length ? `\n${v.length} change(s) outside the fence — docs/RULEBOOK.md §10` : `Fence: ${changes.length} change(s) since ${baseRef}, all inside the fence.`)
  process.exit(v.length ? 1 : 0)
}
