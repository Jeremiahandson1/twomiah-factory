// Draft and live in the website editor (server: site/drafts.ts, site/preview.ts) — one behaviour for the page editor, the
// blog and portfolio editors and the website settings, as Wix and Webflow do it:
//   • What you type shows in the preview as you type.
//   • A moment after you stop typing, your changes are saved as a draft by themselves ("Saving draft…", then "Draft
//     saved"). A draft never changes the site. Save draft saves at once.
//   • Publish puts this record's changes on the site (saving first). Publish all puts every record's on, together.
//   • Discard changes goes back to what is live.
//   • The bar says where you stand: unsaved, saving, a draft not yet published, or live.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, CircleDot, Eye, Loader2, Monitor, Pencil, Smartphone, Undo2, UploadCloud, Save, Layers } from 'lucide-react'
import { PageError, useConfirm } from '../../shared'
import { api } from '../../api'

/** A record as the editor reads it from /api/site: its live fields, and its draft (or null). */
export interface DraftRow { draft: Record<string, any> | null; hasDraft?: boolean; [k: string]: any }

/** How long after the last keystroke the draft saves itself. */
export const AUTOSAVE_MS = 2000

/**
 * The editor's state for one record. `toWorking` picks what the editor edits from a row: the draft where there is one,
 * else the live fields. `save` sends the working copy (PATCH, kept as a draft); `publish` and `discard` call the record's
 * own …/publish and …/draft. Saves run one at a time; a save never overwrites what was typed while it ran.
 */
export function useDraftEditor<T>(opts: {
  row: DraftRow | null
  toWorking: (row: DraftRow) => T
  save: (value: T) => Promise<DraftRow>
  publish: (show: boolean) => Promise<DraftRow>
  discard: () => Promise<DraftRow>
  /** Off: no saving by itself (someone who may only read). */
  autosave?: boolean
}) {
  const [row, setRowState] = useState<DraftRow | null>(opts.row)
  const [value, setValue] = useState<T | null>(opts.row ? opts.toWorking(opts.row) : null)
  const [savedJson, setSavedJsonState] = useState(opts.row ? JSON.stringify(opts.toWorking(opts.row)) : '')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<null | 'publishing' | 'discarding'>(null)
  const [error, setError] = useState<string | null>(null)
  const [justPublished, setJustPublished] = useState(false)
  // The latest of each, for the saves and timers that outlive a render.
  const valueRef = useRef<T | null>(value)
  const rowRef = useRef<DraftRow | null>(row)
  const savedRef = useRef(savedJson)
  const inflight = useRef<Promise<DraftRow | null> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const setRow = useCallback((r: DraftRow) => { rowRef.current = r; setRowState(r) }, [])
  const setSaved = (json: string) => { savedRef.current = json; setSavedJsonState(json) }
  const setVal = (v: T | null) => { valueRef.current = v; setValue(v) }
  const stopTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }

  /** Take a row the server answered with as the new saved state, and what the editor shows. */
  const adopt = useCallback((r: DraftRow) => {
    setRow(r)
    const w = optsRef.current.toWorking(r)
    setVal(w)
    setSaved(JSON.stringify(w))
  }, [setRow])

  const isDirty = value !== null && JSON.stringify(value) !== savedJson
  const hasDraft = !!row?.draft

  /** Save what is in the editor now, after any save already running. Answers the row as saved. */
  const saveNow = useCallback(async (): Promise<DraftRow | null> => {
    stopTimer()
    if (inflight.current) await inflight.current.catch(() => null)
    const v = valueRef.current
    if (v === null) return rowRef.current
    const json = JSON.stringify(v)
    if (json === savedRef.current) return rowRef.current
    const p = (async () => {
      const r = await optsRef.current.save(v)
      setRow(r)
      // What was sent is saved; anything typed since stays unsaved and saves next.
      setSaved(json)
      return r
    })()
    inflight.current = p
    setSaving(true)
    setError(null)
    try { return await p } catch (e: any) { setError(e?.message || 'The draft could not be saved'); throw e } finally {
      if (inflight.current === p) { inflight.current = null; setSaving(false) }
    }
  }, [setRow])

  // Saved by itself a moment after typing stops.
  useEffect(() => {
    if (!isDirty || opts.autosave === false) return
    stopTimer()
    timer.current = setTimeout(() => { saveNow().catch(() => {}) }, AUTOSAVE_MS)
    return stopTimer
  }, [value, savedJson, isDirty, opts.autosave, saveNow])

  // Leaving the screen saves what is not saved yet (a draft — never published).
  useEffect(() => () => {
    if (opts.autosave === false) return
    if (valueRef.current !== null && JSON.stringify(valueRef.current) !== savedRef.current) saveNow().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only what is not saved yet is lost by a reload or a closed tab: the browser asks then, and only then.
  const unsaved = isDirty || saving
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  const update = (next: T | ((v: T) => T)) => {
    setJustPublished(false)
    const cur = valueRef.current
    if (cur === null) return
    setVal(typeof next === 'function' ? (next as (v: T) => T)(cur) : next)
  }

  const run = async (what: 'publishing' | 'discarding', fn: () => Promise<void>) => {
    setBusy(what); setError(null)
    try { await fn() } catch (e: any) { setError(e?.message || 'Something went wrong') } finally { setBusy(null) }
  }
  const saveDraft = () => { saveNow().catch(() => {}) }
  const publishNow = (show = false) => run('publishing', async () => {
    const saved = await saveNow()
    // Typed back to what is live: saving left no draft, and there is nothing to publish.
    if (saved?.draft || show) {
      const sentJson = savedRef.current
      const r = await optsRef.current.publish(show)
      if (valueRef.current !== null && JSON.stringify(valueRef.current) === sentJson) adopt(r)
      else { setRow(r); setSaved(JSON.stringify(optsRef.current.toWorking(r))) }
    }
    setJustPublished(true)
  })
  const discardChanges = () => run('discarding', async () => {
    stopTimer()
    if (inflight.current) await inflight.current.catch(() => null)
    adopt(await optsRef.current.discard())
  })
  /** Unsaved edits only (nothing saved as a draft): back to the saved state without asking the server. */
  const revertLocal = () => { stopTimer(); const r = rowRef.current; if (r) { setVal(optsRef.current.toWorking(r)); setError(null) } }

  return { row, setRow, adopt, value, update, isDirty, hasDraft, saving, busy, error, setError, justPublished, saveDraft, saveNow, publishNow, discardChanges, revertLocal }
}

export type DraftEditor<T> = ReturnType<typeof useDraftEditor<T>>

/** Where the record stands: unsaved, saving, a draft not yet published, or live. */
export function DraftStatus({ isDirty, hasDraft, saving, justPublished }: { isDirty: boolean; hasDraft: boolean; saving?: boolean; justPublished?: boolean }) {
  const state = saving ? 'saving' : isDirty ? 'unsaved' : hasDraft ? 'draft' : 'live'
  const [cls, Icon, text] = state === 'saving'
    ? ['bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200', Loader2, 'Saving draft…']
    : state === 'unsaved'
      ? ['bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200', Pencil, 'Unsaved changes']
      : state === 'draft'
        ? ['bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200', CircleDot, 'Draft saved · not published']
        : ['bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300', CheckCircle2, justPublished ? 'Published · live now' : 'Live · no unpublished changes']
  return (
    <span role="status" data-draft-state={state} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}>
      <Icon className={`w-3.5 h-3.5 ${state === 'saving' ? 'animate-spin' : ''}`} aria-hidden="true" />
      {text}
    </span>
  )
}

/**
 * Save draft, Publish and Discard changes. `offSite`: the record is off the site, and Publish can put it on — the
 * caller's own "show it" choice (`show`, `setShow`), so publishing never changes whether it is shown unasked.
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
  const canPublish = ed.isDirty || ed.saving || ed.hasDraft || (!!offSite && !!show)
  const discard = async () => {
    if (!ed.hasDraft && !ed.saving) { ed.revertLocal(); return }
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
      <button type="button" onClick={discard} disabled={!!ed.busy || !(ed.isDirty || ed.hasDraft || ed.saving)} className="btn-secondary btn-md disabled:opacity-40">
        <Undo2 className="w-4 h-4" />
        {ed.busy === 'discarding' ? 'Discarding…' : 'Discard changes'}
      </button>
      <button type="button" onClick={ed.saveDraft} disabled={!!ed.busy || ed.saving || !ed.isDirty} className="btn-secondary btn-md disabled:opacity-40" title="Your changes also save by themselves a moment after you stop typing">
        <Save className="w-4 h-4" />
        Save draft
      </button>
      <button type="button" onClick={() => ed.publishNow(!!offSite && !!show)} disabled={!!ed.busy || !canPublish} className="btn-primary btn-md disabled:opacity-40">
        <UploadCloud className="w-4 h-4" />
        {ed.busy === 'publishing' ? 'Publishing…' : 'Publish'}
      </button>
    </div>
  )
}

// ── Everything unpublished, and Publish all ─────────────────────────────────

export interface UnpublishedItem { kind: 'page' | 'post' | 'portfolio' | 'settings'; slug: string; title: string; savedAt: string | null; mayPublish: boolean }

const KIND_WORDS: Record<UnpublishedItem['kind'], string> = { page: 'Page', post: 'Blog post', portfolio: 'Project', settings: 'Settings' }
/** Where the admin edits each kind. */
export const editorHref = (i: Pick<UnpublishedItem, 'kind' | 'slug'>) =>
  i.kind === 'page' ? `/crm/website/pages/${i.slug}` : i.kind === 'post' ? `/crm/website/blog/${i.slug}` : i.kind === 'portfolio' ? `/crm/website/portfolio/${i.slug}` : '/crm/website/settings'

/** Every record with unpublished changes (GET /api/site/drafts), and a way to read it again. */
export function useSiteDrafts() {
  const [items, setItems] = useState<UnpublishedItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try { const r: { data: UnpublishedItem[] } = await api.get('/api/site/drafts'); setItems(r.data); setError(null); return r.data } catch (e: any) { setError(e.message); return null }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  return { items, error, refresh }
}

/**
 * The list of unpublished changes, each linked to its editor, and "Publish all changes": what this person may publish
 * goes live together (one transaction, POST /api/site/drafts/publish with the list shown); what they may not is said.
 */
export function UnpublishedList({ items, onPublished, onNavigate }: { items: UnpublishedItem[]; onPublished: (r: { published: any[]; skipped: any[] }) => void; onNavigate?: () => void }) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mine = items.filter((i) => i.mayPublish)
  const others = items.filter((i) => !i.mayPublish)
  const publishAll = async () => {
    const ok = await confirm(`${mine.length} ${mine.length === 1 ? 'change goes' : 'changes go'} on your site together. Whether each page is shown or hidden stays as it is.`, { title: 'Publish all changes?', confirmText: 'Publish all', danger: false })
    if (!ok) return
    setBusy(true); setError(null)
    try { onPublished(await api.post('/api/site/drafts/publish', { items: mine.map(({ kind, slug }) => ({ kind, slug })) })) } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div>
      <ul className="divide-y divide-line border border-line rounded-lg mb-3" data-unpublished-list>
        {items.map((i) => (
          <li key={i.kind + '|' + i.slug} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="text-xs text-muted w-20 shrink-0">{KIND_WORDS[i.kind]}</span>
            <Link to={editorHref(i)} onClick={onNavigate} className="text-ink underline decoration-line underline-offset-2 hover:decoration-ink truncate">{i.title || i.slug}</Link>
            {!i.mayPublish && <span className="ml-auto text-xs text-muted shrink-0">An owner or admin publishes this</span>}
          </li>
        ))}
      </ul>
      <PageError message={error} className="mb-3" />
      {mine.length > 0 && (
        <button type="button" onClick={publishAll} disabled={busy} className="btn-primary btn-md disabled:opacity-40">
          <Layers className="w-4 h-4" />
          {busy ? 'Publishing…' : `Publish all changes (${mine.length})`}
        </button>
      )}
      {others.length > 0 && mine.length === 0 && <p className="text-sm text-muted">An owner or admin publishes these.</p>}
    </div>
  )
}

/**
 * In an editor's header: "Publish all (N)" when OTHER records have unpublished changes too. Opening it saves this
 * editor first (`beforeOpen`), so the list is everything as it stands.
 */
export function PublishAllButton({ current, changed, drafts, beforeOpen, onPublished }: {
  current: { kind: UnpublishedItem['kind']; slug: string }
  /** This editor's own record has changes (saved or not): it counts in "Publish all (N)" too. */
  changed: boolean
  drafts: ReturnType<typeof useSiteDrafts>
  beforeOpen: () => Promise<unknown>
  onPublished: () => void
}) {
  const [open, setOpen] = useState(false)
  const others = (drafts.items || []).filter((i) => !(i.kind === current.kind && i.slug === current.slug))
  if (!others.length && !open) return null
  const openIt = async () => { await beforeOpen().catch(() => {}); await drafts.refresh(); setOpen(true) }
  return (
    <>
      <button type="button" onClick={openIt} className="btn-secondary btn-md" title="Other pages or settings also have unpublished changes">
        <Layers className="w-4 h-4" />
        Publish all ({others.length + (changed ? 1 : 0)})
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="publish-all-heading" className="card card-padding w-full max-w-lg max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h2 id="publish-all-heading" className="text-lg font-semibold text-ink mb-1">Everything unpublished</h2>
            <p className="text-sm text-muted mb-4">Saved changes that are not on your site yet.</p>
            {(drafts.items || []).length === 0
              ? <p className="text-sm text-muted mb-3">Nothing is waiting to be published.</p>
              : <UnpublishedList items={drafts.items || []} onNavigate={() => setOpen(false)} onPublished={() => { setOpen(false); drafts.refresh(); onPublished() }} />}
            <div className="mt-4 text-right"><button type="button" onClick={() => setOpen(false)} className="btn-secondary btn-md">Close</button></div>
          </div>
        </div>
      )}
    </>
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
export function LivePreview({ kind, slug, data, label, publicHref, settingsDraft, className = '' }: {
  kind: 'page' | 'post' | 'portfolio' | 'settings'
  slug: string
  data: unknown | null
  label?: string
  publicHref?: string | null
  /** The site's settings have a draft: offer to draw this page under them too — the whole site as it will be. */
  settingsDraft?: boolean
  className?: string
}) {
  const wide = useIsWide()
  const [withDraftSettings, setWithDraftSettings] = useState(false)
  const underDraft = !!settingsDraft && withDraftSettings && kind !== 'settings'
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
      if (back) back.src = `${base}?v=${n}${underDraft ? '&settings=draft' : ''}`
    }, wait)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, base, underDraft])

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
        <div className="ml-auto flex items-center gap-2">
          {settingsDraft && kind !== 'settings' && (
            <label className="flex items-center gap-1.5 text-xs text-ink-soft" title="Your website settings have unpublished changes: see this page with them too">
              <input type="checkbox" checked={withDraftSettings} onChange={(e) => setWithDraftSettings(e.target.checked)} className="rounded border-line" data-with-draft-settings />
              With draft settings
            </label>
          )}
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
