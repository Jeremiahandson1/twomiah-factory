// Draft and live in the website editor (server: site/drafts.ts, site/preview.ts) — one behaviour for the page editor, the
// blog and portfolio editors and the website settings:
//   • What you type shows in the preview as you type. Nothing is saved by typing.
//   • Save draft keeps your changes without changing the site. Publish puts them on the site (saving first).
//   • Discard changes goes back to what is live.
//   • The bar says which of three states you are in: unsaved changes, saved but unpublished, or live.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, CircleDot, Eye, Monitor, Pencil, Smartphone, Undo2, UploadCloud, Save } from 'lucide-react'
import { useConfirm } from '../../shared'
import { api } from '../../api'

/** A record as the editor reads it from /api/site: its live fields, and its draft (or null). */
export interface DraftRow { draft: Record<string, any> | null; hasDraft?: boolean; [k: string]: any }

/**
 * The editor's state for one record. `toWorking` picks what the editor edits from a row: the draft where there is one,
 * else the live fields. `save` sends the working copy (PATCH, kept as a draft); `publish` and `discard` call the record's
 * own …/publish and …/draft.
 */
export function useDraftEditor<T>(opts: {
  row: DraftRow | null
  toWorking: (row: DraftRow) => T
  save: (value: T) => Promise<DraftRow>
  publish: (show: boolean) => Promise<DraftRow>
  discard: () => Promise<DraftRow>
}) {
  const [row, setRow] = useState<DraftRow | null>(opts.row)
  const [value, setValue] = useState<T | null>(opts.row ? opts.toWorking(opts.row) : null)
  const [savedJson, setSavedJson] = useState(opts.row ? JSON.stringify(opts.toWorking(opts.row)) : '')
  const [busy, setBusy] = useState<null | 'saving' | 'publishing' | 'discarding'>(null)
  const [error, setError] = useState<string | null>(null)
  const [justPublished, setJustPublished] = useState(false)

  /** Take a row the server answered with as the new saved state. */
  const adopt = useCallback((r: DraftRow) => {
    setRow(r)
    const w = opts.toWorking(r)
    setValue(w)
    setSavedJson(JSON.stringify(w))
  }, [opts.toWorking])

  const isDirty = useMemo(() => value !== null && JSON.stringify(value) !== savedJson, [value, savedJson])
  const hasDraft = !!row?.draft

  // Leaving with unsaved edits loses them: the browser asks on a reload or a closed tab.
  useEffect(() => {
    if (!isDirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  const update = (next: T | ((v: T) => T)) => { setJustPublished(false); setValue((v) => (v === null ? v : typeof next === 'function' ? (next as (v: T) => T)(v) : next)) }

  const run = async (what: 'saving' | 'publishing' | 'discarding', fn: () => Promise<void>) => {
    setBusy(what); setError(null)
    try { await fn() } catch (e: any) { setError(e?.message || 'Something went wrong') } finally { setBusy(null) }
  }
  const saveDraft = () => run('saving', async () => { if (value !== null) adopt(await opts.save(value)) })
  const publishNow = (show = false) => run('publishing', async () => {
    let saved = row
    if (value !== null && isDirty) { saved = await opts.save(value); adopt(saved) }
    // Typed back to what is live: saving left no draft, and there is nothing to publish.
    if (saved?.draft || show) adopt(await opts.publish(show))
    setJustPublished(true)
  })
  const discardChanges = () => run('discarding', async () => { adopt(await opts.discard()) })
  /** Unsaved edits only (nothing saved as a draft): back to the saved state without asking the server. */
  const revertLocal = () => { if (row) { setValue(opts.toWorking(row)); setError(null) } }

  return { row, setRow, adopt, value, update, isDirty, hasDraft, busy, error, setError, justPublished, saveDraft, publishNow, discardChanges, revertLocal }
}

export type DraftEditor<T> = ReturnType<typeof useDraftEditor<T>>

/** Where the record stands: unsaved, saved but not live, or live. */
export function DraftStatus({ isDirty, hasDraft, justPublished }: { isDirty: boolean; hasDraft: boolean; justPublished?: boolean }) {
  const [cls, Icon, text] = isDirty
    ? ['bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200', Pencil, 'Unsaved changes']
    : hasDraft
      ? ['bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200', CircleDot, 'Draft saved · not published']
      : ['bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300', CheckCircle2, justPublished ? 'Published · live now' : 'Live · no unpublished changes']
  return (
    <span role="status" data-draft-state={isDirty ? 'unsaved' : hasDraft ? 'draft' : 'live'} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {text}
    </span>
  )
}

/**
 * Save draft, Publish and Discard changes. `hiddenNote`: the record is off the site, and Publish can put it on —
 * the caller's own "show it" choice (`show`, `setShow`), so publishing never changes whether it is shown unasked.
 */
export function DraftActions<T>({ ed, noun, offSite, show, setShow, showLabel }: {
  ed: DraftEditor<T>
  noun: string
  offSite?: boolean
  show?: boolean
  setShow?: (v: boolean) => void
  showLabel?: string
}) {
  const confirm = useConfirm()
  const canPublish = ed.isDirty || ed.hasDraft || (!!offSite && !!show)
  const discard = async () => {
    if (!ed.hasDraft) { ed.revertLocal(); return }
    const ok = await confirm(`Your unpublished changes to this ${noun} are thrown away, and the editor goes back to what is live on your site.`, { title: 'Discard your changes?', confirmText: 'Discard changes' })
    if (ok) ed.discardChanges()
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {offSite && setShow && (
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={!!show} onChange={(e) => setShow(e.target.checked)} className="rounded border-line" />
          {showLabel || 'Show it on the site when I publish'}
        </label>
      )}
      <button type="button" onClick={discard} disabled={!!ed.busy || !(ed.isDirty || ed.hasDraft)} className="btn-secondary btn-md disabled:opacity-40">
        <Undo2 className="w-4 h-4" />
        {ed.busy === 'discarding' ? 'Discarding…' : 'Discard changes'}
      </button>
      <button type="button" onClick={ed.saveDraft} disabled={!!ed.busy || !ed.isDirty} className="btn-secondary btn-md disabled:opacity-40">
        <Save className="w-4 h-4" />
        {ed.busy === 'saving' ? 'Saving…' : 'Save draft'}
      </button>
      <button type="button" onClick={() => ed.publishNow(!!offSite && !!show)} disabled={!!ed.busy || !canPublish} className="btn-primary btn-md disabled:opacity-40">
        <UploadCloud className="w-4 h-4" />
        {ed.busy === 'publishing' ? 'Publishing…' : 'Publish'}
      </button>
    </div>
  )
}

/** Whether the screen is at least the lg breakpoint (where the preview sits beside the editor). */
export function useIsWide(query = '(min-width: 1024px)') {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : true)
  const [wide, setWide] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return
    const m = window.matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return wide
}

/** The "Preview" button a phone gets: the preview replaces the editor until it is pressed again. */
export function PreviewToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} aria-pressed={on} className="btn-secondary btn-md lg:hidden">
      {on ? <Pencil className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      {on ? 'Edit' : 'Preview'}
    </button>
  )
}

const DESKTOP_WIDTH = 1280

/**
 * The live preview: the record as the site will show it, drawn by the site itself from what is in the editor now
 * (POST /api/site/preview/:kind/:slug holds it, the frame GETs the page). Redrawn a moment after typing stops; two
 * frames take turns, the new one shown only once it has loaded and been scrolled to where the old one was, so the page
 * neither flashes nor jumps. `data` null: the saved state (someone who may only read).
 *
 * Desktop draws the page at a desktop width, scaled to fit the pane; Phone at a phone's. On a phone itself the frame is
 * the phone's own width.
 */
export function LivePreview({ kind, slug, data, label, publicHref, className = '' }: {
  kind: 'page' | 'post' | 'portfolio' | 'settings'
  slug: string
  data: unknown | null
  label?: string
  publicHref?: string | null
  className?: string
}) {
  const wide = useIsWide()
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop')
  const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)]
  const front = useRef(0)
  const [shown, setShown] = useState(0)
  const latest = useRef(0)
  const first = useRef(true)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const pane = useRef<HTMLDivElement>(null)
  const [paneSize, setPaneSize] = useState({ w: 0, h: 0 })
  const base = `/api/site/preview/${kind}/${encodeURIComponent(slug)}`
  const key = JSON.stringify(data)

  useLayoutEffect(() => {
    const el = pane.current
    if (!el) return
    const measure = () => setPaneSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const wait = first.current ? 0 : 450
    first.current = false
    const timer = setTimeout(async () => {
      const n = ++latest.current
      setState('loading')
      try {
        if (data !== null) await api.post(base, { data })
      } catch {
        // Not held: the frame shows the saved state rather than nothing.
      }
      if (n !== latest.current) return
      const back = frames[1 - front.current].current
      if (back) back.src = `${base}?v=${n}`
    }, wait)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, base])

  const onLoad = (i: number) => {
    const f = frames[i].current
    if (!f || !f.src) return
    const v = Number(new URL(f.src, window.location.href).searchParams.get('v') || 0)
    if (v !== latest.current || i === front.current) return
    try {
      const was = frames[front.current].current?.contentWindow
      const y = was ? was.scrollY : 0
      f.contentWindow?.scrollTo(0, y)
    } catch { /* same origin; nothing to keep if it isn't */ }
    front.current = i
    setShown(i)
    setState('ready')
  }

  // The frame's own width: a desktop's, scaled down to the pane; a phone's; or, on a phone, the pane's.
  const phone = !wide || device === 'phone'
  const frameW = !wide ? paneSize.w : device === 'phone' ? 390 : Math.max(DESKTOP_WIDTH, paneSize.w)
  const scale = !wide || device === 'phone' || !paneSize.w ? 1 : paneSize.w / frameW
  const frameH = paneSize.h ? paneSize.h / scale : 0

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div className="px-4 py-2 border-b border-line flex items-center gap-3 text-sm shrink-0 bg-paper">
        <span className="font-semibold text-ink">{label || 'Preview'}</span>
        {state === 'loading' && <span className="text-xs text-muted hidden sm:inline">Updating…</span>}
        <div className="ml-auto flex items-center gap-1">
          {wide && (
            <div className="inline-flex rounded-md border border-line overflow-hidden" role="group" aria-label="Preview width">
              <button type="button" onClick={() => setDevice('desktop')} aria-pressed={device === 'desktop'} title="Desktop" className={`px-2 py-1 ${device === 'desktop' ? 'bg-ink text-white dark:bg-slate-200 dark:text-slate-900' : 'text-ink-soft'}`}>
                <Monitor className="w-3.5 h-3.5" aria-hidden="true" /><span className="sr-only">Desktop</span>
              </button>
              <button type="button" onClick={() => setDevice('phone')} aria-pressed={device === 'phone'} title="Phone" className={`px-2 py-1 ${device === 'phone' ? 'bg-ink text-white dark:bg-slate-200 dark:text-slate-900' : 'text-ink-soft'}`}>
                <Smartphone className="w-3.5 h-3.5" aria-hidden="true" /><span className="sr-only">Phone</span>
              </button>
            </div>
          )}
          {publicHref && (
            <a href={publicHref} target="_blank" rel="noreferrer" className="btn-secondary btn-sm" title="Open the live page in a new tab">
              View live
            </a>
          )}
        </div>
      </div>
      <div ref={pane} className="relative flex-1 min-h-0 overflow-hidden bg-slate-100 dark:bg-slate-950">
        {[0, 1].map((i) => (
          <iframe
            key={i}
            ref={frames[i]}
            onLoad={() => onLoad(i)}
            title={i === shown ? 'Preview of your changes' : 'Preview, updating'}
            aria-hidden={i !== shown}
            tabIndex={i === shown ? 0 : -1}
            data-preview-frame={i === shown ? 'shown' : 'next'}
            className="absolute top-0 border-0 bg-white"
            style={{
              width: frameW || '100%',
              height: frameH || '100%',
              left: phone && wide ? `calc(50% - ${frameW / 2}px)` : 0,
              transform: scale !== 1 ? `scale(${scale})` : undefined,
              transformOrigin: 'top left',
              visibility: i === shown ? 'visible' : 'hidden',
            }}
          />
        ))}
        {state === 'error' && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">The preview could not be drawn.</div>}
      </div>
    </div>
  )
}
