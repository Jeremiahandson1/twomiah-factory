// The tech's job flow on the phone (apps/mobile/src/jobflow/flow.ts) and the "waiting to send" wording
// (apps/mobile/src/offline/describe.ts), as pure rules — no device needed.
//   · the steps run on my way → arrived → checklist → photos → customer signs → complete, in that order;
//   · a move waiting to be sent shows as WAITING (not done) and the job's status is what it WILL be;
//   · a refused move shows the server's words and does not count; the next step is the first one still owed;
//   · Complete is not offered while a checklist is owed;
//   · a failed save says "Couldn't send — tap to fix" with the server's words and leads to the job;
//   · a business without checklists, or a job without a photo count, simply has fewer steps.
//
//   bun run tests/mobile/job-flow.test.ts
import { buildFlow, effectiveStatus, jobKey, type FlowInput } from '../../apps/mobile/src/jobflow/flow.ts'
import { describeItem, openFor, orderForList } from '../../apps/mobile/src/offline/describe.ts'
import { clockView, clockKey, tapBody, placeBody } from '../../apps/mobile/src/jobflow/clock.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const ID = 'job1'
const q = (suffix: string, state: 'waiting' | 'sending' | 'failed' = 'waiting', extra: any = {}) =>
  ({ method: 'POST', path: `/api/jobs/${ID}${suffix}`, state, recordKey: jobKey(ID), ...extra }) as any
const sig = { id: 't1', name: 'Tune-up', requireSignature: true, requirePhoto: false }
const base = (over: Partial<FlowInput> = {}): FlowInput => ({ jobId: ID, status: 'scheduled', queue: [], checklists: null, photoCount: null, ...over })
const keys = (f: ReturnType<typeof buildFlow>) => f.steps.map((s) => s.key)
const stateOf = (f: ReturnType<typeof buildFlow>, k: string) => f.steps.find((s) => s.key === k)?.state

{
  const f = buildFlow(base({ checklists: { templates: [sig], outstanding: [{ templateId: 't1', name: 'Tune-up', why: 'not filled in yet' }] }, photoCount: 0 }))
  check('the steps are in the tech\'s order', keys(f).join() === 'on_my_way,arrived,checklist,photos,signature,complete', keys(f))
  check('a new job: on my way is next', f.next === 'on_my_way' && stateOf(f, 'on_my_way') === 'next')
}
{
  const f = buildFlow(base({ status: 'dispatched' }))
  check('on my way done → arrived is next', stateOf(f, 'on_my_way') === 'done' && f.next === 'arrived')
}
{
  const input = base({ queue: [q('/dispatch')] })
  const f = buildFlow(input)
  check('on my way sent while offline shows WAITING, not done', stateOf(f, 'on_my_way') === 'waiting')
  check('…and the job will be dispatched once sent', effectiveStatus(input) === 'dispatched')
  check('…and the next thing the tech can do is "arrived"', f.next === 'arrived')
}
{
  const input = base({ queue: [q('/dispatch'), q('/start')] })
  check('two moves waiting: the status is the later one', effectiveStatus(input) === 'in_progress')
  const f = buildFlow(input)
  check('both show waiting', stateOf(f, 'on_my_way') === 'waiting' && stateOf(f, 'arrived') === 'waiting')
}
{
  const input = base({ queue: [q('/start', 'failed', { refusal: { status: 409, message: 'This job is cancelled, so it cannot be started.' } })] })
  const f = buildFlow(input)
  check('a refused move says why, in the server\'s words', stateOf(f, 'arrived') === 'failed' && f.steps.find((s) => s.key === 'arrived')?.note === 'This job is cancelled, so it cannot be started.')
  check('a refused move does not change the status', effectiveStatus(input) === 'scheduled')
  check('a refused step is where the tech is stopped', f.next === 'on_my_way' || f.next === 'arrived')
}
{
  const lists = { templates: [sig], outstanding: [{ templateId: 't1', name: 'Tune-up', why: 'not filled in yet' }] }
  const f = buildFlow(base({ status: 'in_progress', checklists: lists, photoCount: 0 }))
  check('arrived → the checklist is next', f.next === 'checklist')
  check('Complete is held back while a checklist is owed', f.completeBlockedBy !== null && f.completeBlockedBy.includes('Tune-up'), f.completeBlockedBy)
}
{
  // Same rule as the server's completion gate: a checklist of only optional questions is offered, not demanded.
  const lists = { templates: [sig], outstanding: [{ templateId: 't1', name: 'Extras', why: 'not filled in yet', required: false }] }
  const f = buildFlow(base({ status: 'in_progress', checklists: lists, photoCount: 1 }))
  check('an optional-only checklist does not hold Complete back', f.completeBlockedBy === null)
  const must = buildFlow(base({ status: 'in_progress', checklists: { templates: [sig], outstanding: [{ templateId: 't1', name: 'Safety', why: 'not filled in yet', required: true }, { templateId: 't2', name: 'Extras', why: 'not filled in yet', required: false }] }, photoCount: 1 }))
  check('a required one does, and only it is named', must.completeBlockedBy === 'Safety not filled in yet', must.completeBlockedBy)
}
{
  const lists = { templates: [sig], outstanding: [{ templateId: 't1', name: 'Tune-up', why: 'needs the customer to sign', submissionId: 's1' }] }
  const f = buildFlow(base({ status: 'in_progress', checklists: lists, photoCount: 2 }))
  check('a filled-in checklist waiting for the signature: checklist done, signature next', stateOf(f, 'checklist') === 'done' && f.next === 'signature')
  check('…and photos show how many', f.steps.find((s) => s.key === 'photos')?.note === '2 on the job')
}
{
  const lists = { templates: [sig], outstanding: [] }
  const f = buildFlow(base({ status: 'in_progress', checklists: lists, photoCount: 1 }))
  check('everything done: Complete is next and nothing blocks it', f.next === 'complete' && f.completeBlockedBy === null)
  const done = buildFlow(base({ status: 'completed', checklists: lists, photoCount: 1 }))
  check('a completed job: nothing is next', done.next === null && done.steps.every((s) => s.state === 'done'))
  const sent = buildFlow(base({ status: 'in_progress', checklists: lists, photoCount: 1, queue: [q('/complete')] }))
  check('Complete sent while offline shows WAITING', stateOf(sent, 'complete') === 'waiting' && effectiveStatus(base({ status: 'in_progress', queue: [q('/complete')] })) === 'completed')
}
{
  const f = buildFlow(base({ status: 'in_progress' }))
  check('a business without checklists or photo counts has only the three job moves', keys(f).join() === 'on_my_way,arrived,complete', keys(f))
  const noSig = buildFlow(base({ checklists: { templates: [{ ...sig, requireSignature: false }], outstanding: [] } }))
  check('no checklist asks for a signature → no signature step', !keys(noSig).includes('signature'))
  const other = buildFlow(base({ queue: [{ method: 'POST', path: `/api/jobs/other/dispatch`, state: 'waiting', recordKey: 'job:other' } as any] }))
  check('another job\'s waiting move is not this job\'s', stateOf(other, 'on_my_way') === 'next')
}

// The waiting list's words.
const item = (over: any) => ({ id: 'i1', method: 'POST', path: '/api/x', body: {}, recordKey: 'k', label: undefined, tries: 0, serverErrors: 0, nextAttemptAt: 0, state: 'waiting', blocked: false, ...over }) as any
{
  const w = describeItem(item({ path: `/api/jobs/${ID}/dispatch`, recordKey: jobKey(ID) }))
  check('a waiting save says "Waiting to send" and is named in the tech\'s words', w.headline === 'Waiting to send' && w.title === 'On my way' && !w.failed)
  const f = describeItem(item({ state: 'failed', path: '/api/checklists/job/job1/submit', recordKey: jobKey(ID), refusal: { status: 400, message: 'Answer "Filter changed" first.' } }))
  check('a refused save says "Couldn\'t send — tap to fix" with the server\'s words', f.headline === "Couldn't send — tap to fix" && f.detail === 'Answer "Filter changed" first.' && f.failed && f.title === 'Checklist')
  check('…and tapping it opens the job', f.open === '/(details)/job/job1')
  check('a save with no screen to open leaves it to Try again / Discard', describeItem(item({ state: 'failed', recordKey: 'odd', refusal: { status: 400, message: 'No' } })).open === null)
  check('a save behind a refused one says so', describeItem(item({ blocked: true })).headline === 'Waiting for the one before it')
  check('a label wins over the guess', describeItem(item({ label: 'J-12 · arrived' })).title === 'J-12 · arrived')
  check('the list puts refused saves first', orderForList([item({ id: 'a' }), item({ id: 'b', state: 'failed' }), item({ id: 'c' })]).map((x) => x.id).join() === 'b,a,c')
  check('only a job\'s saves lead to a job', openFor({ recordKey: 'job:abc', path: '/x' }) === '/(details)/job/abc' && openFor({ recordKey: 'quote:abc', path: '/x' }) === null)
}

// The trades' Clock screen.
{
  const U = 'u1'
  const tap = (path: string, at: string, state: any = 'waiting', extra: any = {}) => ({ id: path + at, method: 'POST', path, state, recordKey: clockKey(U), body: { at }, ...extra }) as any
  const open = { clockIn: '2026-11-02T13:00:00.000Z' }
  check('no clock open, nothing waiting: clock in is offered', (() => { const v = clockView(null, [], U); return v.state === 'out' && v.canClockIn && !v.canClockOut && !v.waiting })())
  check('the server\'s open clock: clock out is offered, since is the server\'s time', (() => { const v = clockView(open, [], U); return v.state === 'in' && v.canClockOut && v.since === open.clockIn && !v.waiting })())
  const offline = clockView(null, [tap('/api/time/clock-in', '2026-11-02T13:02:00.000Z')], U)
  check('a clock-in tapped with no signal shows as clocked in, WAITING, from the moment tapped', offline.state === 'in_waiting' && offline.waiting && offline.since === '2026-11-02T13:02:00.000Z' && offline.canClockOut)
  const both = clockView(null, [tap('/api/time/clock-in', '2026-11-02T13:02:00.000Z'), tap('/api/time/clock-out', '2026-11-02T17:30:00.000Z')], U)
  check('clocked in and out while offline: closed, both waiting', both.state === 'out_waiting' && both.canClockIn && !both.canClockOut)
  const outOnly = clockView(open, [tap('/api/time/clock-out', '2026-11-02T17:30:00.000Z')], U)
  check('an open clock with a clock-out waiting is closed for now', outOnly.state === 'out_waiting' && outOnly.waiting)
  const again = clockView(null, [tap('/api/time/clock-in', '2026-11-02T13:00:00.000Z'), tap('/api/time/clock-out', '2026-11-02T14:00:00.000Z'), tap('/api/time/clock-in', '2026-11-02T15:00:00.000Z')], U)
  check('in, out, in again while offline: clocked in from the last tap', again.state === 'in_waiting' && again.since === '2026-11-02T15:00:00.000Z')
  const refused = clockView(null, [tap('/api/time/clock-in', '2026-11-02T13:02:00.000Z', 'failed', { refusal: { status: 400, message: 'That time is more than 48 hours ago \u2014 ask the office to enter it' } })], U)
  check('a refused clock tap says why and does not count as a clock', refused.state === 'out' && refused.refused?.message.includes('48 hours') && refused.canClockIn)
  check('another person\'s waiting taps are not mine', clockView(null, [{ ...tap('/api/time/clock-in', '2026-11-02T13:02:00.000Z'), recordKey: clockKey('u2') }], U).state === 'out')
  // Breaks.
  const brk = (kind: 'start' | 'end', at: string, state: any = 'waiting') => tap(`/api/time/break/${kind}`, at, state)
  check('clocked in, no break: Start break is offered, End is not', (() => { const v = clockView(open, [], U); return v.canStartBreak && !v.canEndBreak && !v.onBreak })())
  check('the server says a break is running: End break is offered, since is the server\'s time', (() => { const v = clockView({ ...open, breakStartedAt: '2026-11-02T15:00:00.000Z' }, [], U); return v.onBreak && v.breakSince === '2026-11-02T15:00:00.000Z' && v.canEndBreak && !v.canStartBreak })())
  check('a break tapped with no signal shows as a break, from the moment tapped', (() => { const v = clockView(open, [brk('start', '2026-11-02T15:05:00.000Z')], U); return v.onBreak && v.breakSince === '2026-11-02T15:05:00.000Z' && v.canEndBreak })())
  check('…and ending it while still offline closes it', (() => { const v = clockView(open, [brk('start', '2026-11-02T15:05:00.000Z'), brk('end', '2026-11-02T15:35:00.000Z')], U); return !v.onBreak && v.canStartBreak && v.breakSince === null })())
  check('a break ended on the phone beats the server\'s older word that it is running', (() => { const v = clockView({ ...open, breakStartedAt: '2026-11-02T15:00:00.000Z' }, [brk('end', '2026-11-02T15:30:00.000Z')], U); return !v.onBreak && v.canStartBreak })())
  check('no clock, no break offered', (() => { const v = clockView(null, [], U); return !v.canStartBreak && !v.canEndBreak })())
  check('a closed clock is not on a break', (() => { const v = clockView(open, [brk('start', '2026-11-02T15:05:00.000Z'), tap('/api/time/clock-out', '2026-11-02T17:30:00.000Z')], U); return !v.onBreak && !v.canStartBreak })())
  check('a refused break tap does not count', (() => { const v = clockView(open, [brk('start', '2026-11-02T15:05:00.000Z', 'failed')], U); return !v.onBreak && v.canStartBreak })())
  // The place stamp.
  check('a fix becomes the place the server reads', JSON.stringify(placeBody({ latitude: 43.07, longitude: -89.4 })) === JSON.stringify({ place: { lat: 43.07, lng: -89.4 } }))
  check('the equator and the meridian are real places', JSON.stringify(placeBody({ latitude: 0, longitude: 0 })) === JSON.stringify({ place: { lat: 0, lng: 0 } }))
  check('no fix, half a fix or an impossible one leaves the place off (a tap is never refused over it)', Object.keys(placeBody(null)).length === 0 && Object.keys(placeBody({ latitude: 43 })).length === 0 && Object.keys(placeBody({ latitude: 143, longitude: 0 })).length === 0 && Object.keys(placeBody({ latitude: 'x', longitude: 1 })).length === 0)
  check('a tap carries the moment it was made', tapBody(new Date('2026-11-02T13:02:00.000Z'), { jobId: 'j1' }).at === '2026-11-02T13:02:00.000Z' && (tapBody(new Date(0), { jobId: 'j1' }) as any).jobId === 'j1')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
