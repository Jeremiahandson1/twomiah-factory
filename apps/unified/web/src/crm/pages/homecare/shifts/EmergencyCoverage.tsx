// Moved from templates/crm-homecare/frontend/src/components/admin/EmergencyCoverage.tsx.
// Find a caregiver to cover a shift someone called out of, and assign them.
//
// Its calls, as the unified server answers them (server/crm/homecare/clients/emergency.ts, data/homecareClients.ts):
//   GET  /api/emergency/miss-reports            → list reply: the open call-outs, camelCase (firstName, clientName,
//                                                 startTime, endTime, date 'YYYY-MM-DD' …; were first_name …).
//   GET  /api/clients                           → list reply of the company's clients (firstName, lastName).
//   GET  /api/emergency/available-caregivers    → list reply: who is free (firstName, phone, scheduledHoursThisWeek,
//                                                 avgRating, isPreferred, certifications …).
//   POST /api/emergency/assign-coverage         → { success, message } — the same body as the template.
import { useState, useEffect } from 'react'
import { formatDate, toLocalYMD } from '../lib/date'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { useConfirm, useMayWrite, useToast } from '../../../../shared'
import { SOLID, field } from './ui'

/** One open call-out (an absences row of type call_out, with its caregiver and the visit it was for). */
interface MissReport {
  id: string
  caregiverId: string
  clientId: string | null
  date: string
  reason: string | null
  firstName: string | null
  lastName: string | null
  clientName: string | null
  startTime: string | null
  endTime: string | null
}

/** A caregiver free for the searched shift. */
interface CoverageCaregiver {
  id: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  certifications: unknown
  scheduledHoursThisWeek: number | string | null
  avgRating: number | string | null
  isPreferred: boolean
}

interface ClientOption { id: string; firstName: string | null; lastName: string | null }

interface SearchForm { date: string; startTime: string; endTime: string; clientId: string }

// The pickers ask for every client: the list is paged at 50 by default, and the template's dropdown stopped there.

const labelStyle = { display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--hc-ink-soft)', marginBottom: '0.3rem' } as const

const EmergencyCoverage = () => {
  const toast = useToast()
  const confirm = useConfirm()
  // Assigning coverage makes a visit: POST /assign-coverage asks care-schedule:create.
  const mayAssign = useMayWrite('care-schedule:create')
  const [missReports, setMissReports] = useState<MissReport[]>([])
  const [availableCaregivers, setAvailableCaregivers] = useState<CoverageCaregiver[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [selectedReport, setSelectedReport] = useState<MissReport | null>(null)
  const [searchForm, setSearchForm] = useState<SearchForm>({
    date: toLocalYMD(new Date()),
    startTime: '08:00',
    endTime: '16:00',
    clientId: '',
  })

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    try {
      const [reports, clientList] = await Promise.all([
        api.get('/api/emergency/miss-reports'),
        listAll('/api/clients'),
      ])
      setMissReports(rows<MissReport>(reports))
      setClients(rows<ClientOption>(clientList))
    } catch {
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const searchCoverage = async (report: MissReport | null = null) => {
    const form: SearchForm = report ? {
      date: report.date?.split('T')[0] || searchForm.date,
      startTime: report.startTime || searchForm.startTime,
      endTime: report.endTime || searchForm.endTime,
      clientId: report.clientId || searchForm.clientId,
    } : searchForm

    setSearching(true)
    if (report) setSelectedReport(report)

    try {
      const data = await api.get('/api/emergency/available-caregivers', {
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        clientId: form.clientId || undefined,
      })
      setAvailableCaregivers(rows<CoverageCaregiver>(data))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to search for available caregivers'))
    } finally {
      setSearching(false)
    }
  }

  const assignCoverage = async (caregiver: CoverageCaregiver) => {
    const ok = await confirm(
      `Assign ${caregiver.firstName} ${caregiver.lastName} as emergency coverage?`,
      { confirmText: 'Assign', danger: false },
    )
    if (!ok) return

    // Coverage is assigned against a specific call-out (absence). A manual
    // availability search has no absence to attach to, so the request 400'd while
    // the UI still claimed success — assign from a "Called Out" report instead.
    if (!selectedReport?.id) {
      toast.error('Pick a "Called Out" report above, then assign coverage for it.')
      return
    }

    try {
      const form = {
        date: selectedReport.date?.split('T')[0] || searchForm.date,
        startTime: selectedReport.startTime || searchForm.startTime,
        endTime: selectedReport.endTime || searchForm.endTime,
        clientId: selectedReport.clientId || searchForm.clientId,
      }
      await api.post('/api/emergency/assign-coverage', {
        absenceId: selectedReport.id,
        caregiverId: caregiver.id,
        ...form,
      })
      toast.success(`Coverage assigned to ${caregiver.firstName} ${caregiver.lastName}. They have been notified.`)
      loadData()
      setAvailableCaregivers([])
      setSelectedReport(null)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to assign coverage'))
    }
  }

  // The hours chip: an ink and its ground, light and dark (the frame's tokens).
  const statusBadge = (hours: number) => {
    if (hours > 35) return { bg: 'var(--hc-danger-bg)', ink: 'var(--hc-danger-ink)', line: 'var(--hc-danger-line)', label: 'Near Overtime' }
    if (hours > 25) return { bg: 'var(--hc-warning-bg)', ink: 'var(--hc-warning-ink)', line: 'var(--hc-warning-line)', label: 'Moderate Hours' }
    return { bg: 'var(--hc-success-bg)', ink: 'var(--hc-success-ink)', line: 'var(--hc-success-line)', label: 'Available' }
  }

  const certList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [])

  if (loading) return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--hc-ink-soft)' }}>Loading...</div>

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--hc-ink)' }}>🚨 Emergency Coverage</h2>
        <p style={{ margin: '0.25rem 0 0 0', color: 'var(--hc-ink-soft)', fontSize: '0.9rem' }}>
          Find available caregivers to cover uncovered shifts
        </p>
      </div>

      {/* Pending Miss Reports */}
      {missReports.length > 0 && (
        <div className="hc-card" style={{ marginBottom: '1.5rem', border: '1px solid var(--hc-danger-line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '1.2rem' }}>🔴</span>
            <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--hc-red-ink)' }}>
              {missReports.length} Shift{missReports.length !== 1 ? 's' : ''} Need Coverage
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {missReports.map((report) => (
              <div key={report.id} style={{
                padding: '0.875rem', background: 'var(--hc-danger-bg)', borderRadius: '8px',
                border: '1px solid var(--hc-danger-line)', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem',
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--hc-ink)' }}>
                    {report.firstName} {report.lastName} — Called Out
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--hc-ink)', marginTop: '0.25rem' }}>
                    📅 {formatDate(report.date, { weekday: 'long', month: 'short', day: 'numeric' })}
                    {report.startTime && ` • ${report.startTime} – ${report.endTime}`}
                    {report.clientName && ` • Client: ${report.clientName}`}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--hc-danger-ink)', marginTop: '0.2rem' }}>
                    Reason: {report.reason || 'No reason provided'}
                  </div>
                </div>
                <button
                  onClick={() => searchCoverage(report)}
                  style={{
                    padding: '0.5rem 1rem', background: SOLID.red, color: '#fff',
                    border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                  }}
                >
                  Find Coverage
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual Search */}
      <div className="hc-card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--hc-ink)' }}>🔍 Find Available Caregivers</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <label style={labelStyle}>Date *</label>
            <input type="date" value={searchForm.date}
              onChange={(e) => setSearchForm((p) => ({ ...p, date: e.target.value }))}
              style={field} />
          </div>
          <div>
            <label style={labelStyle}>Start Time *</label>
            <input type="time" value={searchForm.startTime}
              onChange={(e) => setSearchForm((p) => ({ ...p, startTime: e.target.value }))}
              style={field} />
          </div>
          <div>
            <label style={labelStyle}>End Time *</label>
            <input type="time" value={searchForm.endTime}
              onChange={(e) => setSearchForm((p) => ({ ...p, endTime: e.target.value }))}
              style={field} />
          </div>
          <div>
            <label style={labelStyle}>Client (optional)</label>
            <select value={searchForm.clientId}
              onChange={(e) => setSearchForm((p) => ({ ...p, clientId: e.target.value }))}
              style={field}>
              <option value="">Any client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={() => searchCoverage()}
          disabled={searching}
          style={{
            padding: '0.6rem 1.5rem', background: SOLID.brand, color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
            opacity: searching ? 0.7 : 1,
          }}
        >
          {searching ? 'Searching...' : '🔍 Search Available Caregivers'}
        </button>
      </div>

      {/* Results */}
      {availableCaregivers.length > 0 && (
        <div className="hc-card">
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--hc-ink)' }}>
            ✅ {availableCaregivers.length} Caregiver{availableCaregivers.length !== 1 ? 's' : ''} Available
            {selectedReport && <span style={{ fontWeight: 400, color: 'var(--hc-muted)' }}> for {formatDate(selectedReport.date)}</span>}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {availableCaregivers.map((cg) => {
              const sb = statusBadge(parseFloat(String(cg.scheduledHoursThisWeek ?? 0)) || 0)
              const certs = certList(cg.certifications)
              return (
                <div key={cg.id} style={{
                  padding: '0.875rem', background: 'var(--hc-subtle)', borderRadius: '8px',
                  border: '1px solid var(--hc-line)', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem',
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 700, color: 'var(--hc-ink)', fontSize: '0.95rem' }}>
                        {cg.firstName} {cg.lastName}
                      </span>
                      {cg.isPreferred && (
                        <span style={{ padding: '0.1rem 0.4rem', background: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>
                          ⭐ Preferred
                        </span>
                      )}
                      <span style={{ padding: '0.1rem 0.4rem', background: sb.bg, color: sb.ink, borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, border: `1px solid ${sb.line}` }}>
                        {sb.label}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      {cg.phone && <span>📞 {cg.phone}</span>}
                      <span>📊 {(parseFloat(String(cg.scheduledHoursThisWeek ?? 0)) || 0).toFixed(2)}h this week</span>
                      {parseFloat(String(cg.avgRating ?? 0)) > 0 && <span>⭐ {cg.avgRating} avg rating</span>}
                      {certs.length > 0 && <span>🎓 {certs.join(', ')}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {cg.phone && (
                      <a href={`tel:${cg.phone}`} style={{
                        padding: '0.5rem 0.875rem', background: 'var(--hc-surface)', color: 'var(--hc-ink)',
                        border: '1px solid var(--hc-line)', borderRadius: '8px', cursor: 'pointer',
                        fontWeight: 500, fontSize: '0.85rem', textDecoration: 'none',
                      }}>📞 Call</a>
                    )}
                    {mayAssign && (
                      <button
                        onClick={() => assignCoverage(cg)}
                        style={{
                          padding: '0.5rem 0.875rem', background: SOLID.brand, color: '#fff',
                          border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                        }}
                      >
                        Assign Coverage
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!searching && availableCaregivers.length === 0 && missReports.length === 0 && (
        <div className="hc-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--hc-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
          <p style={{ fontWeight: 600, color: 'var(--hc-ink)' }}>No coverage issues reported</p>
          <p style={{ fontSize: '0.85rem' }}>Use the search above to find available caregivers for a specific shift.</p>
        </div>
      )}
    </div>
  )
}

export default EmergencyCoverage
