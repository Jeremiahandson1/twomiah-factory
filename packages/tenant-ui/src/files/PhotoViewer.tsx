// The one full-size photo viewer every photo grid opens (live test 2026-10-22, roofing P3.8: clicking a job photo did
// nothing). A dialog over the page: the photo as large as the screen allows, its caption, "3 of 8", previous and next
// (buttons, the arrow keys, or a swipe on a phone), Esc or Close to leave — focus goes to Close on opening and back to
// the photo that was clicked on closing. A grid that needs more (delete) passes its own buttons as `actions`; a grid
// whose photos load one at a time (home care's visit photos) passes `load`.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

export interface ViewerPhoto {
  id?: string | null
  /** The full-size image. Absent while `load` fetches it. */
  src?: string | null
  caption?: string | null
  /** A line under the caption (when, by whom). */
  detail?: ReactNode
}

export interface PhotoViewerProps {
  photos: ViewerPhoto[]
  /** Which photo is open; null when the viewer is closed. */
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
  /** Extra buttons for the open photo, beside Close (e.g. Delete). */
  actions?: (photo: ViewerPhoto, i: number) => ReactNode
  /** Fetch a photo's image when it has none yet (`src` empty). */
  load?: (photo: ViewerPhoto) => Promise<string | null>
  /** What the photos are, for the dialog's name ("Job photos"). */
  label?: string
}

export function PhotoViewer({ photos, index, onIndex, onClose, actions, load, label = 'Photos' }: PhotoViewerProps) {
  const open = index !== null && index >= 0 && index < photos.length
  const closeRef = useRef<HTMLButtonElement>(null)
  const opener = useRef<Element | null>(null)
  const touchX = useRef<number | null>(null)
  const [loaded, setLoaded] = useState<Record<number, string | null>>({})
  const [failed, setFailed] = useState(false)
  const count = photos.length
  const photo = open ? photos[index as number] : null
  const src = photo ? (photo.src || loaded[index as number] || null) : null

  const go = (step: number) => { if (open && count > 1) onIndex(((index as number) + step + count) % count) }

  // Remember what had focus (the thumbnail), focus Close, and give focus back when the viewer closes.
  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      const back = opener.current as HTMLElement | null
      if (back && typeof back.focus === 'function') back.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    // Captured first and kept: a viewer opened from inside a dialog (a daily log's form) closes itself on Esc, not
    // the dialog under it too.
    const onKey = (e: KeyboardEvent) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (e.key !== 'Escape' && !step) return
      e.preventDefault(); e.stopPropagation()
      if (step) go(step); else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // A photo with no image yet is fetched once.
  useEffect(() => {
    if (!open || !photo || photo.src || !load || (index as number) in loaded) return
    let live = true
    setFailed(false)
    load(photo).then((s) => { if (live) setLoaded((m) => ({ ...m, [index as number]: s })) }, () => { if (live) { setFailed(true); setLoaded((m) => ({ ...m, [index as number]: null })) } })
    return () => { live = false }
  }, [open, index]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !photo) return null
  const i = index as number
  const btn = 'inline-flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white'

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-white"
      role="dialog" aria-modal="true" aria-label={label}
      data-testid="photo-viewer"
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null }}
      onTouchEnd={(e) => {
        const start = touchX.current; touchX.current = null
        const end = e.changedTouches[0]?.clientX
        if (start === null || end === undefined) return
        if (end - start > 50) go(-1)
        else if (start - end > 50) go(1)
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <p className="text-sm text-white/90" aria-live="polite">{count > 1 ? `${i + 1} of ${count}` : ''}</p>
        <div className="flex items-center gap-2">
          {actions?.(photo, i)}
          <button ref={closeRef} type="button" onClick={onClose} className={`${btn} h-11 w-11`} aria-label="Close"><X className="h-6 w-6" /></button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
        {src
          ? <img src={src} alt={photo.caption || `Photo ${i + 1} of ${count}`} className="max-h-full max-w-full object-contain" />
          : <p className="text-white/80">{failed ? 'This photo could not be loaded.' : 'Loading photo…'}</p>}
        {count > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} className={`${btn} absolute left-2 top-1/2 h-11 w-11 -translate-y-1/2 sm:left-4`} aria-label="Previous photo"><ChevronLeft className="h-7 w-7" /></button>
            <button type="button" onClick={() => go(1)} className={`${btn} absolute right-2 top-1/2 h-11 w-11 -translate-y-1/2 sm:right-4`} aria-label="Next photo"><ChevronRight className="h-7 w-7" /></button>
          </>
        )}
      </div>
      {(photo.caption || photo.detail) && (
        <div className="px-4 py-3 text-center text-sm text-white">
          {photo.caption && <p className="break-words">{photo.caption}</p>}
          {photo.detail && <p className="mt-1 text-white/80">{photo.detail}</p>}
        </div>
      )}
    </div>
  )
}
