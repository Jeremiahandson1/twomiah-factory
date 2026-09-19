// CI guard: a stylist the owner added on the Team page can actually be given work.
//
// Salon T20 H1, open seven builds and reproducing on landscape too. appointment.stylist_id and
// service_records.stylist_id are foreign keys to `user`. A chair-only stylist lives in team_member with
// a different id, so every write was refused by the database with a 409 that said "A related record
// does not exist, or is still in use" and named nobody — while GET /api/team/assignable listed them
// tagged source "member". The API advertised a stylist every write path refused, and the New
// Appointment dialog papered over it by dropping them from the dropdown, which hid a real person from
// the owner instead of fixing anything.
//
// A stylist is therefore one of two things and the column depends on which. Exactly one of the two ids
// is ever set, the choice is made by one resolver, and every read hands back a single stylistId so no
// caller has to know there are two columns.
//   bun scripts/check-roster-stylist-bookable.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const B = 'templates/crm-salon/backend/'

// the second column, on both tables that hold a chair
const schema = read(B + 'db/schema.ts')
if (!schema) fail('the salon schema is missing')
if ((schema.match(/stylistMemberId: text\('stylist_member_id'\)\.references\(\(\) => teamMember\.id, \{ onDelete: 'set null' \}\)/g) || []).length < 2) {
  fail('appointment AND service_record each need a stylist_member_id — a roster stylist cannot be stored in a column that points at `user`')
}

// one resolver, used by every write
const util = read(B + 'src/utils/stylist.ts')
if (!util) fail('src/utils/stylist.ts is missing — which column a stylist goes in must be decided once')
if (!/export async function resolveStylist\(companyId: string, id: unknown\): Promise<StylistRef \| null>/.test(util)) fail('…it must resolve an id to the pair of columns')
if (!/if \(u\) return \{ stylistId: u\.id, stylistMemberId: null \}/.test(util)) fail('…a login user goes in stylist_id')
if (!/if \(m\) return \{ stylistId: null, stylistMemberId: m\.id \}/.test(util)) fail('…a roster member goes in stylist_member_id — and never both')
if (!/return null \/\/ not a person at this salon/.test(util)) fail('…and an id that is neither is refused')
if (!/code: 'UNKNOWN_STYLIST'/.test(util)) fail('…with a 400 that names the field, not a foreign-key 409 that names nobody')
if (!/export const stylistIdOf = \(row: any\): string \| null => row\?\.stylistId \?\? row\?\.stylistMemberId \?\? null/.test(util)) fail('…and one stylistId goes back out, so callers never see two columns')

for (const [file, what] of [['src/routes/appointments.ts', 'the book'], ['src/routes/serviceRecords.ts', 'the visit record']] as Array<[string, string]>) {
  const src = read(B + file)
  if (!src) { fail(`${file} is missing`); continue }
  if (!/from '\.\.\/utils\/stylist\.ts'/.test(src)) fail(`${what} must use the shared stylist resolver`)
  // BOTH the create and the update path — a chair can be assigned on either, so one of each is not enough
  if ((src.match(/resolveStylist\(currentUser\.companyId, /g) || []).length < 2) fail(`${what} must resolve the stylist before writing, on create AND on reassign`)
  if ((src.match(/return unknownStylist\(c, /g) || []).length < 2) fail(`${what} must refuse an id that belongs to nobody, on create AND on reassign`)
  if (!/stylistMemberId: stylist\.stylistMemberId/.test(src) && !/updates\.stylistMemberId = resolved\.stylistMemberId/.test(src)) fail(`${what} must write the roster column`)
  if (!/leftJoin\(teamMember, eq\(/.test(src)) fail(`${what} must read the roster stylist's NAME too, or the chair shows blank`)
  if (!/stylistIdOf\(/.test(src)) fail(`${what} must answer with one stylistId whichever column holds it`)
  // filtering by a stylist has to find them in either column
  if (!/or\(eq\(\w+\.stylistId, stylistId\), eq\(\w+\.stylistMemberId, stylistId\)\)/.test(src)) fail(`${what} must filter on either column — a caller knows one stylist id, not which table it came from`)
}

// double-booking a roster stylist is still a double-book
const appts = read(B + 'src/routes/appointments.ts')
if (!/const heldBy = stylist\.stylistId\n\s+\? eq\(appointment\.stylistId, stylist\.stylistId\)\n\s+: eq\(appointment\.stylistMemberId, stylist\.stylistMemberId!\)/.test(appts)) {
  fail('the clash check must follow the stylist into whichever column holds them, or a roster stylist can be booked into two chairs at once')
}
// completing a visit carries the chair onto the service record
if (!/stylistId: row\.stylistId \|\| null, stylistMemberId: \(row as any\)\.stylistMemberId \|\| null/.test(appts)) fail('completing an appointment must record WHO was in the chair, roster or not')

// the picker offers them, instead of hiding them
const picker = read('templates/crm-salon/frontend/src/lib/staff.ts')
if (!picker) fail('the salon staff picker is missing')
if (/api\.get\('\/api\/company\/users'\)/.test(picker)) fail('the stylist picker must not read logins only — that is what hid the roster stylist from the owner')
if (!/api\.get\('\/api\/team\/assignable'\)/.test(picker)) fail('…it must read the endpoint that knows about both kinds of stylist')
if (!/\.filter\(\(u\) => u\.active !== false && u\.isActive !== false\)/.test(picker)) fail('…while a revoked stylist still must not stay assignable')

if (failed) { console.error(`\nroster stylist bookable: ${failed} check(s) FAILED`); process.exit(1) }
console.log('roster stylist bookable: a chair-only stylist can be booked, named, filtered and double-book-checked, and the picker offers them')
