// Moved from templates/crm-roof/frontend/src/pages/roofing/StormLeadsPage.tsx. Storm lead generation at /api/storms
// (server/crm/roof/field/storms.ts, the storm_lead_gen feature).
//
// Changes from the template:
//   · GET /events is { data, pagination } — the template read a bare array, so the board would have stayed empty;
//   · a converted lead is a homeowner contact (one `name`) and a roofing job: its row links to both, /crm/jobs/:id and
//     /crm/contacts/:id (the template linked the job only);
//   · every write shows the server's sentence when it is refused (the template reported "created" / "dismissed" /
//     "converted" for a refusal too, and opened a new event from the error reply);
//   · the selected event is refreshed with the board, so Generate Leads goes once the leads are made and the lead count
//     is the new one;
//   · the map is Leaflet imported by the app (./PinMap.tsx) — the template's read `window.L` from a CDN script;
//   · the "Follow Up" button on an existing customer's row did nothing (it had no handler) and is gone; the star still
//     marks the row.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, List, Map as MapIcon, Plus, Star, X, Zap } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useMayWrite, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { listOf } from './http'
import PinMap, { coord, type Pin } from './PinMap'
import { todayKey } from '@twomiah/tenant-ui/src/time/day'

const DAMAGE_COLORS: Record<string, string> = {
  minor: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40',
  moderate: 'bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40',
  severe: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
}
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  contacted: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40',
  converted: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  dismissed: 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800',
}
const PIN_COLORS: Record<string, string> = { new: '#3B82F6', contacted: '#EAB308', converted: '#22C55E', dismissed: '#9CA3AF' }

interface StormEvent {
  id: string
  eventDate: string
  eventType: string
  affectedZipCodes: string[] | null
  hailSizeInches: string | number | null
  windSpeedMph: number | null
  description: string | null
  leadCount: number | null
  status: string
}

interface StormLead {
  id: string
  address: string | null
  city: string | null
  zip: string | null
  lat: string | number | null
  lng: string | number | null
  status: string
  estimatedDamage: string | null
  jobId: string | null
  contactId: string | null
  isExistingCustomer: boolean
}

type LeadStatus = 'new' | 'contacted' | 'converted' | 'dismissed'

export default function StormLeadsPage() {
  // The whole board writes through storms:create: raise an event, generate the leads, dismiss
  // one, convert in bulk or one at a time. The reads stay — a crew can see the storm. (T42)
  const mayWorkStorms = useMayWrite('storms:create')
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const [events, setEvents] = useState<StormEvent[]>([])
  // Dismissed events are off the board now, so there has to be a way back to them. (T58)
  const [showDismissed, setShowDismissed] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<StormEvent | null>(null)
  const [leads, setLeads] = useState<StormLead[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set())
  const [filterStatus, setFilterStatus] = useState('')
  const [showNewEvent, setShowNewEvent] = useState(false)
  const [showConvertModal, setShowConvertModal] = useState<string | null>(null)
  const [convertName, setConvertName] = useState('')
  const [convertPhone, setConvertPhone] = useState('')
  const [convertEmail, setConvertEmail] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')

  // New event form
  const [newDate, setNewDate] = useState(todayKey())
  const [newType, setNewType] = useState('hail')
  const [newHailSize, setNewHailSize] = useState('1.5')
  const [newWindSpeed, setNewWindSpeed] = useState('')
  const [newZips, setNewZips] = useState('')
  const [newDesc, setNewDesc] = useState('')

  /**
   * The board, and a way back to what has been put away. (T58)
   *
   * Dismissing an event used to change nothing you could see: the server's list ignored status, so
   * the row came back on the next load with a toast saying it had been dismissed. The list now leaves
   * dismissed events out, which means this screen needs somewhere they can still be found — an event
   * is a record of weather and is never deleted, only put away.
   */
  const loadEvents = useCallback(async () => {
    try {
      const list = listOf<StormEvent>(await api.get('/api/storms/events', { status: showDismissed ? 'dismissed' : undefined }))
      setEvents(list)
      // The open event, as the board now has it (its status and lead count move when leads are generated).
      setSelectedEvent((cur) => (cur ? list.find((e) => e.id === cur.id) ?? cur : cur))
    } catch (e) { toastRef.current.error(errorText(e, 'Failed to load storm events')) }
    finally { setLoading(false) }
  }, [showDismissed])

  useEffect(() => { loadEvents() }, [loadEvents])

  /**
   * `status` is passed in, not read off state. (T41, found while reading this page)
   *
   * The status chips called `setFilterStatus(next)` and `loadLeads(event.id)` in the same handler,
   * and this function read `filterStatus` out of its closure — which still held the PREVIOUS
   * value, because React has not re-rendered yet. So clicking "contacted" fetched the list for
   * whatever filter was selected before, and the chips were always one click behind.
   */
  const loadLeads = async (eventId: string, page = 1, status: string = filterStatus) => {
    try {
      const reply = await api.get(`/api/storms/events/${encodeURIComponent(eventId)}/leads`, { page, limit: 50, status: status || undefined })
      setLeads(listOf<StormLead>(reply))
    } catch (e) { toastRef.current.error(errorText(e, 'Failed to load leads')) }
  }

  const selectEvent = async (event: StormEvent) => {
    setSelectedEvent(event)
    setSelectedLeads(new Set())
    await loadLeads(event.id)
  }

  const createEvent = async () => {
    const zips = newZips.split(',').map((z) => z.trim()).filter(Boolean)
    if (zips.length === 0) { toast.error('Enter at least one zip code'); return }
    try {
      const event = (await api.post('/api/storms/events', {
        eventDate: newDate,
        eventType: newType,
        hailSizeInches: newType === 'hail' ? parseFloat(newHailSize) : null,
        windSpeedMph: newType === 'wind' ? parseInt(newWindSpeed) : null,
        affectedZipCodes: zips,
        description: newDesc || null,
      })) as StormEvent
      setShowNewEvent(false)
      loadEvents()
      selectEvent(event)
      toast.success('Storm event created')
    } catch (e) { toast.error(errorText(e, 'Failed to create event')) }
  }

  const generateLeads = async () => {
    if (!selectedEvent) return
    try {
      const data = (await api.post(`/api/storms/events/${encodeURIComponent(selectedEvent.id)}/generate-leads`, {})) as { leadCount: number; existingCustomersFound: number }
      toast.success(`Generated ${data.leadCount} leads. ${data.existingCustomersFound} existing customers found.`)
      loadLeads(selectedEvent.id)
      loadEvents()
    } catch (e) { toast.error(errorText(e, 'Failed to generate leads')) }
  }

  const dismissEvent = async () => {
    if (!selectedEvent) return
    try {
      await api.post(`/api/storms/events/${encodeURIComponent(selectedEvent.id)}/dismiss`, {})
      setSelectedEvent(null)
      setLeads([])
      loadEvents()
      toast.success('Event dismissed')
    } catch (e) { toast.error(errorText(e, 'Failed to dismiss the event')) }
  }

  const convertLead = async (leadId: string) => {
    try {
      await api.post(`/api/storms/leads/${encodeURIComponent(leadId)}/convert`, { name: convertName, phone: convertPhone, email: convertEmail })
      toast.success('Lead converted — a contact and a job were made')
      setShowConvertModal(null)
      setConvertName(''); setConvertPhone(''); setConvertEmail('')
      if (selectedEvent) loadLeads(selectedEvent.id)
    } catch (e) { toast.error(errorText(e, 'Failed to convert lead')) }
  }

  const bulkConvert = async () => {
    if (selectedLeads.size === 0 || !selectedEvent) return
    try {
      const data = (await api.post('/api/storms/leads/bulk-convert', { leadIds: [...selectedLeads] })) as { converted: number }
      toast.success(`Converted ${data.converted} leads`)
      setSelectedLeads(new Set())
      loadLeads(selectedEvent.id)
    } catch (e) { toast.error(errorText(e, 'Failed to convert the leads')) }
  }

  const bulkDismiss = async () => {
    if (selectedLeads.size === 0 || !selectedEvent) return
    try {
      const data = (await api.post('/api/storms/leads/bulk-dismiss', { leadIds: [...selectedLeads] })) as { dismissed: number }
      toast.success(`Dismissed ${data.dismissed} leads`)
      setSelectedLeads(new Set())
      loadLeads(selectedEvent.id)
    } catch (e) { toast.error(errorText(e, 'Failed to dismiss the leads')) }
  }

  const toggleLead = (id: string) => {
    setSelectedLeads((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedLeads.size === leads.length) setSelectedLeads(new Set())
    else setSelectedLeads(new Set(leads.map((l) => l.id)))
  }

  const pins = useMemo<Pin[]>(() => leads.flatMap((lead) => {
    const lat = coord(lead.lat)
    const lng = coord(lead.lng)
    if (lat === null || lng === null) return []
    return [{
      id: lead.id, lat, lng, radius: 6, color: PIN_COLORS[lead.status] || '#3B82F6', title: lead.address || 'Unknown',
      lines: [lead.status, ...(lead.isExistingCustomer ? ['Existing Customer'] : [])],
    }]
  }), [leads])

  // Stats
  const stats: Record<LeadStatus, number> = { new: 0, contacted: 0, converted: 0, dismissed: 0 }
  leads.forEach((l) => { if (l.status in stats) stats[l.status as LeadStatus]++ })

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" /></div>
  }

  return (
    <div className="flex h-full">
      {/* Events Sidebar */}
      <div className="w-80 border-r bg-white flex-shrink-0 flex flex-col dark:bg-slate-900">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-sm font-bold flex items-center gap-1.5"><Zap size={16} className="text-yellow-500 dark:text-yellow-300" /> Storm Events</h2>
          {mayWorkStorms && (
            <button onClick={() => setShowNewEvent(true)} className="text-xs bg-orange-600 text-white px-2.5 py-1 rounded-lg font-medium flex items-center gap-1">
              <Plus size={12} /> New
            </button>
          )}
        </div>
        {/* Dismissed events leave the board; this is the way back to them. Without it, putting one
            away would make it unreachable, which is deleting with extra steps. (T58) */}
        <div className="px-4 py-2 border-b">
          <button
            onClick={() => { setLoading(true); setSelectedEvent(null); setLeads([]); setShowDismissed(!showDismissed) }}
            className="text-xs text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200 underline"
          >
            {showDismissed ? 'Back to active events' : 'Show dismissed events'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {events.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-8">
              {showDismissed ? 'Nothing has been dismissed' : 'No storm events yet'}
            </p>
          )}
          {events.map((event) => (
            <button key={event.id} onClick={() => selectEvent(event)}
              className={`w-full text-left p-4 border-b hover:bg-gray-50 dark:hover:bg-slate-800 ${selectedEvent?.id === event.id ? 'bg-orange-50 border-l-2 border-l-orange-600 dark:bg-orange-950/40 dark:text-slate-100' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap size={14} className={event.status === 'detected' ? 'text-yellow-500 dark:text-yellow-300' : 'text-gray-400'} />
                  <span className="text-sm font-medium capitalize">{event.eventType}</span>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  event.status === 'detected' ? 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40' :
                  event.status === 'leads_generated' ? 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40' :
                  'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'
                }`}>{event.status.replace('_', ' ')}</span>
              </div>
              <p className="text-xs text-gray-600 mt-1 dark:text-slate-400">{formatDate(event.eventDate)}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-600 dark:text-slate-400">
                {event.hailSizeInches && <span>{event.hailSizeInches}" hail</span>}
                {event.windSpeedMph && <span>{event.windSpeedMph} mph</span>}
                <span>{event.leadCount || 0} leads</span>
              </div>
              {event.description && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 truncate">{event.description}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedEvent ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-slate-400 text-sm">
            Select a storm event or create a new one
          </div>
        ) : (
          <>
            <div className="p-4 bg-white border-b flex items-center justify-between flex-shrink-0 dark:bg-slate-900">
              <div>
                <h2 className="text-lg font-bold capitalize flex items-center gap-2">
                  <Zap size={18} className="text-yellow-500 dark:text-yellow-300" />
                  {selectedEvent.eventType} — {formatDate(selectedEvent.eventDate)}
                </h2>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {(selectedEvent.affectedZipCodes || []).join(', ')} · {selectedEvent.leadCount || 0} leads
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedEvent.status === 'detected' && mayWorkStorms && (
                  <button onClick={generateLeads} className="text-xs bg-orange-600 text-white px-3 py-1.5 rounded-lg font-medium">
                    Generate Leads
                  </button>
                )}
                {selectedEvent.status !== 'dismissed' && mayWorkStorms && (
                  <button onClick={dismissEvent} className="text-xs text-gray-500 px-3 py-1.5 border rounded-lg dark:text-slate-400">Dismiss</button>
                )}
              </div>
            </div>

            {/* Stats Bar */}
            <div className="flex gap-2 px-4 py-2 bg-gray-50 border-b flex-shrink-0 dark:bg-slate-900">
              {(Object.entries(stats) as [LeadStatus, number][]).map(([k, v]) => (
                <button key={k} onClick={() => { const next = filterStatus === k ? '' : k; setFilterStatus(next); loadLeads(selectedEvent.id, 1, next) }}
                  className={`text-xs px-3 py-1 rounded-full font-medium ${filterStatus === k ? 'bg-orange-600 text-white' : STATUS_COLORS[k] || 'bg-gray-100 dark:bg-slate-800 dark:text-slate-100'}`}>
                  {k}: {v}
                </button>
              ))}
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-white border-b flex-shrink-0 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <input type="checkbox" aria-label="Select all leads" checked={selectedLeads.size === leads.length && leads.length > 0}
                  onChange={toggleAll} className="rounded" />
                <span className="text-xs text-gray-500 dark:text-slate-400">{selectedLeads.size} selected</span>
                {selectedLeads.size > 0 && mayWorkStorms && (
                  <>
                    <button onClick={bulkConvert} className="text-xs bg-green-700 text-white px-2.5 py-1 rounded font-medium">Convert Selected</button>
                    <button onClick={bulkDismiss} className="text-xs text-gray-500 px-2.5 py-1 border rounded dark:text-slate-400">Dismiss Selected</button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button aria-label="List view" onClick={() => setViewMode('list')} className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-gray-200 dark:bg-slate-700 dark:text-slate-100' : ''}`}><List size={16} /></button>
                <button aria-label="Map view" onClick={() => setViewMode('map')} className={`p-1.5 rounded ${viewMode === 'map' ? 'bg-gray-200 dark:bg-slate-700 dark:text-slate-100' : ''}`}><MapIcon size={16} /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {viewMode === 'map' ? (
                <PinMap pins={pins} center={pins[0] ? [pins[0].lat, pins[0].lng] : null} zoom={13} className="h-full w-full min-h-[24rem]" />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs text-gray-500 uppercase dark:bg-slate-900 dark:text-slate-400">
                      <th className="px-4 py-2 w-8"></th>
                      <th className="px-4 py-2">Address</th>
                      <th className="px-4 py-2">City/Zip</th>
                      <th className="px-4 py-2">Damage</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <tr key={lead.id} className={`border-b hover:bg-gray-50 dark:hover:bg-slate-800 ${lead.isExistingCustomer ? 'border-l-2 border-l-yellow-400' : ''}`}>
                        <td className="px-4 py-2">
                          <input type="checkbox" aria-label="Select lead" checked={selectedLeads.has(lead.id)} onChange={() => toggleLead(lead.id)} className="rounded" />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            {lead.isExistingCustomer && <Star size={12} className="text-yellow-500 flex-shrink-0 dark:text-yellow-300" aria-label="Existing customer" />}
                            <span className="font-medium">{lead.address || 'Unknown'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-gray-500 dark:text-slate-400">{lead.city}, {lead.zip}</td>
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
                          <div className="flex items-center gap-3">
                            {lead.status === 'new' && !lead.isExistingCustomer && mayWorkStorms && (
                              <button onClick={() => { setShowConvertModal(lead.id); setConvertName(''); setConvertPhone(''); setConvertEmail('') }}
                                className="text-xs text-orange-600 dark:text-orange-200 font-medium hover:underline">Convert</button>
                            )}
                            {lead.jobId && (
                              <Link to={`/crm/jobs/${lead.jobId}`}
                                className="text-xs text-orange-600 dark:text-orange-200 font-medium flex items-center gap-0.5 hover:underline">
                                Job <ArrowRight size={10} />
                              </Link>
                            )}
                            {lead.contactId && (
                              <Link to={`/crm/contacts/${lead.contactId}`}
                                className="text-xs text-orange-600 dark:text-orange-200 font-medium flex items-center gap-0.5 hover:underline">
                                Contact <ArrowRight size={10} />
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {leads.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">No leads for this event</td></tr>
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
          <div className="bg-white rounded-2xl max-w-md w-full p-6 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">New Storm Event</h2>
              <button aria-label="Close" onClick={() => setShowNewEvent(false)}><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-slate-400">Date</label>
                  <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-slate-400">Type</label>
                  <select value={newType} onChange={(e) => setNewType(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
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
                  <label className="text-xs text-gray-500 dark:text-slate-400">Hail Size (inches)</label>
                  <input type="number" step="0.25" value={newHailSize} onChange={(e) => setNewHailSize(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
              )}
              {newType === 'wind' && (
                <div>
                  <label className="text-xs text-gray-500 dark:text-slate-400">Wind Speed (mph)</label>
                  <input type="number" value={newWindSpeed} onChange={(e) => setNewWindSpeed(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 dark:text-slate-400">Affected Zip Codes (comma-separated)</label>
                <input value={newZips} onChange={(e) => setNewZips(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="75201, 75202, 75203" />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-slate-400">Description (optional)</label>
                <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <button onClick={createEvent} className="w-full py-2.5 bg-orange-600 text-white rounded-xl font-semibold text-sm">Create Storm Event</button>
            </div>
          </div>
        </div>
      )}

      {/* Convert Modal */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Convert to CRM Lead</h2>
              <button aria-label="Close" onClick={() => setShowConvertModal(null)}><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-slate-400">Homeowner Name</label>
                <input value={convertName} onChange={(e) => setConvertName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-slate-400">Phone</label>
                <input type="tel" value={convertPhone} onChange={(e) => setConvertPhone(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-slate-400">Email (optional)</label>
                <input type="email" value={convertEmail} onChange={(e) => setConvertEmail(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <button onClick={() => convertLead(showConvertModal)} className="w-full py-2.5 bg-green-700 text-white rounded-xl font-semibold text-sm">
                Convert to Lead
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
