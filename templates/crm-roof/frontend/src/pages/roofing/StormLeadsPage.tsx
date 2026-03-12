import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Zap, Plus, X, Check, XCircle, Phone, ArrowRight,
  Map as MapIcon, List, Star, ChevronRight, Filter,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'

const DAMAGE_COLORS: Record<string, string> = {
  minor: 'bg-yellow-100 text-yellow-700',
  moderate: 'bg-orange-100 text-orange-700',
  severe: 'bg-red-100 text-red-700',
}
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  converted: 'bg-green-100 text-green-700',
  dismissed: 'bg-gray-100 text-gray-500',
}

export default function StormLeadsPage() {
  const { token } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [events, setEvents] = useState<any[]>([])
  const [selectedEvent, setSelectedEvent] = useState<any>(null)
  const [leads, setLeads] = useState<any[]>([])
  const [leadPagination, setLeadPagination] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set())
  const [filterStatus, setFilterStatus] = useState('')
  const [showNewEvent, setShowNewEvent] = useState(false)
  const [showConvertModal, setShowConvertModal] = useState<string | null>(null)
  const [convertName, setConvertName] = useState('')
  const [convertPhone, setConvertPhone] = useState('')
  const [convertEmail, setConvertEmail] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletRef = useRef<any>(null)

  // New event form
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10))
  const [newType, setNewType] = useState('hail')
  const [newHailSize, setNewHailSize] = useState('1.5')
  const [newWindSpeed, setNewWindSpeed] = useState('')
  const [newZips, setNewZips] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/storms/events', { headers })
      const data = await res.json()
      setEvents(Array.isArray(data) ? data : [])
    } catch { toast.error('Failed to load storm events') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { loadEvents() }, [loadEvents])

  const loadLeads = async (eventId: string, page = 1) => {
    const statusParam = filterStatus ? `&status=${filterStatus}` : ''
    const res = await fetch(`/api/storms/events/${eventId}/leads?page=${page}&limit=50${statusParam}`, { headers })
    const data = await res.json()
    setLeads(data.data || [])
    setLeadPagination(data.pagination || {})
  }

  const selectEvent = async (event: any) => {
    setSelectedEvent(event)
    setSelectedLeads(new Set())
    await loadLeads(event.id)
  }

  const createEvent = async () => {
    try {
      const zips = newZips.split(',').map(z => z.trim()).filter(Boolean)
      if (zips.length === 0) { toast.error('Enter at least one zip code'); return }
      const res = await fetch('/api/storms/events', {
        method: 'POST', headers,
        body: JSON.stringify({
          eventDate: newDate,
          eventType: newType,
          hailSizeInches: newType === 'hail' ? parseFloat(newHailSize) : null,
          windSpeedMph: newType === 'wind' ? parseInt(newWindSpeed) : null,
          affectedZipCodes: zips,
          description: newDesc || null,
        }),
      })
      const event = await res.json()
      setShowNewEvent(false)
      loadEvents()
      selectEvent(event)
      toast.success('Storm event created')
    } catch { toast.error('Failed to create event') }
  }

  const generateLeads = async () => {
    if (!selectedEvent) return
    try {
      const res = await fetch(`/api/storms/events/${selectedEvent.id}/generate-leads`, { method: 'POST', headers })
      const data = await res.json()
      toast.success(`Generated ${data.leadCount} leads. ${data.existingCustomersFound} existing customers found.`)
      loadLeads(selectedEvent.id)
      loadEvents()
    } catch { toast.error('Failed to generate leads') }
  }

  const dismissEvent = async () => {
    if (!selectedEvent) return
    await fetch(`/api/storms/events/${selectedEvent.id}/dismiss`, { method: 'POST', headers })
    loadEvents()
    setSelectedEvent(null)
    setLeads([])
    toast.success('Event dismissed')
  }

  const convertLead = async (leadId: string) => {
    try {
      const res = await fetch(`/api/storms/leads/${leadId}/convert`, {
        method: 'POST', headers,
        body: JSON.stringify({ name: convertName, phone: convertPhone, email: convertEmail }),
      })
      const data = await res.json()
      toast.success('Lead converted to CRM job')
      setShowConvertModal(null)
      setConvertName(''); setConvertPhone(''); setConvertEmail('')
      loadLeads(selectedEvent.id)
    } catch { toast.error('Failed to convert lead') }
  }

  const bulkConvert = async () => {
    if (selectedLeads.size === 0) return
    const res = await fetch('/api/storms/leads/bulk-convert', {
      method: 'POST', headers,
      body: JSON.stringify({ leadIds: [...selectedLeads] }),
    })
    const data = await res.json()
    toast.success(`Converted ${data.converted} leads`)
    setSelectedLeads(new Set())
    loadLeads(selectedEvent.id)
  }

  const bulkDismiss = async () => {
    if (selectedLeads.size === 0) return
    const res = await fetch('/api/storms/leads/bulk-dismiss', {
      method: 'POST', headers,
      body: JSON.stringify({ leadIds: [...selectedLeads] }),
    })
    const data = await res.json()
    toast.success(`Dismissed ${data.dismissed} leads`)
    setSelectedLeads(new Set())
    loadLeads(selectedEvent.id)
  }

  const toggleLead = (id: string) => {
    setSelectedLeads(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedLeads.size === leads.length) setSelectedLeads(new Set())
    else setSelectedLeads(new Set(leads.map(l => l.id)))
  }

  // Map rendering
  useEffect(() => {
    if (viewMode !== 'map' || !mapRef.current || leads.length === 0) return
    const L = (window as any).L
    if (!L) return
    if (leafletRef.current) { leafletRef.current.remove(); leafletRef.current = null }

    const validLeads = leads.filter(l => l.lat && l.lng)
    const center = validLeads[0] ? [Number(validLeads[0].lat), Number(validLeads[0].lng)] : [32.78, -96.8]
    const map = L.map(mapRef.current).setView(center, 13)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(map)

    const statusColors: Record<string, string> = { new: '#3B82F6', contacted: '#EAB308', converted: '#22C55E', dismissed: '#9CA3AF' }
    validLeads.forEach((lead: any) => {
      L.circleMarker([Number(lead.lat), Number(lead.lng)], {
        radius: 6, fillColor: statusColors[lead.status] || '#3B82F6', color: '#fff', weight: 2, fillOpacity: 0.8,
      }).addTo(map).bindPopup(`<b>${lead.address}</b><br/>${lead.status}${lead.isExistingCustomer ? '<br/><em>Existing Customer</em>' : ''}`)
    })

    if (validLeads.length > 1) {
      map.fitBounds(L.latLngBounds(validLeads.map((l: any) => [Number(l.lat), Number(l.lng)])), { padding: [30, 30] })
    }
    leafletRef.current = map
    return () => { map.remove(); leafletRef.current = null }
  }, [viewMode, leads])

  // Stats
  const stats = { new: 0, contacted: 0, converted: 0, dismissed: 0 }
  leads.forEach(l => { if (stats[l.status as keyof typeof stats] !== undefined) stats[l.status as keyof typeof stats]++ })

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
  }

  return (
    <div className="flex h-full">
      {/* Events Sidebar */}
      <div className="w-80 border-r bg-white flex-shrink-0 flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-sm font-bold flex items-center gap-1.5"><Zap size={16} className="text-yellow-500" /> Storm Events</h2>
          <button onClick={() => setShowNewEvent(true)} className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded-lg font-medium flex items-center gap-1">
            <Plus size={12} /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {events.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No storm events yet</p>}
          {events.map(event => (
            <button key={event.id} onClick={() => selectEvent(event)}
              className={`w-full text-left p-4 border-b hover:bg-gray-50 ${selectedEvent?.id === event.id ? 'bg-blue-50 border-l-2 border-l-blue-600' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap size={14} className={event.status === 'detected' ? 'text-yellow-500' : 'text-gray-400'} />
                  <span className="text-sm font-medium capitalize">{event.eventType}</span>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  event.status === 'detected' ? 'bg-yellow-100 text-yellow-700' :
                  event.status === 'leads_generated' ? 'bg-green-100 text-green-700' :
                  'bg-gray-100 text-gray-500'
                }`}>{event.status.replace('_', ' ')}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{new Date(event.eventDate).toLocaleDateString()}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                {event.hailSizeInches && <span>{event.hailSizeInches}" hail</span>}
                {event.windSpeedMph && <span>{event.windSpeedMph} mph</span>}
                <span>{event.leadCount || 0} leads</span>
              </div>
              {event.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{event.description}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedEvent ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Select a storm event or create a new one
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-4 bg-white border-b flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold capitalize flex items-center gap-2">
                  <Zap size={18} className="text-yellow-500" />
                  {selectedEvent.eventType} — {new Date(selectedEvent.eventDate).toLocaleDateString()}
                </h2>
                <p className="text-sm text-gray-500">
                  {((selectedEvent.affectedZipCodes as string[]) || []).join(', ')} · {selectedEvent.leadCount || 0} leads
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedEvent.status === 'detected' && (
                  <button onClick={generateLeads} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium">
                    Generate Leads
                  </button>
                )}
                {selectedEvent.status !== 'dismissed' && (
                  <button onClick={dismissEvent} className="text-xs text-gray-500 px-3 py-1.5 border rounded-lg">Dismiss</button>
                )}
              </div>
            </div>

            {/* Stats Bar */}
            <div className="flex gap-2 px-4 py-2 bg-gray-50 border-b flex-shrink-0">
              {Object.entries(stats).map(([k, v]) => (
                <button key={k} onClick={() => { setFilterStatus(filterStatus === k ? '' : k); loadLeads(selectedEvent.id) }}
                  className={`text-xs px-3 py-1 rounded-full font-medium ${filterStatus === k ? 'bg-blue-600 text-white' : STATUS_COLORS[k] || 'bg-gray-100'}`}>
                  {k}: {v}
                </button>
              ))}
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-white border-b flex-shrink-0">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={selectedLeads.size === leads.length && leads.length > 0}
                  onChange={toggleAll} className="rounded" />
                <span className="text-xs text-gray-500">{selectedLeads.size} selected</span>
                {selectedLeads.size > 0 && (
                  <>
                    <button onClick={bulkConvert} className="text-xs bg-green-600 text-white px-2.5 py-1 rounded font-medium">Convert Selected</button>
                    <button onClick={bulkDismiss} className="text-xs text-gray-500 px-2.5 py-1 border rounded">Dismiss Selected</button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setViewMode('list')} className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-gray-200' : ''}`}><List size={16} /></button>
                <button onClick={() => setViewMode('map')} className={`p-1.5 rounded ${viewMode === 'map' ? 'bg-gray-200' : ''}`}><MapIcon size={16} /></button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {viewMode === 'map' ? (
                <div ref={mapRef} className="h-full w-full" />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs text-gray-500 uppercase">
                      <th className="px-4 py-2 w-8"></th>
                      <th className="px-4 py-2">Address</th>
                      <th className="px-4 py-2">City/Zip</th>
                      <th className="px-4 py-2">Damage</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map(lead => (
                      <tr key={lead.id} className={`border-b hover:bg-gray-50 ${lead.isExistingCustomer ? 'border-l-2 border-l-yellow-400' : ''}`}>
                        <td className="px-4 py-2">
                          <input type="checkbox" checked={selectedLeads.has(lead.id)} onChange={() => toggleLead(lead.id)} className="rounded" />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            {lead.isExistingCustomer && <Star size={12} className="text-yellow-500 flex-shrink-0" />}
                            <span className="font-medium">{lead.address || 'Unknown'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-gray-500">{lead.city}, {lead.zip}</td>
                        <td className="px-4 py-2">
                          {lead.estimatedDamage && (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${DAMAGE_COLORS[lead.estimatedDamage] || ''}`}>
                              {lead.estimatedDamage}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[lead.status] || ''}`}>
                            {lead.status}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          {lead.status === 'new' && !lead.isExistingCustomer && (
                            <button onClick={() => { setShowConvertModal(lead.id); setConvertName(''); setConvertPhone(''); setConvertEmail('') }}
                              className="text-xs text-blue-600 font-medium hover:underline">Convert</button>
                          )}
                          {lead.isExistingCustomer && lead.status === 'new' && (
                            <button className="text-xs text-yellow-600 font-medium hover:underline">Follow Up</button>
                          )}
                          {lead.jobId && (
                            <button onClick={() => navigate(`/crm/jobs/${lead.jobId}`)}
                              className="text-xs text-blue-600 font-medium flex items-center gap-0.5 hover:underline">
                              View <ArrowRight size={10} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {leads.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No leads for this event</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* New Event Modal */}
      {showNewEvent && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">New Storm Event</h2>
              <button onClick={() => setShowNewEvent(false)}><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Date</label>
                  <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Type</label>
                  <select value={newType} onChange={e => setNewType(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                    <option value="hail">Hail</option>
                    <option value="wind">Wind</option>
                    <option value="tornado">Tornado</option>
                    <option value="hurricane">Hurricane</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              {newType === 'hail' && (
                <div>
                  <label className="text-xs text-gray-500">Hail Size (inches)</label>
                  <input type="number" step="0.25" value={newHailSize} onChange={e => setNewHailSize(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
              )}
              {newType === 'wind' && (
                <div>
                  <label className="text-xs text-gray-500">Wind Speed (mph)</label>
                  <input type="number" value={newWindSpeed} onChange={e => setNewWindSpeed(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500">Affected Zip Codes (comma-separated)</label>
                <input value={newZips} onChange={e => setNewZips(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="75201, 75202, 75203" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Description (optional)</label>
                <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <button onClick={createEvent} className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm">Create Storm Event</button>
            </div>
          </div>
        </div>
      )}

      {/* Convert Modal */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Convert to CRM Lead</h2>
              <button onClick={() => setShowConvertModal(null)}><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">Homeowner Name</label>
                <input value={convertName} onChange={e => setConvertName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Phone</label>
                <input value={convertPhone} onChange={e => setConvertPhone(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Email (optional)</label>
                <input value={convertEmail} onChange={e => setConvertEmail(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <button onClick={() => convertLead(showConvertModal)} className="w-full py-2.5 bg-green-600 text-white rounded-xl font-semibold text-sm">
                Convert to Lead
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
