// The reply box under a texting thread (packages/tenant-ui MessagesPage `composer`): words, pictures — uploaded, or
// from the customer's job photos and photo library — and sending later at a day and time on the company's clock,
// with the texts set for later listed above it and cancelable until they go. Server: crm/comms/smsMedia.ts and
// crm/comms/scheduledTexts.ts; the send itself is the shared /api/sms reply (opt-outs and the wallet hold).
import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Clock, Send, X, Loader2, Upload } from 'lucide-react'
import { api } from '../api'
import { useAuth, useToast, useConfirm } from '../shared'
import { companyLocalInput, companyTimeZone } from '@twomiah/tenant-ui/src/time/companyClock'

const client = api as any
const errMsg = (e: unknown, fallback: string) => (e as Error)?.message || fallback

interface Picture { key: string; url: string; caption?: string | null; job?: string }
interface Scheduled { id: string; body: string; media: string[] | null; sendAtLabel: string }

export function TextComposer({ conversationId, contactId, onSent }: { conversationId: string; contactId: string | null; onSent: () => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [text, setText] = useState('')
  const [pictures, setPictures] = useState<Picture[]>([])
  const [picking, setPicking] = useState(false)
  const [library, setLibrary] = useState<Picture[] | null>(null)
  const [later, setLater] = useState(false)
  const [sendAt, setSendAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [scheduled, setScheduled] = useState<Scheduled[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const maySend = can('sms:send')

  const loadScheduled = useCallback(async () => {
    try { const r = await client.get('/api/sms-scheduled', { conversationId }); setScheduled(r?.data || []) } catch { setScheduled([]) }
  }, [conversationId])
  useEffect(() => { loadScheduled(); setPictures([]); setText(''); setLater(false); setError('') }, [loadScheduled])
  useEffect(() => { setError('') }, [text, sendAt])

  const openLibrary = async () => {
    setPicking((p) => !p)
    if (library || !can('jobs:read')) return
    try { const r = await client.get('/api/sms-media/library', contactId ? { contactId } : {}); setLibrary(r?.data || []) } catch { setLibrary([]) }
  }
  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const saved = await client.upload('/api/sms-media/upload', fd)
      setPictures((p) => [...p, { key: saved.key, url: saved.url, caption: saved.name }])
      setPicking(false)
    } catch (e) { toast.error(errMsg(e, 'That picture could not be added')) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const send = async () => {
    if (!text.trim() && !pictures.length) { setError('Type a message or add a picture.'); return }
    if (later && !sendAt) { setError('Pick the day and time to send it.'); return }
    setBusy(true)
    const media = pictures.map((p) => p.key)
    try {
      if (later) {
        const r = await client.post('/api/sms-scheduled', { conversationId, message: text.trim(), media, sendAt })
        toast.success(`Text set for ${r?.sendAtLabel || sendAt}`)
        await loadScheduled()
      } else {
        await client.post(`/api/sms/conversations/${conversationId}/reply`, { message: text.trim(), media })
        onSent()
      }
      setText(''); setPictures([]); setLater(false); setSendAt('')
    } catch (e) { setError(errMsg(e, later ? 'The text was not set' : 'The text was not sent')) } finally { setBusy(false) }
  }
  const cancel = async (s: Scheduled) => {
    if (!(await confirm(`Cancel the text set for ${s.sendAtLabel}?`))) return
    try { await client.post(`/api/sms-scheduled/${s.id}/cancel`, {}); toast.success('Scheduled text cancelled'); await loadScheduled() }
    catch (e) { toast.error(errMsg(e, 'Could not cancel it')); await loadScheduled() }
  }
  if (!maySend) return null
  const zone = companyTimeZone()

  return (
    <div className="border-t bg-white p-3 dark:border-slate-800 dark:bg-slate-900" data-testid="text-composer">
      {scheduled.length > 0 && (
        <ul className="mb-2 space-y-1" aria-label="Texts set to send later">
          {scheduled.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <span className="min-w-0"><Clock className="mr-1 inline h-4 w-4" aria-hidden="true" />{s.sendAtLabel}: <span className="break-words">{s.body || 'Picture'}{s.media?.length ? ` (+${s.media.length} picture${s.media.length === 1 ? '' : 's'})` : ''}</span></span>
              <button type="button" onClick={() => cancel(s)} className="shrink-0 rounded px-2 py-0.5 text-sm font-medium underline">Cancel</button>
            </li>
          ))}
        </ul>
      )}
      {pictures.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" aria-label="Pictures to send">
          {pictures.map((p, i) => (
            <div key={p.key} className="relative">
              <img src={p.url} alt={p.caption || 'Picture to send'} className="h-16 w-16 rounded-lg object-cover" />
              <button type="button" onClick={() => setPictures((x) => x.filter((_, j) => j !== i))} aria-label="Remove picture" className="absolute -right-1 -top-1 rounded-full bg-gray-800 p-0.5 text-white"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}
      {picking && (
        <div className="mb-2 rounded-lg border border-gray-200 p-2 dark:border-slate-700">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-800 dark:border-slate-600 dark:text-slate-100"><Upload className="h-4 w-4" />Upload a picture</button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif" className="hidden" onChange={(e) => upload(e.target.files?.[0])} aria-label="Picture to upload" />
          {can('jobs:read') && (
            <div className="mt-2">
              <p className="text-xs text-gray-600 dark:text-slate-300">From {contactId ? "this customer's jobs" : 'recent jobs'}</p>
              {library === null ? <p className="text-xs text-gray-600 dark:text-slate-300">Loading…</p> : library.length === 0 ? <p className="text-xs text-gray-600 dark:text-slate-300">No job photos yet.</p> : (
                <div className="mt-1 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                  {library.map((p) => (
                    <button type="button" key={p.key} title={[p.job, p.caption].filter(Boolean).join(' — ')} onClick={() => { if (!pictures.some((x) => x.key === p.key)) setPictures((x) => [...x, p]); setPicking(false) }} className="rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
                      <img src={p.url} alt={p.caption || p.job || 'Job photo'} className="h-16 w-16 rounded-lg object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {later && (
        <label className="mb-2 flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
          Send at
          <input type="datetime-local" value={sendAt} min={companyLocalInput(new Date())} onChange={(e) => setSendAt(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800" aria-label="Day and time to send" />
          <span className="text-xs text-gray-600 dark:text-slate-300">{zone ? `on the business's clock (${zone})` : "on the business's clock"}</span>
        </label>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={openLibrary} aria-label="Add a picture" aria-expanded={picking} className="rounded-lg border border-gray-300 px-2.5 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"><ImagePlus className="h-5 w-5" /></button>
        <button type="button" onClick={() => setLater((l) => !l)} aria-label="Send later" aria-pressed={later} className={`rounded-lg border px-2.5 ${later ? 'border-orange-600 bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200' : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'}`}><Clock className="h-5 w-5" /></button>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="Type a message..." maxLength={1600} aria-label="Message" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        <button type="button" onClick={send} disabled={busy} aria-label={later ? 'Set the text' : 'Send message'} className="rounded-lg bg-orange-700 px-4 py-2 text-white hover:bg-orange-800 disabled:opacity-50">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : later ? <Clock className="h-5 w-5" /> : <Send className="h-5 w-5" />}</button>
      </div>
    </div>
  )
}
