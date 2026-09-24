// CI guard: removing someone from the roster says what it costs. job.assigned_to_member_id is ON DELETE SET
// NULL, so deleting a crew member quietly unassigned their work — the jobs came back with no assignee and
// nothing was said either before the click or after it (contractor T26 L2). The warning has to survive both
// in the API (a caller that never opens the page still learns) and in the confirm dialog (a person is told
// before, not after).
//   bun scripts/check-team-removal-warning.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const team = read('packages/tenant-backend/src/team/team.ts')
if (!team) fail('packages/tenant-backend/src/team/team.ts is missing')
if (!/export interface TeamTables \{[^}]*job\?: any/s.test(team)) fail('the team module must be able to see jobs, or it cannot count what a removal would strand')
// …and jobs are not the only kind of work. A stylist holds appointments; this module assumed everyone holds
// jobs, so salon's delete reported "0 unassigned" while the FK took the stylist off the booking anyway —
// and the checks below, which named job.assigned_to_member_id, asserted the hard-coding that caused it.
// One list of where a vertical's work lives, declared by the vertical. (Salon T27 N14)
if (!/export interface AssignedWork \{ table: any; field: string; one: string; many: string \}/.test(team)) fail('there must be one description of where a vertical keeps the work a roster member holds')
if (!/assignedWork\?: AssignedWork\[\]/.test(team)) fail('…and a vertical must be able to declare it')
const dflt = team.match(/const work: AssignedWork\[\][\s\S]*?\n  const workLabel = .*/)?.[0] || ''
if (!dflt) fail('createTeamRoutes must settle what work means for this vertical, once')
// The COLUMN, not the table: vet, RV and restaurant have a job table with no assigned_to_member_id, and
// selecting a column that is not there throws inside drizzle — it 500s the whole Team page, not just the count.
if (!/t\.job\?\.assignedToMemberId \? \[\{ table: t\.job, field: 'assignedToMemberId', one: 'job', many: 'jobs' \}\] : \[\]/.test(dflt)) fail('a vertical that declares nothing must still mean jobs, and be skipped on the COLUMN when its jobs have no roster column')
if (!/const workLabel = \{ one: work\[0\]\?\.one \|\| 'job', many: work\[0\]\?\.many \|\| 'jobs' \}/.test(dflt)) fail('…and the work must have a name, so the warning can use the vertical\'s own word')
const counter = team.match(/const assignedJobCounts = async[\s\S]*?\n  \}/)?.[0] || ''
if (!counter) fail('assignedJobCounts is missing — nothing works out what each person is holding')
if (!/for \(const w of work\)/.test(counter)) fail('…across every place this vertical keeps work, not one hard-coded table')
if (!/const col = w\.table\[w\.field\]\s*\n\s*if \(!col\) continue/.test(counter)) fail('…skipping a declared table whose column is missing, rather than 500ing the Team page')
if (!/eq\(w\.table\.companyId, companyId\)/.test(counter)) fail('…and the count must stay inside the company')
if (!/groupBy\(col\)/.test(counter)) fail('…counted per member, not in total')
if (!/out\[String\(r\.memberId\)\] = \(out\[String\(r\.memberId\)\] \|\| 0\) \+ Number\(r\.value\)/.test(counter)) fail('…and two kinds of work add up, rather than the last one overwriting the first')

// the list carries it, so the dialog can warn before the click
if (!/const counts = await assignedJobCounts\(user\.companyId, data\.map/.test(team)) fail('the roster list must carry each member\'s workload')
if (!/r\._source === 'user' \? \{[^}]*\} : \{ \.\.\.r, assignedJobs: counts\[r\.id\] \|\| 0/.test(team)) fail('…on the roster rows only — a borrowed login row has no roster workload to report')

// the delete reports what it did
const del = team.match(/app\.delete\('\/:id'[\s\S]*?\n  \}\)/)?.[0] || ''
if (!del) fail('the team delete route is missing')
if (!/const counts = await assignedJobCounts\(user\.companyId, \[id\]\)/.test(del)) fail('the delete must count the work BEFORE it removes the person')
if (!/return c\.json\(\{ success: true, unassignedJobs, unassignedLabel: workLabel \}\)/.test(del)) fail('…and say how much work it left unassigned, in the word this vertical uses for it')
// The unassign itself walks the same list. It is done HERE rather than left to ON DELETE SET NULL because
// 0018's ADD COLUMN IF NOT EXISTS skips its REFERENCES clause on a tenant whose boot reconcile already made
// the column — the delete then reported work it had not actually released. (Field Service T26 M2)
if (!/for \(const w of work\) \{\s*\n\s*const col = w\.table\[w\.field\]/.test(del)) fail('the delete must release every kind of work this vertical declared')
if (!/await tx\.update\(w\.table\)\.set\(\{ \[w\.field\]: null \}\)/.test(del)) fail('…explicitly, in the same transaction as the delete — not left to a constraint that may not exist')
if (/return c\.body\(null, 204\)/.test(del)) fail('a bare 204 tells the caller nothing — that is how the unassign stayed silent')

// every template hands the roster its jobs
const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']
for (const t of TEMPLATES) {
  const src = read(`templates/${t}/backend/src/routes/team.ts`)
  if (!src) { fail(`templates/${t}/backend/src/routes/team.ts is missing`); continue }
  if (!/tables: \{ teamMember, user, job \}/.test(src)) fail(`${t} does not pass its job table — its roster cannot warn about anything`)
  if (!new RegExp("import \\{ teamMember, user, job\\s*[,}]").test(src)) fail(`${t} does not import the job table`)
}

// A stylist's work is appointments, not jobs. salon's job table has no assigned_to_member_id, so taking
// the default meant counting a column that is not there: the delete answered "0 unassigned" while the FK
// on appointment.stylist_member_id took the stylist off the booking anyway. A vertical whose jobs cannot
// hold a roster member must say where its work actually lives. (Salon T27 N14)
const salonTeam = read('templates/crm-salon/backend/src/routes/team.ts')
if (!/options: \{ assignedWork: \[\{ table: appointment, field: 'stylistMemberId', one: 'appointment', many: 'appointments' \}\] \}/.test(salonTeam)) fail('salon must declare that its roster members hold appointments — its jobs have no assignee column, so the default counts nothing')

// the person is warned before they click, not after
const page = read('packages/tenant-ui/src/people/TeamPage.tsx')
if (!page) fail('packages/tenant-ui/src/people/TeamPage.tsx is missing')
if (!/assignedJobs\?: number/.test(page)) fail('the page must know what a member is holding')
if (!/will be left unassigned\./.test(page)) fail('the confirm dialog must say the work will be left unassigned')
if (!/Number\(toDelete\?\.assignedJobs \|\| 0\) > 0/.test(page)) fail('…and only say it when there IS work to strand')
if (!/noun\.many \+ ' are'\} now unassigned/.test(page)) fail('the toast afterwards must report what actually happened')
// …in this vertical's word for it. The page said "jobs" to a salon whose stylists hold appointments and
// whose job table is empty, so the one sentence about what a removal cost named something that cannot
// exist there. The list hands the page the word; 'job' stays the default for everyone who had it. (T27 N14)
if (!/const \[workLabel, setWorkLabel\] = useState\(\{ one: 'job', many: 'jobs' \}\)/.test(page)) fail('the page must carry what this vertical calls the work a member holds')
if (!/if \(res\?\.workLabel\?\.one\) setWorkLabel\(res\.workLabel\)/.test(page)) fail('…taken from the roster list, which is the side that knows')
if (!/=== 1 \? workLabel\.one : workLabel\.many\} assigned to them will be left unassigned\./.test(page)) fail('…and the confirm dialog must use it')
if (/'job assigned to them' : 'jobs assigned to them'/.test(page)) fail('…the dialog must not go back to hard-coded jobs')
const list = team.match(/return c\.json\(\{ data: withCounts[^\n]*/)?.[0] || ''
if (!/workLabel/.test(list)) fail('the roster list must tell the page what to call the work')

// A login account appears on this page on loan from the user table, under ITS id — so PUT /api/team/:id had
// nothing to update and answered 404, the row menu opened nothing, and six of seven people had nowhere to
// hold a pay rate on the page that prints a Rate column. Saving one creates their roster card. (T29 M2)
if (!/\{ label: 'Edit', icon: Edit, onClick: openEdit \},/.test(page)) fail('Edit must be offered on every row, including a login account')
if (/label: 'Edit'[^}]*show: \(r\) => r\._source !== 'user'/.test(page)) fail('…Edit must not be hidden from login accounts again')
if (!/editing && editing\._source !== 'user'/.test(page)) fail('saving a login account must CREATE a roster card, not PUT to an id the roster does not have')
if (!/editing\?\._source === 'user' && \(/.test(page)) fail('…and the dialog must say that is what it is about to do')
if (!/label: 'Delete'[^}]*show: \(r\) => r\._source !== 'user'/.test(page)) fail('Delete must stay off login accounts — removing a login belongs to Settings › Users')
if (!/m\._source === 'user' \? '' : \(m\.role \|\| ''\)/.test(page)) fail("a login account's permission role must not be carried into the trade field")

// …and that card must not cost them the badge. "Can this person sign in" is answered by whether a login EXISTS
// with their email, never by which table the row was read from — keying it off the row's origin meant the badge
// vanished the moment someone was given a roster card, on the one page where it is the only sign of who has
// access, and precisely for the people just set up. (Contractor T30 N3)
if (!/const loginEmails = new Set<string>\(\)/.test(team)) fail('the roster list must work out who can sign in')
if (!/db\.select\(\{ email: t\.user\.email \}\)\.from\(t\.user\)\.where\(eq\(t\.user\.companyId, user\.companyId\)\)/.test(team)) fail('…from the login table, inside the company')
if (!/for \(const u of logins\) \{ const e = String\(u\.email \|\| ''\)\.toLowerCase\(\); if \(e\) loginEmails\.add\(e\) \}/.test(team)) fail('…and actually fill that set — an empty one badges nobody, silently')
if (!/loginEmails\.has\(String\(r\.email \|\| ''\)\.toLowerCase\(\)\)/.test(team)) fail('…matched on email, case-insensitively — the roster and the login are separate records')
if (!/hasLogin: true \} : \{ \.\.\.r, assignedJobs: counts\[r\.id\] \|\| 0, hasLogin: hasLogin\(r\) \}/.test(team)) fail('every row must carry hasLogin — the borrowed login rows too')
if (!/\(row\.hasLogin \|\| row\._source === 'user'\) && <span/.test(page)) fail('the login badge must follow the login, not the row\'s origin')

if (failed) { console.error(`\nteam removal warning: ${failed} check(s) FAILED`); process.exit(1) }
console.log('team removal warning: removing someone from the roster says what work it leaves unassigned')
