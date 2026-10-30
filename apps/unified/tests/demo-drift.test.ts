// The demo's recorded data against the real server, now. Re-records every trade (a real unified server, the trade's seed, the
// screens' own reads) and compares SHAPES with what is committed in demo/public/demo-data. A server that answers differently —
// a field added or gone, a type changed, a route that now refuses — fails here until the demo's data is re-recorded:
//
//   cd apps/unified && bun run record:demo        (then commit demo/public/demo-data)
//
// Never calls anything outside the process: the server is the app on an in-memory Postgres.
import fs from 'node:fs'
import path from 'node:path'
import { describe, test, expect } from 'bun:test'
import { DEMO_TRADES } from '../demo/trades.ts'
import { DATA_DIR, readManifest, recordTrade } from '../demo/record.ts'
import { driftBetween, shapeOf, templateKey } from '../demo/drift.ts'
import type { DemoData } from '../web/demo/store.ts'

const only = (process.env.ONLY || '').split(',').filter(Boolean)

describe('the drift check itself', () => {
  test('ids and days in a request are not part of its name', () => {
    expect(templateKey('GET /api/jobs/hcs5rmaa4gfks03qct7jc5zq?from=2026-10-30&x=1')).toBe('GET /api/jobs/:id?from=:date&x=1')
  })
  test('null is a wildcard; a type change, a new field and a gone field are drift', () => {
    const base = (body: unknown): DemoData => ({ trade: 't', recordedOn: '2026-10-30', page: {} as any, responses: { 'GET /api/x': { status: 200, body } } })
    expect(driftBetween(base({ a: 1, b: null }), base({ a: 2, b: 'text' }))).toEqual([])
    expect(driftBetween(base({ a: 1 }), base({ a: '1' }))).toEqual(['GET /api/x: $.a was number, now string'])
    expect(driftBetween(base({ a: 1 }), base({ a: 1, c: true }))).toEqual(['GET /api/x: new field $.c (boolean)'])
    expect(driftBetween(base({ a: 1, c: true }), base({ a: 1 }))).toEqual(['GET /api/x: field $.c gone'])
    expect(shapeOf({ rows: [{ id: 1 }, { id: 2, note: 'x' }] }).get('$.rows[].note')).toBe('string')
  })
})

describe('the committed data is current', () => {
  for (const trade of DEMO_TRADES.filter((t) => !only.length || only.includes(t.id))) {
    test(`${trade.label}: a fresh recording has the same shapes`, async () => {
      const file = path.join(DATA_DIR, `${trade.id}.json`)
      expect(fs.existsSync(file), `${trade.id}: no recorded data — run bun run record:demo`).toBe(true)
      const committed = JSON.parse(fs.readFileSync(file, 'utf8')) as DemoData
      const manifest = readManifest(trade)
      expect(manifest, `${trade.id}: no demo/routes/${trade.id}.json`).not.toBeNull()
      const fresh = await recordTrade(trade, manifest!)
      const drift = driftBetween(committed, fresh)
      expect(drift, `The real server's answers changed. Re-record with: bun run record:demo ${trade.id}\n${drift.slice(0, 20).join('\n')}`).toEqual([])
    }, 240_000)
  }
})
