// CI guard: a stylist added under Team has a name on every screen that shows who did the work.
//
// A chair can be held by a login user (appointment/service_record.stylist_id → user) or by a roster-only
// stylist (…​.stylist_member_id → team_member). Every read path has to ask for BOTH, carry both through
// to the response, and render whichever it got.
//
// It has failed at a different link in that chain each round:
//   T27 N5 — the queries did not join team_member at all.
//   T28 M6 — the queries were fixed; six copies of stylistName() in the pages ignored the new field.
//   T29 M2 — the query selected stylistMemberName and the .map() that builds the response dropped it,
//            so the API had the name in hand and did not send it.
//
// Selecting a column proves nothing, so this follows the whole path: SELECT → response → render.
//   bun scripts/check-roster-stylist-visible.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }

const B = 'templates/crm-salon/backend/src/'
const F = 'templates/crm-salon/frontend/src/'

// ── the queries ask for the roster name ──────────────────────────────────────────────────────────
for (const [rel, what] of [[B + 'routes/dashboard.ts', 'the dashboard'], [B + 'routes/clients.ts', 'the client chart'], [B + 'routes/appointments.ts', 'the book']] as const) {
  const src = read(rel)
  if (!src) { fail(rel + ' is missing'); continue }
  if (!/stylistMemberName: teamMember\.name/.test(src)) fail(`${what} must SELECT teamMember.name as stylistMemberName — a roster stylist has no row in \`user\``)
  if (!/leftJoin\(teamMember,/.test(src)) fail(`${what} must leftJoin team_member, or the name is never fetched`)
}

// ── …and the response actually carries it ────────────────────────────────────────────────────────
//
// This is the T29 failure: selected, then dropped by the object literal that builds the reply. Any
// mapping that spells out stylistFirstName by hand must spell out stylistMemberName too.
for (const rel of [B + 'routes/clients.ts', B + 'routes/dashboard.ts', B + 'routes/appointments.ts']) {
  const src = read(rel)
  if (!src) continue
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return
    // a hand-written response field, not the SELECT (which uses `user.firstName`)
    if (!/stylistFirstName:\s*r\./.test(line)) return
    // look for the sibling within the same object literal (a few lines either way)
    const near = lines.slice(Math.max(0, i - 6), i + 7).join('\n')
    // One mapping legitimately has no roster name: a client's PREFERRED stylist is
    // clientProfile.preferredStylistId, a foreign key to `user`, so a roster-only person cannot be one.
    // The exemption is claimed in a comment next to the code, so it is visible rather than assumed.
    if (/PREFERRED stylist/i.test(near)) return
    if (!/stylistMemberName/.test(near)) {
      fail(`${rel.split('/').pop()}:${i + 1} builds a response with stylistFirstName and no stylistMemberName — the roster stylist is dropped on the way out: ${line.trim().slice(0, 70)}`)
    }
  })
}

// ── …and the pages render whichever kind they were given ─────────────────────────────────────────
const staff = read(F + 'lib/staff.ts')
if (!staff) fail(F + 'lib/staff.ts is missing')
if (!/export function stylistNameOf/.test(staff)) fail('lib/staff.ts must export stylistNameOf — one definition, because six copies each ignored the roster field')
if (!/return login \|\| String\(r\.stylistMemberName \|\| ''\)\.trim\(\)/.test(staff)) fail('…and it must fall back to stylistMemberName when there is no login user')

// no page may go back to its own first/last join
for (const page of ['pages/salon/DashboardPage.tsx', 'pages/salon/ClientDetailPage.tsx', 'pages/salon/AppointmentsPage.tsx']) {
  const src = read(F + page)
  if (!src) { fail(F + page + ' is missing'); continue }
  if (!/stylistNameOf/.test(src)) fail(`${page} must use stylistNameOf from lib/staff`)
  const ownJoin = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l) && /function stylistName\s*\(/.test(l))
  if (ownJoin.length) fail(`${page} has grown its own stylistName() again — that is how T28's query fix changed nothing on screen`)
}

if (failed) { console.error(`\nroster stylist visible: ${failed} check(s) FAILED`); process.exit(1) }
console.log('roster stylist visible: selected, carried through the response, and rendered on every screen')
