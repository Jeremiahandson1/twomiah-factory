// Drawing on a job photo (docs/parity/roof-gbb-proposals.md #4, roof-inspection-report.md #13): arrows, circles and text over the
// picture. The marks are shapes in fractions of the picture (../../../photoMarkup.ts); saving sends them to the server, which
// lays them on the photo and keeps the result as a marked copy beside the original (server/crm/roof/photoMarkup). The original
// is never changed. Behind `photo_markup`, and jobs:update like every other change to a photo.
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Circle, Type, Undo2, Trash2 } from 'lucide-react'
import { api } from '../../../../api'
import { useToast, errorText } from '../../../../shared'
import { Modal } from '../../../ui/Modal'
import {
  COLOR_LABELS, MARKUP_COLORS, MAX_SHAPES, MAX_TEXT, SIZE_LABELS, primitive, shapeFromDrag,
  type MarkupColor, type MarkupShape, type TextSize,
} from '../../../photoMarkup'

export interface MarkedResult { original: string; marked: (Record<string, any> & { id: string }) | null }
type Tool = 'arrow' | 'circle' | 'text'
type Point = { x: number; y: number }
const BOARD_WIDTH = 1000

const TOOLS: Array<{ id: Tool; label: string; Icon: typeof Circle }> = [
  { id: 'arrow', label: 'Arrow', Icon: ArrowUpRight }, { id: 'circle', label: 'Circle', Icon: Circle }, { id: 'text', label: 'Text', Icon: Type },
]

/** One shape drawn the way the marked copy will draw it (the same rules: ../../../photoMarkup.ts). */
export function MarkShape({ shape, w, h }: { shape: MarkupShape; w: number; h: number }) {
  const p = primitive(shape, w, h)
  if (p.kind === 'circle') return <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill="none" stroke={p.color} strokeWidth={p.width} />
  if (p.kind === 'text') return <text x={p.x} y={p.y} fontFamily="Arial, Helvetica, sans-serif" fontWeight="bold" fontSize={p.size} fill={p.color} stroke={p.halo} strokeWidth={p.size * 0.12} strokeLinejoin="round" paintOrder="stroke">{p.text}</text>
  return <g><line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.color} strokeWidth={p.width} strokeLinecap="round" /><polygon points={p.head.map((q) => q.join(',')).join(' ')} fill={p.color} /></g>
}

export default function PhotoMarkupEditor({ original, shapes: initial, onClose, onSaved }: {
  original: { id: string; url?: string | null; caption?: string | null }
  shapes: MarkupShape[]
  onClose: () => void
  onSaved: (r: MarkedResult) => void
}) {
  const toast = useToast()
  const [shapes, setShapes] = useState<MarkupShape[]>(initial)
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState<MarkupColor>('red')
  const [size, setSize] = useState<TextSize>('medium')
  const [ratio, setRatio] = useState(0.75)          // height / width of the picture, once it has loaded
  const [drag, setDrag] = useState<{ a: Point; b: Point } | null>(null)
  const [pending, setPending] = useState<Point | null>(null)   // where text will go
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const board = useRef<SVGSVGElement>(null)
  const H = Math.round(BOARD_WIDTH * ratio)

  useEffect(() => { setShapes(initial); setPending(null); setDrag(null) }, [original.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e: React.PointerEvent): Point => {
    const r = board.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const full = shapes.length >= MAX_SHAPES
  const add = (s: MarkupShape | null) => { if (s) setShapes((prev) => [...prev, s]) }

  const down = (e: React.PointerEvent) => {
    if (full) { toast.error(`A photo holds ${MAX_SHAPES} marks at most`); return }
    const p = at(e)
    if (tool === 'text') { setPending(p); setWords(''); return }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setDrag({ a: p, b: p })
  }
  const move = (e: React.PointerEvent) => { if (drag) setDrag({ a: drag.a, b: at(e) }) }
  const up = (e: React.PointerEvent) => {
    if (!drag) return
    add(shapeFromDrag(tool as 'arrow' | 'circle', drag.a, at(e), color))
    setDrag(null)
  }
  const placeText = () => {
    const text = words.trim()
    if (pending && text) add({ kind: 'text', x: Math.min(pending.x, 0.95), y: Math.min(pending.y, 0.95), text: text.slice(0, MAX_TEXT), color, size })
    setPending(null); setWords('')
  }
  const draft = drag && tool !== 'text' ? shapeFromDrag(tool, drag.a, drag.b, color) : null

  const save = async () => {
    setBusy(true)
    try {
      const done = (await api.put(`/api/photo-markup/${original.id}`, { shapes })) as MarkedResult
      toast.success(done.marked ? 'Marked copy saved beside the original' : 'Marks removed')
      onSaved(done)
    } catch (e) { toast.error(errorText(e, 'Could not save the marks')) } finally { setBusy(false) }
  }

  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
  return (
    <Modal isOpen onClose={onClose} title={`Draw on ${original.caption || 'this photo'}`} size="xl">
      <div className="flex flex-wrap items-center gap-2 mb-3" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map(({ id, label, Icon }) => (
          <button key={id} type="button" aria-pressed={tool === id} onClick={() => setTool(id)}
            className={`${btn} ${tool === id ? 'bg-orange-50 border-orange-500 text-orange-800 dark:bg-orange-950/30 dark:text-orange-200' : ''}`}><Icon className="w-4 h-4" aria-hidden="true" /> {label}</button>
        ))}
        <span className="mx-1 h-6 w-px bg-gray-200 dark:bg-slate-700" aria-hidden="true" />
        {(Object.keys(MARKUP_COLORS) as MarkupColor[]).map((c) => (
          <button key={c} type="button" aria-label={COLOR_LABELS[c]} aria-pressed={color === c} title={COLOR_LABELS[c]} onClick={() => setColor(c)}
            className={`h-7 w-7 rounded-full border-2 ${color === c ? 'ring-2 ring-orange-500 ring-offset-1' : ''} border-gray-400`} style={{ backgroundColor: MARKUP_COLORS[c] }} />
        ))}
        {tool === 'text' && (
          <label className="text-sm text-gray-700 dark:text-slate-300">Size{' '}
            <select value={size} onChange={(e) => setSize(e.target.value as TextSize)} className="ml-1 border rounded-lg px-2 py-1 bg-white dark:bg-slate-900 dark:border-slate-700">
              {(Object.keys(SIZE_LABELS) as TextSize[]).map((s) => <option key={s} value={s}>{SIZE_LABELS[s]}</option>)}
            </select></label>
        )}
        <span className="flex-1" />
        <button type="button" className={btn} disabled={shapes.length === 0} onClick={() => setShapes((prev) => prev.slice(0, -1))}><Undo2 className="w-4 h-4" aria-hidden="true" /> Undo</button>
        <button type="button" className={btn} disabled={shapes.length === 0} onClick={() => setShapes([])}><Trash2 className="w-4 h-4" aria-hidden="true" /> Clear all</button>
      </div>
      <p className="text-xs text-gray-500 mb-2 dark:text-slate-400">
        {tool === 'text' ? 'Click where the words should start.' : tool === 'arrow' ? 'Drag from the tail of the arrow to its point.' : 'Drag across the area to circle.'} {shapes.length} of {MAX_SHAPES} marks.
      </p>
      <div className="relative mx-auto select-none touch-none" style={{ maxWidth: '100%' }}>
        <img src={original.url || ''} alt={original.caption || 'Photo to draw on'} draggable={false} className="block w-full h-auto rounded-md"
          onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setRatio(i.naturalHeight / i.naturalWidth) }} />
        <svg ref={board} viewBox={`0 0 ${BOARD_WIDTH} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full cursor-crosshair" role="img" aria-label="Marks on the photo"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
          {shapes.map((s, i) => <MarkShape key={i} shape={s} w={BOARD_WIDTH} h={H} />)}
          {draft && <MarkShape shape={draft} w={BOARD_WIDTH} h={H} />}
        </svg>
        {pending && (
          <form className="absolute z-10 flex gap-1" style={{ left: `${Math.min(pending.x * 100, 60)}%`, top: `${pending.y * 100}%` }} onSubmit={(e) => { e.preventDefault(); placeText() }}>
            <input autoFocus aria-label="Text to place" value={words} maxLength={MAX_TEXT} onChange={(e) => setWords(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setPending(null) }}
              className="border rounded-lg px-2 py-1 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100" placeholder="e.g. Hail hits" />
            <button type="submit" className="px-2 py-1 text-sm rounded-lg bg-orange-600 text-white">Add</button>
          </form>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-slate-400">Saving keeps a marked copy beside the original photo. The original is not changed.</p>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="button" disabled={busy} onClick={save} className="px-4 py-1.5 text-sm font-medium rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50">{busy ? 'Saving…' : shapes.length === 0 ? 'Remove marks' : 'Save marked copy'}</button>
        </div>
      </div>
    </Modal>
  )
}
