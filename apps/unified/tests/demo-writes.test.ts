// The demo's in-browser writes against the REAL server. The demo answers a few changes itself (add a contact, move a quote to
// "sent"…); each of those must do what the real server does — same status code, same record shape, same status word — or a
// visitor sees something the product never does. And the store: a change lives in memory and `reset` takes all of it away.
//
//   cd apps/unified && bun test --timeout 240000 tests/demo-writes.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test, expect, beforeAll } from 'bun:test'
import { DEMO_TRADES, tradeById } from '../demo/trades.ts'
import { DATA_DIR } from '../demo/record.ts'
import { bootDemoTenant, type Kit } from '../demo/seed/kit.ts'
import seedContractor from '../demo/seed/contractor.ts'
import { ACTION_STATUS, handle, NOT_SENT, unavailable } from '../web/demo/router.ts'
import { DemoStore, type DemoData } from '../web/demo/store.ts'
import { shapeOf } from '../demo/drift.ts'

const trade = tradeById('contractor')!
const recorded = (id: string): DemoData => JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${id}.json`), 'utf8'))
const demo = (store: DemoStore, method: string, p: string, body?: unknown) => handle(store, { method, url: new URL(p, 'http://demo.local'), body }, () => {})
const fields = (body: unknown) => [...shapeOf(body).keys()].filter((k) => !k.includes('[]') && k.split('.').length === 2).sort()

let kit: Kit
beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-writes-'))
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body></body></html>')
  kit = await bootDemoTenant(trade, dir)
  await seedContractor(kit)
}, 240_000)

describe('adding a record: what the real server answers', () => {
  const cases: Array<[string, () => Record<string, unknown>]> = [
    ['/api/contacts', () => ({ type: 'client', name: 'Pat Example', email: 'pat@example.com' })],
    ['/api/projects', () => ({ name: 'Example project', status: 'planning' })],
  ]
  for (const [route, body] of cases) {
    test(`POST ${route}: 201 and the same fields`, async () => {
      const real = await kit.t.call(route, { method: 'POST', headers: kit.headers, json: body() })
      const realBody = await real.json()
      const store = new DemoStore(recorded('contractor'))
      const made = demo(store, 'POST', route, body())
      expect(made.status).toBe(real.status)
      const missing = fields(realBody).filter((f) => !fields(made.body).includes(f))
      expect(missing, `the demo's new ${route} record lacks ${missing.join(', ')}`).toEqual([])
    })
  }
})

describe('a status move: the real server and the demo land on the same word', () => {
  const rows: Record<string, () => Promise<{ id: string }>> = {
    '/api/quotes': async () => (await kit.get('/api/quotes?limit=100')).data.find((q: any) => q.status === 'draft'),
    '/api/invoices': async () => (await kit.get('/api/invoices?limit=100')).data.find((q: any) => q.status === 'draft'),
    '/api/jobs': async () => (await kit.get('/api/jobs?limit=100')).data.find((j: any) => j.status === 'scheduled'),
  }
  for (const [collection, actions] of Object.entries(ACTION_STATUS)) {
    for (const [action, status] of Object.entries(actions)) {
      if (!rows[collection]) continue
      test(`${collection}/:id/${action} → ${status}`, async () => {
        const row = await rows[collection]()
        if (!row) return // this seed has no row in the state the action starts from
        const real = await kit.t.call(`${collection}/${row.id}/${action}`, { method: 'POST', headers: kit.headers, json: {} })
        expect(real.status).toBeLessThan(300)
        const after = await kit.get(`${collection}/${row.id}`)
        expect(after.status, 'the real server moved the row to a different word').toBe(status)
      })
    }
  }
})

describe('what is not made', () => {
  test('sending a quote says it was not sent, moves its status, and answers success', () => {
    const data = recorded('contractor')
    const store = new DemoStore(data)
    const seen: string[] = []
    store.notify = (m) => seen.push(m)
    const quote = (demo(store, 'GET', '/api/quotes?limit=100').body as any).data.find((q: any) => q.status === 'draft')
    const r = demo(store, 'POST', `/api/quotes/${quote.id}/send`)
    expect(r.status).toBe(200)
    expect(seen).toEqual([NOT_SENT])
    expect((demo(store, 'GET', `/api/quotes/${quote.id}`).body as any).status).toBe('sent')
  })
  test('a text, a card, a connection and an invite do nothing but say so', () => {
    const store = new DemoStore(recorded('contractor'))
    const seen: string[] = []
    store.notify = (m) => seen.push(m)
    for (const [m, p] of [['POST', '/api/messages/send'], ['POST', '/api/stripe/connect'], ['POST', '/api/integrations/quickbooks/connect'], ['POST', '/api/company/users'], ['POST', '/api/domains/buy'], ['POST', '/api/invoices/abc/send-reminder']]) {
      const r = demo(store, m, p, {})
      expect(r.status, `${m} ${p}`).toBe(200)
    }
    expect(seen.length).toBe(6)
    expect(seen.every((s) => s === NOT_SENT)).toBe(true)
  })
  test('a route the demo does not support answers a clean "not available", never a crash', () => {
    const store = new DemoStore(recorded('contractor'))
    expect(demo(store, 'GET', '/api/nothing-like-this')).toEqual(unavailable(false))
    expect(demo(store, 'POST', '/api/nothing-like-this', {})).toEqual(unavailable(true))
    expect(unavailable(false).status).toBe(404)
    expect(unavailable(true).status).toBe(501)
  })
})

describe('changes live in memory and reset takes them all', () => {
  for (const t of DEMO_TRADES) {
    test(`${t.label}: add, edit, delete, then reset → exactly the recorded answers`, () => {
      const file = path.join(DATA_DIR, `${t.id}.json`)
      if (!fs.existsSync(file)) return // checked by tests/demo-drift.test.ts
      const data = recorded(t.id)
      const store = new DemoStore(data)
      const lists = Object.entries(data.responses).filter(([k, r]) => /^GET \/api\/[a-z-]+\?/.test(k) && r.status === 200 && Array.isArray((r.body as any)?.data) && (r.body as any).data.length)
      expect(lists.length).toBeGreaterThan(0)
      const before = lists.map(([k]) => k)
      const snapshot = lists.map(([k]) => JSON.stringify(demo(store, 'GET', k.slice(4)).body))
      const [key, first] = lists[0]
      const p = key.slice(4).split('?')[0]
      const row = (first.body as any).data[0]
      demo(store, 'POST', p, { name: 'Added in the demo', title: 'Added in the demo' })
      demo(store, 'PUT', `${p}/${row.id}`, { notes: 'edited' })
      demo(store, 'DELETE', `${p}/${row.id}`)
      expect(JSON.stringify(demo(store, 'GET', key.slice(4)).body)).not.toBe(snapshot[0])
      store.reset()
      expect(before.map((k) => JSON.stringify(demo(store, 'GET', k.slice(4)).body))).toEqual(snapshot)
    })
  }
})
