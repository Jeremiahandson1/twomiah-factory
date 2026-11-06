// Twomiah Care, row 16 (care_offline_saves): documenting a whole visit with no signal, run under plain bun.
//   · saves on a visit whose clock-in is still on the phone are HELD, then handed to the offline queue with the real visit id —
//     in the path, the body and the record key — once the clock-in has gone through, oldest first, per person;
//   · "Ready for no signal" says when today's visits were last kept on the phone;
//   · the screens send tasks, doses, vitals and photos through the held/queued path and read from the kept copies.
//
//   bun run tests/mobile/care-offline-visit.test.ts
import { createVisitHold, rewriteHeld, type HeldRequest } from '../../apps/mobile/src/care/visitHold.ts'
import { readyText } from '../../apps/mobile/src/care/rules.ts'
import { readFileSync } from 'fs'
import { join } from 'path'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const memKV = () => { const m = new Map<string, string>(); return { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v) } } }

const V = 'offline-abc123'
const task: HeldRequest = { method: 'PUT', path: `/api/care-tasks/time-entry/${V}/task-1`, body: { status: 'completed', savedAt: '2026-11-06T15:00:00.000Z' }, recordKey: `visit:${V}`, label: 'Make lunch · completed' }
const dose: HeldRequest = { method: 'POST', path: '/api/medications/log', body: { medicationId: 'm1', clientId: 'c1', timeEntryId: V, status: 'given' }, recordKey: `visit:${V}`, label: 'Vitamin D · given' }

check('rewrite: the real id replaces the phone-made one in the path, the body and the record key',
  JSON.stringify(rewriteHeld({ ...task, id: 'h', userId: 'u', visitId: V, heldAt: '' }, 'te-9')) === JSON.stringify({ method: 'PUT', path: '/api/care-tasks/time-entry/te-9/task-1', body: { status: 'completed', savedAt: '2026-11-06T15:00:00.000Z' }, recordKey: 'visit:te-9', label: 'Make lunch · completed' }))
check('rewrite: a dose names the real visit in its body', (rewriteHeld({ ...dose, id: 'h', userId: 'u', visitId: V, heldAt: '' }, 'te-9').body as any).timeEntryId === 'te-9')

{
  const hold = createVisitHold(memKV())
  let refused = false
  try { await hold.hold('ann', 'te-real', task) } catch { refused = true }
  check('only a visit with a phone-made id is held', refused)
  await hold.hold('ann', V, task)
  await hold.hold('ann', V, dose)
  await hold.hold('bea', 'offline-zzz', task)
  check('held saves are counted per person', (await hold.count('ann')) === 2 && (await hold.count('bea')) === 1)
  const sent: HeldRequest[] = []
  const send = async (r: HeldRequest) => { sent.push(r) }
  check('nothing goes while the clock-in is still on the phone', (await hold.release('ann', async () => null, send)) === 0 && sent.length === 0)
  const n = await hold.release('ann', async (local) => (local === 'abc123' ? 'te-9' : null), send)
  check('once it has gone through, both go, oldest first, with the real id', n === 2 && sent.map((x) => x.path).join('|') === '/api/care-tasks/time-entry/te-9/task-1|/api/medications/log')
  check('released saves are forgotten; another person\'s stay held', (await hold.count('ann')) === 0 && (await hold.count('bea')) === 1)
  // a hand-over that fails keeps that save AND the ones behind it, in order
  const h2 = createVisitHold(memKV())
  await h2.hold('ann', V, task); await h2.hold('ann', V, dose)
  let first = true
  const flaky = async (r: HeldRequest) => { if (first) { first = false; throw new Error('disk full') } sent.push(r) }
  check('a save that could not be handed over stays, and the next does not jump ahead of it', (await h2.release('ann', async () => 'te-9', flaky)) === 0 && (await h2.count('ann')) === 2)
  await h2.drop('ann', V)
  check('dropping a visit forgets what was held for it', (await h2.count('ann')) === 0)
}

const now = new Date('2026-11-06T15:00:00Z')
check('ready: never downloaded', readyText(null, now).startsWith('Not downloaded yet'))
check('ready: minutes', readyText('2026-11-06T14:20:00Z', now) === 'Downloaded 40 min ago — tap to refresh')
check('ready: after 12 hours it asks to download again (AlayaCare: downloaded data expires)', readyText('2026-11-06T01:00:00Z', now) === 'Downloaded 14 h ago — tap to download again')

const root = join(import.meta.dir, '../../apps/mobile')
const parts = readFileSync(join(root, 'src/care/components/VisitParts.tsx'), 'utf8')
const ctx = readFileSync(join(root, 'src/care/CareContext.tsx'), 'utf8')
const more = readFileSync(join(root, 'app/(tabs)/more-homecare.tsx'), 'utf8')
check('tasks, doses and vitals save through saveForVisit (held or queued)', (parts.match(/care\.saveForVisit\(timeEntryId/g) || []).length === 3)
check('the visit reads come from the copies kept on the phone', (parts.match(/getSaved\(/g) || []).length >= 4)
check('an offline visit\'s checklist is the client\'s own task list', parts.includes('/api/care-tasks/client/${clientId}'))
check('photos go as files through the queue: uploaded to /photos/file, recorded at /photos/saved', ctx.includes('/photos/file') && ctx.includes('/photos/saved') && ctx.includes('$photos'))
check('held saves are released after saved punches go through, and when the visit gets its real id', (ctx.match(/releaseHeld\(\)/g) || []).length >= 3)
check('More offers the waiting list and says what is still on the phone at sign-out', more.includes("'/(details)/waiting'") && more.includes('still on this phone and not sent'))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
