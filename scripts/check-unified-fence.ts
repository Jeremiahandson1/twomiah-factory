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
/**
 * The unified app's own places. Since engine was merged into main (2026-10-20) their files exist on main too, so a change
 * to one reads as an existing file changed: they may be changed and deleted as freely as they were added — the same
 * places, not new ones. The templates and the rest of the Factory keep their own rule below.
 */
const UNIFIED_OWN = [/^apps\/unified\//, /^apps\/api\/src\/unified\//, /^tests\/unified\//, /^scripts\/check-unified-[^/]+\.ts$/, /^\.github\/workflows\/unified\.yml$/, /^docs\//]
/** Existing files that may be deleted: the phone app's (owner, 2026-10-19 — it has no users yet) and the unified app's own. */
const DELETE_ALLOWED = [/^apps\/mobile\//, /^tests\/mobile\//, ...UNIFIED_OWN]
const ADD_ALLOWED = [/^apps\/api\/src\//, /^apps\/api\/migrations\//, /^apps\/platform\/src\//, /^tests\/shared\//, /^apps\/mobile\//, /^tests\/mobile\//,/^apps\/unified\//, /^apps\/api\/src\/unified\//, /^tests\/unified\//, /^scripts\/check-unified-[^/]+\.ts$/, /^\.github\/workflows\/unified\.yml$/, /^docs\//, /^packages\/[^/]+\/src\//]
/** Existing files that may change: the shared code (the engine), its manifests, the lockfile, the spec, build-check's trigger. */
// apps/mobile (and its tests, tests/mobile): the phone app has no users yet, so it is changed with the unified app instead of waiting (owner, 2026-10-19).
// The four registry/shared-default guards: a change to the shared code they check must update them in the same push, or
// build-check fails on engine (PLAN_TIERS retired; invoicing's quoteJobs pinned) — 2026-10-19. dashboard-counts joined
// them 2026-10-22: it reads the shared Reports page's markup, which gained a CSV button on every card.
// 2026-10-23 (fix-j), the same reason: the day's shared-code fixes moved the shapes eight guards read — the one money
// formatter (money-and-labels), the company clock (agreements, audience-quotes-leads-time, business-day,
// calendar-day-dates, salon-dark-surfaces), the hook table (job-quote-rules) and the photo viewer's white wash
// (light-card-dark-text). Each was extended to read the new single source, never loosened, and mutation-tested.
// batch 2 (fix-f, one rule for stored codes and the vertical's own words): a status chip prints its label or codeLabel(),
// a contact's jobs list is titled by the vertical's word (default "Jobs"), and its lists ask cfg.shows() — section AND
// feature. retest-t24, contact-related-lists and contact-relations-ask were extended to read those, never loosened.
// fix-e's 41ac845f2 made the same money-and-labels change on its branch; batch 2 keeps fix-e's form of that guard, which
// RUNS the shared money() ($824.60, $1,234.50, -$200.00) rather than matching its source text.
// Cutover (owner's "go", 2026-10-20): the live Factory gains the unified path behind an off/test/all switch that starts
// off — its routes, services, the Factory database's schema and the platform screens may change; nothing reaches a
// customer until the switch is turned.
/**
 * The CRM templates' behaviour suites' own test files (tests/<suite>/*.test.ts — not their harnesses, not the
 * templates): a test can be wrong without the live code being so, and its fix touches nothing that runs. First needed
 * 2026-10-20: homecare's visits.test.ts made a weekly shift on "today + 5 days", which every Wednesday (UTC) landed on
 * the Monday of the same caregiver, client and hours as another — and the one-active-pattern rule refused it.
 */
// fix-l (2026-10-23, the live five-role check): the shared Marketing page and recurring form now ask their routes'
// permissions, so scripts/check-write-controls-ask-permission.ts — which fails while a page that asks is still on its
// NOT_SWEPT list — loses those two entries; its ROOT also reads the path with fileURLToPath (a checkout under a folder
// with a space failed its walk). The guard reads the shared package the templates vendor; no template changes.
const SUITE_TESTS = /^tests\/(bar|basic|crm|dispensary|fieldservice|homecare|landscaping|restaurant|roof|rv|salon|store|vet)\/[^/]+\.test\.ts$/
const MODIFY_ALLOWED = [SUITE_TESTS, /^apps\/api\/src\//, /^apps\/api\/schema\.sql$/, /^apps\/api\/migrations\//, /^apps\/platform\/src\//, /^tests\/shared\//, /^apps\/mobile\//, /^tests\/mobile\//,/^scripts\/check-(feature-vocabulary|not-ready-features|parked-features|vertical-vocabulary|composer-facts|trade-detect-slugs|dashboard-counts|money-and-labels|agreements|audience-quotes-leads-time|business-day|calendar-day-dates|salon-dark-surfaces|job-quote-rules|light-card-dark-text|retest-t24|contact-related-lists|contact-relations-ask|write-controls-ask-permission|refusals-render-on-the-page|sms-send-contract)\.ts$/, /^packages\/[^/]+\/src\//, /^docs\/SPEC_UNIFIED_PRODUCT\.md$/, /^bun\.lock$/, /^packages\/[^/]+\/package\.json$/, /^\.github\/workflows\/build-check\.yml$/, ...UNIFIED_OWN]
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
      // The phone app has no users, so it changes freely — removing its dispensary and unreachable screens included.
      if (DELETE_ALLOWED.some((r) => r.test(ch.path))) continue
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
