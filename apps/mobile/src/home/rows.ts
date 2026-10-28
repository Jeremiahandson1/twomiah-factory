/** One list row for a tile's list, from the server's row. Pure, so the tests can hold every tile's row to "title present". */
export interface RowView { key: string; title: string; subtitle?: string; meta?: string; badge?: string; to?: string }

const money = (v: unknown) => `$${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const words = (s: unknown) => String(s ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
const day = (v: unknown) => { const d = new Date(String(v ?? '')); return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString() }

export function rowView(tileId: string, r: any, i: number): RowView {
  switch (tileId) {
    case 'active-projects':
      return { key: r.id, title: r.name || r.number || 'Project', subtitle: [r.number, r.city].filter(Boolean).join(' · ') || undefined, badge: words(r.status) }
    case 'inventory':
      return { key: r.id, title: [r.year, r.make, r.modelName].filter(Boolean).join(' ') || 'Unit', subtitle: r.stockNumber ? `Stock ${r.stockNumber}` : undefined,
        meta: r.internetPrice ? money(r.internetPrice) : undefined, to: `/(details)/unit/${r.id}` }
    case 'open-leads': {
      const l = r.lead || r
      const unit = [r.unitYear, r.unitMake, r.unitModelName].filter(Boolean).join(' ')
      return { key: l.id, title: r.contactName || 'Lead', subtitle: unit || undefined, badge: words(l.stage) }
    }
    case 'open-repair-orders': {
      const o = r.ro || r
      const unit = [r.unitYear, r.unitMake, r.unitModel].filter(Boolean).join(' ')
      return { key: o.id, title: o.roNumber ? `RO ${o.roNumber}` : 'Repair order', subtitle: [r.customerName, unit].filter(Boolean).join(' · ') || undefined, badge: words(o.status) }
    }
    case 'action-items':
      return { key: r.key || String(i), title: r.label, meta: String(r.count ?? ''), badge: r.severity === 'high' ? 'Urgent' : undefined }
    default:
      // home care tile rows: { kind, id, title, subtitle?, amount?, at }
      return { key: `${r.kind}-${r.id}-${i}`, title: r.title || 'Item', subtitle: r.subtitle || undefined, meta: r.amount != null ? money(r.amount) : day(r.at) }
  }
}
