// CI guard: the Team page is ONE list — the roster plus everyone who can sign in.
//
// Three punch lists reported the same thing from three verticals: crm-vet F-16 ("owner missing from the
// team roster"), crm-landscaping BUG-11 ("team PAGE lists only team_member"), crm-restaurant M-07 ("Team
// vs Users are two lists"). The owner is a `user` row; the roster is `team_member`; the page read only the
// second, so the person signed in could not find themselves on their own Team page.
//
// It was then fixed TWICE, because the first fix was conditional: login accounts appeared only as a
// fallback for an EMPTY roster, so they vanished the moment anybody added the first crew member — on the
// one page where "who has access" is the question being asked (F-14 → events T16 H3 → #172). That is the
// regression this guard exists to catch, and check-team-removal-warning.ts does not: it asserts the
// workload rules and only touches `_source` in passing, so reverting the merge to `if (!data.length)`
// leaves every existing guard green.
//
// The rule: the append is conditioned on PAGING and filtering, never on the roster being empty.
//
//   bun scripts/check-team-roster-includes-logins.ts
import { readFileSync } from 'node:fs'

const read = (p: string) => { try { return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8') } catch { return null } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const TEAM = 'packages/tenant-backend/src/team/team.ts'
const PAGE = 'packages/tenant-ui/src/people/TeamPage.tsx'

const team = read(TEAM)
if (!team) fail(`${TEAM} is missing`)
else {
  const list = team.slice(team.indexOf("app.get('/', requirePermission('team:read')"), team.indexOf("app.get('/assignable'"))
  if (!list) fail('the team list route is missing')

  // ── the append happens at all ────────────────────────────────────────────────────────────────────
  if (!/rows = \[\.\.\.data, \.\.\.logins\]/.test(list)) {
    fail('the list must return the roster AND the login accounts as one list — that is the whole defect (vet F-16 / landscaping BUG-11 / restaurant M-07)')
  }
  if (!/_source: 'user' as const/.test(list)) {
    fail("login rows must be flagged `_source: 'user'` — the page uses that flag to badge them and to keep them read-only")
  }
  if (!/totalN \+= logins\.length/.test(list)) {
    fail('the pagination total must count the appended logins, or the page footer contradicts the rows on screen')
  }

  // ── …and NOT only when the roster is empty. This is the F-14 regression, stated exactly. ─────────
  // Found by walking back from the login query to the `if` that encloses it, a line at a time. A
  // cross-line regex looks right and is not: `if \(([^)]*)\) \{[\s\S]*?const uConds` happily anchors on
  // an EARLIER `if (search) {` and reports that condition instead, so the guard would be reading a
  // different line from the one it claims to be checking. (feedback_line_based_class_edits)
  const lines = list.split('\n')
  const uCondsAt = lines.findIndex((l) => l.includes('const uConds'))
  let guardLine: string | undefined
  for (let i = uCondsAt - 1; i >= 0 && i > uCondsAt - 12; i--) {
    const m = lines[i].match(/^\s*if \((.*)\) \{\s*$/)
    if (m) { guardLine = m[1]; break }
  }
  if (uCondsAt === -1 || guardLine === undefined) {
    fail('could not find the condition that guards the login append — this guard cannot do its job; fix the guard')
  } else {
    if (/\bdata\.length\b|\btotal\b\s*(===|==)\s*0|!rows\.length/.test(guardLine)) {
      fail(`the login append is conditioned on the roster being empty (\`${guardLine.trim()}\`). That is F-14: the`
        + ' moment somebody adds the first crew member every login account disappears from the page. Condition it on'
        + ' paging and filtering instead.')
    }
    if (!/page >= pages/.test(guardLine)) {
      fail('the logins must be appended on the LAST page only, or they repeat on every page of a long roster')
    }
    if (!/!search/.test(guardLine) || !/!q\.department/.test(guardLine)) {
      fail('a search or a department filter must suppress the append — otherwise filtering the roster still returns every login account, which is not what was asked for')
    }
  }

  // ── no duplicates: somebody on the roster AND holding a login appears once ───────────────────────
  if (!/const onRoster = new Set\(roster\.map\(/.test(list) || !/users\.filter\(\(u: any\) => !onRoster\.has\(/.test(list)) {
    fail('login accounts must be matched against the roster by email and skipped when already present, or a person with both shows up twice')
  }
  if (!/String\(u\.email \|\| ''\)\.toLowerCase\(\)/.test(list) || !/String\(r\.email \|\| ''\)\.toLowerCase\(\)/.test(list)) {
    fail('…matched case-insensitively — Owner@x.com and owner@x.com are the same person')
  }

  // ── the "login" badge answers "is there an account", not "which table was this row in" ───────────
  if (!/const hasLogin = \(r: any\) => r\._source === 'user' \|\| loginEmails\.has\(/.test(team)) {
    fail("`hasLogin` must be decided by whether a login exists with that email, not by which table the row came from — giving someone a roster card used to make their login badge vanish (Contractor T30 N3)")
  }

  // ── the module must be ABLE to see logins ────────────────────────────────────────────────────────
  if (!/export interface TeamTables \{[^}]*\buser\b/s.test(team)) {
    fail('TeamTables must include the user table, or there are no login accounts to merge')
  }
}

// ── every vertical that wires the module must hand it the user table ───────────────────────────────
const TEMPLATES = ['crm', 'crm-basic', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']
for (const t of TEMPLATES) {
  const src = read(`templates/${t}/backend/src/routes/team.ts`)
  if (!src) { fail(`templates/${t}/backend/src/routes/team.ts is missing`); continue }
  if (!/createTeamRoutes/.test(src)) { fail(`${t} does not use the shared team module, so it keeps its own list and this rule cannot reach it`); continue }
  if (!/tables: \{[^}]*\buser\b/s.test(src)) fail(`${t} does not pass its user table — its Team page cannot show anyone who can sign in`)
}

// ── the page's side of the same contract ───────────────────────────────────────────────────────────
const page = read(PAGE)
if (!page) fail(`${PAGE} is missing`)
else {
  if (!/\(row\.hasLogin \|\| row\._source === 'user'\)/.test(page)) {
    fail('the Team page must badge the people who can sign in — that badge is the only at-a-glance answer to "who has access"')
  }
  if (!/show: \(r\) => r\._source !== 'user'/.test(page)) {
    fail("Delete must be hidden on a borrowed login row: there is no team_member to delete, so the button could only 404 (logins are removed under Settings › Users)")
  }
  if (!/Settings → Users|Settings › Users/.test(page)) {
    fail('the page must say where logins are actually managed, or a read-only row looks like a bug')
  }
}

if (failed) { console.error(`\nteam roster/logins: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`team roster includes logins: the Team page is one list — roster + every login account, deduped by email, appended on the last page and never conditioned on an empty roster (${TEMPLATES.length} templates)`)
