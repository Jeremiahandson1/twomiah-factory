// Moved from templates/crm-homecare/frontend/src/components/admin/RosterOptimizer.tsx.
//
// Full-roster schedule optimizer: loads every active caregiver and client, the office sets target hours per caretaker
// and visits / hours per client, runs it, reviews the proposed week, then applies it. Nothing live changes until "Apply".
// Shown in the Schedule Hub's Tools tab.
//
// Server (server/crm/homecare/planning/rosterOptimizer.ts, mounted at /api/roster-optimizer):
//   GET  /roster — { caregivers, clients, week: { start, end } }; a caregiver is { id, firstName, lastName, phone,
//        hireDate, maxHoursPerWeek, activeClientCount, currentWeeklyHours }, a client { id, firstName, lastName,
//        serviceType, …, assignedHoursPerWeek, serviceDaysPerWeek, serviceAllowedDays, scheduledDays, currentCaregivers }
//        (server/data/homecarePlanning.ts rosterCaregivers / rosterClients, camelCase)
//   POST /run { caregivers, clients } — { week, proposals, existingSchedules, unscheduled, summary }
//   POST /apply { proposals } — { success, created, errors, errorDetails }
import { useEffect, useState, type CSSProperties } from 'react'
import { useToast } from '../../../../shared'
import { api, errorMessage } from '../lib/http'
import { formatDate } from '../lib/date'
import { C, FILL, MARKS, tint, dayButton, dayChip } from './theme'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtTime(t: string | null | undefined): string {
  if (!t) return ''
  const [h, m] = t.slice(0, 5).split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m}${hour >= 12 ? 'pm' : 'am'}`
}

function suggestVisits(hrs: number): number {
  if (!hrs || hrs <= 0) return 3
  if (hrs <= 5) return 2
  if (hrs <= 10) return 3
  if (hrs <= 20) return 4
  if (hrs <= 30) return 5
  return 6
}

interface RosterCaregiver {
  id: string
  firstName: string
  lastName: string
  maxHoursPerWeek: number | string | null
  activeClientCount: number | string | null
  currentWeeklyHours: number
}
interface RosterClient {
  id: string
  firstName: string
  lastName: string
  assignedHoursPerWeek: number | string | null
  serviceDaysPerWeek: number | null
  serviceAllowedDays: number[] | null
  scheduledDays: number[] | null
}
interface Roster { caregivers: RosterCaregiver[]; clients: RosterClient[]; week: { start: string; end: string } }

interface CgRow extends RosterCaregiver {
  targetHours: number
  enabled: boolean
  preferredStart: string
  preferredEnd: string
  preferredDays: number[]
}
interface ClRow extends RosterClient {
  hoursPerWeek: number
  visitsPerWeek: number
  enabled: boolean
  preferredDays: number[]
  timeWindowStart: string
  timeWindowEnd: string
}

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
  conflictsWith: Array<{ clientName: string; start: string; end: string }>
}
interface RunResult {
  proposals: Proposal[]
  existingSchedules: Array<{ id: string; caregiverId: string; clientName: string; dayOfWeek: number; startTime: string; endTime: string }>
  unscheduled: Array<{ clientId: string; clientName: string; visitNumber: number; reason: string }>
  summary: {
    caregivers: Array<{ id: string; name: string; targetHours: number; existingHours: number; proposedNewHours: number; totalHours: number; remainingCapacity: number; utilizationPct: number }>
    clients: Array<{ id: string; name: string; visitsNeeded: number; visitsPlaced: number; hoursPerWeek: number; fullyScheduled: boolean }>
    totalProposals: number
    conflictCount: number
    unscheduledCount: number
    fullyScheduledClients: number
    totalClients: number
  }
}

const tinyLabel: CSSProperties = { fontSize: '0.68rem', fontWeight: 700, color: C.inkSoft, display: 'block', marginBottom: '0.2rem' }
const tinyHint: CSSProperties = { fontWeight: 400, color: C.inkSoft }
const tinyTime: CSSProperties = { padding: '0.2rem', borderRadius: '5px', border: `1px solid ${C.line}`, fontSize: '0.78rem', boxSizing: 'border-box' }

export default function RosterOptimizer() {
  const toast = useToast()
  const [roster, setRoster] = useState<Roster | null>(null)
  const [caregivers, setCaregivers] = useState<CgRow[]>([])
  const [clients, setClients] = useState<ClRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [step, setStep] = useState<'setup' | 'results'>('setup')
  const [running, setRunning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cgFilter, setCgFilter] = useState('')
  const [clFilter, setClFilter] = useState('')

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const data = await api.get('/api/roster-optimizer/roster') as Roster
        if (!live) return
        setRoster(data)
        setCaregivers(data.caregivers.map((cg) => ({
          ...cg,
          targetHours: parseFloat(String(cg.maxHoursPerWeek)) || 40,
          enabled: true,
          preferredStart: '',
          preferredEnd: '',
          preferredDays: [],
        })))
        setClients(data.clients.map((cl) => {
          const hrs = parseFloat(String(cl.assignedHoursPerWeek)) || 0
          const allowedDays = Array.isArray(cl.serviceAllowedDays) ? cl.serviceAllowedDays.map(Number) : []
          return {
            ...cl,
            hoursPerWeek: hrs,
            visitsPerWeek: cl.serviceDaysPerWeek || suggestVisits(hrs),
            enabled: true,
            preferredDays: allowedDays,
            timeWindowStart: '',
            timeWindowEnd: '',
          }
        }))
      } catch (err) {
        if (live) setLoadError(errorMessage(err))
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [])

  // ── Caregivers ──
  const updateCg = <K extends keyof CgRow>(id: string, key: K, value: CgRow[K]) =>
    setCaregivers((prev) => prev.map((c) => (c.id === id ? { ...c, [key]: value } : c)))
  const toggleDays = (days: number[], day: number) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b))
  const toggleCgDay = (id: string, day: number) =>
    setCaregivers((prev) => prev.map((c) => (c.id !== id ? c : { ...c, preferredDays: toggleDays(c.preferredDays || [], day) })))
  const toggleAllCg = (val: boolean) => setCaregivers((prev) => prev.map((c) => ({ ...c, enabled: val })))

  // ── Clients ──
  const updateCl = <K extends keyof ClRow>(id: string, key: K, value: ClRow[K]) =>
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, [key]: value } : c)))
  const toggleClDay = (id: string, day: number) =>
    setClients((prev) => prev.map((c) => (c.id !== id ? c : { ...c, preferredDays: toggleDays(c.preferredDays || [], day) })))
  const toggleAllCl = (val: boolean) => setClients((prev) => prev.map((c) => ({ ...c, enabled: val })))

  // ── Run ──
  const runOptimizer = async () => {
    const activeCg = caregivers.filter((c) => c.enabled)
    const activeCl = clients.filter((c) => c.enabled && c.hoursPerWeek > 0 && c.visitsPerWeek > 0)
    if (!activeCg.length) { toast.error('Enable at least one caretaker'); return }
    if (!activeCl.length) { toast.error('Enable at least one client with hours set'); return }

    setRunning(true)
    setResult(null)
    try {
      const data = await api.post('/api/roster-optimizer/run', {
        caregivers: activeCg.map((c) => ({
          id: c.id, targetHours: c.targetHours,
          preferredStart: c.preferredStart || null,
          preferredEnd: c.preferredEnd || null,
          preferredDays: c.preferredDays?.length ? c.preferredDays : null,
        })),
        clients: activeCl.map((c) => ({
          id: c.id, hoursPerWeek: c.hoursPerWeek, visitsPerWeek: c.visitsPerWeek,
          preferredDays: c.preferredDays?.length ? c.preferredDays : null,
          timeWindowStart: c.timeWindowStart || null,
          timeWindowEnd: c.timeWindowEnd || null,
        })),
      }) as RunResult
      setResult(data)
      // Every proposal without a conflict starts selected
      setSelected(new Set(data.proposals.filter((p) => !p.hasConflict).map((p) => p.id)))
      setStep('results')
    } catch (err) {
      toast.error('Optimizer failed: ' + errorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  // ── Apply ──
  const applyProposals = async () => {
    if (!result || selected.size === 0) return
    const toApply = result.proposals.filter((p) => selected.has(p.id))
    setApplying(true)
    try {
      const data = await api.post('/api/roster-optimizer/apply', { proposals: toApply }) as { created: number; errors: number }
      toast.success(`✅ Applied ${data.created} schedule${data.created !== 1 ? 's' : ''} to live schedule!`)
      if (data.errors > 0) toast.error(`⚠️ ${data.errors} failed`)
      setStep('setup')
      setResult(null)
    } catch (err) {
      toast.error('Apply failed: ' + errorMessage(err))
    } finally {
      setApplying(false)
    }
  }

  const toggleProposal = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const cgColorFor = (id: string) => {
    const idx = caregivers.findIndex((c) => c.id === id)
    return MARKS[idx % MARKS.length] || C.muted
  }

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: C.muted }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
      Loading your full roster...
    </div>
  )

  if (loadError) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: C.ink }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>❌</div>
      <span style={{ color: tint('red').ink }}>Failed to load roster: {loadError}</span>
    </div>
  )

  const activeCgCount = caregivers.filter((c) => c.enabled).length
  const activeClCount = clients.filter((c) => c.enabled).length
  const totalTargetHrs = caregivers.filter((c) => c.enabled).reduce((s, c) => s + c.targetHours, 0)
  const totalNeededHrs = clients.filter((c) => c.enabled).reduce((s, c) => s + c.hoursPerWeek, 0)
  const blue = tint('blue'), green = tint('green'), amber = tint('amber'), red = tint('red')
  const enough = totalTargetHrs >= totalNeededHrs
  const capacity = enough ? green : amber

  return (
    <div>
      {/* Header banner: white text on deep fills, dark in both themes. */}
      <div style={{ background: `linear-gradient(135deg, #1e3a5f 0%, ${C.brandFill} 100%)`, borderRadius: '12px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem', color: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.15rem' }}>📊 Roster Schedule Optimizer</h3>
            <p style={{ margin: 0, fontSize: '0.87rem' }}>
              Automatically analyzes your entire team and client roster to build the best weekly schedule.
              Nothing changes until you review and apply.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '1.25rem', flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{caregivers.length}</div>
              <div style={{ fontSize: '0.72rem' }}>Caretakers</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{clients.length}</div>
              <div style={{ fontSize: '0.72rem' }}>Clients</div>
            </div>
          </div>
        </div>
      </div>

      {step === 'setup' && (
        <>
          {activeCgCount > 0 && activeClCount > 0 && (
            <div style={{
              padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.25rem', background: capacity.bg, border: `1px solid ${capacity.line}`,
              display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: capacity.ink }}>{enough ? '✅' : '⚠️'} Capacity Check</span>
              <span style={{ fontSize: '0.85rem', color: C.ink }}>
                Available caretaker hours: <strong>{totalTargetHrs}h</strong> &nbsp;|&nbsp;
                Client hours needed: <strong>{totalNeededHrs}h</strong> &nbsp;|&nbsp;
                <span style={{ color: capacity.ink }}>
                  {enough ? `+${(totalTargetHrs - totalNeededHrs).toFixed(1)}h buffer` : `⚠ ${(totalNeededHrs - totalTargetHrs).toFixed(1)}h shortfall`}
                </span>
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
            {/* Caretakers */}
            <div className="hc-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h4 style={{ margin: 0, color: blue.ink }}>
                  👤 Caretakers
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: blue.bg, color: blue.ink, padding: '0.2rem 0.5rem', borderRadius: '12px' }}>
                    {activeCgCount} / {caregivers.length} active
                  </span>
                </h4>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button onClick={() => toggleAllCg(true)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderRadius: '5px', border: `1px solid ${blue.line}`, background: blue.bg, cursor: 'pointer', color: blue.ink }}>All</button>
                  <button onClick={() => toggleAllCg(false)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderRadius: '5px', border: `1px solid ${C.line}`, background: C.subtle, cursor: 'pointer', color: C.inkSoft }}>None</button>
                </div>
              </div>

              <input placeholder="🔍 Filter caretakers..." value={cgFilter} onChange={(e) => setCgFilter(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '7px', border: `1px solid ${C.line}`, fontSize: '0.85rem', marginBottom: '0.75rem', boxSizing: 'border-box' }} />

              <div style={{ maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {caregivers
                  .filter((cg) => !cgFilter || `${cg.firstName} ${cg.lastName}`.toLowerCase().includes(cgFilter.toLowerCase()))
                  .map((cg) => (
                    <div key={cg.id} style={{
                      padding: '0.6rem 0.75rem', borderRadius: '8px',
                      background: cg.enabled ? blue.bg : C.subtle,
                      border: `1.5px solid ${cg.enabled ? cgColorFor(cg.id) + '66' : C.line}`,
                      opacity: cg.enabled ? 1 : 0.55,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <input type="checkbox" checked={cg.enabled} onChange={(e) => updateCg(cg.id, 'enabled', e.target.checked)}
                          style={{ cursor: 'pointer', width: 'auto', flexShrink: 0 }} />
                        <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: cgColorFor(cg.id), flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cg.firstName} {cg.lastName}
                          </div>
                          {/* Hours in the grid's week (Sun–Sat), through the schedule engine — the same number the Schedule grid shows. */}
                          <div style={{ fontSize: '0.72rem', color: C.inkSoft }}
                            title={roster?.week ? `Scheduled ${formatDate(roster.week.start, { month: 'short', day: 'numeric' })} – ${formatDate(roster.week.end, { month: 'short', day: 'numeric' })}` : undefined}>
                            {Number(cg.currentWeeklyHours || 0).toFixed(2)}h this week · {cg.activeClientCount} clients
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                          <span style={{ fontSize: '0.72rem', color: C.inkSoft }}>Target:</span>
                          <input type="number" min="1" max="80" step="0.5" value={cg.targetHours}
                            onChange={(e) => updateCg(cg.id, 'targetHours', parseFloat(e.target.value) || 0)}
                            disabled={!cg.enabled}
                            style={{ width: '52px', padding: '0.25rem 0.3rem', borderRadius: '6px', border: `1px solid ${C.line}`, fontSize: '0.85rem', textAlign: 'center' }} />
                          <span style={{ fontSize: '0.72rem', color: C.inkSoft }}>h</span>
                        </div>
                      </div>
                      {cg.enabled && (
                        <div style={{ marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: `1px solid ${C.line}` }}>
                          <label style={tinyLabel}>Preferred Shift <span style={tinyHint}>(empty = any time)</span></label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
                            <input type="time" value={cg.preferredStart || ''} onChange={(e) => updateCg(cg.id, 'preferredStart', e.target.value)} style={tinyTime} />
                            <input type="time" value={cg.preferredEnd || ''} onChange={(e) => updateCg(cg.id, 'preferredEnd', e.target.value)} style={tinyTime} />
                          </div>
                          <div style={{ marginTop: '0.4rem' }}>
                            <label style={tinyLabel}>Preferred Days <span style={tinyHint}>(empty = any day)</span></label>
                            <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                              {DAY_NAMES.map((d, i) => (
                                <button key={i} type="button" onClick={() => toggleCgDay(cg.id, i)} style={dayButton((cg.preferredDays || []).includes(i), i, true)}>{d}</button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            {/* Clients */}
            <div className="hc-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h4 style={{ margin: 0, color: green.ink }}>
                  🏥 Clients
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: green.bg, color: green.ink, padding: '0.2rem 0.5rem', borderRadius: '12px' }}>
                    {activeClCount} / {clients.length} active
                  </span>
                </h4>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button onClick={() => toggleAllCl(true)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderRadius: '5px', border: `1px solid ${green.line}`, background: green.bg, cursor: 'pointer', color: green.ink }}>All</button>
                  <button onClick={() => toggleAllCl(false)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderRadius: '5px', border: `1px solid ${C.line}`, background: C.subtle, cursor: 'pointer', color: C.inkSoft }}>None</button>
                </div>
              </div>

              <input placeholder="🔍 Filter clients..." value={clFilter} onChange={(e) => setClFilter(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '7px', border: `1px solid ${C.line}`, fontSize: '0.85rem', marginBottom: '0.75rem', boxSizing: 'border-box' }} />

              <div style={{ maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {clients
                  .filter((cl) => !clFilter || `${cl.firstName} ${cl.lastName}`.toLowerCase().includes(clFilter.toLowerCase()))
                  .map((cl) => (
                    <div key={cl.id} style={{
                      padding: '0.6rem 0.75rem', borderRadius: '8px',
                      background: cl.enabled ? green.bg : C.subtle,
                      border: `1.5px solid ${cl.enabled ? green.line : C.line}`,
                      opacity: cl.enabled ? 1 : 0.55,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: cl.enabled ? '0.5rem' : 0 }}>
                        <input type="checkbox" checked={cl.enabled} onChange={(e) => updateCl(cl.id, 'enabled', e.target.checked)}
                          style={{ cursor: 'pointer', width: 'auto', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cl.firstName} {cl.lastName}
                          </div>
                          {(cl.scheduledDays?.length ?? 0) > 0 && (
                            <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                              {(cl.scheduledDays || []).map((d) => (
                                <span key={d} style={dayChip(Number(d), true)}>{DAY_NAMES[Number(d)]}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {cl.enabled && (
                        <div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                            <div>
                              <label style={{ ...tinyLabel, marginBottom: '0.15rem' }}>Hrs / Week</label>
                              <div style={{ padding: '0.3rem', borderRadius: '6px', border: `1px solid ${C.line}`, fontSize: '0.85rem', background: C.subtle, color: C.ink, fontWeight: 600 }}>
                                {cl.hoursPerWeek}h
                              </div>
                            </div>
                            <div>
                              <label style={{ ...tinyLabel, marginBottom: '0.15rem' }}>Visits / Week</label>
                              <input type="number" min="1" max="7" value={cl.visitsPerWeek}
                                onChange={(e) => updateCl(cl.id, 'visitsPerWeek', parseFloat(e.target.value) || 0)}
                                style={{ width: '100%', padding: '0.3rem', borderRadius: '6px', border: `1px solid ${C.line}`, fontSize: '0.85rem', boxSizing: 'border-box' }} />
                            </div>
                            {cl.hoursPerWeek > 0 && cl.visitsPerWeek > 0 && (
                              <div style={{ gridColumn: '1/-1', fontSize: '0.7rem', color: C.inkSoft }}>
                                ≈ {(cl.hoursPerWeek / cl.visitsPerWeek).toFixed(1)}h per visit
                              </div>
                            )}
                          </div>

                          <div style={{ marginTop: '0.4rem' }}>
                            <label style={tinyLabel}>Visit Days <span style={tinyHint}>(empty = auto)</span></label>
                            <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                              {DAY_NAMES.map((d, i) => (
                                <button key={i} type="button" onClick={() => toggleClDay(cl.id, i)} style={dayButton((cl.preferredDays || []).includes(i), i, true)}>{d}</button>
                              ))}
                            </div>
                          </div>

                          <div style={{ marginTop: '0.4rem' }}>
                            <label style={tinyLabel}>Time Window <span style={tinyHint}>(empty = any)</span></label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
                              <input type="time" value={cl.timeWindowStart || ''} onChange={(e) => updateCl(cl.id, 'timeWindowStart', e.target.value)} style={tinyTime} />
                              <input type="time" value={cl.timeWindowEnd || ''} onChange={(e) => updateCl(cl.id, 'timeWindowEnd', e.target.value)} style={tinyTime} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <button onClick={runOptimizer} disabled={running || activeCgCount === 0 || activeClCount === 0}
              style={{
                padding: '0.95rem 2.75rem', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '1.05rem',
                background: running || activeCgCount === 0 || activeClCount === 0 ? FILL.grey : `linear-gradient(135deg, #1e3a5f, ${C.brandFill})`,
                color: '#fff', boxShadow: running ? 'none' : `0 4px 18px ${C.shadow}`, transition: 'all 0.2s',
              }}>
              {running ? '⏳ Analyzing roster...' : `✨ Generate Optimized Schedule (${activeCgCount} caretakers · ${activeClCount} clients)`}
            </button>
            {(activeCgCount === 0 || activeClCount === 0) && (
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: C.muted }}>Enable at least one caretaker and one client to continue</p>
            )}
          </div>
        </>
      )}

      {step === 'results' && result && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'Proposals', value: result.summary.totalProposals, t: blue },
              { label: 'Clients Covered', value: `${result.summary.fullyScheduledClients}/${result.summary.totalClients}`, t: green },
              { label: 'Conflicts', value: result.summary.conflictCount, t: result.summary.conflictCount > 0 ? red : green },
              { label: 'Unscheduled', value: result.summary.unscheduledCount, t: result.summary.unscheduledCount > 0 ? amber : green },
            ].map((s) => (
              <div key={s.label} className="hc-card" style={{ textAlign: 'center', padding: '0.75rem', background: s.t.bg }}>
                <div style={{ fontSize: '1.85rem', fontWeight: 800, color: s.t.ink }}>{s.value}</div>
                <div style={{ fontSize: '0.78rem', color: C.inkSoft }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div className="hc-card" style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.75rem' }}>👤 Caretaker Utilization</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {result.summary.caregivers.map((cg) => (
                <div key={cg.id} style={{ flex: '1 1 200px', padding: '0.75rem', background: C.subtle, borderRadius: '8px', borderLeft: `4px solid ${cgColorFor(cg.id)}` }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.3rem' }}>{cg.name}</div>
                  <div style={{ fontSize: '0.75rem', color: C.inkSoft, marginBottom: '0.35rem' }}>
                    {Number(cg.existingHours || 0).toFixed(2)}h this week + {cg.proposedNewHours}h new = <strong style={{ color: C.ink }}>{cg.totalHours}h</strong> / {cg.targetHours}h target
                  </div>
                  <div style={{ height: '7px', background: C.line, borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${cg.utilizationPct}%`, height: '100%', background: cg.utilizationPct > 100 ? '#DC2626' : cgColorFor(cg.id), transition: 'width 0.4s' }} />
                  </div>
                  <div style={{ fontSize: '0.7rem', marginTop: '0.25rem', color: cg.remainingCapacity > 0 ? green.ink : C.inkSoft }}>
                    {cg.utilizationPct}% utilized
                    {cg.remainingCapacity > 0 && ` · ${cg.remainingCapacity}h open`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="hc-card" style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.75rem' }}>🏥 Client Coverage</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              {result.summary.clients.map((cl) => {
                const t = cl.fullyScheduled ? green : amber
                return (
                  <div key={cl.id} style={{ flex: '1 1 150px', padding: '0.6rem 0.75rem', borderRadius: '8px', background: t.bg, border: `1.5px solid ${t.line}` }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.2rem' }}>{cl.name}</div>
                    <div style={{ fontSize: '0.8rem', color: t.ink }}>{cl.fullyScheduled ? '✅' : '⚠'} {cl.visitsPlaced}/{cl.visitsNeeded} visits</div>
                    <div style={{ fontSize: '0.72rem', color: C.inkSoft }}>{cl.hoursPerWeek}h/wk</div>
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
            <h4 style={{ margin: 0 }}>📋 Proposed Schedule
              <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: C.muted, fontWeight: 400 }}>({selected.size} of {result.proposals.length} selected)</span>
            </h4>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button onClick={() => setSelected(result.proposals.length === selected.size ? new Set() : new Set(result.proposals.map((p) => p.id)))}
                style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontSize: '0.78rem', cursor: 'pointer' }}>
                {selected.size === result.proposals.length ? 'Deselect All' : 'Select All'}
              </button>
              {(['grid', 'list'] as const).map((v) => (
                <button key={v} onClick={() => setViewMode(v)}
                  style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: 'none', fontSize: '0.78rem', cursor: 'pointer',
                    background: viewMode === v ? FILL.blue : C.subtle, color: viewMode === v ? '#fff' : C.ink }}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {viewMode === 'grid' && (
            <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
                <thead>
                  <tr style={{ background: C.subtle }}>
                    <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.8rem', color: C.inkSoft, fontWeight: 600, borderBottom: `2px solid ${C.line}`, whiteSpace: 'nowrap' }}>Caretaker</th>
                    {DAY_NAMES.map((d) => (
                      <th key={d} style={{ padding: '0.6rem 0.4rem', textAlign: 'center', fontSize: '0.8rem', color: C.inkSoft, fontWeight: 600, borderBottom: `2px solid ${C.line}`, minWidth: '85px' }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.summary.caregivers.map((cg) => (
                    <tr key={cg.id} style={{ borderBottom: `1px solid ${C.subtle}` }}>
                      <td style={{ padding: '0.4rem 0.75rem', verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cgColorFor(cg.id), flexShrink: 0 }} />
                          <span style={{ fontSize: '0.83rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{(cg.name || '').split(' ')[0]}</span>
                        </div>
                        <div style={{ fontSize: '0.68rem', color: C.muted, paddingLeft: '1.1rem' }}>{cg.totalHours}/{cg.targetHours}h</div>
                      </td>
                      {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                        const existing = result.existingSchedules.filter((s) => s.caregiverId === cg.id && s.dayOfWeek === day)
                        const proposed = result.proposals.filter((p) => p.caregiverId === cg.id && p.dayOfWeek === day)
                        return (
                          <td key={day} style={{ padding: '0.2rem', verticalAlign: 'top' }}>
                            {existing.map((s) => (
                              <div key={s.id} title="Existing — not changed"
                                style={{ fontSize: '0.65rem', padding: '0.2rem 0.3rem', marginBottom: '0.15rem', borderRadius: '4px', background: C.subtle, borderLeft: `3px solid ${cgColorFor(cg.id)}60`, color: C.inkSoft }}>
                                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.clientName?.split(' ')[0]}</div>
                                <div>{fmtTime(s.startTime)}</div>
                              </div>
                            ))}
                            {proposed.map((p) => {
                              const on = selected.has(p.id)
                              const t = p.hasConflict ? red : blue
                              return (
                                <div key={p.id} onClick={() => toggleProposal(p.id)}
                                  title={p.hasConflict ? `⚠ Overlaps: ${p.conflictsWith.map((c) => c.clientName).join(', ')}` : 'Click to toggle'}
                                  style={{ fontSize: '0.65rem', padding: '0.2rem 0.3rem', marginBottom: '0.15rem', borderRadius: '4px', cursor: 'pointer',
                                    background: on ? t.bg : C.surface,
                                    border: `1px solid ${t.line}`,
                                    borderLeft: `3px solid ${p.hasConflict ? '#DC2626' : cgColorFor(p.caregiverId)}`,
                                    opacity: on ? 1 : 0.45 }}>
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
              <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.72rem', color: C.muted, marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <span>◻ Grey = existing (unchanged)</span>
                <span style={{ color: blue.ink }}>🔷 Blue = proposed new (selected)</span>
                <span style={{ color: red.ink }}>🔴 Red = conflict (review before applying)</span>
                <span>Click any proposal to toggle</span>
              </div>
            </div>
          )}

          {viewMode === 'list' && (
            <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {result.proposals.map((p) => {
                const on = selected.has(p.id)
                const t = p.hasConflict ? red : blue
                return (
                  <div key={p.id} onClick={() => toggleProposal(p.id)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.7rem 0.9rem', borderRadius: '8px', cursor: 'pointer',
                      background: on ? t.bg : C.subtle, border: `1.5px solid ${on ? t.line : C.line}`,
                    }}>
                    <input type="checkbox" checked={on} onChange={() => {}} style={{ width: 'auto', cursor: 'pointer', marginTop: '2px' }} />
                    <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: cgColorFor(p.caregiverId), flexShrink: 0, marginTop: '4px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                        {p.clientName}
                        {p.hasConflict && <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', padding: '0.1rem 0.4rem', background: C.surface, border: `1px solid ${red.line}`, color: red.ink, borderRadius: '4px' }}>⚠ CONFLICT</span>}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: C.inkSoft }}>
                        {p.caregiverName} · {p.dayName} {fmtTime(p.startTime)}–{fmtTime(p.endTime)} ({p.hoursPerVisit}h)
                      </div>
                      {p.hasConflict && p.conflictsWith.map((c, i) => (
                        <div key={i} style={{ fontSize: '0.73rem', color: red.ink, marginTop: '0.15rem' }}>
                          ⚠ Overlaps {c.clientName} ({fmtTime(c.start)}–{fmtTime(c.end)})
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', alignItems: 'center', padding: '1rem', background: C.subtle, borderRadius: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => setStep('setup')}
              style={{ padding: '0.7rem 1.4rem', borderRadius: '8px', border: `1.5px solid ${C.line}`, background: C.surface, color: C.ink, cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}>
              ← Back to Setup
            </button>
            <button onClick={runOptimizer} disabled={running}
              style={{ padding: '0.7rem 1.4rem', borderRadius: '8px', border: `1px solid ${C.line}`, background: C.surface, color: C.ink, cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}>
              🔄 Re-run
            </button>
            <button onClick={applyProposals} disabled={applying || selected.size === 0}
              style={{
                padding: '0.7rem 1.75rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem',
                background: applying || selected.size === 0 ? FILL.grey : `linear-gradient(135deg, ${FILL.green}, ${C.brandFill})`,
                color: '#fff', boxShadow: applying || selected.size === 0 ? 'none' : `0 4px 12px ${C.shadow}`,
              }}>
              {applying ? 'Applying...' : `✅ Apply ${selected.size} to Live Schedule`}
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: C.muted, textAlign: 'center', margin: '0.5rem 0 0' }}>
            Only checked proposals apply. Conflicts are unchecked by default — review before including.
          </p>
        </div>
      )}
    </div>
  )
}
