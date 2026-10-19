// Moved from templates/crm-homecare/frontend/src/components/admin/FormBuilder.tsx — create custom forms, fill & submit
// them against clients / caregivers, and print a submission. (server/crm/homecare/clients/forms.ts: templates and
// submissions are camelCase — requiresSignature, autoAttachTo, isBuiltIn, submissionCount, templateName, entityName …)
import { useState, useEffect, type CSSProperties } from 'react'
import { useConfirm } from '../../../../shared'
import { api, rows, downloadBlob, saveBlob, errorMessage } from '../lib/http'
import { formatAgencyDate } from '../lib/agencyClock'
import { allRows, type Client, type Caregiver } from './shared'
import { useMay } from '../lib/useMay'

const FIELD_TYPES = [
  { value: 'text', label: 'Text Input', icon: '✏️' },
  { value: 'textarea', label: 'Long Text', icon: '📄' },
  { value: 'select', label: 'Dropdown', icon: '🔽' },
  { value: 'checkbox', label: 'Checkbox', icon: '☑️' },
  { value: 'radio', label: 'Multiple Choice', icon: '🔘' },
  { value: 'number', label: 'Number', icon: '🔢' },
  { value: 'date', label: 'Date', icon: '📅' },
  { value: 'section', label: 'Section Heading', icon: '🔖' },
]

interface FormField {
  id: string
  type: string
  label: string
  required?: boolean
  options?: string[]
  inputType?: string
}

/** A form template (GET /api/forms/templates?active=all). */
interface FormTemplate {
  id: string | null
  name: string
  description?: string | null
  category: string
  requiresSignature: boolean
  autoAttachTo?: string | null
  isActive: boolean
  isBuiltIn?: boolean
  submissionCount?: number
  fields: FormField[] | string
}
type EditableTemplate = Omit<FormTemplate, 'fields'> & { fields: FormField[] }

/** A submission (GET /api/forms/submissions). */
interface Submission {
  id: string
  templateName?: string | null
  category?: string | null
  entityName?: string | null
  entityType?: string | null
  submittedByName?: string | null
  createdAt: string
  status: string
}

type Answer = string | boolean | string[]

// A checkbox field with options is multi-select (value = array); without options it's a single Yes box.
const isMultiCheck = (f: FormField) => f.type === 'checkbox' && Array.isArray(f.options) && f.options.length > 0
const isEmptyAnswer = (f: FormField, v: Answer | undefined) => isMultiCheck(f)
  ? !(Array.isArray(v) && v.length)
  : (f.type === 'checkbox' ? !v : (v == null || String(v).trim() === ''))

const CATEGORIES = ['assessment', 'incident', 'physician_order', 'consent', 'intake', 'hr', 'general']

const genId = () => Math.random().toString(36).slice(2, 8)

const parseFields = (raw: FormTemplate['fields']): FormField[] => {
  if (Array.isArray(raw)) return raw
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

// Each category's colours: a chip (ink on its tint), a filled filter button (white on a deep shade) and the card's top
// rule. The template drew text in the category's mid colour on a 9% tint of it (amber on pale amber ~2:1) and white on
// mid amber / emerald (~2.2:1); every pair now reads in both themes.
const CAT: Record<string, { chip: string; solid: string; rule: string }> = {
  assessment: { chip: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200', solid: 'bg-blue-700 border-blue-700 text-white', rule: '#3B82F6' },
  incident: { chip: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200', solid: 'bg-red-700 border-red-700 text-white', rule: '#EF4444' },
  physician_order: { chip: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200', solid: 'bg-violet-700 border-violet-700 text-white', rule: '#8B5CF6' },
  consent: { chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200', solid: 'bg-amber-700 border-amber-700 text-white', rule: '#F59E0B' },
  intake: { chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200', solid: 'bg-emerald-700 border-emerald-700 text-white', rule: '#10B981' },
  hr: { chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200', solid: 'bg-indigo-700 border-indigo-700 text-white', rule: '#6366F1' },
  general: { chip: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-200', solid: 'bg-gray-700 border-gray-700 text-white', rule: '#6B7280' },
}
const catOf = (c?: string | null) => CAT[c || ''] || CAT.general

// Inputs and boxes on the frame's tokens (light and dark).
const box: CSSProperties = { padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--hc-line)', fontSize: '0.88rem' }
const wideBox: CSSProperties = { ...box, width: '100%', boxSizing: 'border-box' }
const fieldLabel: CSSProperties = { display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.3rem' }
const blueBtn: CSSProperties = { border: 'none', background: '#1D4ED8', color: '#fff', cursor: 'pointer', fontWeight: 700 }
const plainBtn: CSSProperties = { border: '1px solid var(--hc-line)', background: 'var(--hc-surface)', color: 'var(--hc-ink-soft)', cursor: 'pointer' }
const dashedEmpty: CSSProperties = { textAlign: 'center', padding: '3rem', color: 'var(--hc-muted)', background: 'var(--hc-subtle)', borderRadius: '10px', border: '2px dashed var(--hc-line)' }

// ── FORM FILLER ── (its own component, so the page re-rendering — a notice fading — never throws the answers away)
function FormFiller({ template, clients, caregivers, onClose, onSaved }: {
  template: FormTemplate; clients: Client[]; caregivers: Caregiver[]; onClose: () => void; onSaved: () => void
}) {
  const confirm = useConfirm()
  const [formData, setFormData] = useState<Record<string, Answer>>({})
  const [entityType, setEntityType] = useState(template.autoAttachTo === 'caregiver' ? 'caregiver' : 'client')
  const [entityId, setEntityId] = useState('')
  const [signature, setSignature] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fields = parseFields(template.fields)

  // Long forms (the in-home assessment) are filled out over 20+ minutes — never
  // throw the answers away on a stray tap outside the box.
  const requestClose = async () => {
    if (Object.keys(formData).length && !(await confirm('Close this form? Your answers will be lost.', { danger: true }))) return
    onClose()
  }

  const submit = async () => {
    setError('')
    if (!entityId) { setError(`Pick the ${entityType} this form is for.`); return }
    const missing = fields.filter((f) => f.required && f.type !== 'section' && isEmptyAnswer(f, formData[f.id])).map((f) => f.label)
    if (missing.length) { setError(`Please answer: ${missing.join(' · ')}`); return }

    setSaving(true)
    try {
      await api.post('/api/forms/submissions', {
        templateId: template.id, entityType, entityId, clientId: entityType === 'client' ? entityId : null, data: formData, status: 'submitted',
        signature: template.requiresSignature ? signature : undefined,
      })
      onSaved()
    } catch (e) { setError(`Not saved — ${errorMessage(e, 'Save failed')}. Your answers are still here; try again.`) }
    setSaving(false)
  }

  const setAnswer = (fid: string, v: Answer) => setFormData((d) => ({ ...d, [fid]: v }))
  const toggleOption = (fid: string, o: string) => setFormData((d) => {
    const cur = Array.isArray(d[fid]) ? (d[fid] as string[]) : []
    return { ...d, [fid]: cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o] }
  })
  const text = (fid: string) => (typeof formData[fid] === 'string' ? (formData[fid] as string) : '')

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: '12px', padding: '1.5rem', maxWidth: '760px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0 }}>{template.name}</h3>
            {template.description && <p style={{ margin: '0.25rem 0 0', color: 'var(--hc-muted)', fontSize: '0.85rem' }}>{template.description}</p>}
          </div>
          <button onClick={requestClose} aria-label="Close form" style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--hc-muted)' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--hc-line)' }}>
          <div>
            <label style={fieldLabel}>Attach to</label>
            <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setEntityId('') }} style={wideBox}>
              <option value="client">Client</option>
              <option value="caregiver">Caregiver</option>
            </select>
          </div>
          <div>
            <label style={fieldLabel}>{entityType === 'client' ? 'Client' : 'Caregiver'}</label>
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)} style={wideBox}>
              <option value="">Select...</option>
              {(entityType === 'client' ? clients : caregivers).map((p) => (
                <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
          {fields.map((field) => field.type === 'section' ? (
            <h4 key={field.id} className="mt-3 mb-0 pb-1 border-b-2 border-blue-100 text-blue-700 text-base font-bold dark:border-blue-900 dark:text-blue-300">{field.label}</h4>
          ) : (
            <div key={field.id}>
              <label style={{ ...fieldLabel, fontSize: '0.88rem', color: 'var(--hc-ink-soft)' }}>
                {field.label} {field.required && <span style={{ color: 'var(--hc-red-ink)' }}>*</span>}
              </label>
              {field.type === 'date' && (
                <input type="date" value={text(field.id)} onChange={(e) => setAnswer(field.id, e.target.value)} style={box} />
              )}
              {field.type === 'textarea' && (
                <textarea value={text(field.id)} onChange={(e) => setAnswer(field.id, e.target.value)} rows={3} style={{ ...wideBox, resize: 'vertical' }} />
              )}
              {(field.type === 'text' || field.type === 'number') && (
                <input type={field.inputType || field.type} value={text(field.id)} onChange={(e) => setAnswer(field.id, e.target.value)} style={wideBox} />
              )}
              {field.type === 'select' && (
                <select value={text(field.id)} onChange={(e) => setAnswer(field.id, e.target.value)} style={wideBox}>
                  <option value="">Select...</option>
                  {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {isMultiCheck(field) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {(field.options || []).map((o) => {
                    const cur = formData[field.id]
                    const on = Array.isArray(cur) && cur.includes(o)
                    return (
                      <label key={o} className={`flex items-center gap-1.5 cursor-pointer px-3 py-1 rounded-md border text-sm ${on ? 'border-orange-500 bg-orange-50 text-orange-900 dark:border-orange-400 dark:bg-orange-950 dark:text-orange-100' : 'border-gray-300 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleOption(field.id, o)} />
                        {o}
                      </label>
                    )
                  })}
                </div>
              )}
              {field.type === 'checkbox' && !isMultiCheck(field) && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!formData[field.id]} onChange={(e) => setAnswer(field.id, e.target.checked)} />
                  <span style={{ fontSize: '0.88rem' }}>Yes</span>
                </label>
              )}
              {field.type === 'radio' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {(field.options || []).map((o) => {
                    const on = formData[field.id] === o
                    return (
                      <label key={o} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', padding: '0.3rem 0.75rem', border: `1px solid ${on ? 'var(--hc-blue-ink)' : 'var(--hc-line)'}`, borderRadius: '20px', background: on ? 'var(--hc-info-bg)' : 'var(--hc-surface)', color: on ? 'var(--hc-info-ink)' : 'var(--hc-ink)', fontSize: '0.85rem' }}>
                        <input type="radio" name={field.id} value={o} checked={on} onChange={() => setAnswer(field.id, o)} style={{ display: 'none' }} />
                        {o}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {template.requiresSignature && (
          <div style={{ marginBottom: '1.25rem', padding: '0.85rem', background: 'var(--hc-warning-bg)', border: '1px solid var(--hc-warning-line)', borderRadius: '8px' }}>
            <label style={{ display: 'block', fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.35rem', color: 'var(--hc-warning-ink)' }}>✍️ Signature Required</label>
            <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Type full name to sign..."
              style={{ ...wideBox, border: '1px solid var(--hc-warning-line)', fontSize: '0.95rem', fontFamily: 'cursive' }} />
          </div>
        )}

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg text-sm font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={submit} disabled={saving || (template.requiresSignature && !signature)}
            style={{ ...blueBtn, flex: 1, padding: '0.7rem', borderRadius: '8px', fontSize: '0.92rem', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Submitting...' : '✓ Submit Form'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FormBuilder() {
  // Each control for whoever the server lets use it: templates are care-clients, filling one out is evv:create (lib/useMay.ts).
  const may = useMay('care-clients')
  const mayEvv = useMay('evv')
  const confirm = useConfirm()
  const [tab, setTab] = useState('templates')
  const [templates, setTemplates] = useState<FormTemplate[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [editTemplate, setEditTemplate] = useState<EditableTemplate | null>(null) // null = list, obj = edit
  const [fillModal, setFillModal] = useState<FormTemplate | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [caregivers, setCaregivers] = useState<Caregiver[]>([])
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [filterCat, setFilterCat] = useState('')

  const flash = (m: string, ok = true) => { setMsg({ text: m, ok }); setTimeout(() => setMsg(null), 3500) }

  const load = async () => {
    setLoading(true)
    try {
      const [tData, sData, cRows, cgRows] = await Promise.all([
        api.get('/api/forms/templates', { active: 'all' }),
        api.get('/api/forms/submissions', { limit: 100 }),
        allRows<Client>('/api/clients'),
        allRows<Caregiver>('/api/caregivers'),
      ])
      setTemplates(rows<FormTemplate>(tData))
      setSubmissions(rows<Submission>(sData))
      setClients(cRows)
      setCaregivers(cgRows)
    } catch (e) { flash(errorMessage(e, 'Could not load the forms'), false) }
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const newTemplate = () => setEditTemplate({
    id: null, name: '', description: '', category: 'general',
    requiresSignature: false, autoAttachTo: 'client', isActive: true,
    fields: [],
  })

  const saveTemplate = async () => {
    if (!editTemplate) return
    if (!editTemplate.name) { flash('Name is required', false); return }
    try {
      const body = {
        name: editTemplate.name, description: editTemplate.description, category: editTemplate.category,
        fields: editTemplate.fields, requiresSignature: editTemplate.requiresSignature,
        autoAttachTo: editTemplate.autoAttachTo, isActive: editTemplate.isActive,
      }
      if (editTemplate.id) await api.put(`/api/forms/templates/${editTemplate.id}`, body)
      else await api.post('/api/forms/templates', body)
      flash('Template saved')
      setEditTemplate(null)
      load()
    } catch (e) { flash('Error saving: ' + errorMessage(e), false) }
  }

  const deleteTemplate = async (id: string | null) => {
    if (!id || !(await confirm('Deactivate this template?'))) return
    try {
      await api.delete(`/api/forms/templates/${id}`)
      flash('Deactivated'); load()
    } catch (e) { flash(errorMessage(e, 'Failed to deactivate'), false) }
  }

  const deleteSubmission = async (id: string) => {
    if (!(await confirm('Delete this submission?', { danger: true }))) return
    try {
      await api.delete(`/api/forms/submissions/${id}`)
      flash('Submission deleted')
      load()
    } catch (e) { flash(errorMessage(e, 'Failed to delete'), false) }
  }

  const downloadPdf = async (s: Submission) => {
    try {
      const blob = await downloadBlob(`/api/forms/submissions/${s.id}/pdf`)
      saveBlob(blob, `${(s.templateName || 'form').replace(/[^a-zA-Z0-9_-]/g, '_')}-${String(s.id).slice(0, 8)}.pdf`)
    } catch (e) { flash('PDF download failed: ' + errorMessage(e, 'PDF failed'), false) }
  }

  // Field editing
  const addField = () => {
    const field: FormField = { id: genId(), type: 'text', label: '', required: false, options: [] }
    setEditTemplate((t) => (t ? { ...t, fields: [...t.fields, field] } : t))
  }
  const updateField = (idx: number, updates: Partial<FormField>) => setEditTemplate((t) => {
    if (!t) return t
    const fields = [...t.fields]; fields[idx] = { ...fields[idx], ...updates }; return { ...t, fields }
  })
  const removeField = (idx: number) => setEditTemplate((t) => (t ? { ...t, fields: t.fields.filter((_, i) => i !== idx) } : t))
  const moveField = (idx: number, dir: number) => setEditTemplate((t) => {
    if (!t) return t
    const fields = [...t.fields]
    const swap = idx + dir
    if (swap < 0 || swap >= fields.length) return t
    ;[fields[idx], fields[swap]] = [fields[swap], fields[idx]]
    return { ...t, fields }
  })

  const tabStyle = (t: string): CSSProperties => ({
    padding: '0.5rem 1rem', border: 'none', borderBottom: `3px solid ${tab === t ? 'var(--hc-blue-ink)' : 'transparent'}`, background: 'none', cursor: 'pointer',
    fontWeight: tab === t ? 700 : 400, color: tab === t ? 'var(--hc-blue-ink)' : 'var(--hc-muted)', fontSize: '0.92rem',
  })

  const filteredTemplates = filterCat ? templates.filter((t) => t.category === filterCat) : templates
  const pill = 'px-3 py-1 rounded-full border text-xs cursor-pointer'
  const pillOff = 'border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'

  // ── TEMPLATE EDITOR ──
  if (editTemplate) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '2px solid var(--hc-line)' }}>
        <button onClick={() => setEditTemplate(null)} style={{ background: 'var(--hc-subtle)', color: 'var(--hc-ink)', border: 'none', borderRadius: '8px', padding: '0.5rem 0.85rem', cursor: 'pointer', fontWeight: 600 }}>← Back</button>
        <h2 style={{ margin: 0 }}>{editTemplate.id ? 'Edit Template' : 'New Template'}</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', maxWidth: '700px', marginBottom: '1.25rem' }}>
        <div>
          <label style={{ ...fieldLabel, fontSize: '0.88rem' }}>Form Name *</label>
          <input value={editTemplate.name} onChange={(e) => setEditTemplate((t) => (t ? { ...t, name: e.target.value } : t))}
            placeholder="e.g. Initial Client Assessment"
            style={{ ...wideBox, padding: '0.6rem', borderRadius: '8px', border: '2px solid var(--hc-line)', fontSize: '0.92rem' }} />
        </div>
        <div>
          <label style={{ ...fieldLabel, fontSize: '0.88rem' }}>Category</label>
          <select value={editTemplate.category} onChange={(e) => setEditTemplate((t) => (t ? { ...t, category: e.target.value } : t))}
            style={{ ...wideBox, padding: '0.6rem', borderRadius: '8px', border: '2px solid var(--hc-line)', fontSize: '0.92rem' }}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ ...fieldLabel, fontSize: '0.88rem' }}>Description</label>
          <input value={editTemplate.description || ''} onChange={(e) => setEditTemplate((t) => (t ? { ...t, description: e.target.value } : t))}
            placeholder="Brief description..."
            style={{ ...wideBox, padding: '0.6rem', borderRadius: '8px', border: '2px solid var(--hc-line)', fontSize: '0.92rem' }} />
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', gridColumn: '1 / -1' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={editTemplate.requiresSignature} onChange={(e) => setEditTemplate((t) => (t ? { ...t, requiresSignature: e.target.checked } : t))} />
            <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>Requires Signature</span>
          </label>
          <div>
            <select value={editTemplate.autoAttachTo || 'client'} onChange={(e) => setEditTemplate((t) => (t ? { ...t, autoAttachTo: e.target.value } : t))}
              style={{ ...box, padding: '0.4rem 0.65rem', fontSize: '0.85rem' }}>
              <option value="client">Attach to Client</option>
              <option value="caregiver">Attach to Caregiver</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '700px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h4 style={{ margin: 0 }}>Fields ({editTemplate.fields.length})</h4>
          <button onClick={addField} style={{ ...blueBtn, padding: '0.4rem 0.9rem', borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem' }}>+ Add Field</button>
        </div>

        {editTemplate.fields.length === 0 && (
          <div style={{ ...dashedEmpty, padding: '2rem', marginBottom: '1rem' }}>
            No fields yet — click "Add Field" to start building
          </div>
        )}

        {editTemplate.fields.map((field, idx) => (
          <div key={field.id} style={{ background: 'var(--hc-subtle)', border: '1px solid var(--hc-line)', borderRadius: '10px', padding: '1rem', marginBottom: '0.6rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: '0.6rem', alignItems: 'center', marginBottom: '0.6rem' }}>
              <input value={field.label} onChange={(e) => updateField(idx, { label: e.target.value })} placeholder={`Field ${idx + 1} label...`} style={box} />
              <select value={field.type} onChange={(e) => updateField(idx, { type: e.target.value })} style={{ ...box, fontSize: '0.85rem' }}>
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button onClick={() => moveField(idx, -1)} disabled={idx === 0} style={{ background: 'none', color: 'var(--hc-ink)', border: '1px solid var(--hc-line)', borderRadius: '4px', cursor: 'pointer', padding: '0.25rem 0.4rem', opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
                <button onClick={() => moveField(idx, 1)} disabled={idx === editTemplate.fields.length - 1} style={{ background: 'none', color: 'var(--hc-ink)', border: '1px solid var(--hc-line)', borderRadius: '4px', cursor: 'pointer', padding: '0.25rem 0.4rem', opacity: idx === editTemplate.fields.length - 1 ? 0.3 : 1 }}>↓</button>
                <button onClick={() => removeField(idx)} style={{ background: 'none', border: '1px solid var(--hc-danger-line)', borderRadius: '4px', cursor: 'pointer', padding: '0.25rem 0.4rem', color: 'var(--hc-red-ink)' }}>✕</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!field.required} onChange={(e) => updateField(idx, { required: e.target.checked })} />
                Required
              </label>
              {(field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') && (
                <div style={{ flex: 1 }}>
                  <input value={(field.options || []).join(', ')} onChange={(e) => updateField(idx, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder={field.type === 'checkbox' ? 'Options (pick any): Option 1, Option 2 — leave blank for a single Yes box' : 'Options: Option 1, Option 2, Option 3'}
                    style={{ ...wideBox, padding: '0.4rem 0.6rem', fontSize: '0.82rem' }} />
                </div>
              )}
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button onClick={saveTemplate} style={{ ...blueBtn, padding: '0.7rem 1.5rem', borderRadius: '8px', fontSize: '0.92rem' }}>✓ Save Template</button>
          <button onClick={() => setEditTemplate(null)} style={{ ...plainBtn, padding: '0.7rem 1.25rem', borderRadius: '8px', fontWeight: 600, fontSize: '0.92rem' }}>Cancel</button>
        </div>
      </div>
      {msg && <Flash msg={msg} />}
    </div>
  )

  // ── MAIN VIEW ──
  return (
    <div>
      {msg && <Flash msg={msg} />}
      {fillModal && (
        <FormFiller template={fillModal} clients={clients} caregivers={caregivers}
          onClose={() => setFillModal(null)}
          onSaved={() => { flash('Form submitted'); setFillModal(null); load() }} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>📝 Form Builder</h2>
        {may.create && <button onClick={newTemplate} style={{ ...blueBtn, padding: '0.5rem 1.1rem', borderRadius: '8px', fontSize: '0.88rem' }}>+ New Template</button>}
      </div>

      <div style={{ display: 'flex', borderBottom: '2px solid var(--hc-line)', marginBottom: '1.25rem' }}>
        <button style={tabStyle('templates')} onClick={() => setTab('templates')}>📋 Templates ({templates.length})</button>
        <button style={tabStyle('submissions')} onClick={() => setTab('submissions')}>📨 Submissions ({submissions.length})</button>
      </div>

      {tab === 'templates' && (
        <>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button onClick={() => setFilterCat('')} className={`${pill} ${!filterCat ? `${CAT.assessment.solid} font-bold` : pillOff}`}>All</button>
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setFilterCat(c === filterCat ? '' : c)} className={`${pill} ${filterCat === c ? `${catOf(c).solid} font-bold` : pillOff}`}>{c.replace(/_/g, ' ')}</button>
            ))}
          </div>

          {loading ? <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--hc-muted)' }}>Loading...</div>
            : filteredTemplates.length === 0 ? (
              <div style={dashedEmpty}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📝</div>
                No templates yet — click "New Template" to create one
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
                {filteredTemplates.map((t) => (
                  <div key={t.id} style={{ background: 'var(--hc-surface)', border: '1px solid var(--hc-line)', borderTop: `3px solid ${catOf(t.category).rule}`, borderRadius: '10px', padding: '1rem', opacity: t.isActive ? 1 : 0.6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem', gap: '0.4rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--hc-ink)' }}>
                        {t.isBuiltIn && <span title="Built-in template" className="text-amber-700 dark:text-amber-300" style={{ marginRight: 4 }}>★</span>}
                        {t.name}
                      </span>
                      <span className={catOf(t.category).chip} style={{ padding: '0.1rem 0.45rem', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap', marginLeft: '0.5rem' }}>{t.category.replace(/_/g, ' ')}</span>
                    </div>
                    {t.description && <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: 'var(--hc-muted)', lineHeight: 1.4 }}>{t.description}</p>}
                    <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)', marginBottom: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span>{parseFields(t.fields).length} fields</span>
                      <span>{t.submissionCount || 0} submissions</span>
                      {t.requiresSignature && <span>✍️ Signature</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {mayEvv.create && <button onClick={() => setFillModal(t)} style={{ ...blueBtn, flex: 1, padding: '0.4rem', borderRadius: '6px', fontWeight: 600, fontSize: '0.8rem' }}>Fill Out</button>}
                      {may.update && <button onClick={() => setEditTemplate({ ...t, fields: parseFields(t.fields) })} style={{ ...plainBtn, padding: '0.4rem 0.65rem', borderRadius: '6px', fontSize: '0.8rem' }}>Edit</button>}
                      {may.delete && <button onClick={() => deleteTemplate(t.id)} style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid var(--hc-danger-line)', background: 'var(--hc-surface)', color: 'var(--hc-red-ink)', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </>
      )}

      {tab === 'submissions' && (
        loading ? <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--hc-muted)' }}>Loading...</div>
          : submissions.length === 0 ? (
            <div style={dashedEmpty}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📨</div>
              No submissions yet
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ background: 'var(--hc-subtle)', borderBottom: '2px solid var(--hc-line)' }}>
                  {['Form', 'Category', 'Attached To', 'Submitted By', 'Date', 'Status', 'PDF', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.65rem 0.85rem', fontWeight: 700, color: 'var(--hc-ink-soft)', fontSize: '0.82rem' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submissions.map((s, i) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--hc-subtle)', background: i % 2 === 0 ? 'var(--hc-surface)' : 'var(--hc-ground)' }}>
                    <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600 }}>{s.templateName}</td>
                    <td style={{ padding: '0.65rem 0.85rem' }}><span className={catOf(s.category).chip} style={{ padding: '0.1rem 0.45rem', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700 }}>{(s.category || 'general').replace(/_/g, ' ')}</span></td>
                    <td style={{ padding: '0.65rem 0.85rem', color: 'var(--hc-muted)' }}>{s.entityName || s.entityType || '—'}</td>
                    <td style={{ padding: '0.65rem 0.85rem', color: 'var(--hc-muted)' }}>{s.submittedByName}</td>
                    <td style={{ padding: '0.65rem 0.85rem', color: 'var(--hc-muted)' }}>{formatAgencyDate(s.createdAt)}</td>
                    <td style={{ padding: '0.65rem 0.85rem' }}>
                      <span className={s.status === 'signed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200'}
                        style={{ padding: '0.15rem 0.5rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700 }}>{s.status}</span>
                    </td>
                    <td style={{ padding: '0.65rem 0.85rem' }}>
                      <button title="Download printable PDF" onClick={() => downloadPdf(s)}
                        style={{ ...plainBtn, background: 'none', borderRadius: 6, padding: '0.3rem 0.55rem', fontSize: '0.78rem' }}>
                        📄 PDF
                      </button>
                    </td>
                    <td style={{ padding: '0.65rem 0.85rem' }}>
                      {may.delete && <button onClick={() => deleteSubmission(s.id)} title="Delete submission" aria-label="Delete submission"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--hc-red-ink)', fontSize: '0.9rem' }}>🗑</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}
    </div>
  )
}

/** The corner notice. */
function Flash({ msg }: { msg: { text: string; ok: boolean } }) {
  return (
    <div style={{
      position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, fontWeight: 600, padding: '0.75rem 1.25rem', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      background: msg.ok ? 'var(--hc-success-bg)' : 'var(--hc-danger-bg)', color: msg.ok ? 'var(--hc-success-ink)' : 'var(--hc-danger-ink)',
    }}>{msg.text}</div>
  )
}
