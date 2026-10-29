// "Change layout" on a section: the layouts that suit this section's own content, each drawn by the site's own renderer
// (small, real previews of THIS section), one click to switch. The section's words, photos and settings are kept exactly
// as they are — only the layout name changes — so switching back or Undo loses nothing. A layout that would leave
// something out says so on its card ("Won't show the photo"); one that cannot draw the content is not offered.
// (server/site/layouts.ts is the table; server/site/preview.ts draws the thumbnails.)
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'

interface Section { type: string; variant: string; data: Record<string, any> }
interface Offered { id: string; label: string; blurb: string; current: boolean; hides: string[] }

/** The section types whose layouts the table knows (server/site/layouts.ts LAYOUTS). */
export const LAYOUT_TYPES = new Set(['hero', 'services', 'testimonials', 'about', 'gallery', 'cta'])

const FRAME_W = 1100, THUMB_W = 300, SCALE = THUMB_W / FRAME_W, FRAME_H = 640

function Thumb({ pageSlug, section, layout }: { pageSlug: string; section: Section; layout: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setUrl(null); setFailed(false)
    api.post(`/api/site/preview/layout/${encodeURIComponent(pageSlug)}`, { section: { type: section.type, data: section.data }, variant: layout })
      .then((r: { url: string }) => { if (live) setUrl(r.url) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [pageSlug, section.type, layout, JSON.stringify(section.data)])
  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-paper" style={{ width: THUMB_W, height: FRAME_H * SCALE }} aria-hidden="true">
      {url && <iframe title="" src={url} tabIndex={-1} loading="lazy" style={{ width: FRAME_W, height: FRAME_H, border: 0, transform: `scale(${SCALE})`, transformOrigin: '0 0', pointerEvents: 'none' }} />}
      {failed && <span className="absolute inset-0 grid place-items-center text-xs text-muted">No preview</span>}
    </div>
  )
}

export function ChangeLayout({ pageSlug, section, onPick, disabled }: { pageSlug: string; section: Section; onPick: (variant: string) => void; disabled?: boolean }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [layouts, setLayouts] = useState<Offered[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    setLayouts(null); setError(null)
    api.post('/api/site/layouts', { type: section.type, variant: section.variant, data: section.data })
      .then((r: { layouts: Offered[] }) => { if (live) setLayouts(r.layouts) })
      .catch((e: Error) => { if (live) setError(e.message || 'Could not load the layouts') })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, section.type, section.variant])

  useEffect(() => {
    const d = dlg.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" disabled={disabled} onClick={() => setOpen(true)}>Change layout</button>
      <dialog ref={dlg} onClose={() => setOpen(false)} onClick={(e) => { if (e.target === dlg.current) setOpen(false) }} aria-labelledby={`cl-title-${section.type}`} className="rounded-xl border border-line p-0 max-w-[min(1000px,94vw)] w-full bg-paper text-ink backdrop:bg-black/40">
        <div className="p-5">
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 id={`cl-title-${section.type}`} className="text-lg font-semibold">Change layout</h2>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>Close</button>
          </div>
          <p className="text-sm text-ink-soft mb-4">Your words, photos and settings stay as they are. Only the way they are laid out changes, and you can switch back any time.</p>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {!layouts && !error && <p className="text-sm text-muted">Loading layouts…</p>}
          {layouts && layouts.length <= 1 && <p className="text-sm text-muted">This section has no other layout that suits what is in it.</p>}
          {layouts && layouts.length > 0 && (
            <ul className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_W + 24}px, 1fr))` }}>
              {layouts.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    data-layout={l.id}
                    aria-pressed={l.current}
                    disabled={l.current}
                    onClick={() => { onPick(l.id); setOpen(false) }}
                    className={`text-left w-full rounded-lg border p-3 transition-colors ${l.current ? 'border-ink ring-2 ring-ink' : 'border-line hover:border-ink-soft'}`}
                  >
                    <Thumb pageSlug={pageSlug} section={section} layout={l.id} />
                    <span className="block mt-2 text-sm font-semibold">{l.label}{l.current && <span className="ml-2 text-xs font-normal text-muted">Current</span>}</span>
                    <span className="block text-xs text-ink-soft">{l.blurb}</span>
                    {l.hides.length > 0 && <span className="block text-xs text-amber-800 dark:text-amber-300 mt-1">Won't show {l.hides.join(', ')} (kept, and back if you switch layout again).</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </dialog>
    </>
  )
}
