// The crew's own tools on a visit in the web field view (TechView's jobExtras / listExtras / photoActions), on the routes the phone
// app already uses — landscaping live test 11/08 found them only on the phone:
//   · the office's checklists for the job (Job Checklists, `job_checklists`): fill each in, a photo or signature question, and the
//     customer's signature on site when the checklist asks for it — POST /api/checklists/job/:id/submit (the server checks every
//     answer and refuses "Complete" while a required one is unfinished);
//   · each person's timer (crew_timers), materials used (visit_materials, picked by name from the price book — no prices) and
//     "Couldn't do it" (visit_skip) — /api/crew-day/visits/:id/…;
//   · Finish Day (crew_day_map): the day's recap — GET /api/crew-day/day;
//   · drawing on a photo (photo_markup) — roofing's editor, PUT /api/photo-markup/:photoId.
// Each part shows only where its switch is on; every write is jobs:update on the server, as on the phone.
import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, Clock, Flag, Loader2, Package, PenLine, Play, Square, Trash2, X } from 'lucide-react'
import { api } from '../api'
import { useAuth, useMayWrite, useToast, errorText } from '../shared'
import { SignaturePad } from '@twomiah/tenant-ui/src/portal/SignaturePad'
import PhotoMarkupEditor from './pages/roof/jobs/PhotoMarkupEditor'

const card = 'bg-white rounded-xl p-4 shadow-sm dark:bg-slate-900'
const heading = 'text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5'
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50'
const main = `${btn} bg-green-700 text-white`
const soft = `${btn} border border-gray-300 text-gray-900 dark:border-slate-600 dark:text-slate-100`
const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const rows = (r: any) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [])
const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 32)
type JobLite = { id: string; status: string; number: string; title: string }
const closed = (s: string) => s === 'completed' || s === 'cancelled'

// ── The office's checklists ──
interface Field { id: string; label: string; type: string; required: boolean; options?: string[] }
export interface Template { id: string; name: string; description?: string | null; fields: Field[]; requireSignature: boolean; requirePhoto: boolean }
interface Answer { value?: string; choices?: string[]; photos?: string[]; signature?: string }

// Also the office's, on the job page (checklistLife.tsx JobChecklistsPanel — field service re-check 11/10: only Tech View could fill one in).
export function ChecklistForm({ job, tpl, onClose, onSent }: { job: JobLite; tpl: Template; onClose: () => void; onSent: () => void }) {
  const toast = useToast()
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [notes, setNotes] = useState('')
  const [signFor, setSignFor] = useState<string | null>(null)   // a signature question's id, or 'customer'
  const [customer, setCustomer] = useState<{ signature: string; signedBy: string; consent: boolean }>({ signature: '', signedBy: '', consent: false })
  const [busy, setBusy] = useState(false)
  const set = (id: string, a: Answer) => setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], ...a } }))
  const photo = async (f: Field, file: File | undefined) => {
    if (!file) return
    const fd = new FormData(); fd.append('photo', file)
    try { const r: any = await (api as any).upload(`/api/checklists/job/${job.id}/photos`, fd); set(f.id, { photos: [...(answers[f.id]?.photos ?? []), r.url] }) }
    catch (e) { toast.error(errorText(e, 'The photo could not be added')) }
  }
  const send = async () => {
    setBusy(true)
    try {
      const body: any = {
        id: newId(), templateId: tpl.id, overallNotes: notes || undefined,
        answers: tpl.fields.filter((f) => f.type !== 'section').map((f) => ({ id: f.id, value: answers[f.id]?.value ?? '', choices: answers[f.id]?.choices, photos: answers[f.id]?.photos, signature: answers[f.id]?.signature })),
      }
      if (tpl.requireSignature && customer.signature) body.signature = customer
      await api.post(`/api/checklists/job/${job.id}/submit`, body)
      toast.success(tpl.requireSignature && !customer.signature ? `${tpl.name} saved — it still needs the customer to sign` : `${tpl.name} saved`)
      onSent()
    } catch (e) { toast.error(errorText(e, 'The checklist was not saved')) } finally { setBusy(false) }
  }
  const pick = (f: Field, v: string) => set(f.id, { value: answers[f.id]?.value === v ? '' : v })
  const choice = (opts: string[], f: Field, words: Record<string, string> = {}) => (
    <div className="flex flex-wrap gap-2">{opts.map((o) => <button key={o} type="button" aria-pressed={answers[f.id]?.value === o} onClick={() => pick(f, o)} className={answers[f.id]?.value === o ? main : soft}>{words[o] ?? o}</button>)}</div>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label={tpl.name}>
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-slate-900 sm:max-w-lg sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">{tpl.name}</h3><button type="button" aria-label="Close" onClick={onClose} className="p-2"><X className="h-5 w-5" /></button></div>
        {tpl.description && <p className="mb-3 text-sm text-gray-700 dark:text-slate-300">{tpl.description}</p>}
        <div className="space-y-4">
          {tpl.fields.map((f) => f.type === 'section' ? <h4 key={f.id} className="border-b pt-2 font-semibold text-gray-900 dark:border-slate-700 dark:text-slate-100">{f.label}</h4> : (
            <div key={f.id}>
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-slate-100">{f.label}{f.required ? ' *' : ''}</label>
              {f.type === 'pass_fail' && choice(['pass', 'fail', 'attention'], f, { pass: 'Pass', fail: 'Fail', attention: 'Needs attention' })}
              {f.type === 'yes_no' && choice(['yes', 'no'], f, { yes: 'Yes', no: 'No' })}
              {f.type === 'text' && <textarea className={field} rows={2} value={answers[f.id]?.value ?? ''} onChange={(e) => set(f.id, { value: e.target.value })} />}
              {f.type === 'number' && <input className={field} inputMode="decimal" value={answers[f.id]?.value ?? ''} onChange={(e) => set(f.id, { value: e.target.value })} />}
              {f.type === 'date' && <input className={field} type="date" value={answers[f.id]?.value ?? ''} onChange={(e) => set(f.id, { value: e.target.value })} />}
              {f.type === 'dropdown' && <select className={field} value={answers[f.id]?.value ?? ''} onChange={(e) => set(f.id, { value: e.target.value })}><option value="">Pick one</option>{(f.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>}
              {f.type === 'multi_select' && <div className="flex flex-wrap gap-3">{(f.options ?? []).map((o) => {
                const on = (answers[f.id]?.choices ?? []).includes(o)
                return <label key={o} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={on} onChange={() => set(f.id, { choices: on ? (answers[f.id]?.choices ?? []).filter((x) => x !== o) : [...(answers[f.id]?.choices ?? []), o] })} />{o}</label>
              })}</div>}
              {f.type === 'photo' && <div className="space-y-2">
                {(answers[f.id]?.photos ?? []).length > 0 && <p className="text-sm text-gray-700 dark:text-slate-300">{answers[f.id]!.photos!.length} photo{answers[f.id]!.photos!.length === 1 ? '' : 's'} added</p>}
                <label className={`${soft} cursor-pointer`}>Take or add a photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => photo(f, e.target.files?.[0])} /></label>
              </div>}
              {f.type === 'signature' && (answers[f.id]?.signature
                ? <p className="text-sm text-green-800 dark:text-green-300">Signed <button type="button" className="underline" onClick={() => set(f.id, { signature: undefined })}>Sign again</button></p>
                : signFor === f.id ? <SignaturePad width={420} height={160} onSave={(d) => { set(f.id, { signature: d }); setSignFor(null) }} onCancel={() => setSignFor(null)} />
                : <button type="button" className={soft} onClick={() => setSignFor(f.id)}>Sign</button>)}
            </div>
          ))}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-slate-100">Notes (optional)</label>
            <textarea className={field} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {tpl.requireSignature && (
            <div className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
              <p className="mb-2 text-sm font-semibold text-gray-900 dark:text-slate-100">The customer signs</p>
              {customer.signature
                ? <p className="text-sm text-green-800 dark:text-green-300">Signed <button type="button" className="underline" onClick={() => setCustomer({ ...customer, signature: '' })}>Sign again</button></p>
                : signFor === 'customer' ? <SignaturePad width={420} height={160} onSave={(d) => { setCustomer({ ...customer, signature: d }); setSignFor(null) }} onCancel={() => setSignFor(null)} />
                : <button type="button" className={soft} onClick={() => setSignFor('customer')}>Customer signs here</button>}
              <input className={`${field} mt-2`} placeholder="Customer's full name" value={customer.signedBy} onChange={(e) => setCustomer({ ...customer, signedBy: e.target.value })} />
              <label className="mt-2 flex items-start gap-2 text-sm text-gray-800 dark:text-slate-200"><input type="checkbox" className="mt-1" checked={customer.consent} onChange={(e) => setCustomer({ ...customer, consent: e.target.checked })} />The customer agrees to sign electronically.</label>
              <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">Saved without a signature, it waits for the customer to sign.</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-2"><button type="button" className={soft} onClick={onClose}>Cancel</button><button type="button" className={`${main} flex-1`} disabled={busy} onClick={send}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save checklist</button></div>
      </div>
    </div>
  )
}

function OfficeChecklists({ job, refresh }: { job: JobLite; refresh: () => void }) {
  const { hasFeature } = useAuth()
  const mayWrite = useMayWrite('jobs:update')
  const [view, setView] = useState<{ templates: Template[]; outstanding: Array<{ templateId: string; why: string; required: boolean }>; submissions: Array<{ templateId: string; status: string }> } | null>(null)
  const [open, setOpen] = useState<Template | null>(null)
  const load = useCallback(() => { api.get(`/api/checklists/job/${job.id}`).then((r: any) => setView(r)).catch(() => setView(null)) }, [job.id])
  useEffect(() => { if (hasFeature('job_checklists')) load() }, [hasFeature, load])
  if (!hasFeature('job_checklists') || !view || !view.templates.length) return null
  const owed = new Map(view.outstanding.map((o) => [o.templateId, o]))
  return (
    <div className={card}>
      <h3 className={heading}><ClipboardCheck className="h-4 w-4" aria-hidden />Checklists</h3>
      <ul className="space-y-2">
        {view.templates.map((t) => {
          const o = owed.get(t.id)
          return (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-900 dark:text-slate-100">
              <span>{t.name} <span className="text-gray-600 dark:text-slate-400">· {!o ? 'Done' : o.why === 'needs the customer to sign' ? 'Needs the customer to sign' : `Not filled in yet${o.required ? ' (needed to finish)' : ''}`}</span></span>
              {mayWrite && o && !closed(job.status) && <button type="button" className={soft} onClick={() => setOpen(t)}>{o.why === 'needs the customer to sign' ? 'Fill in again' : 'Fill in'}</button>}
            </li>
          )
        })}
      </ul>
      {open && <ChecklistForm job={job} tpl={open} onClose={() => setOpen(null)} onSent={() => { setOpen(null); load(); refresh() }} />}
    </div>
  )
}

// ── Each person's timer ──
function CrewTimers({ job }: { job: JobLite }) {
  const toast = useToast()
  const mayWrite = useMayWrite('jobs:update')
  const [crew, setCrew] = useState<Array<{ key: string; name: string; running: boolean; hours: number }> | null>(null)
  const load = useCallback(() => { api.get(`/api/crew-day/visits/${job.id}/crew`).then((r: any) => setCrew(rows(r))).catch(() => setCrew(null)) }, [job.id])
  useEffect(() => { load() }, [load])
  if (!crew || !crew.length) return null
  const tap = async (key: string, action: 'start' | 'stop', name: string) => {
    try { await api.post(`/api/crew-day/visits/${job.id}/crew/${encodeURIComponent(key)}/${action}`, { tappedAt: new Date().toISOString() }); toast.success(`${name}: timer ${action === 'start' ? 'started' : 'stopped'}`); load() }
    catch (e) { toast.error(errorText(e, 'The timer was not changed')) }
  }
  return (
    <div className={card}>
      <h3 className={heading}><Clock className="h-4 w-4" aria-hidden />Crew time</h3>
      <ul className="space-y-2">{crew.map((p) => (
        <li key={p.key} className="flex items-center justify-between gap-2 text-sm text-gray-900 dark:text-slate-100">
          <span>{p.name} <span className="text-gray-600 dark:text-slate-400">· {Math.round(p.hours * 100) / 100} h{p.running ? ' · running' : ''}</span></span>
          {mayWrite && !closed(job.status) && (p.running
            ? <button type="button" className={soft} onClick={() => tap(p.key, 'stop', p.name)}><Square className="h-4 w-4" aria-hidden />Stop</button>
            : <button type="button" className={main} onClick={() => tap(p.key, 'start', p.name)}><Play className="h-4 w-4" aria-hidden />Start</button>)}
        </li>
      ))}</ul>
    </div>
  )
}

// ── Materials used ──
function Materials({ job }: { job: JobLite }) {
  const toast = useToast()
  const mayWrite = useMayWrite('jobs:update')
  const [list, setList] = useState<Array<{ id: string; name: string; quantity: number; unit: string | null }> | null>(null)
  const [catalog, setCatalog] = useState<Array<{ id: string; name: string; unit: string }>>([])
  const [form, setForm] = useState({ pick: '', name: '', quantity: '', unit: '' })
  const load = useCallback(() => { api.get(`/api/crew-day/visits/${job.id}/materials`).then((r: any) => setList(rows(r))).catch(() => setList(null)) }, [job.id])
  useEffect(() => { load(); api.get('/api/crew-day/materials-catalog').then((r: any) => setCatalog(rows(r))).catch(() => setCatalog([])) }, [load])
  if (!list) return null
  const add = async () => {
    const quantity = Number(form.quantity)
    try {
      await api.post(`/api/crew-day/visits/${job.id}/materials`, { ...(form.pick ? { pricebookItemId: form.pick } : { name: form.name }), quantity, unit: form.unit || undefined, entryKey: newId() })
      toast.success('Material added'); setForm({ pick: '', name: '', quantity: '', unit: '' }); load()
    } catch (e) { toast.error(errorText(e, 'The material was not added')) }
  }
  const remove = async (id: string) => { try { await api.delete(`/api/crew-day/visits/${job.id}/materials/${id}`); toast.success('Material removed'); load() } catch (e) { toast.error(errorText(e, 'Not removed')) } }
  return (
    <div className={card}>
      <h3 className={heading}><Package className="h-4 w-4" aria-hidden />Materials used</h3>
      {list.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">Nothing recorded yet.</p> : (
        <ul className="mb-3 space-y-1">{list.map((m) => (
          <li key={m.id} className="flex items-center justify-between text-sm text-gray-900 dark:text-slate-100"><span>{m.quantity} {m.unit || ''} {m.name}</span>
            {mayWrite && !closed(job.status) && <button type="button" aria-label={`Remove ${m.name}`} onClick={() => remove(m.id)} className="p-1 text-red-700 dark:text-red-300"><Trash2 className="h-4 w-4" /></button>}</li>
        ))}</ul>
      )}
      {mayWrite && !closed(job.status) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]">
          {catalog.length > 0
            ? <select aria-label="Material" className={field} value={form.pick} onChange={(e) => { const p = catalog.find((x) => x.id === e.target.value); setForm({ ...form, pick: e.target.value, unit: p?.unit || form.unit }) }}><option value="">Type one in below, or pick…</option>{catalog.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            : null}
          {!form.pick && <input aria-label="Material name" className={field} placeholder="Material (e.g. Mulch)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          <input aria-label="How much" className={field} inputMode="decimal" placeholder="How much" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          <input aria-label="Unit" className={field} placeholder="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <button type="button" className={main} disabled={!form.quantity || (!form.pick && !form.name.trim())} onClick={add}>Add</button>
        </div>
      )}
    </div>
  )
}

// ── "Couldn't do it" ──
function CouldNotDo({ job, refresh }: { job: JobLite; refresh: () => void }) {
  const toast = useToast()
  const mayWrite = useMayWrite('jobs:update')
  const [reasons, setReasons] = useState<Array<{ id: string; label: string }>>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ reason: '', note: '', rebook: true })
  useEffect(() => { api.get('/api/crew-day/skip-reasons').then((r: any) => setReasons(rows(r))).catch(() => setReasons([])) }, [])
  if (!mayWrite || closed(job.status) || job.status === 'on_hold' || !reasons.length) return null
  const send = async () => {
    try { await api.post(`/api/crew-day/visits/${job.id}/skip`, { ...form, note: form.note || undefined, tappedAt: new Date().toISOString() }); toast.success('Marked as not done — the office has it'); setOpen(false); refresh() }
    catch (e) { toast.error(errorText(e, 'That was not saved')) }
  }
  return (
    <div className={card}>
      {!open ? <button type="button" className={`${soft} w-full`} onClick={() => setOpen(true)}><Flag className="h-4 w-4" aria-hidden />Couldn’t do it</button> : (
        <div className="space-y-2">
          <h3 className={heading}><Flag className="h-4 w-4" aria-hidden />Couldn’t do it</h3>
          <select aria-label="Why" className={field} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}><option value="">Why not?</option>{reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          <textarea aria-label="Note" className={field} rows={2} placeholder="Note for the office (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="checkbox" checked={form.rebook} onChange={(e) => setForm({ ...form, rebook: e.target.checked })} />Needs rebooking</label>
          <div className="flex gap-2"><button type="button" className={soft} onClick={() => setOpen(false)}>Cancel</button><button type="button" className={`${main} flex-1`} disabled={!form.reason} onClick={send}>Mark as not done</button></div>
        </div>
      )}
    </div>
  )
}

/** Under the Job card in the web field view. */
export function CrewJobExtras({ job, refresh }: { job: JobLite; refresh: () => void }) {
  const { hasFeature } = useAuth()
  return (
    <>
      <OfficeChecklists job={job} refresh={refresh} />
      {hasFeature('crew_timers') && <CrewTimers job={job} />}
      {hasFeature('visit_materials') && <Materials job={job} />}
      {hasFeature('visit_skip') && <CouldNotDo job={job} refresh={refresh} />}
    </>
  )
}

/** Above the day's list: Finish Day and its recap (Service Autopilot's). */
export function CrewFinishDay() {
  const { hasFeature } = useAuth()
  const toast = useToast()
  const [recap, setRecap] = useState<any | null>(null)
  const [busy, setBusy] = useState(false)
  if (!hasFeature('crew_day_map')) return null
  const finish = async () => {
    setBusy(true)
    try { const r: any = await api.get('/api/crew-day/day'); setRecap(r?.recap ?? null) } catch (e) { toast.error(errorText(e, 'The day could not be read')) } finally { setBusy(false) }
  }
  return (
    <div className="px-4 pt-3">
      <button type="button" className={`${soft} w-full`} disabled={busy} onClick={finish}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Finish Day</button>
      {recap && (
        <div className={`${card} mt-3 text-sm text-gray-900 dark:text-slate-100`} role="status">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Your day</h3><button type="button" aria-label="Close" onClick={() => setRecap(null)}><X className="h-4 w-4" /></button></div>
          <p>{recap.done} of {recap.stops} stop{recap.stops === 1 ? '' : 's'} done · {Math.round(recap.hours * 100) / 100} h on visits</p>
          {recap.couldNotDo?.length > 0 && <p className="mt-1">Couldn’t do: {recap.couldNotDo.map((v: any) => `${v.name} (${v.reason}${v.rebook ? ', to rebook' : ''})`).join('; ')}</p>}
          {recap.stillOpen?.length > 0 && <p className="mt-1 text-amber-800 dark:text-amber-300">Still open: {recap.stillOpen.map((v: any) => v.name).join('; ')}</p>}
          {recap.notesOutstanding?.length > 0 && <p className="mt-1">No note to the customer yet: {recap.notesOutstanding.map((v: any) => v.name).join('; ')}</p>}
        </div>
      )}
    </div>
  )
}

/** "Draw on it" in the photo viewer (photo_markup): roofing's editor; the marked copy sits beside the original. */
export function DrawOnPhoto({ photo, reload }: { photo: { id: string; url?: string; caption?: string }; reload: () => void }) {
  const { hasFeature } = useAuth()
  const [open, setOpen] = useState(false)
  if (!hasFeature('photo_markup')) return null
  return (
    <>
      <button type="button" aria-label="Draw on this photo" onClick={() => setOpen(true)} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"><PenLine className="h-5 w-5" /></button>
      {open && <PhotoMarkupEditor original={{ id: photo.id, url: photo.url, caption: photo.caption }} shapes={[]} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />}
    </>
  )
}
