// Canvassing with no signal on the phone (docs/parity/roof-canvass-offline.md): the Canvass screen's requests
// (apps/mobile/src/canvass/offlineCanvass.ts) through the REAL offline queue (src/offline/engine.ts) and its photo step
// (src/offline/localPhotos.ts), with a scripted network and a scripted camera roll. What it proves:
//   · started, knocked and ended with no signal, it is all kept, and goes the moment signal returns — the session first,
//     the doors in the order knocked, the end last — with the phone's own times and the phone-made session id in every path;
//   · a door's photos are uploaded just before it is sent, from their files, and the door goes with their addresses; a
//     photo whose file is gone is left off and the door's notes say so; a lost reply re-sends the same names (same files);
//   · a door the server refuses is kept as failed, with its words, and the end waits behind it; nothing is dropped;
//   · one person's waiting canvass is never sent as another's.
//
//   bun run tests/mobile/offline-canvass.test.ts
import { createEngine, type KV, type Sender } from '../../apps/mobile/src/offline/engine.ts'
import { withUploadedPhotos, type FileExists, type UploadPhoto } from '../../apps/mobile/src/offline/localPhotos.ts'
import { canvassKey, doorRequest, endRequest, newSessionId, startRequest } from '../../apps/mobile/src/canvass/offlineCanvass.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

function world() {
  let t = Date.parse('2026-10-31T15:00:00Z')
  const data = new Map<string, string>()
  const kv: KV = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v) } }
  const files = new Set<string>()
  const uploads: Array<{ path: string; name: string; uri: string }> = []
  const sent: Array<{ path: string; body: any; key: string }> = []
  let online = false
  let uploadReplies: Array<{ status: number; data?: any }> = []
  const refuse = new Map<string, { status: number; data?: any }>()
  const exists: FileExists = async (uri) => files.has(uri)
  const upload: UploadPhoto = async (path, name, uri) => {
    if (!online) return { status: 0 }
    uploads.push({ path, name, uri })
    return uploadReplies.shift() ?? { status: 201, data: { url: `/media/photos/co/canvass/${name}.jpg` } }
  }
  // The phone's sender as OfflineQueue.ts builds it: photos first, then the save.
  const send: Sender = async ({ id, path, body }) => {
    if (!online) return { status: 0 }
    const prepared = await withUploadedPhotos(id, body, exists, upload)
    if ('status' in prepared) return prepared
    const r = refuse.get(path)
    sent.push({ path, body: prepared.body, key: id })
    return r ?? { status: 201, data: { ok: true } }
  }
  let n = 0
  const engine = createEngine({ kv, send, now: () => t, random: () => 0.5, newId: () => `save${++n}`, setTimer: () => () => {} })
  return { engine, files, uploads, sent, refuse, setUploadReplies: (r: typeof uploadReplies) => { uploadReplies = r }, goOnline: () => { online = true; engine.setOnline(true) }, goOffline: () => { online = false; engine.setOnline(false) }, advance: (ms: number) => { t += ms } }
}

async function main() {
  console.log('a session canvassed with no signal')
  {
    const w = world()
    await w.engine.load('rep1')
    w.goOffline()
    const sid = newSessionId()
    check('the session id is one the server takes', /^[A-Za-z0-9_-]{16,64}$/.test(sid), sid)
    const at = (h: number) => new Date(Date.parse('2026-10-31T12:00:00Z') + h * 3600_000)
    const start = await w.engine.submit(startRequest(sid, 'Elm St', at(0), { latitude: 44.8, longitude: -91.5 }))
    w.files.add('file:///cam/1.jpg'); w.files.add('file:///cam/2.jpg')
    const d1 = await w.engine.submit(doorRequest(sid, { outcome: 'interested', address: ' 12 Elm St ', phone: '715-555-0100', photoUris: ['file:///cam/1.jpg', 'file:///cam/gone.jpg', 'file:///cam/2.jpg'], notes: 'Hail on the north slope' }, at(1)))
    const d2 = await w.engine.submit(doorRequest(sid, { outcome: 'no_answer', address: '14 Elm St', lat: 44.81, lng: -91.51 }, at(2)))
    const end = await w.engine.submit(endRequest(sid, 'Elm St', at(3)))
    check('everything is kept, nothing sent', [start, d1, d2, end].every((r) => r.queued) && w.sent.length === 0)
    check('all under the session\'s record', w.engine.status().items.every((i) => i.recordKey === canvassKey(sid)))
    w.goOnline()
    await w.engine.sendNow()
    const paths = w.sent.map((s) => s.path)
    check('signal back: session, the doors in order, then the end', JSON.stringify(paths) === JSON.stringify([
      '/api/canvassing/sessions', `/api/canvassing/sessions/${sid}/stops`, `/api/canvassing/sessions/${sid}/stops`, `/api/canvassing/sessions/${sid}/end`,
    ]), paths)
    check('the session carries the phone-made id and its start time', w.sent[0].body.id === sid && w.sent[0].body.startedAt === at(0).toISOString())
    const door = w.sent[1].body
    check('the door is dated when it was knocked', door.visitedAt === at(1).toISOString() && w.sent[2].body.visitedAt === at(2).toISOString())
    check('its photos went first and it carries their addresses', JSON.stringify(door.photos) === JSON.stringify(['/media/photos/co/canvass/save2-0.jpg', '/media/photos/co/canvass/save2-2.jpg']), door.photos)
    check('the photo whose file was gone is left off, and the notes say so', /Hail on the north slope\n\(1 photo could not be sent from the phone\)/.test(door.notes), door.notes)
    check('no file addresses reach the server', !JSON.stringify(w.sent).includes('file:///') && !('$photos' in door))
    check('the address is trimmed and the end carries its time', door.address === '12 Elm St' && w.sent[3].body.endedAt === at(3).toISOString())
    check('the queue is empty', w.engine.status().items.length === 0)
  }

  console.log('a lost reply while the photos go')
  {
    const w = world()
    await w.engine.load('rep1')
    const sid = newSessionId()
    w.files.add('file:///cam/a.jpg')
    w.goOnline()
    await w.engine.submit(startRequest(sid, 'S', new Date(), null))
    w.setUploadReplies([{ status: 503 }])
    const r = await w.engine.submit(doorRequest(sid, { outcome: 'no_answer', address: '1 Oak', photoUris: ['file:///cam/a.jpg'] }, new Date()))
    check('the door waits (the upload had no good answer)', r.queued === true && w.sent.length === 1)
    w.advance(60_000)
    await w.engine.sendNow()
    check('then goes, its photo uploaded again under the same name', w.sent.length === 2 && w.uploads.length === 2 && w.uploads[0].name === w.uploads[1].name, w.uploads)
  }

  console.log('a door the server refuses')
  {
    const w = world()
    await w.engine.load('rep1')
    w.goOffline()
    const sid = newSessionId()
    await w.engine.submit(startRequest(sid, 'S', new Date(), null))
    await w.engine.submit(doorRequest(sid, { outcome: 'interested', address: '9 Pine', email: 'not-an-email' }, new Date()))
    await w.engine.submit(endRequest(sid, 'S', new Date()))
    w.refuse.set(`/api/canvassing/sessions/${sid}/stops`, { status: 400, data: { error: 'The email does not look right — check it or leave it blank.' } })
    w.goOnline()
    await w.engine.sendNow()
    const items = w.engine.status().items
    const door = items.find((i) => i.path.endsWith('/stops'))
    check('it is kept as failed, with the server\'s words', door?.state === 'failed' && /email does not look right/.test(door?.refusal?.message || ''), door)
    check('the end waits behind it; nothing is dropped', items.length === 2 && items.find((i) => i.path.endsWith('/end'))?.blocked === true, items.map((i) => [i.path, i.state, i.blocked]))
  }

  console.log("someone else's canvass")
  {
    const w = world()
    await w.engine.load('rep1')
    w.goOffline()
    const sid = newSessionId()
    await w.engine.submit(startRequest(sid, 'S', new Date(), null))
    await w.engine.load('rep2')
    w.goOnline()
    await w.engine.sendNow()
    check('rep2 signed in: rep1\'s waiting session is not sent and not shown', w.sent.length === 0 && w.engine.status().items.length === 0)
    await w.engine.load('rep1')
    await w.engine.sendNow()
    check('rep1 back: it goes', w.sent.length === 1 && w.sent[0].body.id === sid)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}
main()
