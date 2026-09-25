/**
 * lib/register/floor.ts — the room, as the floor phone draws it.
 * Stored in settings.floor; the defaults are the Amber Inn as described:
 * 5 booths, 5 tables, 10 bar seats.
 */
export interface FloorTable { id: string; name: string; kind: 'booth' | 'table' | 'bar'; seats: number }
export interface FloorConfig { tables: FloorTable[] }

export function defaultFloor(): FloorConfig {
  const t: FloorTable[] = []
  for (let n = 1; n <= 5; n++) t.push({ id: `booth-${n}`, name: `Booth ${n}`, kind: 'booth', seats: 4 })
  for (let n = 1; n <= 5; n++) t.push({ id: `table-${n}`, name: `Table ${n}`, kind: 'table', seats: 4 })
  for (let n = 1; n <= 10; n++) t.push({ id: `bar-${n}`, name: `Bar seat ${n}`, kind: 'bar', seats: 1 })
  return { tables: t }
}

/** Clean a floor from the admin: unique ids and names, sane seat counts, at most 60 tables. */
export function floorConfig(raw: unknown): FloorConfig {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as any).tables) ? (raw as any).tables : null
  if (!list) return defaultFloor()
  const seenIds = new Set<string>(), seenNames = new Set<string>()
  const tables: FloorTable[] = []
  for (const r of list.slice(0, 60)) {
    const name = String(r?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)
    if (!name || seenNames.has(name.toLowerCase())) continue
    const kind = r?.kind === 'booth' || r?.kind === 'bar' ? r.kind : 'table'
    let id = String(r?.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'table'
    while (seenIds.has(id)) id += '-2'
    const seats = Math.max(1, Math.min(20, Math.floor(Number(r?.seats) || (kind === 'bar' ? 1 : 4))))
    seenIds.add(id); seenNames.add(name.toLowerCase())
    tables.push({ id, name, kind, seats })
  }
  return tables.length ? { tables } : defaultFloor()
}
