import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Mail, Phone, Calendar } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'

interface Lead {
  id: string
  name: string
  email: string
  phone?: string | null
  message: string
  source?: string | null
  status: 'new' | 'replied' | 'closed' | 'spam'
  notes?: string | null
  createdAt: string
}

const STATUS_LABELS: Record<Lead['status'], { label: string; classes: string }> = {
  new:     { label: 'New',     classes: 'bg-blue-50 text-blue-800 border-blue-200' },
  replied: { label: 'Replied', classes: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  closed:  { label: 'Closed',  classes: 'bg-gray-100 text-gray-700 border-gray-300' },
  spam:    { label: 'Spam',    classes: 'bg-red-50 text-red-800 border-red-200' },
}
const STATUS_FILTERS: Array<{ value: Lead['status'] | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'replied', label: 'Replied' },
  { value: 'closed', label: 'Closed' },
  { value: 'spam', label: 'Spam' },
]

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Lead['status'] | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})

  const refresh = (status: typeof filter) => {
    const path = status === 'all' ? '/api/admin/leads' : `/api/admin/leads?status=${status}`
    setLoading(true)
    api.get<{ leads: Lead[] }>(path)
      .then(({ leads }) => setLeads(leads))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh(filter) }, [filter])

  const updateStatus = async (lead: Lead, status: Lead['status']) => {
    try {
      await api.patch(`/api/admin/leads/${lead.id}`, { status })
      setLeads((ls) => ls.map((l) => l.id === lead.id ? { ...l, status } : l))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const saveNotes = async (lead: Lead) => {
    const notes = notesDraft[lead.id] ?? lead.notes ?? ''
    try {
      await api.patch(`/api/admin/leads/${lead.id}`, { notes })
      setLeads((ls) => ls.map((l) => l.id === lead.id ? { ...l, notes } : l))
      setNotesDraft((d) => { const next = { ...d }; delete next[lead.id]; return next })
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl text-ink">Leads</h1>
        <p className="text-muted text-sm mt-1">Contact-form submissions. Replies go through your own email — set status here to track what's been handled.</p>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={'btn-sm rounded-full px-3 py-1 ' + (filter === f.value ? 'bg-ink text-white' : 'bg-white border border-line text-ink-soft hover:bg-paper')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}
      {loading && <div className="text-muted text-sm">Loading…</div>}
      {!loading && leads.length === 0 && (
        <div className="card card-padding text-center text-muted">
          No leads {filter === 'all' ? 'yet' : `in "${filter}"`}.
        </div>
      )}

      {!loading && leads.length > 0 && (
        <div className="space-y-3">
          {leads.map((lead) => {
            const isOpen = expandedId === lead.id
            const status = STATUS_LABELS[lead.status]
            return (
              <div key={lead.id} className="card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : lead.id)}
                  className="w-full px-5 py-4 flex items-center gap-4 text-left bg-white hover:bg-paper transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink truncate">{lead.name}</div>
                    <div className="flex items-center gap-3 text-xs text-muted mt-1">
                      <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{lead.email}</span>
                      {lead.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</span>}
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />
                        {new Date(lead.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  </div>
                  <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border', status.classes)}>{status.label}</span>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-muted shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted shrink-0" />}
                </button>

                {isOpen && (
                  <div className="border-t border-line bg-paper px-5 py-4 space-y-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1">Message</div>
                      <p className="text-sm text-ink whitespace-pre-wrap">{lead.message}</p>
                    </div>
                    {lead.source && (
                      <div className="text-xs text-muted">From: <span className="text-ink-soft">{lead.source}</span></div>
                    )}

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1">Internal notes</div>
                      <textarea
                        rows={3}
                        placeholder="Notes for the team (not sent to the customer)"
                        value={notesDraft[lead.id] ?? lead.notes ?? ''}
                        onChange={(e) => setNotesDraft((d) => ({ ...d, [lead.id]: e.target.value }))}
                        className="input"
                      />
                      {(notesDraft[lead.id] !== undefined && notesDraft[lead.id] !== (lead.notes || '')) && (
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => saveNotes(lead)} className="btn-primary btn-sm">Save notes</button>
                          <button onClick={() => setNotesDraft((d) => { const next = { ...d }; delete next[lead.id]; return next })} className="btn-secondary btn-sm">Cancel</button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft mr-2">Status:</span>
                      {(['new', 'replied', 'closed', 'spam'] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => updateStatus(lead, s)}
                          disabled={lead.status === s}
                          className={'btn-sm rounded-full px-3 py-1 ' + (lead.status === s ? 'bg-ink text-white' : 'bg-white border border-line text-ink-soft hover:bg-paper')}
                        >
                          {STATUS_LABELS[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
