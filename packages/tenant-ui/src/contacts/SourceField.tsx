// The Source field on the contact form: the company's list of source choices, plus "Other…" for a one-off. (T63)
//
// Owner, 2026-10-09: "anyone should be able to add a lead, but only managers should be able to add a source, like a
// dropdown … staff should be able to choose the lead source, and add an other for one offs, but not add actual lead
// source choices."
//
//   · Everyone picks from the list (GET /api/contacts/source-options) or chooses Other and types a one-off. The
//     one-off is saved on THIS contact only — contact.source is free text — and never joins the list.
//   · Managers and up (leads:update, what PUT /api/contacts/source-options asks) also get "Edit choices".
//   · A contact saved before the list existed keeps what was typed: it shows as Other with that text, not as blank.
//   · If the list cannot be loaded, the field is the plain text box it always was — the form must never be the
//     thing that stops somebody recording a lead.
import { useState, useEffect } from 'react'
import { X, Plus } from 'lucide-react'
import { Field, inputCls, errMsg } from '../invoicing/ui'
import { useMayWrite } from '../auth/PermissionsContext'

const OTHER = '__other__'

interface SourceFieldProps {
  api: { get: (path: string, params?: any) => Promise<any>; put: (path: string, body: any) => Promise<any> }
  value: string
  onChange: (value: string) => void
  toast: { success: (m: string) => void; error: (m: string) => void }
}

export function SourceField({ api, value, onChange, toast }: SourceFieldProps) {
  // "Edit choices" is PUT /api/contacts/source-options — leads:update, owners/admins/managers. Asked here, by the
  // control that writes, not handed in by the page.
  const canManage = useMayWrite('leads:update')
  const [options, setOptions] = useState<string[] | null>(null)
  const [pickedOther, setPickedOther] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const [newChoice, setNewChoice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.get('/api/contacts/source-options')
      .then((r: any) => { if (!cancelled) setOptions(Array.isArray(r?.options) ? r.options : []) })
      .catch(() => { if (!cancelled) setOptions([]) })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // No list (still loading, refused, or empty and nobody to fill it): the old text box.
  if (options === null || (options.length === 0 && !canManage)) {
    return <Field label="Source"><input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} placeholder="Referral, Website, etc." /></Field>
  }

  const match = options.find((o) => o.toLowerCase() === String(value || '').trim().toLowerCase())
  const isOther = pickedOther || (!!value && !match)
  const selectValue = isOther ? OTHER : (match || '')

  const pick = (v: string) => {
    if (v === OTHER) { setPickedOther(true); onChange(match ? '' : value); return }
    setPickedOther(false)
    onChange(v)
  }

  const startEdit = () => { setDraft(options); setNewChoice(''); setEditing(true) }
  const addDraft = () => {
    const v = newChoice.trim().replace(/\s+/g, ' ')
    if (!v) return
    if (v.toLowerCase() === 'other') { toast.error('"Other" is always offered — add the sources you actually see.'); return }
    if (draft.some((d) => d.toLowerCase() === v.toLowerCase())) { toast.error(`"${v}" is already a choice.`); return }
    setDraft([...draft, v]); setNewChoice('')
  }
  const saveDraft = async () => {
    setSaving(true)
    try {
      const r = await api.put('/api/contacts/source-options', { options: draft })
      setOptions(Array.isArray(r?.options) ? r.options : draft)
      setEditing(false)
      toast.success('Source choices saved')
    } catch (err) { toast.error(errMsg(err, 'Could not save the source choices')) } finally { setSaving(false) }
  }

  return (
    <div className={editing ? 'md:col-span-2' : undefined}>
      <Field label="Source">
        <select value={selectValue} onChange={(e) => pick(e.target.value)} className={inputCls}>
          <option value="">Choose a source…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={OTHER}>Other…</option>
        </select>
      </Field>
      {isOther && (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} mt-2`}
          placeholder="Where did this one come from?" aria-label="Other source" maxLength={120} />
      )}
      {canManage && !editing && (
        <button type="button" onClick={startEdit} className="mt-1 text-xs text-orange-700 hover:underline dark:text-orange-300">Edit choices</button>
      )}
      {canManage && editing && (
        <div className="mt-2 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
          <p className="text-xs text-gray-600 mb-2 dark:text-slate-300">The choices everyone picks from. "Other" is always there for one-offs.</p>
          <ul className="flex flex-wrap gap-2 mb-2">
            {draft.map((d) => (
              <li key={d} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-800 dark:bg-slate-800 dark:text-slate-100">
                {d}
                <button type="button" onClick={() => setDraft(draft.filter((x) => x !== d))} aria-label={`Remove ${d}`} className="text-gray-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"><X className="w-3 h-3" /></button>
              </li>
            ))}
            {draft.length === 0 && <li className="text-xs text-gray-500 dark:text-slate-400">No choices — everyone will type their own under Other.</li>}
          </ul>
          <div className="flex gap-2">
            <input type="text" value={newChoice} onChange={(e) => setNewChoice(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft() } }}
              className={inputCls} placeholder="e.g. Yard sign" maxLength={40} aria-label="New source choice" />
            <button type="button" onClick={addDraft} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 text-sm text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"><Plus className="w-3 h-3" />Add</button>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
            <button type="button" onClick={saveDraft} disabled={saving} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">{saving ? 'Saving…' : 'Save choices'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
