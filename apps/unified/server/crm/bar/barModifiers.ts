// A menu item's add-ons and changes (bar_menu_item.modifiers): "Add bacon" +$2.00, "Gluten-free bun" +$1.50, "No
// onions" $0. The register, the kiosk and the website order price a line as its size plus the modifiers picked, on the
// server, from the item as it is now; the picked names ride on the line's note ("+ Bacon · No onions") so the grill
// ticket and the receipt say them.
import { createId } from '@paralleldrive/cuid2'

export interface Modifier { id: string; name: string; priceCents: number }
export const MAX_MODIFIERS = 20

/** The stored list, cleaned: a name, a price of 0 to $100 in cents, an id. */
export function modifiersOf(item: { modifiers?: unknown }): Modifier[] {
  const raw = Array.isArray(item.modifiers) ? item.modifiers : []
  return raw.map((m: any) => ({ id: String(m?.id || ''), name: String(m?.name || '').trim().slice(0, 60), priceCents: Math.round(Number(m?.priceCents) || 0) }))
    .filter((m) => m.id && m.name && m.priceCents >= 0 && m.priceCents <= 10000)
    .slice(0, MAX_MODIFIERS)
}

/** What the menu screen saves: [{ id?, name, priceCents }]. A new one gets an id; a nonsense one is refused. */
export function modifiersInput(v: unknown): Modifier[] | 'bad' {
  if (v === null || v === undefined) return []
  if (!Array.isArray(v) || v.length > MAX_MODIFIERS) return 'bad'
  const out: Modifier[] = []
  for (const m of v as any[]) {
    const name = String(m?.name ?? '').trim()
    if (!name) continue
    const price = Math.round(Number(m?.priceCents ?? 0))
    if (name.length > 60 || !Number.isFinite(price) || price < 0 || price > 10000) return 'bad'
    out.push({ id: typeof m?.id === 'string' && /^[a-z0-9]{6,40}$/i.test(m.id) ? m.id : createId(), name, priceCents: price })
  }
  return out
}

/** The modifiers picked, in the menu's order, or the refusal when one is not this item's. */
export function pickModifiers(item: { modifiers?: unknown }, ids: unknown): Modifier[] | 'unknown' {
  if (ids === undefined || ids === null) return []
  if (!Array.isArray(ids) || ids.length > MAX_MODIFIERS) return 'unknown'
  const all = modifiersOf(item)
  const want = new Set(ids.map(String))
  if ([...want].some((id) => !all.some((m) => m.id === id))) return 'unknown'
  return all.filter((m) => want.has(m.id))
}

/** "+ Bacon · No onions" — the picked modifiers as the line's note says them. "No …" reads as it is. */
export function modifierNote(mods: Modifier[]): string {
  return mods.map((m) => (/^(no|without|extra|add|sub)\b/i.test(m.name) ? m.name : '+ ' + m.name)).join(' · ')
}
