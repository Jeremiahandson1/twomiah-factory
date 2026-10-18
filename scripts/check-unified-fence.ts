/**
 * RULEBOOK §10: while the unified app is under construction, the `engine` branch only ADDS files in its own places
 * and never changes the live system. Compares the branch with where it left main (the merge base).
 *
 *   bun run scripts/check-unified-fence.ts [base-ref]     default base: origin/main
 *   checkFence(changes, read)                             the rule itself (apps/unified/tests/fence.test.ts)
 */
import { spawnSync } from 'node:child_process'

export interface Change { status: 'A' | 'M' | 'D' | 'R' | string; path: string; from?: string }
export interface FenceViolation { path: string; detail: string }

/** Where new files may go. */
const ADD_ALLOWED = [/^apps\/unified\//, /^tests\/unified\//, /^scripts\/check-unified-[^/]+\.ts$/, /^\.github\/workflows\/unified\.yml$/, /^docs\//]
/** Existing files that may change. */
const MODIFY_ALLOWED = [/^docs\/SPEC_UNIFIED_PRODUCT\.md$/, /^bun\.lock$/, /^packages\/[^/]+\/package\.json$/]
const DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

export function checkFence(changes: Change[], read: (ref: 'base' | 'head', path: string) => string | null): FenceViolation[] {
  const out: FenceViolation[] = []
  for (const ch of changes) {
    const s = ch.status[0]
    if (s === 'A') {
      if (!ADD_ALLOWED.some((r) => r.test(ch.path))) out.push({ path: ch.path, detail: 'a new file outside the unified app\'s places' })
    } else if (s === 'M') {
      if (!MODIFY_ALLOWED.some((r) => r.test(ch.path))) { out.push({ path: ch.path, detail: 'an existing file changed; the live system is not touched during construction' }); continue }
      if (/^packages\/[^/]+\/package\.json$/.test(ch.path)) {
        const why = onlyDeclaresMore(read('base', ch.path), read('head', ch.path))
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
