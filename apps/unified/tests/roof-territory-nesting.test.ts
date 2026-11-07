// A territory sits under the one it belongs to (roofing live test 11/07: a KML area set to belong to EC County showed only an
// "in EC County" label, anywhere in the list). The list is ordered parent first, then its own, each a level deeper.
import { test, expect } from 'bun:test'
import { Window } from 'happy-dom'
const win: any = new Window({ url: 'https://x.example.com/crm/territories' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
const PAGE = '../web/src/crm/pages/roof/field/TerritoriesPage.tsx'
const { nestTerritories } = (await import(PAGE)) as any

test('children follow their parent a level deeper; an orphan or a self-parent is top level', () => {
  const rows = [
    { id: 'kml', parentId: 'county' }, { id: 'zip', parentId: null }, { id: 'county', parentId: null },
    { id: 'block', parentId: 'kml' }, { id: 'lost', parentId: 'gone' }, { id: 'self', parentId: 'self' },
  ]
  expect(nestTerritories(rows).map((r: { t: { id: string }; depth: number }) => `${r.t.id}:${r.depth}`)).toEqual(['zip:0', 'county:0', 'kml:1', 'block:2', 'lost:0', 'self:0'])
})
