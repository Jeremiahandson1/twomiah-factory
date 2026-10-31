// Moved from templates/crm-homecare/frontend/src/components/admin/ScheduleOptimizer.tsx.
//
// Sandbox schedule builder — pick clients and caregivers, set hours / visits, generate an optimized proposal, review it,
// then apply it to the live schedule. Nothing live changes until "Apply" is clicked. Shown in the Schedule Hub's Tools tab.
//
// Server (server/crm/homecare/planning/scheduleOptimizer.ts, mounted at /api/optimizer):
//   GET  /client-data/:clientId — { client, authorization, authorizedHoursPerWeek, remainingHours, assignedHoursPerWeek,
//        serviceDaysPerWeek, serviceAllowedDays, existingScheduleDays, existingSchedules }
//   POST /run { caregivers, clients } — { proposals, existingSchedules, unscheduled, summary }
//   POST /apply { proposals } — { success, created, errors, errorDetails }
import { useState, type CSSProperties } from 'react'
import { useToast } from '../../../../shared'
import { useMay } from '../lib/useMay'
import { api, errorMessage } from '../lib/http'
import { C, FILL, MARKS, tint, dayButton, dayChip } from './theme'
import { fullName, type Caregiver, type Client } from './types'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface PickedCaregiver {
  id: string
  name: string
  allocatedHours: number
  preferredStart: string
  preferredEnd: string
  preferredDays: number[]
}

interface PickedClient {
  id: string
  name: string
  hoursPerWeek: number
  visitsPerWeek: number
  authorizedHoursPerWeek: number
  remainingHours: number
  existingDays: number[]
  auth: unknown
  preferredDays: number[]
  timeWindowStart: string
  timeWindowEnd: string
}

interface ClientData {
  authorization: unknown
  authorizedHoursPerWeek: number
  remainingHours: number
  assignedHoursPerWeek: number | null
  serviceDaysPerWeek: number | null
  serviceAllowedDays: number[] | null
  existingScheduleDays: number[]
}

interface Conflict { scheduleId?: string; clientName: string; start: string; end: string; suggestion: string }
interface Proposal {
  id: string
  clientId: string
  clientName: string
  caregiverId: string
  caregiverName: string
  dayOfWeek: number
  dayName: string
  startTime: string
  endTime: string
  hoursPerVisit: number
  hasConflict: boolean
  conflictsWith: Conflict[]
  isNew: boolean
}
interface ExistingSlot { id: string; caregiverId: string; clientName: string; dayOfWeek: number; startTime: string; endTime: string }
interface RunResult {
  proposals: Proposal[]
  existingSchedules: ExistingSlot[]
  unscheduled: Array<{ clientId: string; clientName: string; visitNumber: number; reason: string }>
  summary: {
    caregivers: Array<{ id: string; name: string; allocatedHours: number; existingHours: number; proposedNewHours: number; totalHours: number; remainingHours: number }>
    clients: Array<{ id: string; name: string; visitsNeeded: number; visitsPlaced: number; hoursPerWeek: number; fullyScheduled: boolean }>
    totalProposals: number
    conflictCount: number
    unscheduledCount: number
  }
}

interface Props { caregivers: Caregiver[]; clients: Client[] }

const smallLabel: CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: C.inkSoft, display: 'block', marginBottom: '0.25rem' }
const hint: CSSProperties = { fontWeight: 400, color: C.inkSoft }
const timeInput: CSSProperties = { padding: '0.25rem', borderRadius: '5px', border: `1px solid ${C.line}`, fontSize: '0.82rem' }

export default function ScheduleOptimizer({ caregivers: allCaregivers, clients: allClients }: Props) {
  const toast = useToast()
  // Run is care-schedule:update, apply is care-schedule:create (planning/scheduleOptimizer.ts) — lib/useMay.ts.
  const may = useMay('care-schedule')
  const [selectedCaregivers, setSelectedCaregivers] = useState<PickedCaregiver[]>([])
  const [selectedClients, setSelectedClients] = useState<PickedClient[]>([])
  const [cgDropdown, setCgDropdown] = useState('')
  const [clDropdown, setClDropdown] = useState('')
  const [loadingClient, setLoadingClient] = useState<string | null>(null)

  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [activeView, setActiveView] = useState<'grid' | 'list'>('grid')
  const [selectedProposals, setSelectedProposals] = useState<Set<string>>(new Set())

  // ── Add / remove caregivers ──
  const addCaregiver = (id: string) => {
    if (!id || selectedCaregivers.find((c) => c.id === id)) return
    const cg = allCaregivers.find((c) => c.id === id)
    if (!cg) return
    setSelectedCaregivers((prev) => [...prev, { id, name: fullName(cg), allocatedHours: 40, preferredStart: '', preferredEnd: '', preferredDays: [] }])
    setCgDropdown('')
  }
  const removeCaregiver = (id: string) => setSelectedCaregivers((prev) => prev.filter((c) => c.id !== id))
  const updateCgHours = (id: string, hours: string) =>
    setSelectedCaregivers((prev) => prev.map((c) => (c.id === id ? { ...c, allocatedHours: parseFloat(hours) || 0 } : c)))
  const updateCgField = (id: string, key: 'preferredStart' | 'preferredEnd', value: string) =>
    setSelectedCaregivers((prev) => prev.map((c) => (c.id === id ? { ...c, [key]: value } : c)))

  // ── Add / remove clients ──
  const addClient = async (id: string) => {
    if (!id || selectedClients.find((c) => c.id === id)) return
    const cl = allClients.find((c) => c.id === id)
    if (!cl) return
    setLoadingClient(id)
    setClDropdown('')
    try {
      const data = await api.get(`/api/optimizer/client-data/${id}`) as ClientData
      const hrs = Number(data.assignedHoursPerWeek || data.authorizedHoursPerWeek || 0)
      // Pre-populate allowed days from the client record if available
      const allowedDays = Array.isArray(data.serviceAllowedDays) ? data.serviceAllowedDays.map(Number) : []
      setSelectedClients((prev) => [...prev, {
        id,
        name: fullName(cl),
        hoursPerWeek: hrs,
        visitsPerWeek: data.serviceDaysPerWeek || suggestVisits(hrs),
        authorizedHoursPerWeek: data.authorizedHoursPerWeek,
        remainingHours: data.remainingHours,
        existingDays: (data.existingScheduleDays || []).map(Number),
        auth: data.authorization,
        preferredDays: allowedDays,
        timeWindowStart: '',
        timeWindowEnd: '',
      }])
    } catch {
      setSelectedClients((prev) => [...prev, {
        id, name: fullName(cl), hoursPerWeek: 0, visitsPerWeek: 3, authorizedHoursPerWeek: 0, remainingHours: 0,
        existingDays: [], auth: null, preferredDays: [], timeWindowStart: '', timeWindowEnd: '',
      }])
    } finally {
      setLoadingClient(null)
    }
  }
  const removeClient = (id: string) => setSelectedClients((prev) => prev.filter((c) => c.id !== id))
  const updateClientVisits = (id: string, value: string) =>
    setSelectedClients((prev) => prev.map((c) => (c.id === id ? { ...c, visitsPerWeek: parseFloat(value) || 0 } : c)))
  const updateClientRaw = (id: string, key: 'timeWindowStart' | 'timeWindowEnd', value: string) =>
    setSelectedClients((prev) => prev.map((c) => (c.id === id ? { ...c, [key]: value } : c)))

  const toggleDay = (days: number[], day: number) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b))
  const toggleCgDay = (id: string, day: number) =>
    setSelectedCaregivers((prev) => prev.map((c) => (c.id !== id ? c : { ...c, preferredDays: toggleDay(c.preferredDays || [], day) })))
  const toggleClientDay = (id: string, day: number) =>
    setSelectedClients((prev) => prev.map((c) => (c.id !== id ? c : { ...c, preferredDays: toggleDay(c.preferredDays || [], day) })))

  // ── Run ──
  const runOptimizer = async () => {
    if (!selectedCaregivers.length || !selectedClients.length) { toast.error('Add at least one caregiver and one client'); return }
    setRunning(true)
    setResult(null)
    try {
      const data = await api.post('/api/optimizer/run', {
        caregivers: selectedCaregivers.map((c) => ({
          id: c.id, allocatedHours: c.allocatedHours,
          preferredStart: c.preferredStart || null,
          preferredEnd: c.preferredEnd || null,
          preferredDays: c.preferredDays?.length ? c.preferredDays : null,
        })),
        clients: selectedClients.map((c) => ({
          id: c.id, visitsPerWeek: c.visitsPerWeek, hoursPerWeek: c.hoursPerWeek,
          preferredDays: c.preferredDays?.length ? c.preferredDays : null,
          timeWindowStart: c.timeWindowStart || null,
          timeWindowEnd: c.timeWindowEnd || null,
        })),
      }) as RunResult
      setResult(data)
      // Select every proposal without a conflict
      setSelectedProposals(new Set(data.proposals.filter((p) => !p.hasConflict).map((p) => p.id)))
    } catch (e) {
      toast.error('Optimizer failed: ' + errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  // ── Apply ──
  const applyProposals = async () => {
    if (!result || selectedProposals.size === 0) return
    const toApply = result.proposals.filter((p) => selectedProposals.has(p.id))
    setApplying(true)
    try {
      const data = await api.post('/api/optimizer/apply', { proposals: toApply }) as { created: number; errors: number }
      toast.success(`✅ Applied ${data.created} schedule${data.created !== 1 ? 's' : ''} to live schedule!`)
      if (data.errors > 0) toast.error(`⚠️ ${data.errors} failed to save`)
      setResult(null)
      setSelectedCaregivers([])
      setSelectedClients([])
    } catch (e) {
      toast.error('Failed to apply: ' + errorMessage(e))
    } finally {
      setApplying(false)
    }
  }

  const toggleProposal = (id: string) => {
    setSelectedProposals((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    if (selectedProposals.size === result?.proposals.length) setSelectedProposals(new Set())
    else setSelectedProposals(new Set(result?.proposals.map((p) => p.id)))
  }

  const fmtTime = (t: string) => {
    if (!t) return ''
    const [h, m] = t.split(':')
    const hour = parseInt(h)
    return `${hour % 12 || 12}:${m}${hour >= 12 ? 'pm' : 'am'}`
  }
  const cgColor = (id: string) => {
    const idx = allCaregivers.findIndex((c) => c.id === id)
    return MARKS.slice(0, 8)[idx % 8] || C.muted
  }

  const availCaregivers = allCaregivers.filter((c) => !selectedCaregivers.find((s) => s.id === c.id))
  const availClients = allClients.filter((c) => !selectedClients.find((s) => s.id === c.id))
  const blue = tint('blue'), green = tint('green'), amber = tint('amber'), red = tint('red')

  return (
    <div>
      {/* Intro banner: white text on the brand's deep shade and the blue fill, both dark in both themes. */}
      <div style={{ background: `linear-gradient(135deg, ${C.brandFill} 0%, #1d4ed8 100%)`, borderRadius: '12px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem', color: '#fff' }}>
        <h3 style={{ margin: '0 0 0.4rem', fontSize: '1.1rem' }}>🧠 Schedule Optimizer</h3>
        <p style={{ margin: 0, fontSize: '0.88rem' }}>
          Pick the clients and caretakers you want to work with. Set how many hours each caretaker gets and how many visits each client needs.
          The optimizer reads existing schedules and builds the best arrangement — then you review it before anything changes.
        </p>
      </div>

      {!result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
          {/* Caretakers */}
          <div className="hc-card">
            <h4 style={{ margin: '0 0 1rem', color: blue.ink, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              👤 Caretakers
              <span style={{ marginLeft: 'auto', fontSize: '0.75rem', background: blue.bg, color: blue.ink, padding: '0.2rem 0.5rem', borderRadius: '12px' }}>
                {selectedCaregivers.length} added
              </span>
            </h4>
            <select value={cgDropdown} onChange={(e) => addCaregiver(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: `2px solid ${blue.line}`, marginBottom: '1rem', fontSize: '0.9rem' }}>
              <option value="">+ Add a caretaker...</option>
              {availCaregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}
            </select>

            {selectedCaregivers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: C.muted, fontSize: '0.88rem' }}>No caretakers added yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {selectedCaregivers.map((cg) => (
                  <div key={cg.id} style={{ padding: '0.75rem', borderRadius: '8px', background: C.subtle, border: `2px solid ${cgColor(cg.id)}55` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: cgColor(cg.id), flexShrink: 0 }} />
                      <div style={{ flex: 1, fontWeight: 600, fontSize: '0.9rem' }}>{cg.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.78rem', color: C.inkSoft, whiteSpace: 'nowrap' }}>Hrs/wk:</label>
                        <input type="number" min="1" max="80" step="0.5" value={cg.allocatedHours}
                          onChange={(e) => updateCgHours(cg.id, e.target.value)}
                          style={{ width: '60px', padding: '0.3rem 0.4rem', borderRadius: '6px', border: `1px solid ${C.line}`, fontSize: '0.9rem', textAlign: 'center' }} />
                      </div>
                      <button onClick={() => removeCaregiver(cg.id)} aria-label={`Remove ${cg.name}`}
                        style={{ background: 'none', border: 'none', color: red.ink, cursor: 'pointer', fontSize: '1rem', padding: '0.2rem' }}>✕</button>
                    </div>

                    <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: `1px solid ${C.line}` }}>
                      <label style={smallLabel}>Preferred Shift <span style={hint}>(empty = any time)</span></label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                        <input type="time" value={cg.preferredStart || ''} onChange={(e) => updateCgField(cg.id, 'preferredStart', e.target.value)} style={timeInput} />
                        <input type="time" value={cg.preferredEnd || ''} onChange={(e) => updateCgField(cg.id, 'preferredEnd', e.target.value)} style={timeInput} />
                      </div>
                    </div>

                    <div style={{ marginTop: '0.5rem' }}>
                      <label style={smallLabel}>Preferred Days <span style={hint}>(empty = any day)</span></label>
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        {DAY_NAMES.map((d, i) => (
                          <button key={i} type="button" onClick={() => toggleCgDay(cg.id, i)} style={dayButton((cg.preferredDays || []).includes(i), i)}>{d}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Clients */}
          <div className="hc-card">
            <h4 style={{ margin: '0 0 1rem', color: green.ink, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              🏡 Clients
              <span style={{ marginLeft: 'auto', fontSize: '0.75rem', background: green.bg, color: green.ink, padding: '0.2rem 0.5rem', borderRadius: '12px' }}>
                {selectedClients.length} added
              </span>
            </h4>
            <select value={clDropdown} onChange={(e) => addClient(e.target.value)} disabled={loadingClient !== null}
              style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: `2px solid ${green.line}`, marginBottom: '1rem', fontSize: '0.9rem' }}>
              <option value="">{loadingClient ? 'Loading...' : '+ Add a client...'}</option>
              {availClients.map((cl) => <option key={cl.id} value={cl.id}>{cl.firstName} {cl.lastName}</option>)}
            </select>

            {selectedClients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: C.muted, fontSize: '0.88rem' }}>No clients added yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {selectedClients.map((cl) => (
                  <div key={cl.id} style={{ padding: '0.75rem', borderRadius: '8px', background: green.bg, border: `1.5px solid ${green.line}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{cl.name}</div>
                      <button onClick={() => removeClient(cl.id)} aria-label={`Remove ${cl.name}`}
                        style={{ background: 'none', border: 'none', color: red.ink, cursor: 'pointer', fontSize: '1rem', padding: 0 }}>✕</button>
                    </div>

                    {cl.auth ? (
                      <div style={{ fontSize: '0.75rem', color: green.ink, background: C.surface, border: `1px solid ${green.line}`, padding: '0.2rem 0.5rem', borderRadius: '6px', display: 'inline-block', marginBottom: '0.5rem' }}>
                        ✓ Auth: {cl.authorizedHoursPerWeek}h/wk · {cl.remainingHours}h remaining
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.75rem', color: amber.ink, background: amber.bg, border: `1px solid ${amber.line}`, padding: '0.2rem 0.5rem', borderRadius: '6px', display: 'inline-block', marginBottom: '0.5rem' }}>
                        ⚠ No active authorization found
                      </div>
                    )}

                    {cl.existingDays?.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.72rem', color: C.inkSoft }}>Already scheduled:</span>
                        {cl.existingDays.map((d) => <span key={d} style={dayChip(d)}>{DAY_NAMES[d]}</span>)}
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      <div>
                        <label style={smallLabel}>Hours/Week</label>
                        <div style={{ padding: '0.35rem', borderRadius: '6px', border: `1px solid ${C.line}`, fontSize: '0.9rem', background: C.subtle, color: C.ink, fontWeight: 600 }}>
                          {cl.hoursPerWeek}h
                        </div>
                      </div>
                      <div>
                        <label style={smallLabel}>Visits/Week</label>
                        <input type="number" min="1" max="7" value={cl.visitsPerWeek} onChange={(e) => updateClientVisits(cl.id, e.target.value)}
                          style={{ width: '100%', padding: '0.35rem', borderRadius: '6px', border: `1px solid ${C.line}`, fontSize: '0.9rem' }} />
                      </div>
                    </div>
                    {cl.hoursPerWeek > 0 && cl.visitsPerWeek > 0 && (
                      <div style={{ fontSize: '0.72rem', color: C.inkSoft, marginTop: '0.35rem' }}>
                        ≈ {(cl.hoursPerWeek / cl.visitsPerWeek).toFixed(1)}h per visit
                      </div>
                    )}

                    <div style={{ marginTop: '0.5rem' }}>
                      <label style={smallLabel}>Visit Days <span style={{ fontWeight: 400, color: C.inkSoft }}>(leave empty = auto)</span></label>
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        {DAY_NAMES.map((d, i) => (
                          <button key={i} type="button" onClick={() => toggleClientDay(cl.id, i)} style={dayButton((cl.preferredDays || []).includes(i), i)}>{d}</button>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginTop: '0.5rem' }}>
                      <label style={smallLabel}>Visit Time Window <span style={{ fontWeight: 400, color: C.inkSoft }}>(leave empty = any time)</span></label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                        <input type="time" value={cl.timeWindowStart || ''} onChange={(e) => updateClientRaw(cl.id, 'timeWindowStart', e.target.value)} style={timeInput} />
                        <input type="time" value={cl.timeWindowEnd || ''} onChange={(e) => updateClientRaw(cl.id, 'timeWindowEnd', e.target.value)} style={timeInput} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!result && (
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          {may.update && <button onClick={runOptimizer} disabled={running || !selectedCaregivers.length || !selectedClients.length}
            style={{
              padding: '0.9rem 2.5rem', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '1.05rem',
              background: running ? FILL.grey : `linear-gradient(135deg, ${C.brandFill}, #1d4ed8)`,
              color: '#fff', boxShadow: running ? 'none' : `0 4px 15px ${C.shadow}`,
            }}>
            {running ? '⏳ Analyzing schedules...' : '✨ Generate Optimized Schedule'}
          </button>}
          {(!selectedCaregivers.length || !selectedClients.length) && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: C.muted }}>Add at least one caretaker and one client to begin</p>
          )}
        </div>
      )}

      {result && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'Proposals', value: result.summary.totalProposals, t: blue },
              { label: 'Clean', value: result.summary.totalProposals - result.summary.conflictCount, t: green },
              { label: 'Conflicts', value: result.summary.conflictCount, t: result.summary.conflictCount > 0 ? red : green },
              { label: 'Unscheduled', value: result.summary.unscheduledCount, t: result.summary.unscheduledCount > 0 ? amber : green },
            ].map((s) => (
              <div key={s.label} className="hc-card" style={{ textAlign: 'center', padding: '0.75rem', background: s.t.bg }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: s.t.ink }}>{s.value}</div>
                <div style={{ fontSize: '0.78rem', color: C.inkSoft }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div className="hc-card" style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.75rem' }}>👤 Caretaker Hour Summary</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {result.summary.caregivers.map((cg) => (
                <div key={cg.id} style={{ flex: '1 1 180px', padding: '0.75rem', background: C.subtle, borderRadius: '8px', borderLeft: `4px solid ${cgColor(cg.id)}` }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.35rem' }}>{cg.name}</div>
                  <div style={{ fontSize: '0.78rem', color: C.inkSoft, marginBottom: '0.4rem' }}>
                    {cg.existingHours}h existing + {cg.proposedNewHours}h new = <strong style={{ color: C.ink }}>{cg.totalHours}h</strong> / {cg.allocatedHours}h
                  </div>
                  <div style={{ height: '6px', background: C.line, borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min((cg.totalHours / cg.allocatedHours) * 100, 100)}%`, height: '100%',
                      background: cg.totalHours > cg.allocatedHours ? '#DC2626' : cgColor(cg.id),
                    }} />
                  </div>
                  {cg.remainingHours > 0 && (
                    <div style={{ fontSize: '0.72rem', color: green.ink, marginTop: '0.25rem' }}>{cg.remainingHours}h remaining capacity</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="hc-card" style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.75rem' }}>🏡 Client Coverage</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {result.summary.clients.map((cl) => {
                const t = cl.fullyScheduled ? green : amber
                return (
                  <div key={cl.id} style={{ flex: '1 1 160px', padding: '0.75rem', borderRadius: '8px', background: t.bg, border: `1.5px solid ${t.line}` }}>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.25rem' }}>{cl.name}</div>
                    <div style={{ fontSize: '0.82rem', color: t.ink }}>
                      {cl.fullyScheduled ? '✅' : '⚠'} {cl.visitsPlaced}/{cl.visitsNeeded} visits
                    </div>
                    <div style={{ fontSize: '0.75rem', color: C.inkSoft }}>{cl.hoursPerWeek}h/week</div>
                  </div>
                )
              })}
            </div>
          </div>

          {result.unscheduled.length > 0 && (
            <div style={{ padding: '0.875rem 1rem', background: amber.bg, border: `1px solid ${amber.line}`, borderRadius: '8px', marginBottom: '1.25rem', color: amber.ink }}>
              <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>⚠️ Could Not Schedule</div>
              {result.unscheduled.map((u, i) => (
                <div key={i} style={{ fontSize: '0.85rem' }}>{u.clientName} — Visit {u.visitNumber}: {u.reason}</div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h4 style={{ margin: 0 }}>📋 Proposed Schedule</h4>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button onClick={toggleAll} style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontSize: '0.8rem', cursor: 'pointer' }}>
                {selectedProposals.size === result.proposals.length ? 'Deselect All' : 'Select All'}
              </button>
              {(['grid', 'list'] as const).map((v) => (
                <button key={v} onClick={() => setActiveView(v)}
                  style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: 'none', fontSize: '0.8rem', cursor: 'pointer',
                    background: activeView === v ? FILL.blue : C.subtle, color: activeView === v ? '#fff' : C.ink }}>
                  {v === 'grid' ? 'Grid' : 'List'}
                </button>
              ))}
            </div>
          </div>

          {activeView === 'grid' && (
            <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '650px' }}>
                <thead>
                  <tr style={{ background: C.subtle }}>
                    <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.82rem', color: C.inkSoft, fontWeight: 600, borderBottom: `2px solid ${C.line}` }}>Caretaker</th>
                    {DAY_NAMES.map((d) => (
                      <th key={d} style={{ padding: '0.6rem 0.5rem', textAlign: 'center', fontSize: '0.82rem', color: C.inkSoft, fontWeight: 600, borderBottom: `2px solid ${C.line}`, minWidth: '90px' }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.summary.caregivers.map((cg) => (
                    <tr key={cg.id} style={{ borderBottom: `1px solid ${C.subtle}` }}>
                      <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cgColor(cg.id) }} />
                          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{(cg.name || '').split(' ')[0]}</span>
                        </div>
                      </td>
                      {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                        const existing = result.existingSchedules.filter((s) => s.caregiverId === cg.id && s.dayOfWeek === day)
                        const proposed = result.proposals.filter((p) => p.caregiverId === cg.id && p.dayOfWeek === day)
                        return (
                          <td key={day} style={{ padding: '0.25rem', verticalAlign: 'top' }}>
                            {existing.map((s) => (
                              <div key={s.id} title="Existing schedule"
                                style={{ fontSize: '0.68rem', padding: '0.2rem 0.3rem', marginBottom: '0.2rem', borderRadius: '4px', background: C.subtle, borderLeft: `3px solid ${cgColor(cg.id)}80`, color: C.inkSoft }}>
                                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.clientName?.split(' ')[0]}</div>
                                <div>{fmtTime(s.startTime)}</div>
                              </div>
                            ))}
                            {proposed.map((p) => {
                              const on = selectedProposals.has(p.id)
                              const t = p.hasConflict ? red : blue
                              return (
                                <div key={p.id} onClick={() => toggleProposal(p.id)}
                                  style={{ fontSize: '0.68rem', padding: '0.2rem 0.3rem', marginBottom: '0.2rem', borderRadius: '4px', cursor: 'pointer',
                                    background: on ? t.bg : C.surface,
                                    border: `1px solid ${t.line}`,
                                    borderLeft: `3px solid ${p.hasConflict ? '#DC2626' : cgColor(cg.id)}`,
                                    opacity: on ? 1 : 0.5 }}
                                  title={p.hasConflict ? `⚠ Conflict: ${p.conflictsWith.map((c) => c.clientName).join(', ')}` : 'New proposal — click to toggle'}>
                                  <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {p.hasConflict ? '⚠ ' : '✦ '}{p.clientName?.split(' ')[0]}
                                  </div>
                                  <div>{fmtTime(p.startTime)}–{fmtTime(p.endTime)}</div>
                                </div>
                              )
                            })}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: '0.75rem', color: C.muted, marginTop: '0.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <span>◻ Greyed = existing schedule (unchanged)</span>
                <span style={{ color: blue.ink }}>🔷 Blue = proposed new visit (selected)</span>
                <span style={{ color: red.ink }}>🔴 Red = proposed but has time conflict</span>
                <span>Click to toggle selection</span>
              </div>
            </div>
          )}

          {activeView === 'list' && (
            <div style={{ marginBottom: '1.25rem' }}>
              {result.proposals.map((p) => {
                const on = selectedProposals.has(p.id)
                const t = p.hasConflict ? red : blue
                return (
                  <div key={p.id} onClick={() => toggleProposal(p.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', marginBottom: '0.5rem', borderRadius: '8px', cursor: 'pointer',
                      background: on ? t.bg : C.subtle, border: `1.5px solid ${on ? t.line : C.line}`,
                    }}>
                    <input type="checkbox" checked={on} onChange={() => {}} style={{ width: 'auto', cursor: 'pointer' }} />
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: cgColor(p.caregiverId), flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        {p.clientName}
                        {p.isNew && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: C.surface, border: `1px solid ${blue.line}`, color: blue.ink, borderRadius: '4px' }}>NEW DAY</span>}
                        {p.hasConflict && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: C.surface, border: `1px solid ${red.line}`, color: red.ink, borderRadius: '4px' }}>⚠ CONFLICT</span>}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: C.inkSoft }}>
                        with {p.caregiverName} · {p.dayName} {fmtTime(p.startTime)}–{fmtTime(p.endTime)} ({p.hoursPerVisit}h)
                      </div>
                      {p.hasConflict && p.conflictsWith.map((c, i) => (
                        <div key={i} style={{ fontSize: '0.75rem', color: red.ink, marginTop: '0.2rem' }}>
                          ⚠ Overlaps with {c.clientName} ({fmtTime(c.start)}–{fmtTime(c.end)}) — {c.suggestion}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', padding: '1rem', background: C.subtle, borderRadius: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => { setResult(null) }}
              style={{ padding: '0.7rem 1.5rem', borderRadius: '8px', border: `1.5px solid ${C.line}`, background: C.surface, color: C.ink, cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>
              ← Start Over
            </button>
            {may.update && <button onClick={() => { setResult(null); runOptimizer() }} disabled={running}
              style={{ padding: '0.7rem 1.5rem', borderRadius: '8px', border: `1px solid ${C.line}`, background: C.surface, color: C.ink, cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>
              🔄 Re-run
            </button>}
            {may.create && <button onClick={applyProposals} disabled={applying || selectedProposals.size === 0}
              style={{
                padding: '0.7rem 1.75rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem',
                background: applying || selectedProposals.size === 0 ? FILL.grey : `linear-gradient(135deg, ${FILL.green}, ${C.brandFill})`,
                color: '#fff', boxShadow: applying || selectedProposals.size === 0 ? 'none' : `0 4px 12px ${C.shadow}`,
              }}>
              {applying ? 'Applying...' : `✅ Apply ${selectedProposals.size} Schedule${selectedProposals.size !== 1 ? 's' : ''} to Live`}
            </button>}
          </div>
          <p style={{ fontSize: '0.78rem', color: C.muted, textAlign: 'center', margin: '0.5rem 0 0' }}>
            Only checked proposals will be applied. Conflicts are unchecked by default — review them before including.
          </p>
        </div>
      )}
    </div>
  )
}

function suggestVisits(hoursPerWeek: number): number {
  if (!hoursPerWeek || hoursPerWeek <= 0) return 3
  if (hoursPerWeek <= 5) return 2
  if (hoursPerWeek <= 10) return 3
  if (hoursPerWeek <= 20) return 4
  if (hoursPerWeek <= 30) return 5
  return 6
}
