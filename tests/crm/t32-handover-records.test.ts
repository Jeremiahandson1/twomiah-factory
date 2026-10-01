// T32 M1 and M2 — the two records a client walks the building with at handover.
//
// M1  INS-0001 was failed, then passed. The pass OVERWROTE the failure in place: status failed →
//     passed, result fail → pass, deficiencies gone. So an inspection a building inspector had failed
//     read as if it had passed first time. The screen's Fail also sent the literal string "See notes"
//     every time, so the failure reason could not be recorded at all. And an inspection scheduled for
//     9 October could be failed on the 1st.
// M2  Verify on an OPEN punch item answered 200 — as owner AND as field. So the snag list could be
//     signed off without the work being done, by the person who was supposed to do it, and
//     `verifiedBy` came out of the request body.
import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project, inspection, punchListItem } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Handover Co', slug: 'handover-co', email: 'h@test.local', state: 'OH', settings: {},
  enabledFeatures: ['inspections', 'punch_lists', 'projects'],
} as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-ho@test.local`, passwordHash: 'x', firstName: tag === 'owner' ? 'Ines' : 'Fred', lastName: tag === 'owner' ? 'Okonjo' : 'Hale',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const manager = await mk('manager', 'manager')
const tech = await mk('field', 'field')
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Handover Client', type: 'customer' } as any).returning()
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'The Build', number: 'PRJ-HO', status: 'active',
} as any).returning()

const app = new Hono()
app.route('/api/inspections', (await import('./src/routes/inspections.ts')).default)
app.route('/api/punch-lists', (await import('./src/routes/punchLists.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asManager = as(manager), asTech = as(tech)
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

// ══════════ M1 · a failure is not overwritten by a pass ════════════════════════════════════════
{
  const made = await asOwner('POST', '/api/inspections', { type: 'Framing', projectId: proj.id, scheduledDate: yesterday, inspector: 'City of Eau Claire' })
  check('an inspection is scheduled', made.status === 201, { status: made.status, body: made.text?.slice(0, 220) })
  const id = made.json?.id

  const vague = await asOwner('POST', `/api/inspections/${id}/fail`, { deficiencies: 'See notes' })
  check('"See notes" is refused as a deficiency list', vague.status === 400, { status: vague.status, body: vague.text?.slice(0, 220) })
  check('…and says why — the re-inspection is booked against it', /re-inspection|crew/i.test(String(vague.json?.error || '')), vague.json?.error)
  const empty = await asOwner('POST', `/api/inspections/${id}/fail`, {})
  check('…so is nothing at all', empty.status === 400, { status: empty.status })

  const real = await asOwner('POST', `/api/inspections/${id}/fail`, {
    deficiencies: 'Two joist hangers missing at grid C. Firestopping incomplete above the third-floor ceiling.',
  })
  check('a real failure is recorded', real.status === 200 && real.json?.status === 'failed', { status: real.status, insStatus: real.json?.status })
  check('…with who recorded it', real.json?.resultedBy === 'Ines Okonjo', real.json?.resultedBy)
  check('…and when', !!real.json?.resultedAt, real.json?.resultedAt)

  // The fault.
  const flip = await asOwner('POST', `/api/inspections/${id}/pass`)
  check('a failed inspection cannot then be PASSED', flip.status === 400, { status: flip.status, body: flip.text?.slice(0, 240) })
  check('…and points at the re-inspection', /reinspect/.test(JSON.stringify(flip.json)), flip.json)
  const [still] = await db.select().from(inspection).where(eq(inspection.id, id))
  check('…the failure is intact: status, result and the deficiency list',
    still?.status === 'failed' && still?.result === 'fail' && /joist hangers/.test(still?.deficiencies || ''),
    { status: still?.status, result: still?.result, deficiencies: still?.deficiencies?.slice(0, 40) })

  // The re-visit.
  const re = await asOwner('POST', `/api/inspections/${id}/reinspect`, { scheduledDate: nextWeek })
  check('a re-inspection is booked as a NEW record', re.status === 201 && re.json?.inspection?.id !== id,
    { status: re.status, newId: re.json?.inspection?.id })
  check('…linked back to the failure', re.json?.inspection?.reinspectionOfId === id, re.json?.inspection?.reinspectionOfId)
  check('…carrying the type and the project', re.json?.inspection?.type === 'Framing' && re.json?.inspection?.projectId === proj.id, re.json?.inspection)
  check('…and the deficiency list, so whoever turns up knows what to look at',
    /joist hangers/.test(re.json?.inspection?.notes || ''), re.json?.inspection?.notes?.slice(0, 60))
  check('…scheduled, not resulted', re.json?.inspection?.status === 'scheduled' && !re.json?.inspection?.result, re.json?.inspection?.status)

  const twice = await asOwner('POST', `/api/inspections/${id}/reinspect`, {})
  check('…and it cannot be booked twice', twice.status === 409, { status: twice.status, body: twice.text?.slice(0, 200) })
  const n: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM inspection WHERE project_id = ${proj.id}`)
  check('…so the project has two inspections, not three', Number((n.rows || n)[0]?.n) === 2, (n.rows || n)[0])

  // And the re-inspection can pass, which is the point of the whole exercise.
  const reId = re.json?.inspection?.id
  await db.update(inspection).set({ scheduledDate: new Date(Date.now() - 3600_000) }).where(eq(inspection.id, reId))
  const ok = await asOwner('POST', `/api/inspections/${reId}/pass`)
  check('the re-inspection passes', ok.status === 200 && ok.json?.status === 'passed', { status: ok.status, insStatus: ok.json?.status })
  const [original] = await db.select().from(inspection).where(eq(inspection.id, id))
  check('…and the original STILL says it failed', original?.status === 'failed', original?.status)
}

// ══════════ M1b · a result cannot predate the visit ════════════════════════════════════════════
{
  const made = await asOwner('POST', '/api/inspections', { type: 'Electrical rough-in', projectId: proj.id, scheduledDate: nextWeek })
  const id = made.json?.id
  const early = await asOwner('POST', `/api/inspections/${id}/fail`, { deficiencies: 'Nothing wrong, I just pressed the button.' })
  check('an inspection scheduled for next week cannot be failed today', early.status === 400, { status: early.status, body: early.text?.slice(0, 220) })
  check('…and says to move the date if the inspector came early', /came early/i.test(String(early.json?.error || '')), early.json?.error)
  const earlyPass = await asOwner('POST', `/api/inspections/${id}/pass`)
  check('…nor passed', earlyPass.status === 400, { status: earlyPass.status })

  // Today's inspection CAN be resulted today, even if its time is later — the inspector came at 9am.
  const today = await asOwner('POST', '/api/inspections', { type: 'Plumbing', projectId: proj.id, scheduledDate: new Date().toISOString().slice(0, 10) })
  const nowPass = await asOwner('POST', `/api/inspections/${today.json.id}/pass`)
  check("today's inspection can be resulted today", nowPass.status === 200, { status: nowPass.status, body: nowPass.text?.slice(0, 200) })
}

// ══════════ M2 · a punch item is signed off by a second person, after the work ═════════════════
{
  const made = await asOwner('POST', '/api/punch-lists', { description: 'Touch up paint, stair 2', projectId: proj.id, location: 'Stair 2' })
  check('a punch item is raised', made.status === 201 && made.json?.status === 'open', { status: made.status, itemStatus: made.json?.status })
  const id = made.json?.id

  const earlyVerify = await asOwner('POST', `/api/punch-lists/${id}/verify`, { verifiedBy: 'Somebody Else' })
  check('an OPEN item cannot be verified', earlyVerify.status === 400, { status: earlyVerify.status, body: earlyVerify.text?.slice(0, 240) })
  check('…saying the work has to be marked complete first', /complete/i.test(String(earlyVerify.json?.error || '')), earlyVerify.json?.error)
  const [untouched] = await db.select().from(punchListItem).where(eq(punchListItem.id, id))
  check('…and it is still open', untouched?.status === 'open', untouched?.status)

  const done = await asTech('POST', `/api/punch-lists/${id}/complete`)
  check('the technician who did the work marks it complete', done.status === 200 && done.json?.status === 'completed',
    { status: done.status, itemStatus: done.json?.status })

  const selfSign = await asTech('POST', `/api/punch-lists/${id}/verify`, {})
  check('…and cannot sign off their own work', selfSign.status === 403, { status: selfSign.status, body: selfSign.text?.slice(0, 240) })
  check('…saying it needs a manager', /manager/i.test(String(selfSign.json?.error || '')), selfSign.json?.error)

  const signed = await asManager('POST', `/api/punch-lists/${id}/verify`, { verifiedBy: 'Not Me' })
  check('a manager verifies it', signed.status === 200 && signed.json?.status === 'verified', { status: signed.status, itemStatus: signed.json?.status })
  check('…and verifiedBy is the SIGNED-IN person, not the body', signed.json?.verifiedBy === 'Fred Hale', { verifiedBy: signed.json?.verifiedBy })
  check('…with the time it was signed', !!signed.json?.verifiedAt, signed.json?.verifiedAt)

  const again = await asManager('POST', `/api/punch-lists/${id}/verify`, {})
  check('verifying twice is refused', again.status === 400, { status: again.status })
  const reopenByTech = await asTech('POST', `/api/punch-lists/${id}/reopen`)
  check('a technician cannot un-sign-off a verified item', reopenByTech.status === 403, { status: reopenByTech.status })
  const reopen = await asManager('POST', `/api/punch-lists/${id}/reopen`)
  check('a manager can reopen it, so a mis-click at handover is not permanent', reopen.status === 200 && reopen.json?.status === 'open',
    { status: reopen.status, itemStatus: reopen.json?.status })
  check('…and the sign-off is cleared with it', !reopen.json?.verifiedBy && !reopen.json?.verifiedAt, reopen.json)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
