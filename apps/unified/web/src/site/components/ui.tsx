// Pieces the website screens share. The site admin had three copies of the "new page / new post / new project" dialog
// and the published pill; one each here.
import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'
import { PageError, useAuth } from '../../shared'
import { Label } from './Field'

/** A title → an address: lowercase letters, numbers and hyphens. */
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** "Oct 18, 2026" on the company's clock, not the reader's (a date read in another zone can be a day out). */
export function useShortDate() {
  const { company } = useAuth()
  const timeZone = (company as { timeZone?: string } | null)?.timeZone || undefined
  return (iso: string) => {
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone }) } catch { return '—' }
  }
}

export function StatusPill({ on, onLabel = 'Published', offLabel }: { on: boolean; onLabel?: string; offLabel: string }) {
  return (
    <span className={on
      ? 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300'
      : 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}>
      {on ? <Eye className="w-3 h-3" aria-hidden="true" /> : <EyeOff className="w-3 h-3" aria-hidden="true" />}
      {on ? onLabel : offLabel}
    </span>
  )
}

/** Name it and give it an address. `create` answers the new record's slug; a refusal is shown in the dialog. */
export function NewItemDialog({ heading, prefix, pattern, hint, titlePlaceholder, slugPlaceholder, submitLabel, existingSlugs, duplicateMessage, create, onClose }: {
  heading: string
  /** What comes before the address on the public site: "/", "/blog/", "/projects/". */
  prefix: string
  pattern: string
  hint: string
  titlePlaceholder?: string
  slugPlaceholder?: string
  submitLabel: string
  existingSlugs: string[]
  duplicateMessage: string
  create: (title: string, slug: string) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setTitleAndSlug = (next: string) => {
    setTitle(next)
    if (!slugTouched) setSlug(slugify(next))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (existingSlugs.includes(slug)) { setError(duplicateMessage); return }
    setSubmitting(true)
    try {
      await create(title, slug)
    } catch (err: any) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-item-heading" className="card card-padding w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 id="new-item-heading" className="text-xl text-ink">{heading}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="new-item-title">Title</Label>
            <input id="new-item-title" type="text" value={title} onChange={(e) => setTitleAndSlug(e.target.value)} placeholder={titlePlaceholder} required autoFocus className="input" />
          </div>
          <div>
            <Label htmlFor="new-item-slug">Address</Label>
            <div className="flex items-center gap-1">
              <span className="text-muted text-sm">{prefix}</span>
              <input id="new-item-slug" type="text" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }} pattern={pattern} placeholder={slugPlaceholder} required className="input" />
            </div>
            <p className="text-xs text-muted mt-1">{hint}</p>
          </div>
          <PageError message={error} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
            <button type="submit" disabled={submitting || !title || !slug} className="btn-primary btn-md disabled:opacity-40">
              {submitting ? 'Creating…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
