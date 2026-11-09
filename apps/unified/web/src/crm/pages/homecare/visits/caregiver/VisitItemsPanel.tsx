// Inside a visit on the caregiver's web view (care_visit_items): forms to fill in, interventions, goals and the tasks for every
// visit — the phone app's (apps/mobile/src/care/components/VisitItems.tsx), here too. Home care live re-check 11/08: a required
// item ("Wash hands on arrival") refused the web clock-out while nothing on the web visit screen showed it.
//   GET  /api/visit-items/visit/:id                 the items and what is recorded (403/404 without the feature: nothing shows)
//   PUT  /api/visit-items/visit/:id/:itemId         { status: done | skipped | refused, note?, rating? }
//   POST /api/visit-items/visit/:id/:itemId/form    { data, signature? }
//   GET  /api/forms/templates/:id                   the form's fields
import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/http'
import { useMayWrite, useToast } from '../../../../../shared'
import SignaturePad from '../../lib/SignaturePad'

interface Item { id: string; kind: 'form' | 'intervention' | 'goal' | 'general_task'; name: string; detail: string | null; formTemplateId: string | null; required: boolean; status: string | null; rating: string | null; note: string | null }
interface FormField { id: string; label?: string; type: string; required?: boolean; options?: string[] }
const HEAD: Record<Item['kind'], string> = { form: 'Forms', intervention: 'Interventions', goal: 'Goals', general_task: 'Tasks for every visit' }
const STATE: Record<string, string> = { done: 'Done', skipped: 'Skipped', refused: 'Refused' }
const RATINGS = [{ value: 'progress', label: 'Progress' }, { value: 'no_change', label: 'No change' }, { value: 'declined', label: 'Declined' }]
const box = 'w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const btn = 'rounded-md border px-3 py-1.5 text-sm font-semibold'
const btnMain = `${btn} border-teal-700 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-700`
const btnSoft = `${btn} border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100`

const blank = (f: FormField, v: unknown) => f.type === 'checkbox' ? (f.options?.length ? !(Array.isArray(v) && v.length) : !v) : v === undefined || v === null || String(v).trim() === ''

function FormSheet({ item, visitId, onClose, onSent }: { item: Item; visitId: string; onClose: () => void; onSent: () => void }) {
  const toast = useToast()
  const [fields, setFields] = useState<FormField[] | null>(null)
  const [needsSignature, setNeedsSignature] = useState(false)
  const [data, setData] = useState<Record<string, unknown>>({})
  const [missing, setMissing] = useState<string[]>([])
  const [signing, setSigning] = useState(false)
  useEffect(() => {
    api.get(`/api/forms/templates/${item.formTemplateId}`).then((t: any) => { setFields(Array.isArray(t?.fields) ? t.fields : []); setNeedsSignature(!!t?.requiresSignature) })
      .catch((e) => { toast.error(errorMessage(e, 'The form did not load')); onClose() })
  }, [item.formTemplateId]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (signature?: string) => {
    const miss = (fields || []).filter((f) => f.required && f.type !== 'section' && blank(f, data[f.id])).map((f) => f.label || f.id)
    if (miss.length) { setMissing(miss); toast.error(`Please answer: ${miss.join(' · ')}`); return }
    try {
      await api.post(`/api/visit-items/visit/${visitId}/${item.id}/form`, { data, ...(signature ? { signature } : {}), savedAt: new Date().toISOString() })
      toast.success(`${item.name} saved`); onSent(); onClose()
    } catch (e) { toast.error(errorMessage(e, 'The form was not saved')) }
  }
  const set = (id: string, v: unknown) => { setData((d) => ({ ...d, [id]: v })); setMissing([]) }
  return (
    <div className="fixed inset-0 z-[2050] flex items-end justify-center bg-black/50 p-2 sm:items-center" role="dialog" aria-modal="true" aria-label={item.name}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 text-gray-900 dark:bg-slate-900 dark:text-slate-100">
        <h3 className="mb-3 text-lg font-extrabold">{item.name}</h3>
        {fields === null ? <p>Loading…</p> : fields.map((f) => {
          const bad = missing.includes(f.label || f.id)
          const label = `${f.label || f.id}${f.required ? ' *' : ''}`
          if (f.type === 'section') return <h4 key={f.id} className="mb-2 mt-3 font-bold">{f.label}</h4>
          if ((f.type === 'select' || f.type === 'radio' || f.type === 'checkbox') && f.options?.length) {
            const multi = f.type === 'checkbox'
            const on = (o: string) => multi ? Array.isArray(data[f.id]) && (data[f.id] as string[]).includes(o) : data[f.id] === o
            return (
              <div key={f.id} className="mb-3" role={multi ? 'group' : 'radiogroup'} aria-label={f.label}>
                <div className="text-sm font-semibold">{label}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {f.options.map((o) => <button key={o} type="button" aria-pressed={on(o)} onClick={() => set(f.id, multi ? (on(o) ? (data[f.id] as string[]).filter((x) => x !== o) : [...((data[f.id] as string[]) || []), o]) : o)}
                    className={on(o) ? btnMain : btnSoft}>{o}</button>)}
                </div>
                {bad && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">This question needs an answer.</p>}
              </div>
            )
          }
          if (f.type === 'checkbox') return (
            <label key={f.id} className="mb-3 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!data[f.id]} onChange={(e) => set(f.id, e.target.checked)} />{label}</label>
          )
          return (
            <label key={f.id} className="mb-3 block text-sm font-semibold">{label}
              {f.type === 'textarea'
                ? <textarea rows={3} className={`${box} mt-1`} value={String(data[f.id] ?? '')} onChange={(e) => set(f.id, e.target.value)} />
                : <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} className={`${box} mt-1`} value={String(data[f.id] ?? '')} onChange={(e) => set(f.id, e.target.value)} />}
              {bad && <span role="alert" className="mt-1 block text-sm text-red-700 dark:text-red-300">This question needs an answer.</span>}
            </label>
          )
        })}
        <div className="mt-3 flex gap-2">
          <button type="button" className={btnSoft} onClick={onClose}>Cancel</button>
          {fields && (needsSignature
            ? <button type="button" className={btnMain} onClick={() => setSigning(true)}>Sign and save</button>
            : <button type="button" className={btnMain} onClick={() => send()}>Save form</button>)}
        </div>
      </div>
      <SignaturePad open={signing} onClose={() => setSigning(false)} documentName={item.name} requireTypedName={false}
        onSign={async (uri) => { setSigning(false); await send(uri) }} />
    </div>
  )
}

function ItemRow({ item, onRecord, onForm, mayRecord, mayForm }: { item: Item; onRecord: (status: 'done' | 'skipped' | 'refused', extra?: { note?: string; rating?: string }) => Promise<void>; onForm: () => void; mayRecord: boolean; mayForm: boolean }) {
  const [ask, setAsk] = useState<null | 'skipped' | 'refused' | 'rating'>(null)
  const [note, setNote] = useState(item.note || '')
  const settled = !!item.status
  const rating = RATINGS.find((r) => r.value === item.rating)?.label
  const needsReason = ask === 'refused' || (ask === 'skipped' && item.required)
  return (
    <div className={`mb-2 rounded-lg border p-3 ${settled ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40' : 'border-gray-200 dark:border-slate-700'}`}>
      <div className="font-bold">{item.name}{item.required ? ' · Required' : ''}</div>
      {item.detail && <div className="text-sm text-gray-600 dark:text-slate-300">{item.detail}</div>}
      {settled && <div className="text-sm font-semibold">{STATE[item.status!] ?? item.status}{rating ? ` · ${rating}` : ''}{item.note ? ` · ${item.note}` : ''}</div>}
      {ask ? (
        <div className="mt-2 flex flex-col gap-2">
          {ask === 'rating' && <div className="flex flex-wrap gap-2">{RATINGS.map((r) => <button key={r.value} type="button" className={btnSoft} onClick={async () => { await onRecord('done', { rating: r.value, note }); setAsk(null) }}>{r.label}</button>)}</div>}
          <label className="text-sm">{ask === 'rating' ? 'Note (optional)' : ask === 'refused' ? 'Why did the client refuse? (required)' : item.required ? 'Why are you skipping it? (required)' : 'Reason (optional)'}
            <textarea rows={2} className={`${box} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="flex gap-2">
            {ask !== 'rating' && <button type="button" className={btnMain} disabled={needsReason && !note.trim()} onClick={async () => { await onRecord(ask, { note }); setAsk(null) }}>{ask === 'refused' ? 'Mark refused' : 'Mark skipped'}</button>}
            <button type="button" className={btnSoft} onClick={() => setAsk(null)}>Cancel</button>
          </div>
        </div>
      ) : (mayRecord || (item.kind === 'form' && mayForm)) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {item.kind === 'form'
            ? mayForm && <button type="button" className={btnMain} onClick={onForm}>{item.status === 'done' ? 'Fill in again' : 'Fill in'}</button>
            : item.kind === 'goal'
              ? <button type="button" className={btnMain} onClick={() => setAsk('rating')}>How did it go?</button>
              : <button type="button" className={btnMain} onClick={() => onRecord('done')}>Done</button>}
          {mayRecord && item.status !== 'skipped' && <button type="button" className={btnSoft} onClick={() => setAsk('skipped')}>Skip</button>}
          {mayRecord && item.status !== 'refused' && <button type="button" className={btnSoft} onClick={() => setAsk('refused')}>Refused</button>}
        </div>
      )}
    </div>
  )
}

export default function VisitItemsPanel({ timeEntryId }: { timeEntryId: string }) {
  const toast = useToast()
  // What the routes ask: recording an item, evv:update; saving a form, evv:create (server/crm/homecare/visits/visitItems.ts).
  const mayRecord = useMayWrite('evv:update')
  const mayForm = useMayWrite('evv:create')
  const [items, setItems] = useState<Item[] | null>(null)
  const [form, setForm] = useState<Item | null>(null)
  const load = useCallback(() => {
    api.get(`/api/visit-items/visit/${timeEntryId}`).then((r: any) => setItems(Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [])).catch(() => setItems(null))
  }, [timeEntryId])
  useEffect(() => { load() }, [load])
  const record = async (item: Item, status: 'done' | 'skipped' | 'refused', extra?: { note?: string; rating?: string }) => {
    try {
      await api.put(`/api/visit-items/visit/${timeEntryId}/${item.id}`, { status, note: extra?.note || null, rating: extra?.rating, savedAt: new Date().toISOString() })
      setItems((prev) => (prev || []).map((x) => (x.id === item.id ? { ...x, status, note: extra?.note || null, rating: extra?.rating ?? null } : x)))
      toast.success(`${item.name}: ${STATE[status]}`)
    } catch (e) { toast.error(errorMessage(e, 'That was not saved')) }
  }
  if (!items || !items.length) return null
  return (
    <div className="p-3" data-testid="visit-items-panel">
      {(['form', 'intervention', 'goal', 'general_task'] as const).map((k) => {
        const list = items.filter((i) => i.kind === k)
        if (!list.length) return null
        return (
          <div key={k}>
            <h4 className="mb-2 mt-1 font-extrabold text-gray-900 dark:text-slate-100">{HEAD[k]}</h4>
            {list.map((i) => <ItemRow key={i.id} item={i} onRecord={(s, e) => record(i, s, e)} onForm={() => setForm(i)} mayRecord={mayRecord} mayForm={mayForm} />)}
          </div>
        )
      })}
      {items.some((i) => i.required && !i.status) && <p role="status" className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Finish the items marked Required before you clock out.</p>}
      {form && <FormSheet item={form} visitId={timeEntryId} onClose={() => setForm(null)} onSent={() => setItems((prev) => (prev || []).map((x) => (x.id === form.id ? { ...x, status: 'done' } : x)))} />}
    </div>
  )
}
