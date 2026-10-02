// T32 H10 and H11 — two site records that could be silently rewritten after the fact.
//
// H10  A log for 30 September was PUT with new text and date = 1 October. It saved: 30 September's
//      content was gone and 30 September had no log. A second log for the same day was accepted, and
//      so was one dated 1 March 2027.
// H11  RFI-001 was closed unanswered, answered, closed, then answered AGAIN. The second answer
//      replaced the first with no history, the status went back to Answered, and `respondedBy` was
//      always null because it came from the request body.
//
// These are the documents a contractor reaches for when there is an argument about what happened —
// a delay, an injury, the instruction the work was built to. A record that can be quietly changed is
// not a record, which is the same thing T32 H2 said about an approved change order.
//
// Dates here are built RELATIVE to the company's today, not hardcoded. A test that pins "30
// September" passes in September and fails forever after; one that pins a fixed age reads the same
// on every day of the year. (feedback: test-that-fails-only-overnight)
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project, dailyLog, rfi } = await import('./db/schema.ts')

// UTC, so "the company's day" and the test's arithmetic are the same day — the point being asserted
// is the locking rule, not the timezone maths, and a tenant on America/Chicago would make every
// boundary in here ambiguous for four hours a day.
const [co] = await db.insert(company).values({
  name: 'Site Co', slug: 'site-co', email: 's@test.local', state: 'OH',
  settings: { timezone: 'UTC' },
  enabledFeatures: ['daily_logs', 'rfis', 'projects'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-site@test.local', passwordHash: 'x', firstName: 'Dale', lastName: 'Monk',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Site Client', type: 'customer' } as any).returning()
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'The Site', number: 'PRJ-SITE', status: 'active',
} as any).returning()

const app = new Hono()
app.route('/api/daily-logs', (await import('./src/routes/dailyLogs.ts')).default)
app.route('/api/rfis', (await import('./src/routes/rfis.ts')).default)
app.route('/api/inspections', (await import('./src/routes/inspections.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

/** A calendar day N days before today, as the API takes it. */
const dayAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const dayAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

// ══════════ H10 · a log stays on its day ═══════════════════════════════════════════════════════
{
  const made = await api('POST', '/api/daily-logs', {
    projectId: proj.id, date: dayAgo(1), workPerformed: 'Poured the slab', crewSize: 4,
  })
  check("yesterday's log can still be filed (and finished)", made.status === 201, { status: made.status, body: made.text?.slice(0, 200) })
  const id = made.json?.id

  // The window: a log is editable on its day and the day after.
  const fix = await api('PUT', `/api/daily-logs/${id}`, { workPerformed: 'Poured the slab, 14 yards' })
  check("…and edited the next morning, which is how site diaries are written", fix.status === 200 && /14 yards/.test(fix.json?.workPerformed || ''),
    { status: fix.status, workPerformed: fix.json?.workPerformed })

  // The fault: moving it to today.
  const moved = await api('PUT', `/api/daily-logs/${id}`, { workPerformed: 'Something else entirely', date: dayAgo(0) })
  check('a log cannot be MOVED to another day', moved.status === 400, { status: moved.status, body: moved.text?.slice(0, 220) })
  check('…and the refusal says why — the day it came from would be left empty', /no log|did not happen/i.test(JSON.stringify(moved.json)), moved.json)
  const [after] = await db.select().from(dailyLog).where(eq(dailyLog.id, id))
  check("…yesterday's log still says what it said", /14 yards/.test(after?.workPerformed || ''), after?.workPerformed)
  check('…and is still dated yesterday', new Date(after!.date).toISOString().slice(0, 10) === dayAgo(1),
    { date: new Date(after!.date).toISOString().slice(0, 10), expected: dayAgo(1) })
}

// ══════════ H10b · one log per person per day ══════════════════════════════════════════════════
{
  const first = await api('POST', '/api/daily-logs', { projectId: proj.id, date: dayAgo(0), workPerformed: 'Framing' })
  check("today's log is filed", first.status === 201, { status: first.status, body: first.text?.slice(0, 200) })
  const dupe = await api('POST', '/api/daily-logs', { projectId: proj.id, date: dayAgo(0), workPerformed: 'Framing again' })
  check('a second log for the same day by the same person is refused', dupe.status === 409, { status: dupe.status, body: dupe.text?.slice(0, 220) })
  check('…and points at the one that exists', dupe.json?.existingId === first.json?.id, { existingId: dupe.json?.existingId })

  // A second CREW on the same site is a different person, and that is normal.
  const [mate] = await db.insert(user).values({
    email: 'crew-site@test.local', passwordHash: 'x', firstName: 'Nia', lastName: 'Ford',
    role: 'field', companyId: co.id, isActive: true,
  } as any).returning()
  const res = await app.request('/api/daily-logs', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': mate.id },
    body: JSON.stringify({ projectId: proj.id, date: dayAgo(0), workPerformed: "Second crew's day" }),
  })
  check('…but a second CREW filing their own log for the same day is allowed', res.status === 201, { status: res.status })
}

// ══════════ H10c · the past is closed, and the future never happened ═══════════════════════════
{
  const future = await api('POST', '/api/daily-logs', { projectId: proj.id, date: dayAhead(150), workPerformed: 'Not yet' })
  check('a log cannot be dated in the future', future.status === 400, { status: future.status, body: future.text?.slice(0, 200) })
  check('…and says today\'s date so the mistake is obvious', /has not happened yet/.test(JSON.stringify(future.json)), future.json)

  // Seeded directly, because the API now refuses to file one this old — which is the point.
  const [old] = await db.insert(dailyLog).values({
    companyId: co.id, projectId: proj.id, userId: owner.id,
    date: new Date(Date.now() - 30 * 86_400_000), workPerformed: 'What actually happened',
  } as any).returning()

  const rewrite = await api('PUT', `/api/daily-logs/${old.id}`, { workPerformed: 'A different story' })
  check('a 30-day-old log cannot be edited', rewrite.status === 400, { status: rewrite.status, body: rewrite.text?.slice(0, 220) })
  check('…and the refusal says how old it is', /30 days old/.test(JSON.stringify(rewrite.json)), rewrite.json)
  const [still] = await db.select().from(dailyLog).where(eq(dailyLog.id, old.id))
  check('…and it still says what actually happened', still?.workPerformed === 'What actually happened', still?.workPerformed)

  const erase = await api('DELETE', `/api/daily-logs/${old.id}`)
  check('…nor DELETED, or the lock would be theatre (delete, refile, rewritten)', erase.status === 400, { status: erase.status, body: erase.text?.slice(0, 200) })
  const [alive] = await db.select().from(dailyLog).where(eq(dailyLog.id, old.id))
  check('…and it is still there', !!alive, null)
}

// ══════════ H11 · an RFI answer is the instruction the work was built to ═══════════════════════
{
  const made = await api('POST', '/api/rfis', { projectId: proj.id, subject: 'Beam size at grid C', question: 'W12 or W14?' })
  check('an RFI is raised', made.status === 201 && made.json?.status === 'open', { status: made.status, rfiStatus: made.json?.status })
  const id = made.json?.id

  const empty = await api('POST', `/api/rfis/${id}/respond`, { response: '   ' })
  check('a blank answer is refused', empty.status === 400, { status: empty.status })

  const first = await api('POST', `/api/rfis/${id}/respond`, { response: 'W14, per S-201.', respondedBy: 'Current User' })
  check('answering works', first.status === 200 && first.json?.status === 'answered', { status: first.status, rfiStatus: first.json?.status })
  check('…and the responder is the SIGNED-IN person, not the body or null', first.json?.respondedBy === 'Dale Monk', { respondedBy: first.json?.respondedBy })

  const over = await api('POST', `/api/rfis/${id}/respond`, { response: 'Actually W12.' })
  check('a second answer does not silently replace the first', over.status === 409, { status: over.status, body: over.text?.slice(0, 220) })
  check('…and names who answered it and when', /Dale Monk/.test(JSON.stringify(over.json)), over.json)
  const [unchanged] = await db.select().from(rfi).where(eq(rfi.id, id))
  check('…the original answer is intact', unchanged?.response === 'W14, per S-201.', unchanged?.response)

  const revised = await api('POST', `/api/rfis/${id}/respond?replace=true`, { response: 'Actually W12 — see RFI-002.' })
  check('a revised answer can be given deliberately', revised.status === 200, { status: revised.status, body: revised.text?.slice(0, 200) })
  check('…and the ORIGINAL is still in the record', /W14, per S-201\./.test(revised.json?.response || ''), revised.json?.response)
  check('…alongside the revision, dated and attributed', /Revised .* by Dale Monk/.test(revised.json?.response || '') && /W12/.test(revised.json?.response || ''), revised.json?.response)

  const closed = await api('POST', `/api/rfis/${id}/close`)
  check('closing works', closed.status === 200 && closed.json?.status === 'closed', { status: closed.status, rfiStatus: closed.json?.status })
  check('…and records WHEN it closed (closedAt was never written at all)', !!closed.json?.closedAt, { closedAt: closed.json?.closedAt })

  const sneak = await api('POST', `/api/rfis/${id}/respond?replace=true`, { response: 'One more thing.' })
  check('a CLOSED RFI takes no new answer', sneak.status === 400, { status: sneak.status, body: sneak.text?.slice(0, 220) })
  check('…and points at reopening, which is a visible act', /reopen/i.test(JSON.stringify(sneak.json)), sneak.json)
  const [sealed] = await db.select().from(rfi).where(eq(rfi.id, id))
  check('…nothing changed', sealed?.status === 'closed' && !/One more thing/.test(sealed?.response || ''), { status: sealed?.status })

  const reopened = await api('POST', `/api/rfis/${id}/reopen`)
  check('reopening a closed RFI works', reopened.status === 200, { status: reopened.status, body: reopened.text?.slice(0, 200) })
  check('…and it goes back to answered, because it had an answer', reopened.json?.status === 'answered', reopened.json?.status)
  check('…with closedAt cleared', !reopened.json?.closedAt, { closedAt: reopened.json?.closedAt })
  const twice = await api('POST', `/api/rfis/${id}/reopen`)
  check('…and reopening an open one is refused', twice.status === 400, { status: twice.status })

  const now = await api('POST', `/api/rfis/${id}/respond?replace=true`, { response: 'Confirmed W12.' })
  check('…once reopened, a revised answer lands', now.status === 200 && /Confirmed W12/.test(now.json?.response || ''), { status: now.status })
}

// ══════════ H11b · an unanswered RFI can still be withdrawn ════════════════════════════════════
{
  const made = await api('POST', '/api/rfis', { projectId: proj.id, subject: 'Moot point', question: 'Never mind' })
  const closed = await api('POST', `/api/rfis/${made.json.id}/close`)
  check('closing an UNANSWERED RFI is allowed — a question can be withdrawn', closed.status === 200, { status: closed.status })
  const reopened = await api('POST', `/api/rfis/${made.json.id}/reopen`)
  check('…and reopening it returns it to open, not to answered', reopened.json?.status === 'open', reopened.json?.status)
}

// ══════════ T33 · the day a record REPORTS, on a company that is not on UTC ═══════════════════════
//
// Everything above runs on a UTC company, deliberately — the comment at the top says why: these are
// locking rules, and a zone would make every boundary ambiguous. That choice is also exactly why
// this class of defect went untested for a round, so it gets its own company rather than changing
// the one above.
//
// Two reports, same root cause, OPPOSITE directions:
//
//   Inspections said "failed on 2026-10-02" for a result recorded at 7pm on 1 Oct in Ohio.
//     `resulted_at` is an INSTANT, and its UTC day is tomorrow by late evening. It has to be read
//     in the company's zone.
//
//   Daily logs called a 30 Sep log "2026-09-29".
//     `date` is a calendar DAY held as a midnight marker. Converting a marker into a zone walks it
//     backwards — 2026-09-30T00:00Z is 7pm on the 29th in Chicago. It must be taken at face value.
//
// Read one the way the other needs and you get the wrong day in whichever direction you guessed.
{
  const TZ = 'America/Chicago'
  const [tzCo] = await db.insert(company).values({
    name: 'Zone Co', slug: 'zone-co', email: 'z@test.local', state: 'IL',
    settings: { timezone: TZ },
    enabledFeatures: ['daily_logs', 'inspections', 'projects'],
  } as any).returning()
  const [tzOwner] = await db.insert(user).values({
    email: 'owner-zone@test.local', passwordHash: 'x', firstName: 'Ida', lastName: 'Zone',
    role: 'owner', companyId: tzCo.id, isActive: true,
  } as any).returning()
  const [tzClient] = await db.insert(contact).values({ companyId: tzCo.id, name: 'Zone Client', type: 'customer' } as any).returning()
  const [tzProj] = await db.insert(project).values({
    companyId: tzCo.id, contactId: tzClient.id, name: 'Zone Site', number: 'PRJ-ZONE', status: 'active',
  } as any).returning()

  const zapi = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method, headers: { 'content-type': 'application/json', 'x-test-user': tzOwner.id },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }
  /** A calendar day N days back ON THE COMPANY'S CLOCK — not the server's. */
  const coDay = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - n * 86_400_000))

  // ── a daily log reports its OWN day ─────────────────────────────────────────────────────────────
  // Yesterday, not two days back: the edit window is its own day plus the next, so a 2-day-old log
  // is correctly closed to edits and the re-save check below would be measuring the wrong rule.
  const theDay = coDay(1)
  const filed = await zapi('POST', '/api/daily-logs', { projectId: tzProj.id, date: theDay, workPerformed: 'Formwork', crewSize: 3 })
  check(`T33 a log can be filed for ${theDay}`, filed.status === 201, { status: filed.status, body: filed.text?.slice(0, 180) })

  // The duplicate refusal NAMES the day. On a Chicago company this said the day before.
  const dupe = await zapi('POST', '/api/daily-logs', { projectId: tzProj.id, date: theDay, workPerformed: 'Formwork again' })
  check('T33 a second log for that day is refused', dupe.status === 409, { status: dupe.status })
  check(`T33 …and the message says ${theDay}, NOT the day before`, (dupe.json?.error || '').includes(theDay),
    { error: dupe.json?.error, expected: theDay, dayBefore: coDay(3) })

  // Re-saving the SAME day must not read as moving it. Both sides have to be read the same way.
  const resave = await zapi('PUT', `/api/daily-logs/${filed.json?.id}`, { date: theDay, workPerformed: 'Formwork, 12 bays' })
  check('T33 re-saving a log with its OWN date is allowed, not refused as a move', resave.status === 200,
    { status: resave.status, body: resave.text?.slice(0, 200) })

  const moved = await zapi('PUT', `/api/daily-logs/${filed.json?.id}`, { date: coDay(0) })
  check('T33 …while a genuine move is still refused', moved.status === 400, { status: moved.status })
  check(`T33 …and that refusal also names ${theDay}`, (moved.json?.error || '').includes(theDay), { error: moved.json?.error })

  // ── an inspection result reports the COMPANY'S day ──────────────────────────────────────────────
  const ins = await zapi('POST', '/api/inspections', { type: 'framing', projectId: tzProj.id, scheduledDate: coDay(1) })
  check('T33 an inspection can be booked for yesterday', ins.status === 201, { status: ins.status, body: ins.text?.slice(0, 180) })
  const failed1 = await zapi('POST', `/api/inspections/${ins.json?.id}/fail`, { deficiencies: 'Joist hangers missing on bay 3' })
  check('T33 …and failed', failed1.status === 200, { status: failed1.status, body: failed1.text?.slice(0, 180) })

  const again = await zapi('POST', `/api/inspections/${ins.json?.id}/fail`, { deficiencies: 'Again' })
  check('T33 a resulted inspection cannot be resulted twice', again.status === 400, { status: again.status })
  check('T33 …and the message says the COMPANY\'S day, not tomorrow in UTC',
    (again.json?.error || '').includes(coDay(0)), { error: again.json?.error, companyToday: coDay(0), utcToday: new Date().toISOString().slice(0, 10) })

  // And the future-date refusal reads the scheduled day at face value while reading today in the zone.
  const future = await zapi('POST', '/api/inspections', { type: 'final', projectId: tzProj.id, scheduledDate: coDay(-3) })
  const early = await zapi('POST', `/api/inspections/${future.json?.id}/pass`)
  check('T33 an inspection scheduled three days out still cannot be passed', early.status === 400, { status: early.status })
  check('T33 …and the refusal names the day it is booked for', (early.json?.error || '').includes(coDay(-3)), { error: early.json?.error, expected: coDay(-3) })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
