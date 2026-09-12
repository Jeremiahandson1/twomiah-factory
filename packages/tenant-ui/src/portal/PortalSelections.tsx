// Portal selections: the customer picks finishes/fixtures per project from the options the office set up.
import React, { useState, useEffect } from 'react'
import { Palette, Check, Clock, ChevronDown, ChevronUp, Loader2, ImageIcon, StickyNote } from 'lucide-react'
import { usePortal } from './PortalContext'
import { Spinner, PageTitle, Empty, card, pill, inputCls, labelCls, formatDate, moneyShort } from './common'

const STATUS_STYLES: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', selected: 'bg-blue-100 text-blue-700', approved: 'bg-green-100 text-green-700', ordered: 'bg-purple-100 text-purple-700', received: 'bg-gray-100 text-gray-700' }

export function PortalSelections() {
  const { fetch: portalFetch } = usePortal()
  const [projects, setProjects] = useState<any[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selections, setSelections] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectionsLoading, setSelectionsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    portalFetch('/projects').then((data) => { const list = Array.isArray(data) ? data : []; setProjects(list); if (list.length > 0) setSelectedProjectId(list[0].id) }).catch((e) => setError((e as Error).message)).finally(() => setLoading(false))
  }, [portalFetch])
  useEffect(() => {
    if (!selectedProjectId) return
    setSelectionsLoading(true)
    portalFetch(`/selections/project/${selectedProjectId}/selections`).then((d) => setSelections(Array.isArray(d) ? d : [])).catch(() => setSelections([])).finally(() => setSelectionsLoading(false))
  }, [portalFetch, selectedProjectId])

  if (loading) return <Spinner />
  const title = <PageTitle title="Selections" subtitle="Choose finishes, fixtures, and materials for your project." />
  if (projects.length === 0) return <div>{title}{error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}<Empty icon={Palette} text="No projects available." /></div>

  const grouped: Record<string, any[]> = {}
  for (const sel of selections) { const cat = sel.category?.name || 'Uncategorized'; (grouped[cat] ||= []).push(sel) }

  return (
    <div>
      {title}
      {projects.length > 1 && (
        <div className="mb-6"><label htmlFor="sel-project" className={labelCls}>Project</label><select id="sel-project" value={selectedProjectId || ''} onChange={(e) => setSelectedProjectId(e.target.value)} className={`${inputCls} max-w-md`}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.number})</option>)}</select></div>
      )}
      {selectionsLoading ? <Spinner /> : selections.length === 0 ? <Empty icon={Palette} text="No selections available for this project yet." /> : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <CategoryGroup key={category} category={category} items={items} projectId={selectedProjectId!} onUpdate={(updated) => setSelections((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated, status: 'selected' } : s)))} />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryGroup({ category, items, projectId, onUpdate }: { category: string; items: any[]; projectId: string; onUpdate: (sel: any) => void }) {
  const [expanded, setExpanded] = useState(true)
  const totalAllowance = items.reduce((sum, s) => sum + Number(s.allowance || 0), 0)
  const totalSelected = items.reduce((sum, s) => (s.selected_option ? sum + Number(s.selected_option.price) * Number(s.quantity || 1) : sum), 0)
  const pendingCount = items.filter((s) => s.status === 'pending').length
  return (
    <div className={`${card} overflow-hidden`}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors dark:hover:bg-slate-800">
        <div className="flex items-center gap-3"><div className="p-2 bg-purple-100 rounded-lg"><Palette className="w-5 h-5 text-purple-600" /></div><div className="text-left"><h2 className="font-semibold text-gray-900 dark:text-slate-100">{category}</h2><p className="text-sm text-gray-500 dark:text-slate-400">{items.length} selection{items.length !== 1 ? 's' : ''}{pendingCount > 0 && <span className="ml-2 text-orange-600 font-medium">{pendingCount} awaiting your choice</span>}</p></div></div>
        <div className="flex items-center gap-4">
          {totalAllowance > 0 && <div className="text-right text-sm"><p className="text-gray-500 dark:text-slate-400">Allowance</p><p className="font-medium text-gray-900 dark:text-slate-100">{moneyShort(totalAllowance)}</p></div>}
          {totalSelected > 0 && <div className="text-right text-sm"><p className="text-gray-500 dark:text-slate-400">Selected</p><p className={`font-medium ${totalSelected > totalAllowance ? 'text-red-600' : 'text-green-600'}`}>{moneyShort(totalSelected)}{totalAllowance > 0 && <span className="text-xs ml-1">({totalSelected - totalAllowance >= 0 ? '+' : ''}{moneyShort(totalSelected - totalAllowance)})</span>}</p></div>}
          {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </div>
      </button>
      {expanded && <div className="border-t divide-y dark:border-slate-700 dark:divide-slate-800">{items.map((sel) => <SelectionItem key={sel.id} selection={sel} projectId={projectId} onUpdate={onUpdate} />)}</div>}
    </div>
  )
}

function SelectionItem({ selection, projectId, onUpdate }: { selection: any; projectId: string; onUpdate: (sel: any) => void }) {
  const { fetch: portalFetch } = usePortal()
  const [showOptions, setShowOptions] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notes, setNotes] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const canSelect = selection.status === 'pending' || selection.status === 'selected'
  const options: any[] = selection.availableOptionsList || []
  const allowance = Number(selection.allowance || 0), quantity = Number(selection.quantity || 1)

  const choose = async (optionId: string) => {
    setSubmitting(true); setConfirmed(false); setError('')
    try {
      const result = await portalFetch(`/selections/project/${projectId}/selections/${selection.id}`, { method: 'POST', body: JSON.stringify({ optionId, notes: notes || undefined }) })
      onUpdate({ ...result, id: selection.id }); setConfirmed(true); setShowOptions(false); setNotes(''); setTimeout(() => setConfirmed(false), 3000)
    } catch (e) { setError('Failed to make selection: ' + (e as Error).message) } finally { setSubmitting(false) }
  }

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <div className="flex items-center gap-2"><h3 className="font-medium text-gray-900 dark:text-slate-100">{selection.name}</h3><span className={pill(STATUS_STYLES[selection.status] || 'bg-gray-100 text-gray-700')}>{selection.status}</span></div>
          {selection.description && <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">{selection.description}</p>}
          {selection.location && <p className="text-xs text-gray-400 mt-1">Location: {selection.location}</p>}
          {selection.due_date && <p className={`text-xs mt-1 ${new Date(selection.due_date) < new Date() && selection.status === 'pending' ? 'text-red-500 font-medium' : 'text-gray-400'}`}>Due: {formatDate(selection.due_date)}</p>}
        </div>
        <div className="text-right text-sm">
          {allowance > 0 && <p className="text-gray-500 dark:text-slate-400">Allowance: <span className="font-medium text-gray-700 dark:text-slate-200">{moneyShort(allowance)}</span></p>}
          {selection.selected_option && <p className="text-gray-700 font-medium dark:text-slate-200">Selected: {moneyShort(Number(selection.selected_option.price) * quantity)}{allowance > 0 && <span className={`ml-1 text-xs ${Number(selection.selected_option.price) * quantity > allowance ? 'text-red-600' : 'text-green-600'}`}>({Number(selection.selected_option.price) * quantity - allowance >= 0 ? '+' : ''}{moneyShort(Number(selection.selected_option.price) * quantity - allowance)})</span>}</p>}
        </div>
      </div>
      {selection.selected_option && (
        <div className="mt-2 p-3 bg-blue-50 rounded-lg flex items-center gap-3 dark:bg-blue-950/30">
          <Check className="w-5 h-5 text-blue-600 shrink-0" />
          <div className="flex-1"><p className="text-sm font-medium text-blue-900 dark:text-blue-200">{selection.selected_option.name}{selection.selected_option.manufacturer && <span className="text-blue-600 font-normal"> by {selection.selected_option.manufacturer}</span>}</p>{selection.client_notes && <p className="text-xs text-blue-700 mt-1 dark:text-blue-300">Note: {selection.client_notes}</p>}</div>
          {selection.selected_option.image_url && <img src={selection.selected_option.image_url} alt="" className="w-12 h-12 rounded object-cover" />}
        </div>
      )}
      {confirmed && <div className="mt-2 p-3 bg-green-50 rounded-lg flex items-center gap-2 dark:bg-green-950/30"><Check className="w-5 h-5 text-green-600" /><p className="text-sm font-medium text-green-800 dark:text-green-300">Selection saved successfully!</p></div>}
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {canSelect && options.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowOptions(!showOptions)} className="text-sm text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1">{showOptions ? 'Hide options' : `View ${options.length} option${options.length !== 1 ? 's' : ''}`}{showOptions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
          {showOptions && (
            <div className="mt-3 space-y-3">
              <div><label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1 dark:text-slate-400"><StickyNote className="w-3 h-3" /> Add a note (optional)</label><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g., Prefer matte finish..." className={inputCls} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {options.map((option: any) => {
                  const isSelected = selection.selected_option_id === option.id
                  const totalPrice = Number(option.totalPrice || option.price * quantity), priceDiff = Number(option.priceDiff ?? (totalPrice - allowance))
                  return (
                    <button type="button" key={option.id} disabled={submitting} onClick={() => choose(option.id)} className={`text-left border rounded-lg p-3 transition-all hover:shadow-md disabled:opacity-60 ${isSelected ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 hover:border-orange-300 dark:border-slate-700'}`}>
                      {option.image_url ? <img src={option.image_url} alt={option.name} className="w-full h-32 object-cover rounded mb-2" /> : <div className="w-full h-32 bg-gray-100 rounded mb-2 flex items-center justify-center dark:bg-slate-800"><ImageIcon className="w-8 h-8 text-gray-300" /></div>}
                      <p className="font-medium text-sm text-gray-900 dark:text-slate-100">{option.name}</p>
                      {option.manufacturer && <p className="text-xs text-gray-500 dark:text-slate-400">{option.manufacturer}{option.model ? ` - ${option.model}` : ''}</p>}
                      {option.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{option.description}</p>}
                      <div className="mt-2 flex items-center justify-between"><p className="text-sm font-bold text-gray-900 dark:text-slate-100">{moneyShort(totalPrice)}</p>{allowance > 0 && <span className={`text-xs font-medium ${priceDiff > 0 ? 'text-red-600' : priceDiff < 0 ? 'text-green-600' : 'text-gray-500'}`}>{priceDiff !== 0 ? `${priceDiff > 0 ? '+' : ''}${moneyShort(priceDiff)}` : 'Within allowance'}</span>}</div>
                      {option.lead_time_days > 0 && <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" />{option.lead_time_days} day lead time</p>}
                      {isSelected && <div className="mt-2 flex items-center gap-1 text-blue-600 text-xs font-medium"><Check className="w-3 h-3" /> Currently selected</div>}
                    </button>
                  )
                })}
              </div>
              {submitting && <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Saving your selection...</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
