// The Book as a time grid (salon gap #3; feature `book_grid`): a column per stylist for a day, or a column per day for one stylist's
// week; cards sized by their time, drag to move, drag the bottom edge to resize, processing time hatched, blocked time (lunch, training)
// drawn and editable. The arithmetic is bookGrid.ts; every move is the same PUT the Reschedule button makes, so the server's clash,
// own-chair and blocked-time checks decide — this screen only draws and asks.
import { useMemo, useRef, useState } from 'react'
import { Plus, Lock } from 'lucide-react'
import { companyDayKey, companyMinutes, companyMoment, whenTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { piecesFor, gridRange, lanes, movedStart, resizedEnd, columnAt, hhmm, serviceHue, snap, type Piece } from './bookGridMath'
import { pxPerMinFor, DEFAULT_SLOT_MIN } from './bookViews'

export interface GridItem { id: string; serviceName?: string; stylistId?: string | null; stylistFirstName?: string; startOffsetMin: number; durationMin: number; processingAfterMin?: number | null; processingMin?: number | null }
export interface GridAppt {
  id: string; status?: string; startTime?: string; endTime?: string; stylistId?: string | null
  clientName?: string; serviceName?: string; processingAfterMin?: number | null; processingMin?: number | null; items?: GridItem[]
}
export interface GridBlock { id: string; stylistId?: string | null; startTime: string; endTime: string; reason?: string | null; typeId?: string | null; typeName?: string | null; typeColor?: string | null; paid?: boolean | null; seriesId?: string | null; /** 'block' (default), or 'time_off' / 'closed' — drawn from timeOff.ts and kept on the Time off screen. */ kind?: 'block' | 'time_off' | 'closed'; readOnly?: boolean }
/** What a block says on the Book: its type, then its own reason. */
export const blockLabel = (b: Pick<GridBlock, 'typeName' | 'reason'>) => (b.typeName && b.reason ? `${b.typeName} · ${b.reason}` : b.typeName || b.reason || 'Blocked')
export interface GridColumn { key: string; label: string; sub?: string; /** day mode: the stylist ('' = unassigned) */ stylistId?: string; /** week mode: the day */ day?: string }

const DEAD = new Set(['cancelled', 'no_show'])
const TONE: Record<string, string> = {
  scheduled: 'bg-white dark:bg-slate-900', confirmed: 'bg-blue-50 dark:bg-blue-950/40', checked_in: 'bg-teal-50 dark:bg-teal-950/40',
  in_chair: 'bg-teal-100 dark:bg-teal-950/60', completed: 'bg-green-50 dark:bg-green-950/40',
}
const fmt = (min: number) => whenTime(companyMoment('2000-01-03', hhmm(min)), { hour: 'numeric', minute: '2-digit' })

interface Card { key: string; appt: GridAppt; start: number; end: number; pieces: Piece[]; label: string; itemised: boolean }

/** What each column holds: the cards (this stylist's services of a visit, or the whole appointment) and the blocks. */
function fill(cols: GridColumn[], appts: GridAppt[], blocks: GridBlock[], weekMode: boolean) {
  const cards = new Map<string, Card[]>(), blocked = new Map<string, Array<{ b: GridBlock; start: number; end: number }>>()
  for (const c of cols) { cards.set(c.key, []); blocked.set(c.key, []) }
  const colFor = (stylist: string | null | undefined, startIso: string | undefined) => {
    if (weekMode) return cols.find((c) => c.day === companyDayKey(startIso))
    return cols.find((c) => c.stylistId === (stylist || ''))
  }
  for (const a of appts) {
    if (DEAD.has(a.status || '') || !a.startTime) continue
    const aStart = companyMinutes(a.startTime)
    const aEnd = a.endTime ? aStart + Math.round((new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60000) : aStart + 60
    if (a.items && a.items.length > 1) {
      // Each service in its own stylist's column, for its own stretch.
      for (const it of a.items) {
        const col = colFor(it.stylistId, a.startTime)
        if (!col) continue
        const s = aStart + it.startOffsetMin
        cards.get(col.key)!.push({ key: `${a.id}:${it.id}`, appt: a, start: s, end: Math.min(24 * 60, s + it.durationMin), pieces: piecesFor(s, Math.min(24 * 60, s + it.durationMin), { afterMin: it.processingAfterMin, min: it.processingMin }), label: it.serviceName || 'Service', itemised: true })
      }
    } else {
      const col = colFor(a.stylistId, a.startTime)
      if (!col) continue
      const end = Math.min(24 * 60, aEnd)
      cards.get(col.key)!.push({ key: a.id, appt: a, start: aStart, end, pieces: piecesFor(aStart, end, { afterMin: a.processingAfterMin, min: a.processingMin }), label: a.serviceName || '', itemised: false })
    }
  }
  for (const b of blocks) {
    const targets = weekMode ? cols.filter((c) => c.day && c.day >= companyDayKey(b.startTime) && c.day <= companyDayKey(b.endTime)) : cols.filter((c) => !b.stylistId || c.stylistId === b.stylistId)
    for (const col of targets) {
      const dayStart = weekMode ? col.day! : companyDayKey(b.startTime)
      const s = companyDayKey(b.startTime) < dayStart ? 0 : companyMinutes(b.startTime)
      const e = companyDayKey(b.endTime) > dayStart ? 24 * 60 : companyMinutes(b.endTime)
      if (e > s) blocked.get(col.key)!.push({ b, start: s, end: e })
    }
  }
  return { cards, blocked }
}

export default function BookGrid({ cols, appts, blocks, weekMode, today, slotMin = DEFAULT_SLOT_MIN, mayMove, mayBook, onPick, onMove, onResize, onEmptySlot, onBlock }: {
  cols: GridColumn[]; appts: GridAppt[]; blocks: GridBlock[]; weekMode: boolean; today: string
  /** Minutes per time slot (5, 10, 15, 30): how tall the grid is drawn, and the step a drag moves by. */
  slotMin?: number
  mayMove: boolean; mayBook: boolean
  onPick: (a: GridAppt) => void
  onMove: (a: GridAppt, to: { start: Date; end: Date; stylistId?: string; itemised: boolean }) => void
  onResize: (a: GridAppt, end: Date) => void
  onEmptySlot: (col: GridColumn, startMin: number) => void
  onBlock: (b: GridBlock) => void
}) {
  const PX_PER_MIN = pxPerMinFor(slotMin)
  const { cards, blocked } = useMemo(() => fill(cols, appts, blocks, weekMode), [cols, appts, blocks, weekMode])
  const range = useMemo(() => {
    const spans: Array<{ start: number; end: number }> = []
    cards.forEach((l) => l.forEach((c) => spans.push(c)))
    blocked.forEach((l) => l.forEach((c) => spans.push(c)))
    return gridRange(spans)
  }, [cards, blocked])
  const height = (range.to - range.from) * PX_PER_MIN
  const hours = Array.from({ length: (range.to - range.from) / 60 + 1 }, (_, i) => range.from + i * 60)
  // a faint line for every slot, a firmer one on the hour
  const slotLines = Array.from({ length: Math.floor((range.to - range.from) / slotMin) + 1 }, (_, i) => range.from + i * slotMin)
  const colRefs = useRef<Array<HTMLDivElement | null>>([])
  const [drag, setDrag] = useState<null | { card: Card; mode: 'move' | 'resize'; y0: number; moved: boolean; start: number; end: number; col: number; from: number }>(null)

  const startDrag = (e: React.PointerEvent, card: Card, mode: 'move' | 'resize', colIdx: number) => {
    if (!mayMove || e.button !== 0) return
    if (mode === 'resize' && card.itemised) return
    e.preventDefault(); e.stopPropagation()
    const y0 = e.clientY
    let cur = { card, mode, y0, moved: false, start: card.start, end: card.end, col: colIdx, from: colIdx }
    setDrag(cur)
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0
      if (!cur.moved && Math.abs(dy) < 4 && Math.abs(ev.clientX - e.clientX) < 4) return
      const spans = colRefs.current.map((el) => { const r = el?.getBoundingClientRect(); return { left: r?.left ?? 0, right: r?.right ?? 0 } })
      cur = mode === 'move'
        ? { ...cur, moved: true, start: movedStart(card.start, card.end - card.start, dy, PX_PER_MIN, slotMin), end: 0, col: columnAt(ev.clientX, spans) }
        : { ...cur, moved: true, end: resizedEnd(card.start, card.end, dy, PX_PER_MIN, slotMin) }
      if (mode === 'move') cur.end = cur.start + (card.end - card.start)
      setDrag(cur)
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel)
      setDrag(null)
      if (!cur.moved) { onPick(card.appt); return }
      if (mode === 'resize') {
        if (cur.end !== card.end) onResize(card.appt, companyMoment(weekMode ? cols[cur.col].day! : companyDayKey(card.appt.startTime), hhmm(Math.min(cur.end, 24 * 60 - 1))))
        return
      }
      const target = cols[cur.col]
      const day = weekMode ? target.day! : companyDayKey(card.appt.startTime)
      const sameSpot = cur.start === card.start && cur.col === colIdx
      if (sameSpot) return
      const start = companyMoment(day, hhmm(cur.start))
      // The visit keeps its length (and a visit with several services its stylists): only the start and, for one service, the chair move.
      const startOfAppt = card.itemised ? cur.start - (card.start - companyMinutes(card.appt.startTime)) : cur.start
      const apptStart = companyMoment(day, hhmm(Math.max(0, startOfAppt)))
      const len = card.appt.endTime && card.appt.startTime ? new Date(card.appt.endTime).getTime() - new Date(card.appt.startTime).getTime() : (card.end - card.start) * 60_000
      const s = card.itemised ? apptStart : start
      onMove(card.appt, { start: s, end: new Date(s.getTime() + len), stylistId: !weekMode && !card.itemised && target.stylistId !== undefined && target.stylistId !== (card.appt.stylistId || '') ? target.stylistId : undefined, itemised: card.itemised })
    }
    const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); setDrag(null) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel)
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-white dark:bg-slate-900" role="region" aria-label="The Book as a time grid">
      <div className="flex min-w-max">
        <div className="sticky left-0 z-20 w-14 shrink-0 bg-white dark:bg-slate-900 border-r">
          <div className="h-12 border-b" />
          <div className="relative" style={{ height }}>
            {hours.map((h) => <span key={h} className="absolute right-1 -translate-y-1/2 text-[11px] text-gray-500 dark:text-slate-400" style={{ top: (h - range.from) * PX_PER_MIN }}>{h === range.from ? '' : fmt(h)}</span>)}
          </div>
        </div>
        {cols.map((col, ci) => {
          const laid = lanes((cards.get(col.key) || []).map((c) => ({ ...c })))
          return (
            <div key={col.key} className="w-40 shrink-0 border-r last:border-r-0">
              <div className={`h-12 border-b px-2 py-1 text-center ${col.day === today ? 'bg-teal-700 text-white' : ''}`}>
                <p className="truncate text-sm font-semibold">{col.label}</p>
                {col.sub && <p className={`truncate text-xs ${col.day === today ? 'text-teal-50' : 'text-gray-500 dark:text-slate-400'}`}>{col.sub}</p>}
              </div>
              <div ref={(el) => { colRefs.current[ci] = el }} className="relative" style={{ height }}
                onClick={(e) => {
                  if (!mayBook || e.target !== e.currentTarget) return
                  const r = e.currentTarget.getBoundingClientRect()
                  onEmptySlot(col, Math.max(range.from, Math.min(range.to - slotMin, snap(range.from + (e.clientY - r.top) / PX_PER_MIN, slotMin))))
                }}>
                {slotLines.map((m) => <div key={m} className={`pointer-events-none absolute inset-x-0 border-t ${m % 60 === 0 ? 'border-gray-200 dark:border-slate-700' : 'border-gray-100 border-dotted dark:border-slate-800'}`} style={{ top: (m - range.from) * PX_PER_MIN }} />)}
                {(blocked.get(col.key) || []).map(({ b, start, end }) => (
                  <button key={b.id + col.key} type="button" onClick={() => mayMove && onBlock(b)} disabled={!mayMove}
                    className="absolute inset-x-0 z-10 overflow-hidden border-y border-gray-300 px-1 text-left text-[11px] text-gray-600 dark:border-slate-600 dark:text-slate-300"
                    style={{ top: (Math.max(start, range.from) - range.from) * PX_PER_MIN, height: (Math.min(end, range.to) - Math.max(start, range.from)) * PX_PER_MIN, backgroundImage: 'repeating-linear-gradient(135deg, rgba(120,120,120,.18) 0 6px, transparent 6px 12px)', ...(b.typeColor ? { borderLeft: `4px solid ${b.typeColor}` } : {}) }}
                    title={`${blockLabel(b)}${b.paid === true ? ' (paid)' : b.paid === false ? ' (unpaid)' : ''}`}>
                    <Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />{blockLabel(b)}{!b.stylistId && !weekMode ? ' · everyone' : ''}
                  </button>
                ))}
                {laid.map((c) => {
                  const dragging = drag?.card.key === c.key
                  const hue = serviceHue(c.appt.serviceName || c.label)
                  return (
                    <div key={c.key} role="button" tabIndex={0} aria-label={`${fmt(c.start)} ${c.appt.clientName || 'Walk-in'} ${c.label}`}
                      onPointerDown={(e) => startDrag(e, c, 'move', ci)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(c.appt) } }}
                      className={`absolute z-20 overflow-hidden rounded-md border text-xs shadow-sm ${TONE[c.appt.status || 'scheduled'] || TONE.scheduled} ${mayMove ? 'cursor-grab touch-none' : 'cursor-pointer'} ${dragging ? 'opacity-40' : ''}`}
                      style={{ top: (c.start - range.from) * PX_PER_MIN, height: Math.max(14, (c.end - c.start) * PX_PER_MIN - 1), left: `${(c.lane * 100) / c.lanes}%`, width: `calc(${100 / c.lanes}% - 2px)`, borderLeft: `4px solid hsl(${hue} 55% 45%)` }}>
                      {c.pieces.filter((p) => p.kind === 'processing').map((p) => (
                        <span key={p.start} aria-hidden="true" className="absolute inset-x-0 z-0 opacity-70" style={{ top: (p.start - c.start) * PX_PER_MIN, height: (p.end - p.start) * PX_PER_MIN, backgroundImage: `repeating-linear-gradient(45deg, hsl(${hue} 55% 80% / .7) 0 5px, transparent 5px 10px)` }} />
                      ))}
                      <span className="relative z-10 block px-1 pt-0.5">
                        <b className="text-gray-900 dark:text-slate-100">{fmt(c.start)}</b>{' '}<span className="text-gray-900 dark:text-slate-100">{c.appt.clientName || 'Walk-in'}</span>
                        {c.end - c.start >= 30 && c.label && <span className="block truncate text-gray-600 dark:text-slate-300">{c.label}{c.itemised && c.appt.items ? ` · ${c.appt.items.length} services` : ''}</span>}
                      </span>
                      {mayMove && !c.itemised && <span onPointerDown={(e) => startDrag(e, c, 'resize', ci)} className="absolute inset-x-0 bottom-0 z-20 h-2 cursor-ns-resize" aria-label="Drag to change the length" />}
                    </div>
                  )
                })}
                {drag?.moved && (() => {
                  // The ghost: where the card will land.
                  const onThis = drag.mode === 'move' ? drag.col === ci : drag.from === ci
                  if (!onThis) return null
                  const s = drag.mode === 'move' ? drag.start : drag.card.start, e = drag.mode === 'move' ? drag.end : drag.end
                  return <div className="pointer-events-none absolute inset-x-1 z-30 rounded-md border-2 border-dashed border-teal-600 bg-teal-500/10 text-[11px] font-semibold text-teal-800 dark:text-teal-200"
                    style={{ top: (s - range.from) * PX_PER_MIN, height: (e - s) * PX_PER_MIN }}>{fmt(s)} – {fmt(e)}</div>
                })()}
                {mayBook && laid.length === 0 && (blocked.get(col.key) || []).length === 0 && (
                  <span className="pointer-events-none absolute inset-x-0 top-2 text-center text-xs text-gray-400 dark:text-slate-500"><Plus className="mr-1 inline h-3 w-3" aria-hidden="true" />click a time to book</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="border-t px-3 py-2 text-xs text-gray-500 dark:text-slate-400">
        {mayMove ? `Drag a card to move it, drag its bottom edge to change its length — in steps of ${slotMin} minutes. ` : ''}Hatched colour is processing time — the stylist is free. Grey bars are blocked time.
      </p>
    </div>
  )
}
