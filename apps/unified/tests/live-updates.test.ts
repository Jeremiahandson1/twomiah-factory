// Live updates over a real WebSocket on a real Bun.serve, composed as server/index.ts composes it (http/live.ts):
// a one-time ticket from the signed-in API, the socket opened with it, and a change made through the API arriving.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let server: ReturnType<typeof Bun.serve>
let token = ''
let base = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts'] }).where(eq(t.schema.company.id, s.company.id))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json()).accessToken
  server = Bun.serve({ port: 0, fetch: t.app.fetch, websocket: t.services.live.websocket })
  base = `http://localhost:${server.port}`
})
afterAll(() => server?.stop(true))

const ticket = async (auth = true) => fetch(`${base}/api/live/ticket`, { method: 'POST', headers: auth ? { Authorization: `Bearer ${token}` } : {} })

/** Opens the socket and resolves with it once open, collecting every message. */
function open(tk: string): Promise<{ ws: WebSocket; got: any[] }> {
  return new Promise((resolve, reject) => {
    const got: any[] = []
    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/live-socket?ticket=${encodeURIComponent(tk)}`)
    ws.onmessage = (m) => got.push(JSON.parse(String(m.data)))
    ws.onopen = () => resolve({ ws, got })
    ws.onerror = () => reject(new Error('socket refused'))
  })
}
const until = async (f: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await Bun.sleep(20); return f() }

describe('live updates', () => {
  test('no sign-in, no ticket', async () => {
    expect((await ticket(false)).status).toBe(401)
  })

  test('no ticket, or a made-up one: the socket is refused', async () => {
    expect((await fetch(`${base}/api/live-socket`)).status).toBe(401)
    expect((await fetch(`${base}/api/live-socket?ticket=nope`)).status).toBe(401)
  })

  test('a change made through the API reaches the open socket', async () => {
    const r = await ticket()
    expect(r.status).toBe(200)
    const { ticket: tk, path } = await r.json()
    expect(path).toBe('/api/live-socket')
    const { ws, got } = await open(tk)
    const made = await t.call('/api/contacts', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, json: { name: 'Live Update Person', type: 'client' } })
    expect(made.status).toBe(201)
    const id = (await made.json()).id
    expect(await until(() => got.some((m) => m.event === 'contact:created' && m.data?.id === id))).toBe(true)
    ws.close()
  })

  test('a ticket is used once', async () => {
    const { ticket: tk } = await (await ticket()).json()
    const first = await open(tk)
    first.ws.close()
    expect((await fetch(`${base}/api/live-socket?ticket=${encodeURIComponent(tk)}`)).status).toBe(401)
  })

  test("one person's event reaches only that person", async () => {
    const mine = await open((await (await ticket()).json()).ticket)
    const co = await t.services.companyId()
    t.services.realtime.emitToUser(co!, 'someone-else', 'alert:created', { n: 1 })
    t.services.realtime.emitToCompany(co!, 'data:refresh', { entity: 'jobs' })
    expect(await until(() => mine.got.some((m) => m.event === 'data:refresh'))).toBe(true)
    expect(mine.got.some((m) => m.event === 'alert:created')).toBe(false)
    mine.ws.close()
  })

  test("another company's events never arrive", async () => {
    const mine = await open((await (await ticket()).json()).ticket)
    t.services.realtime.emitToCompany('another-company', 'contact:created', { id: 'x' })
    t.services.realtime.emitToCompany((await t.services.companyId())!, 'data:refresh', { entity: 'marker' })
    expect(await until(() => mine.got.some((m) => m.data?.entity === 'marker'))).toBe(true)
    expect(mine.got.some((m) => m.data?.id === 'x')).toBe(false)
    mine.ws.close()
  })
})
