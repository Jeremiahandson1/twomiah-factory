// crm-fieldservice — who the "Assign To" pickers may offer. (T42 low)
//
//   "Viewer offered as a technician in Dispatch; roster-only member still missing from the assign list."
//
// Both halves came from one line. DispatchBoard read `/api/team?role=technician&limit=100`, and
// GET /api/team honours page, limit, active, department and search — NOT role. The filter was
// silently ignored, so the board listed every person in the company, the viewer among them. And
// team.ts says so three lines above the right endpoint: "Pickers must read this, never GET /."
//
// /assignable has included roster-only crew since T21 M12, so moving the board onto it fixes the
// second half as well — Dispatch was looking somewhere those people never appear.
//
// This pins the ENDPOINT's contract, which is what every picker in the fleet depends on: a viewer is
// not offered, and everybody who can actually take the work still is. Only viewer is excluded on
// purpose — a manager, an admin and an owner all turn out on jobs in a small shop, and leaving them
// out of the picker would be the opposite bug, so each is asserted present.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, teamMember } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'FS Seats', slug: 'fs-seats-t47', email: 'fss@test.local', state: 'OH', settings: {},
  enabledFeatures: ['jobs', 'team', 'service_dispatch'],
} as any).returning()

const mk = async (role: string, tag: string, isActive = true) => (await db.insert(user).values({
  email: `${tag}-fss@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive,
} as any).returning())[0]
const owner = await mk('owner', 'Olive')
const admin = await mk('admin', 'Adam')
const manager = await mk('manager', 'Marta')
const tech = await mk('field', 'Tomas')
const viewer = await mk('viewer', 'Vera')
const goneTech = await mk('field', 'Gone', false)

// roster-only crew: on the roster, no login. /assignable has included these since T21 M12.
const [rosterOnly] = await db.insert(teamMember).values({
  companyId: co.id, name: 'Rafferty Crew', email: 'rafferty-fss@test.local', role: 'Technician', active: true,
} as any).returning()
// …and somebody who is BOTH, who must be offered once, as their login
await db.insert(teamMember).values({
  companyId: co.id, name: 'Tomas U', email: `Tomas-fss@test.local`, role: 'Technician', active: true,
} as any)

const app = new Hono()
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const assignable = async (who: any) => {
  const res = await app.request('/api/team/assignable', { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, rows: (Array.isArray(j) ? j : (j?.data ?? [])) as any[], text: t }
}

console.log('\n══════════ who may be sent to a job ══════════')
{
  const r = await assignable(owner)
  check('the picker answers', r.status === 200, { status: r.status, body: r.text?.slice(0, 180) })
  const emails = r.rows.map((x) => String(x.email || '').toLowerCase())
  const names = r.rows.map((x) => x.name)

  check('T42: the read-only VIEWER is not offered as a technician',
    !emails.includes('vera-fss@test.local'), names)

  for (const [label, who] of [['the owner', owner], ['the admin', admin], ['the manager', manager], ['the technician', tech]] as const) {
    check(`…${label} still is — small shops put all of them on jobs`,
      emails.includes(String((who as any).email).toLowerCase()), names)
  }

  check('an INACTIVE login is not offered', !emails.includes('gone-fss@test.local'), names)

  check('T42: roster-only crew ARE offered — Dispatch was looking somewhere they never appear',
    r.rows.some((x) => x.id === rosterOnly.id && x.kind === 'member'), r.rows.map((x) => ({ n: x.name, k: x.kind })))

  // somebody with both a login and a roster card appears once, as their login
  const tomas = r.rows.filter((x) => String(x.email || '').toLowerCase() === 'tomas-fss@test.local')
  check('…and somebody who is both is offered ONCE, as their login',
    tomas.length === 1 && tomas[0].kind === 'user', tomas)
}

console.log('\n══════════ and GET / is not a picker ══════════')
{
  // The reason the board was wrong: this endpoint ignores ?role, so a picker reading it gets
  // everybody. Pinned so nobody "fixes" Dispatch by going back to it.
  const res = await app.request('/api/team?role=technician&limit=100', { headers: { 'x-test-user': owner.id } })
  const j: any = await res.json().catch(() => ({}))
  const rows = (Array.isArray(j) ? j : (j?.data ?? [])) as any[]
  const hasViewer = rows.some((x) => String(x.email || '').toLowerCase() === 'vera-fss@test.local')
  check('GET /api/team?role=… still ignores the role filter, which is why pickers must not read it',
    res.status === 200 && hasViewer, { status: res.status, n: rows.length, hasViewer })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
