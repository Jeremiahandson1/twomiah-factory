// Landscaping parity row 9: before- and after-photos on the crew's visit, kept on the phone with no signal, drawn on.
//   · a photo's save carries its kind (before / after) through the offline queue, and the strip can say which a waiting photo is;
//   · with no signal nothing is sent; with signal the file goes up, then the save with its kind;
//   · the visit offers "Photos — before and after" where the business has job photos, and the older after-photo form only where
//     it has not (a section another switch replaces), and the new screen is registered.
// Fails without the change: jobPhotoRequest took no kind, the strip knew none, and the visit had only the after-photo form.
//
//   bun run tests/mobile/landscaping-visit-photos.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { jobPhotoRequest, pendingJobPhotos } from '../../apps/mobile/src/jobflow/jobPhotos.ts'
import { LANDSCAPING } from '../../apps/mobile/src/trades/landscaping.ts'
import { createEngine, type KV, type Sender } from '../../apps/mobile/src/offline/engine.ts'
import { withUploadedPhotos, type FileExists, type UploadPhoto } from '../../apps/mobile/src/offline/localPhotos.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const app = path.resolve(import.meta.dir, '../../apps/mobile')

console.log('the save')
{
  const b = jobPhotoRequest('j1', ['file:///a.jpg'], 'Before photo', 'before')
  check('a before photo\'s save says so', b.body.kind === 'before' && b.path === '/api/jobs/j1/photos/saved')
  check('…and keeps the file on the phone until it is sent', b.body.$photos.uris[0] === 'file:///a.jpg' && b.body.$photos.uploadTo === '/api/jobs/j1/photos/file')
  check('a photo with no kind is as before (no kind sent)', !('kind' in jobPhotoRequest('j1', ['file:///a.jpg'], 'Job photo').body))
  const queue = [{ id: 'q1', method: 'POST', path: '/api/jobs/j1/photos/saved', state: 'waiting', body: b.body }, { id: 'q2', method: 'POST', path: '/api/jobs/j1/photos/saved', state: 'waiting', body: jobPhotoRequest('j1', ['file:///c.jpg'], 'x').body }] as any
  const pending = pendingJobPhotos(queue, 'j1')
  check('the strip can say a waiting photo is a before photo', pending[0].kind === 'before' && pending[1].kind === undefined)
}

console.log('through the real queue')
async function queued() {
  const data = new Map<string, string>()
  const kv: KV = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v) } }
  const uploads: string[] = []
  const sent: Array<{ path: string; body: any }> = []
  let online = false
  const exists: FileExists = async () => true
  const upload: UploadPhoto = async (p, name) => { if (!online) return { status: 0 }; uploads.push(p); return { status: 201, data: { url: `/media/photos/co/j1/${name}.jpg` } } }
  const send: Sender = async ({ id, path: p, body }) => {
    if (!online) return { status: 0 }
    const prepared = await withUploadedPhotos(id, body, exists, upload)
    if ('status' in prepared) return prepared
    sent.push({ path: p, body: prepared.body })
    return { status: 201, data: { saved: 1 } }
  }
  let n = 0
  const engine = createEngine({ kv, send, now: () => 0, random: () => 0.5, newId: () => `save${++n}`, setTimer: () => () => {} })
  await engine.load('crew1'); engine.setOnline(false)
  const r = await engine.submit(jobPhotoRequest('j1', ['file:///a.jpg'], 'Before photo', 'before'))
  check('no signal: kept, nothing uploaded', r.queued && uploads.length === 0 && sent.length === 0)
  online = true; engine.setOnline(true); await engine.sendNow()
  check('with signal: the file, then the save', uploads.length === 1 && sent.length === 1 && sent[0].path === '/api/jobs/j1/photos/saved')
  check('…and the save still says before', sent[0]?.body.kind === 'before' && sent[0]?.body.photos.length === 1, sent)
}
await queued()

console.log('the visit and the screen')
{
  const route = LANDSCAPING.find((s) => s.id === 'landscaping-route')!
  const sections = route.detail!.sections
  const photos = sections.find((s) => s.feature === 'photo_capture')
  const visit = { id: 'j1', status: 'scheduled' }
  check('the visit offers before and after photos where job photos are on — before the work starts too', photos?.links?.(visit)[0]?.route === '/(details)/visit-photos?jobId=j1')
  check('…not on a cancelled visit', (photos?.links?.({ id: 'j1', status: 'cancelled' }) || []).length === 0)
  const older = sections.find((s) => s.feature === 'visit_reports' && (s.links?.({ id: 'j1', status: 'completed' }) || []).some((l) => l.route?.startsWith('/(details)/visit-photo?')))
  check('the older after-photo form is only where job photos are off', older?.unlessFeature === 'photo_capture')
  const layout = fs.readFileSync(path.join(app, 'app/(details)/_layout.tsx'), 'utf8')
  check('the screen is registered', layout.includes("'visit-photos'") && fs.existsSync(path.join(app, 'app/(details)/visit-photos.tsx')))
  const screen = fs.readFileSync(path.join(app, 'app/(details)/visit-photos.tsx'), 'utf8')
  check('…and is the job\'s own strip with the before/after choice', /<PhotoGallery[^>]*\bkinds\b/.test(screen))
  const engineFile = fs.readFileSync(path.join(app, 'src/trades/TradeDetail.tsx'), 'utf8')
  check('the detail honours a section another switch replaces', engineFile.includes('unlessFeature'))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
