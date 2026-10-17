// The room, as the floor screen draws it (pages /crm/floor): booths, tables and bar seats. Stored on
// bar_settings.floor; a bar that has not set its room yet gets a starting layout to edit (5 booths, 5 tables,
// 10 bar seats — the Amber Inn as described, 9/25). Each table's open check is the one whose spot is that table's
// name, so a check opened on the register for "Booth 2" shows on Booth 2 here, and the other way round.
// Ported from website-premium-bar's lib/register/floor.ts (Amber Inn, 9/27).
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { barSettings } from '../../db/schema.ts'

export interface FloorTable { id: string; name: string; kind: 'booth' | 'table' | 'bar'; seats: number }
export interface FloorConfig { tables: FloorTable[] }

export function defaultFloor(): FloorConfig {
  const t: FloorTable[] = []
  for (let n = 1; n <= 5; n++) t.push({ id: `booth-${n}`, name: `Booth ${n}`, kind: 'booth', seats: 4 })
  for (let n = 1; n <= 5; n++) t.push({ id: `table-${n}`, name: `Table ${n}`, kind: 'table', seats: 4 })
  for (let n = 1; n <= 10; n++) t.push({ id: `bar-${n}`, name: `Bar seat ${n}`, kind: 'bar', seats: 1 })
  return { tables: t }
}

/** Clean a floor from the settings screen: unique ids and names, sane seat counts, at most 60 tables. */
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

export async function floorFor(companyId: string): Promise<FloorConfig> {
  const [s] = await db.select({ floor: barSettings.floor }).from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
  return floorConfig(s?.floor)
}

export async function saveFloor(companyId: string, raw: unknown): Promise<FloorConfig> {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as any).tables) ? (raw as any).tables : null
  if (!list || !list.length) throw new Error('A floor needs at least one table.')
  const clean = floorConfig(raw)
  await db.insert(barSettings).values({ companyId, floor: clean }).onConflictDoNothing({ target: barSettings.companyId })
  await db.update(barSettings).set({ floor: clean, updatedAt: new Date() }).where(eq(barSettings.companyId, companyId))
  return clean
}
