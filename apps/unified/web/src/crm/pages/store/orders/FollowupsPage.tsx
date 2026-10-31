// The store's post-purchase emails at /crm/followups (parity row 3 against Shopify Email's automations, 2026-10-31):
// a first-order email, a thank-you with products to go with the order, and a reminder to reorder consumables — each off until
// switched on, each with its own days and wording, optionally only for a saved segment. They go out through Email Marketing, so
// an unsubscribed customer is never mailed and nothing is counted against a send limit.
//
// GET/PUT /api/admin/followups (server/crm/store/followups/routes.ts) — behind the store_followups feature and marketing:read, as
// this page's menu row is; saving is marketing:update (the page asks the same, and the server refuses a seat without it).
//   · a failed read or save says so in words, with the server's sentence; a wrong number marks its own box;
//   · the wording is plain text paragraphs here (blank lines between them); the server keeps it as email-safe HTML.
import { useCallback, useEffect, useState } from 'react'
import { MailCheck } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useMayWrite } from '../../../../shared'

interface One { on: boolean; days?: number; subject: string; body: string }
interface Loaded {
  segmentId: string | null
  firstOrder: One & { days: number }; crossSell: One & { days: number }; replenish: One
  sent: { firstOrder: number; crossSell: number; replenish: number }
  days: { min: number; max: number }
  mergeFields: { key: string; label: string }[]
  segments: { id: string; name: string }[]
  note: string
}
type Key = 'firstOrder' | 'crossSell' | 'replenish'

// The email body is HTML on the server; here it is edited as paragraphs of text.
const toText = (html: string) => html.replace(/<\/p>\s*<p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const toHtml = (text: string) => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')

const SECTIONS: { key: Key; title: string; what: string; hasDays: boolean; extra: string }[] = [
  { key: 'firstOrder', title: 'First-order email', what: 'To a customer after their first order has reached them.', hasDays: true, extra: '' },
  { key: 'crossSell', title: 'Thank-you and “you may like”', what: 'To a customer after any order has reached them, with up to three products to go with what they bought (your “You may also like” picks, else the same category).', hasDays: true, extra: 'The products are added under your wording.' },
  { key: 'replenish', title: 'Time to reorder', what: 'For things that run out. Set the days on each product (Products › the product › Reorder reminder); the email lists what is due.', hasDays: false, extra: 'The products are added under your wording.' },
]

export default function FollowupsPage() {
  const mayChange = useMayWrite('marketing:update')
  const [data, setData] = useState<Loaded | null>(null)
  const [form, setForm] = useState<Record<Key, { on: boolean; days: string; subject: string; body: string }> | null>(null)
  const [segmentId, setSegmentId] = useState('')
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const apply = (d: Loaded) => {
    setData(d); setSegmentId(d.segmentId ?? '')
    const row = (o: One) => ({ on: o.on, days: o.days == null ? '' : String(o.days), subject: o.subject, body: toText(o.body) })
    setForm({ firstOrder: row(d.firstOrder), crossSell: row(d.crossSell), replenish: row(d.replenish) })
  }
  const load = useCallback(async () => {
    try { apply((await api.get('/api/admin/followups')) as Loaded); setLoadError('') } catch (e) { setLoadError(errorText(e, "Couldn't load the post-purchase emails")) }
  }, [])
  useEffect(() => { void load() }, [load])

  const change = (k: Key, patch: Partial<{ on: boolean; days: string; subject: string; body: string }>) => { setForm((f) => (f ? { ...f, [k]: { ...f[k], ...patch } } : f)); setSaved('') }
  const save = async () => {
    if (!form) return
    setError(''); setSaved(''); setBusy(true)
    const days = (k: Key) => Number(form[k].days.replace(/[^0-9]/g, ''))
    const part = (k: Key, withDays: boolean) => ({ on: form[k].on, ...(withDays ? { days: days(k) } : {}), subject: form[k].subject.trim() || null, body: toHtml(form[k].body) || null })
    try {
      await api.put('/api/admin/followups', { segmentId: segmentId || null, firstOrder: part('firstOrder', true), crossSell: part('crossSell', true), replenish: part('replenish', false) })
      await load(); setSaved('Saved.')
    } catch (e) { setError(errorText(e, "Couldn't save the post-purchase emails")) } finally { setBusy(false) }
  }

  const field = 'input mt-1 w-full'
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2"><MailCheck className="h-6 w-6" aria-hidden="true" />Post-purchase emails</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">Email a customer after their order has reached them. All three are off until you switch them on. Customers who unsubscribed are never emailed, and nothing here counts against a sending limit.</p>
      </div>
      {loadError ? <PageError message={`${loadError} — refresh to try again.`} /> : !data || !form ? <p className="text-gray-500 dark:text-slate-400">Loading…</p> : (
        <>
          <p className="text-sm text-gray-600 dark:text-slate-400">{data.note} You can use {data.mergeFields.map((m) => `{{${m.key}}}`).join(', ')} in the subject and the wording.</p>
          <label className="block max-w-md text-sm text-gray-700 dark:text-slate-300">Send to
            <select className={field} value={segmentId} disabled={!mayChange} onChange={(e) => { setSegmentId(e.target.value); setSaved('') }}>
              <option value="">Every customer</option>
              {data.segments.map((s) => <option key={s.id} value={s.id}>Only the segment “{s.name}”</option>)}
              {segmentId && !data.segments.some((s) => s.id === segmentId) && <option value={segmentId}>A segment that was removed (nobody)</option>}
            </select></label>
          {error && <PageError message={error} />}
          {SECTIONS.map((s) => {
            const f = form[s.key]
            const count = data.sent[s.key]
            return (
              <section key={s.key} className="card p-4 sm:p-6 space-y-3" aria-label={s.title}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{s.title}</h2>
                  <p className="text-sm text-gray-600 dark:text-slate-400">{count} sent so far</p>
                </div>
                <p className="text-sm text-gray-500 dark:text-slate-400">{s.what}</p>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                  <input type="checkbox" checked={f.on} disabled={!mayChange} onChange={(e) => change(s.key, { on: e.target.checked })} /> Send this email
                </label>
                {s.hasDays && <label className="block max-w-xs text-sm text-gray-700 dark:text-slate-300">Days after the order arrives
                  <input className={field} inputMode="numeric" value={f.days} disabled={!mayChange} onChange={(e) => change(s.key, { days: e.target.value })} aria-describedby={`${s.key}-days`} />
                  <span id={`${s.key}-days`} className="text-xs text-gray-500 dark:text-slate-400">From {data.days.min} to {data.days.max} days.</span></label>}
                <label className="block text-sm text-gray-700 dark:text-slate-300">Subject
                  <input className={field} value={f.subject} maxLength={300} disabled={!mayChange} onChange={(e) => change(s.key, { subject: e.target.value })} /></label>
                <label className="block text-sm text-gray-700 dark:text-slate-300">Wording
                  <textarea className={field} rows={6} value={f.body} disabled={!mayChange} onChange={(e) => change(s.key, { body: e.target.value })} /></label>
                {s.extra && <p className="text-xs text-gray-500 dark:text-slate-400">{s.extra}</p>}
              </section>
            )
          })}
          {mayChange && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>Save post-purchase emails</button>
              {saved && <p role="status" className="text-sm text-green-700 dark:text-green-400">{saved}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
