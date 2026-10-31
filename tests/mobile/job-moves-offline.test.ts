// Parity item 3 (docs/parity/fieldservice-phone-job-flow.md rows 1, 4, 10, 11): the job flow with no signal.
//   · a job can be put On hold and picked up again, offline: the flow shows it, the waiting hold counts, a refused one shows its words;
//   · every move carries WHEN the tech tapped (tappedAt) so a move sent later still records the real time;
//   · a job photo taken with no signal stays a file on the phone, shows in the strip as waiting, and goes through the real queue:
//     file first (named from the save, so a retry is the same file), then the save that records it — nothing sent while offline;
//   · a job read once can be read again with no signal: the last good copy, marked as a copy, only when the read got NO ANSWER;
//     a real refusal is never hidden by an old copy; one person's copies are not another's.
//
//   bun run tests/mobile/job-moves-offline.test.ts
import { buildFlow, effectiveStatus, jobKey, moveBody, type FlowInput } from '../../apps/mobile/src/jobflow/flow.ts'
import { jobPhotoRequest, pendingJobPhotos, photosKey } from '../../apps/mobile/src/jobflow/jobPhotos.ts'
import { createEngine, type KV, type Sender } from '../../apps/mobile/src/offline/engine.ts'
import { withUploadedPhotos, type FileExists, type UploadPhoto } from '../../apps/mobile/src/offline/localPhotos.ts'
import { createReadCache, MAX_COPIES } from '../../apps/mobile/src/offline/readCache.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const ID = 'job1'
const q = (suffix: string, state: 'waiting' | 'sending' | 'failed' = 'waiting', extra: any = {}) =>
  ({ method: 'POST', path: `/api/jobs/${ID}${suffix}`, state, recordKey: jobKey(ID), ...extra }) as any
const base = (over: Partial<FlowInput> = {}): FlowInput => ({ jobId: ID, status: 'scheduled', queue: [], checklists: null, photoCount: null, ...over })
const stateOf = (f: ReturnType<typeof buildFlow>, k: string) => f.steps.find((s) => s.key === k)?.state

console.log('on hold')
{
  const f = buildFlow(base({ status: 'in_progress' }))
  check('a job being worked can be put on hold', f.canHold === true)
  check('a finished job cannot', buildFlow(base({ status: 'completed' })).canHold === false)
}
{
  const input = base({ status: 'in_progress', queue: [q('/hold')] })
  const f = buildFlow(input)
  check('a hold waiting to be sent: the job WILL be on hold, shown as waiting', effectiveStatus(input) === 'on_hold' && stateOf(f, 'on_hold') === 'waiting')
  check('…and the hold button is not offered twice', f.canHold === false)
}
{
  const f = buildFlow(base({ status: 'on_hold', startedAt: '2026-10-31T14:00:00Z' }))
  check('a job on hold: the one step is to resume it', f.next === 'on_hold' && f.steps[0].key === 'on_hold' && f.steps[0].state === 'next')
  check('…arrival already done stays done', stateOf(f, 'arrived') === 'done')
  check('a job put on hold before it was started shows arrival to do', stateOf(buildFlow(base({ status: 'on_hold' })), 'arrived') === 'todo')
}
{
  const input = base({ status: 'on_hold', queue: [q('/start')] })
  check('Resume waiting to be sent: the job will be in progress', effectiveStatus(input) === 'in_progress')
  const hold = base({ status: 'in_progress', queue: [q('/hold'), q('/start')] })
  check('hold then resume, both waiting, in order: in progress again', effectiveStatus(hold) === 'in_progress')
}
{
  const f = buildFlow(base({ status: 'in_progress', queue: [q('/hold', 'failed', { refusal: { status: 409, message: 'This job is already completed, so it can\'t be put on hold now.' } })] }))
  check('a refused hold shows the server\'s words and does not change the job', stateOf(f, 'on_hold') === undefined && f.status === 'in_progress')
  const input = base({ status: 'on_hold', queue: [q('/hold', 'failed', { refusal: { status: 409, message: 'No.' } })] })
  const g = buildFlow(input)
  check('…when the server already had it on hold, a refused hold shows as failed with its words', stateOf(g, 'on_hold') === 'failed' && g.steps[0].note === 'No.')
}
check('a queued move never turns a finished job back', effectiveStatus(base({ status: 'completed', queue: [q('/hold')] })) === 'completed')

console.log('when the tech tapped')
{
  const at = new Date('2026-10-31T14:05:09.000Z')
  check('a move says when it was tapped, as a time', moveBody(at).tappedAt === '2026-10-31T14:05:09.000Z')
  check('without a time given it is now', Math.abs(Date.parse(moveBody().tappedAt) - Date.now()) < 5000)
}

console.log('job photos with no signal')
{
  const r = jobPhotoRequest('job 1', ['file:///a.jpg', 'file:///b.jpg'], 'Job photo')
  check('the save names where the files go and where they are recorded', r.path === '/api/jobs/job%201/photos/saved' && (r.body as any).$photos.uploadTo === '/api/jobs/job%201/photos/file' && (r.body as any).$photos.uris.length === 2)
  check('photos go under their own record key (they do not wait behind the job\'s moves)', r.recordKey === photosKey('job 1') && r.recordKey !== jobKey('job 1'))
  const pend = pendingJobPhotos([
    { id: 's1', method: 'POST', path: '/api/jobs/job%201/photos/saved', state: 'waiting', body: r.body } as any,
    { id: 's2', method: 'POST', path: '/api/jobs/other/photos/saved', state: 'waiting', body: jobPhotoRequest('other', ['file:///z.jpg'], 'x').body } as any,
    { id: 's3', method: 'POST', path: '/api/jobs/job%201/dispatch', state: 'waiting', body: {} } as any,
  ], 'job 1')
  check('the strip shows only this job\'s pictures still on the phone', pend.length === 2 && pend.every((p) => p.state === 'waiting') && pend[0].uri === 'file:///a.jpg')
  const refused = pendingJobPhotos([{ id: 's9', method: 'POST', path: '/api/jobs/job%201/photos/saved', state: 'failed', body: r.body, refusal: { status: 400, message: 'A photo could not be read — take it again.' } } as any], 'job 1')
  check('a refused photo shows as failed with the server\'s words', refused[0].state === 'failed' && refused[0].message?.startsWith('A photo could not be read'))
}
async function photosThroughTheQueue() {
  let t = Date.parse('2026-10-31T15:00:00Z')
  const data = new Map<string, string>()
  const kv: KV = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v) } }
  const files = new Set(['file:///a.jpg', 'file:///b.jpg'])
  const uploads: Array<{ path: string; name: string }> = []
  const sent: Array<{ path: string; body: any }> = []
  let online = false
  const exists: FileExists = async (uri) => files.has(uri)
  const upload: UploadPhoto = async (path, name) => { if (!online) return { status: 0 }; uploads.push({ path, name }); return { status: 201, data: { url: `/media/photos/co/job1/${name}.jpg` } } }
  const send: Sender = async ({ id, path, body }) => {
    if (!online) return { status: 0 }
    const prepared = await withUploadedPhotos(id, body, exists, upload)
    if ('status' in prepared) return prepared
    sent.push({ path, body: prepared.body })
    return { status: 201, data: { saved: 2 } }
  }
  let n = 0
  const engine = createEngine({ kv, send, now: () => t, random: () => 0.5, newId: () => `save${++n}`, setTimer: () => () => {} })
  await engine.load('rep1'); engine.setOnline(false)
  const queued = await engine.submit(jobPhotoRequest('job1', ['file:///a.jpg', 'file:///b.jpg'], 'Job photo'))
  check('with no signal nothing is uploaded; the photos wait on the phone', queued.queued === true && uploads.length === 0 && sent.length === 0)
  check('…and the strip can show them as waiting', pendingJobPhotos(engine.status().items as any, 'job1').length === 2)
  online = true; engine.setOnline(true); await engine.sendNow()
  check('with signal each file goes up first, then one save records them', uploads.length === 2 && uploads.every((u) => u.path === '/api/jobs/job1/photos/file') && sent.length === 1 && engine.status().items.length === 0, { uploads, sent })
  check('the save carries the uploaded addresses', sent[0].path === '/api/jobs/job1/photos/saved' && sent[0].body.photos.length === 2 && sent[0].body.photos[0].startsWith('/media/photos/co/job1/'))
  check('the names come from the save, so a retry replaces the file', new Set(uploads.map((u) => u.name)).size === 2 && uploads[0].name.startsWith('save1'))
}
await photosThroughTheQueue()

console.log('reading a job with no signal')
async function reading() {
  const data = new Map<string, string>()
  const kv = { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => { data.set(k, v) }, removeItem: async (k: string) => { data.delete(k) } }
  let clock = Date.parse('2026-10-31T15:12:00Z')
  const cache = createReadCache({ kv, now: () => clock })
  const job = { id: 'job1', title: 'Furnace' }
  const good = await cache.read('rep1', '/api/jobs/job1', async () => ({ ok: true, status: 200, data: job }))
  check('a good read is returned as it is', good.ok && good.data === job && !good.fromCache)
  const offline = await cache.read('rep1', '/api/jobs/job1', async () => { throw new Error('Network request failed') })
  check('with no signal the last good copy is returned, marked as a copy with its time', offline.ok && offline.fromCache === true && offline.data.title === 'Furnace' && offline.savedAt === '2026-10-31T15:12:00.000Z')
  const gateway = await cache.read('rep1', '/api/jobs/job1', async () => ({ ok: false, status: 503, data: null }))
  check('a gateway error is also "no answer"', gateway.ok && gateway.fromCache === true)
  const gone = await cache.read('rep1', '/api/jobs/job1', async () => ({ ok: false, status: 404, data: { error: 'Job not found' }, error: 'Job not found' }))
  check('a real refusal is never hidden by an old copy', !gone.ok && gone.status === 404 && !gone.fromCache)
  const never = await cache.read('rep1', '/api/jobs/job2', async () => { throw new Error('x') })
  check('a job never read before has nothing to show', !never.ok && never.status === 0)
  const other = await cache.read('rep2', '/api/jobs/job1', async () => { throw new Error('x') })
  check('another person on the same phone sees nothing of it', !other.ok)
  const nobody = await cache.read(null, '/api/jobs/job1', async () => ({ ok: true, status: 200, data: job }))
  check('nobody signed in: read, nothing kept', nobody.ok && ![...data.keys()].some((k) => k.includes(':null:')))
  for (let i = 0; i < MAX_COPIES + 5; i++) await cache.read('rep1', `/api/jobs/many${i}`, async () => ({ ok: true, status: 200, data: { i } }))
  check('only the most recent copies are kept', JSON.parse(data.get('twomiah_read_cache_v1:rep1:index')!).length === MAX_COPIES && !data.has('twomiah_read_cache_v1:rep1:/api/jobs/job1'))
  await cache.clear('rep1')
  check('signing out clears them', ![...data.keys()].some((k) => k.startsWith('twomiah_read_cache_v1:rep1:')))
}
await reading()

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
