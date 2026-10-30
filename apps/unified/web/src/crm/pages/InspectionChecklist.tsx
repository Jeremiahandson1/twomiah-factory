// An inspection's checklist and the saved checklists a business reuses (feature inspection_checklists; server:
// crm/siteRecords/inspectionChecklists.ts). Shown only where the page says the feature is on.
//
// Each line is answered Pass, Fail or N/A. Failing a line needs a few words on what is wrong, and puts it on the project's punch
// list by itself — the answer from the server says which one, so the inspector sees it happen. Photos go up the moment they are
// picked: the visit already exists, so there is nothing to wait for.
import { useCallback, useEffect, useState } from 'react'
import { Check, X as XIcon, Minus, Trash2, Plus } from 'lucide-react'
import { api } from '../../api'
import { useToast } from '../../shared'
import { Modal, ConfirmModal } from '../ui/Modal'
import { Button } from '../ui/DataTable'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'
import { RecordPhotosField, uploadRecordPhotos, type SavedPhoto, type PendingPhoto } from '../ui/RecordPhotosField'

export interface ChecklistLine { id: string; label: string; result: 'pending' | 'pass' | 'fail' | 'na'; note: string | null; punchListItemId: string | null }
export interface ChecklistTemplate { id: string; name: string; type: string | null; items: Array<{ id: string; label: string }> }

const ANSWERS: Array<{ result: 'pass' | 'fail' | 'na'; label: string; Icon: typeof Check; on: string }> = [
  { result: 'pass', label: 'Pass', Icon: Check, on: 'bg-green-600 text-white border-green-600' },
  { result: 'fail', label: 'Fail', Icon: XIcon, on: 'bg-red-600 text-white border-red-600' },
  { result: 'na', label: 'N/A', Icon: Minus, on: 'bg-gray-600 text-white border-gray-600' },
]
const off = 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-800'

export function ChecklistModal({ inspection, canEdit, onClose, onChanged }: {
  inspection: Record<string, unknown> | null
  /** inspections:update, and the visit has no result yet. */
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const id = inspection?.id as string | undefined
  const [lines, setLines] = useState<ChecklistLine[] | null>(null)
  const [photos, setPhotos] = useState<SavedPhoto[]>([])
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
  const [typed, setTyped] = useState('')
  const [adding, setAdding] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<PendingPhoto[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const r: any = await api.get(`/api/inspection-checklists/${id}`)
      setLines(r?.items || [])
      setPhotos(r?.photos || [])
      setNotes(Object.fromEntries((r?.items || []).map((l: ChecklistLine) => [l.id, l.note || ''])))
    } catch (err) { toast.error((err as Error).message); setLines([]) }
  }, [id])

  useEffect(() => {
    setLines(null); setTemplateId(''); setTyped(''); setAdding(''); setPending([])
    if (!id) return
    load()
    api.get('/api/inspection-templates').then((r: any) => setTemplates(r?.data || [])).catch(() => setTemplates([]))
  }, [id, load])

  const start = async () => {
    if (!id) return
    const items = typed.split('\n').map((s) => s.trim()).filter(Boolean)
    if (!templateId && !items.length) { toast.error('Pick a checklist or type the lines to check'); return }
    setBusy(true)
    try { await api.post(`/api/inspection-checklists/${id}/start`, templateId ? { templateId } : { items }); await load(); onChanged() }
    catch (err) { toast.error((err as Error).message) }
    finally { setBusy(false) }
  }

  const answer = async (line: ChecklistLine, result: ChecklistLine['result']) => {
    if (!id) return
    const note = (notes[line.id] || '').trim()
    if (result === 'fail' && note.length < 3) { toast.error('Say what is wrong first, in the box under the line'); return }
    try {
      const r: any = await api.put(`/api/inspection-checklists/${id}/items/${line.id}`, { result, note: note || null })
      if (r?.punchItem?.number) toast.success(`Failed — ${r.punchItem.number} was added to the punch list`)
      else if (r?.note) toast.success(r.note)
      await load(); onChanged()
    } catch (err) { toast.error((err as Error).message) }
  }

  const saveNote = async (line: ChecklistLine) => {
    if (!id) return
    const note = (notes[line.id] || '').trim()
    if (note === (line.note || '')) return
    try { await api.put(`/api/inspection-checklists/${id}/items/${line.id}`, { note: note || null }); await load() }
    catch (err) { toast.error((err as Error).message) }
  }

  const addLine = async () => {
    if (!id || !adding.trim()) return
    try { await api.post(`/api/inspection-checklists/${id}/items`, { label: adding.trim() }); setAdding(''); await load(); onChanged() }
    catch (err) { toast.error((err as Error).message) }
  }

  const removeLine = async (line: ChecklistLine) => {
    if (!id) return
    try { await api.delete(`/api/inspection-checklists/${id}/items/${line.id}`); await load(); onChanged() }
    catch (err) { toast.error((err as Error).message) }
  }

  // Photos go up as soon as they are picked.
  const pick = async (next: PendingPhoto[]) => {
    if (!id) return
    setPending(next)
    if (!next.length) return
    const { failed, reasons } = await uploadRecordPhotos('/api/inspection-checklists', id, next)
    setPending(failed)
    if (failed.length) toast.error(`${failed.length === 1 ? 'A photo' : `${failed.length} photos`} did not upload — ${reasons.join('; ')}`)
    await load(); onChanged()
  }

  const done = (lines || []).filter((l) => l.result !== 'pending').length
  const failed = (lines || []).filter((l) => l.result === 'fail').length
  const suggested = templates.filter((t) => !t.type || t.type === inspection?.type)

  return (
    <Modal isOpen={!!inspection} onClose={onClose} title={`Checklist — ${(inspection?.number as string) || ''} ${(inspection?.type as string) || ''}`} size="lg">
      {lines === null ? <p className="py-8 text-center text-sm text-gray-600 dark:text-slate-300">Loading the checklist…</p> : (
        <div className="space-y-5">
          {lines.length === 0 ? (
            canEdit ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-700 dark:text-slate-300">This visit has no checklist yet. Start one from a saved checklist, or type the lines to check.</p>
                {templates.length > 0 && (
                  <div>
                    <label htmlFor="checklist-template" className="block text-sm font-medium mb-1">Saved checklist</label>
                    <select id="checklist-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                      <option value="">Select…</option>
                      {(suggested.length ? suggested : templates).map((t) => <option key={t.id} value={t.id}>{t.name} — {t.items.length} {t.items.length === 1 ? 'line' : 'lines'}</option>)}
                    </select>
                  </div>
                )}
                {!templateId && (
                  <div>
                    <label htmlFor="checklist-typed" className="block text-sm font-medium mb-1">Or type the lines, one on each row</label>
                    <textarea id="checklist-typed" value={typed} onChange={(e) => setTyped(e.target.value)} rows={4} placeholder={'Hangers installed at every joist\nFirestopping complete'} className="w-full px-3 py-2 border rounded-lg" />
                  </div>
                )}
                <Button onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start checklist'}</Button>
              </div>
            ) : <p className="text-sm text-gray-700 dark:text-slate-300">This visit has no checklist.</p>
          ) : (
            <>
              <p className="text-sm text-gray-700 dark:text-slate-300">{done} of {lines.length} answered{failed > 0 ? ` · ${failed} failed` : ''}</p>
              <ul className="space-y-3">
                {lines.map((l) => (
                  <li key={l.id} className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm">{l.label}</p>
                      {canEdit && <button type="button" onClick={() => removeLine(l)} aria-label={`Remove ${l.label}`} className="p-1 text-gray-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Answer for ${l.label}`}>
                      {ANSWERS.map(({ result, label, Icon, on }) => (
                        <button key={result} type="button" disabled={!canEdit} aria-pressed={l.result === result} onClick={() => answer(l, l.result === result ? 'pending' : result)}
                          className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-60 ${l.result === result ? on : off}`}>
                          <Icon className="w-4 h-4" />{label}
                        </button>
                      ))}
                    </div>
                    {(canEdit || l.note) && (
                      <input value={notes[l.id] ?? ''} disabled={!canEdit} onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })} onBlur={() => saveNote(l)}
                        aria-label={`Note for ${l.label}`} placeholder={l.result === 'fail' ? 'What is wrong?' : 'Note (needed if it fails)'} className="mt-2 w-full px-3 py-2 border rounded-lg text-sm" />
                    )}
                    {l.result === 'fail' && l.punchListItemId && <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">On the punch list.</p>}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <div className="flex gap-2">
                  <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addLine() }} aria-label="Add a line" placeholder="Add a line to check" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                  <Button variant="secondary" onClick={addLine} disabled={!adding.trim()}><Plus className="w-4 h-4 mr-1 inline" />Add</Button>
                </div>
              )}
            </>
          )}
          <RecordPhotosField base="/api/inspection-checklists" recordId={id} photos={photos} onPhotosChange={(p) => { setPhotos(p); onChanged() }}
            pending={pending} onPendingChange={pick} canEdit={canEdit} inputId="inspection-photos" />
        </div>
      )}
    </Modal>
  )
}

/** The saved checklists: make, change, delete. One line to a row; the order typed is the order on the visit. */
export function ChecklistTemplatesModal({ isOpen, onClose, types, canCreate, canUpdate, canDelete }: {
  isOpen: boolean; onClose: () => void; types: string[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean
}) {
  const toast = useToast()
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [editing, setEditing] = useState<ChecklistTemplate | 'new' | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [text, setText] = useState('')
  const [toDelete, setToDelete] = useState<ChecklistTemplate | null>(null)

  const load = useCallback(() => { api.get('/api/inspection-templates').then((r: any) => setTemplates(r?.data || [])).catch((e: Error) => toast.error(e.message)) }, [])
  useEffect(() => { if (isOpen) { setEditing(null); load() } }, [isOpen, load])

  const open = (t: ChecklistTemplate | 'new') => {
    setEditing(t)
    setName(t === 'new' ? '' : t.name); setType(t === 'new' ? '' : t.type || ''); setText(t === 'new' ? '' : t.items.map((i) => i.label).join('\n'))
  }
  const save = async () => {
    const items = text.split('\n').map((s) => s.trim()).filter(Boolean)
    if (!name.trim()) { toast.error('Name the checklist'); return }
    if (!items.length) { toast.error('Add at least one line'); return }
    try {
      if (editing === 'new') await api.post('/api/inspection-templates', { name: name.trim(), type: type || null, items })
      else if (editing) await api.put(`/api/inspection-templates/${editing.id}`, { name: name.trim(), type: type || null, items })
      toast.success('Saved'); setEditing(null); load()
    } catch (err) { toast.error((err as Error).message) }
  }
  const remove = async () => {
    if (!toDelete) return
    try { await api.delete(`/api/inspection-templates/${toDelete.id}`); toast.success('Deleted'); setToDelete(null); load() }
    catch (err) { toast.error((err as Error).message) }
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Inspection checklists" size="lg">
        {editing ? (
          <div className="space-y-4">
            <div><label htmlFor="tpl-name" className="block text-sm font-medium mb-1">Name *</label><input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Framing walk-through" /></div>
            <div><label htmlFor="tpl-type" className="block text-sm font-medium mb-1">For inspections of type</label>
              <select id="tpl-type" value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 border rounded-lg"><option value="">Any</option>{types.map((t) => <option key={t} value={t}>{codeLabel(t)}</option>)}</select></div>
            <div><label htmlFor="tpl-lines" className="block text-sm font-medium mb-1">Lines to check, one on each row *</label><textarea id="tpl-lines" value={text} onChange={(e) => setText(e.target.value)} rows={8} className="w-full px-3 py-2 border rounded-lg" placeholder={'Hangers installed at every joist\nFirestopping complete'} /></div>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save checklist</Button></div>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.length === 0 && <p className="text-sm text-gray-700 dark:text-slate-300">No saved checklists yet. Make one for each kind of inspection you do, then start it from any visit.</p>}
            <ul className="divide-y divide-gray-200 dark:divide-slate-700">
              {templates.map((t) => (
                <li key={t.id} className="py-2 flex items-center justify-between gap-2">
                  <div><p className="font-medium text-sm">{t.name}</p><p className="text-xs text-gray-600 dark:text-slate-400">{t.items.length} {t.items.length === 1 ? 'line' : 'lines'}{t.type ? ` · ${t.type}` : ''}</p></div>
                  <div className="flex gap-2">
                    {canUpdate && <Button variant="secondary" size="sm" onClick={() => open(t)}>Edit</Button>}
                    {canDelete && <Button variant="secondary" size="sm" onClick={() => setToDelete(t)}>Delete</Button>}
                  </div>
                </li>
              ))}
            </ul>
            {canCreate && <Button onClick={() => open('new')}><Plus className="w-4 h-4 mr-1 inline" />New checklist</Button>}
          </div>
        )}
      </Modal>
      <ConfirmModal isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} title="Delete checklist" message={`Delete ${toDelete?.name}? Visits that already used it keep their lines.`} confirmText="Delete" />
    </>
  )
}
