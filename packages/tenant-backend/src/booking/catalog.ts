// What customers can book. The default catalog is the bookable_service table every CRM has. The salon
// catalog is its Service Menu (items flagged "bookable online") — the real menu, so the appointment
// carries the service, duration and price — with the widget list retired once anything is flagged.
import { eq, and, asc, sql } from 'drizzle-orm'
import type { BookingCatalog, CatalogService } from './types'

const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }

export function fromWidgetRow(r: any): CatalogService {
  const depositAmount = num(r.depositAmount)
  return {
    id: r.id, name: r.name, description: r.description ?? null,
    durationMinutes: num(r.durationMinutes, 60) || 60,
    price: num(r.price),
    depositRequired: !!r.depositRequired && depositAmount > 0,
    depositAmount: !!r.depositRequired ? depositAmount : 0,
    active: r.active !== false,
    sortOrder: num(r.sortOrder),
    source: 'widget', legacyServiceId: r.id, menuServiceId: null,
  }
}

/**
 * The bookable_service table — active rows in the owner's sort order. Catalogs take `db` for
 * ordinary reads and an optional executor so the same object works inside the booking transaction.
 */
export function createWidgetCatalog(db: any, t: { bookableService: any }): BookingCatalog {
  const bs = t.bookableService
  return {
    async publicServices(companyId, exec = db) {
      const rows = await exec.select().from(bs).where(and(eq(bs.companyId, companyId), eq(bs.active, true))).orderBy(asc(bs.sortOrder), asc(bs.name))
      return rows.map(fromWidgetRow)
    },
    async resolve(companyId, serviceId, exec = db) {
      const [row] = await exec.select().from(bs).where(and(eq(bs.id, serviceId), eq(bs.companyId, companyId), eq(bs.active, true))).limit(1)
      return row ? fromWidgetRow(row) : null
    },
  }
}

/**
 * Salon: Service Menu items flagged bookableOnline, plus any widget-only services whose name has no
 * menu match — until the salon flags anything on the menu, after which the widget list is retired
 * everywhere (catalog AND booking) so a retired id can't be booked through the API either.
 */
export function createMenuCatalog(db: any, t: { bookableService: any; serviceMenu: any }): BookingCatalog {
  const widget = createWidgetCatalog(db, t)
  const menu = t.serviceMenu
  const fromMenu = (m: any): CatalogService => ({
    id: m.id, name: m.name, description: m.description ?? null,
    durationMinutes: num(m.durationMin, 60) || 60, price: num(m.price),
    depositRequired: false, depositAmount: 0, active: m.active !== false, sortOrder: 0,
    source: 'menu', legacyServiceId: null, menuServiceId: m.id,
  })
  const flagged = (companyId: string) => and(eq(menu.companyId, companyId), eq(menu.active, true), eq(menu.bookableOnline, true))
  const retired = async (companyId: string, exec = db) => {
    const [row] = await exec.select({ id: menu.id }).from(menu).where(flagged(companyId)).limit(1)
    return !!row
  }
  return {
    retired,
    async publicServices(companyId, exec = db) {
      const items = await exec.select().from(menu).where(flagged(companyId)).orderBy(asc(menu.name))
      const out = items.map(fromMenu)
      if (out.length) return out
      return widget.publicServices(companyId, exec)
    },
    async resolve(companyId, serviceId, exec = db) {
      const [m] = await exec.select().from(menu).where(and(eq(menu.id, serviceId), eq(menu.companyId, companyId), eq(menu.active, true))).limit(1)
      if (m) return fromMenu(m)
      if (await retired(companyId, exec)) return null
      const w = await widget.resolve(companyId, serviceId, exec)
      if (!w) return null
      // Link a widget service to the menu entry with the same name when one exists, so the appointment carries it.
      const [match] = await exec.select({ id: menu.id }).from(menu)
        .where(and(eq(menu.companyId, companyId), sql`lower(${menu.name}) = lower(${w.name})`)).limit(1)
      return { ...w, menuServiceId: match?.id || null }
    },
  }
}
