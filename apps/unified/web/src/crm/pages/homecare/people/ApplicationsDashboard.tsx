// Moved from templates/crm-homecare/frontend/src/components/admin/ApplicationsDashboard.tsx (/crm/applications).
//
// Replies read (server/crm/homecare/hr/applications.ts):
//   GET  /api/applications          care-hr:read — { data }: the application rows (camelCase: firstName, hasCna,
//                                   yearsExperience, desiredPayRate, certifications [json], createdAt …)
//   POST /api/applications/:id/hire care-hr:create — { success, caregiverId, packetUrl, packetCreated, credentialsEmailed,
//                                   emailedTo, tempPassword (only when the email did not go), message }; a plan's seat
//                                   limit is a 403 with its sentence.
import { useEffect, useState, type MouseEvent } from 'react'
import { useToast } from '../../../../shared'
import { api, errorMessage, rows } from '../lib/http'
import { formatDate } from '../lib/date'
import ApplicationDetail from './ApplicationDetail'
import { useMay } from '../lib/useMay'

export interface ApplicationRow {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  status: string | null
  yearsExperience: number | null
  desiredPayRate: string | null
  hasCna: boolean | null
  hasLpn: boolean | null
  hasRn: boolean | null
  hasCpr: boolean | null
  hasFirstAid: boolean | null
  certifications: unknown
  createdAt: string
}

interface HireResult {
  credentialsEmailed?: boolean
  emailedTo?: string
  tempPassword?: string
  message?: string
  packetUrl?: string | null
}

// White text sits on these in both themes (the template's #059669 was 3.8:1 with white; its grey 2.5:1).
const HIRE_FILL = '#047857'
const BUSY_FILL = '#6B7280'

const fieldInput = { width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--hc-line)', fontSize: '0.95rem', background: 'var(--hc-surface)', color: 'var(--hc-ink)' } as const
const fieldLabel = { display: 'block', marginBottom: '0.3rem', fontWeight: 600, fontSize: '0.85rem' } as const

export default function ApplicationsDashboard() {
  // Hiring is care-hr:create, the server's check (lib/useMay.ts).
  const mayHr = useMay('care-hr')
  const toast = useToast()
  const [applications, setApplications] = useState<ApplicationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('new')
  const [selectedApp, setSelectedApp] = useState<ApplicationRow | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [hireModal, setHireModal] = useState<ApplicationRow | null>(null)
  const [hireForm, setHireForm] = useState({ hourlyRate: '15.00', email: '', password: '' })
  const [hiring, setHiring] = useState(false)
  const [hireResult, setHireResult] = useState<HireResult | null>(null)

  useEffect(() => {
    loadApplications()
  }, [])

  const loadApplications = async () => {
    try {
      setApplications(rows<ApplicationRow>(await api.get('/api/applications')))
    } catch (error) {
      console.error('Failed to load applications:', error)
    } finally {
      setLoading(false)
    }
  }

  const openHireModal = (app: ApplicationRow, e: MouseEvent) => {
    e.stopPropagation()
    setHireForm({ hourlyRate: '15.00', email: app.email || '', password: '' })
    setHireModal(app)
    setHireResult(null)
  }

  const handleHire = async () => {
    if (!hireModal) return
    const rateText = String(hireForm.hourlyRate).trim()
    if (rateText !== '' && (!Number.isFinite(Number(rateText)) || Number(rateText) < 0)) {
      toast.error('Hourly rate must be a number of zero or more')
      return
    }
    setHiring(true)
    try {
      const data: HireResult = await api.post(`/api/applications/${hireModal.id}/hire`, {
        hourlyRate: String(hireForm.hourlyRate).trim() === '' ? undefined : Number(hireForm.hourlyRate),
        email: hireForm.email,
        password: hireForm.password || undefined,
      })
      setHireResult(data)
      loadApplications()
    } catch (error) {
      toast.error('Error: ' + errorMessage(error, 'Hire failed'))
    } finally {
      setHiring(false)
    }
  }

  const filteredApplications = applications
    .filter((app) => {
      if (filter !== 'all' && app.status !== filter) return false
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        return (
          (app.firstName || '').toLowerCase().includes(term) ||
          (app.lastName || '').toLowerCase().includes(term) ||
          (app.email || '').toLowerCase().includes(term)
        )
      }
      return true
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'hired': return 'hc-badge-success'
      case 'offered': return 'hc-badge-primary'
      case 'interviewed': return 'hc-badge-info'
      case 'reviewing': return 'hc-badge-warning'
      case 'rejected': return 'hc-badge-danger'
      case 'new': return 'hc-badge-secondary'
      default: return 'hc-badge-secondary'
    }
  }

  const getCertificationBadges = (app: ApplicationRow) => {
    const certs: string[] = []
    if (app.hasCna) certs.push('CNA')
    if (app.hasLpn) certs.push('LPN')
    if (app.hasRn) certs.push('RN')
    if (app.hasCpr) certs.push('CPR')
    if (app.hasFirstAid) certs.push('First Aid')
    for (const c of (Array.isArray(app.certifications) ? app.certifications : [])) if (!certs.includes(String(c))) certs.push(String(c))
    return certs
  }

  const closeHire = () => { setHireModal(null); setHireResult(null) }

  if (selectedApp) {
    return (
      <ApplicationDetail
        applicationId={selectedApp.id}
        onBack={() => {
          setSelectedApp(null)
          loadApplications()
        }}
      />
    )
  }

  return (
    <div>
      <div className="page-header">
        <h2>📋 Job Applications</h2>
      </div>

      {/* Search & Filter */}
      <div className="hc-card">
        <div className="filter-controls">
          <input type="text" placeholder="Search by name or email..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
        </div>

        <div className="filter-tabs">
          {['all', 'new', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected'].map((f) => (
            <button key={f} className={`filter-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="filter-count">({applications.filter((a) => f === 'all' || a.status === f).length})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Applications Table */}
      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : filteredApplications.length === 0 ? (
        <div className="hc-card hc-card-centered">
          <p>No applications found.</p>
        </div>
      ) : (
        <div className="applications-grid">
          {filteredApplications.map((app) => (
            <div key={app.id} className="application-card" onClick={() => setSelectedApp(app)}>
              <div className="app-header">
                <div>
                  <h4>{app.firstName} {app.lastName}</h4>
                  <p className="app-date">{formatDate(app.createdAt)}</p>
                </div>
                <span className={`hc-badge ${getStatusColor(app.status)}`}>{(app.status || 'new').toUpperCase()}</span>
              </div>

              <div className="app-body">
                <p><strong>Email:</strong> {app.email}</p>
                <p><strong>Phone:</strong> {app.phone}</p>

                {Number(app.yearsExperience) > 0 && <p><strong>Experience:</strong> {app.yearsExperience} years</p>}

                {getCertificationBadges(app).length > 0 && (
                  <div className="app-certs">
                    {getCertificationBadges(app).map((cert) => <span key={cert} className="hc-badge hc-badge-info">{cert}</span>)}
                  </div>
                )}

                {app.desiredPayRate && <p><strong>Expected Rate:</strong> ${app.desiredPayRate}/hr</p>}
              </div>

              <div className="app-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <small>Click to review application</small>
                {mayHr.create && app.status !== 'hired' && app.status !== 'rejected' && (
                  <button onClick={(e) => openHireModal(app, e)}
                    style={{ padding: '0.35rem 0.75rem', background: HIRE_FILL, color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                    ✅ Hire as Caregiver
                  </button>
                )}
                {app.status === 'hired' && (
                  <span style={{ padding: '0.25rem 0.6rem', background: 'var(--hc-success-bg)', color: 'var(--hc-success-ink)', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600 }}>
                    ✓ Hired
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hire Modal */}
      {hireModal && (
        <div onClick={closeHire}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: '12px', width: '100%', maxWidth: '480px', overflow: 'hidden' }}>

            {!hireResult ? (
              <>
                <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--hc-line)' }}>
                  <h3 style={{ margin: 0, color: 'var(--hc-green-ink)' }}>✅ Convert to Caregiver</h3>
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.88rem', color: 'var(--hc-muted)' }}>
                    Create a caregiver account for <strong>{hireModal.firstName} {hireModal.lastName}</strong>
                  </p>
                </div>
                <div style={{ padding: '1.25rem' }}>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={fieldLabel}>Email (for login) *</label>
                    <input value={hireForm.email} onChange={(e) => setHireForm((p) => ({ ...p, email: e.target.value }))} style={fieldInput} />
                  </div>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={fieldLabel}>Temporary Password</label>
                    <input value={hireForm.password} onChange={(e) => setHireForm((p) => ({ ...p, password: e.target.value }))}
                      placeholder="Leave blank to auto-generate" style={fieldInput} />
                    <small style={{ color: 'var(--hc-muted)' }}>They'll use this to log in the first time</small>
                  </div>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={fieldLabel}>Hourly Rate ($)</label>
                    <input inputMode="decimal" value={hireForm.hourlyRate} onChange={(e) => setHireForm((p) => ({ ...p, hourlyRate: e.target.value }))} style={fieldInput} />
                  </div>

                  {/* Applicant Summary */}
                  <div style={{ padding: '0.75rem', background: 'var(--hc-success-bg)', borderRadius: '8px', border: '1px solid var(--hc-success-line)', fontSize: '0.82rem', marginBottom: '1rem', color: 'var(--hc-success-ink)' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>Applicant Info</div>
                    <div>📞 {hireModal.phone || 'No phone'}</div>
                    <div>📍 {[hireModal.city, hireModal.state].filter(Boolean).join(', ') || 'No city given'}</div>
                    {/* A number in `{n && …}` prints a bare "0" when it is 0 — compare instead. */}
                    {Number(hireModal.yearsExperience) > 0 && <div>🏥 {hireModal.yearsExperience} yrs experience</div>}
                    {hireModal.hasCna === true && <div>📋 CNA</div>}
                  </div>
                </div>
                <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--hc-line)', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button onClick={closeHire}
                    style={{ padding: '0.6rem 1.25rem', background: 'var(--hc-subtle)', color: 'var(--hc-ink)', border: '1px solid var(--hc-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
                  <button onClick={handleHire} disabled={hiring || !hireForm.email}
                    style={{ padding: '0.6rem 1.25rem', background: hiring ? BUSY_FILL : HIRE_FILL, color: '#fff', border: 'none', borderRadius: '8px', cursor: hiring ? 'not-allowed' : 'pointer', fontSize: '0.9rem', fontWeight: 600 }}>
                    {hiring ? 'Creating...' : '✅ Create Caregiver Account'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
                <h3 style={{ margin: '0 0 0.5rem', color: 'var(--hc-green-ink)' }}>Caregiver Created!</h3>
                <p style={{ marginBottom: '1rem' }}><strong>{hireModal.firstName} {hireModal.lastName}</strong> is now a caregiver.</p>
                {/* The login is emailed to the new caregiver. The password is on screen only when that email did not go
                    (the server then returns it), so the office can hand it over — never beside an email that has it. */}
                {hireResult.credentialsEmailed ? (
                  <div style={{ padding: '1rem', background: 'var(--hc-success-bg)', borderRadius: '8px', border: '1px solid var(--hc-success-line)', textAlign: 'left', marginBottom: '1.5rem', color: 'var(--hc-success-ink)', fontSize: '0.9rem' }}>
                    ✉️ Login details emailed to <strong>{hireResult.emailedTo || hireForm.email}</strong>.
                  </div>
                ) : (
                  <div style={{ padding: '1rem', background: 'var(--hc-warning-bg)', borderRadius: '8px', border: '1px solid var(--hc-warning-line)', textAlign: 'left', marginBottom: '1.5rem', color: 'var(--hc-warning-ink)' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>⚠️ The login email could not be sent — give them these yourself</div>
                    <div style={{ fontSize: '0.9rem' }}><strong>Email:</strong> {hireResult.emailedTo || hireForm.email}</div>
                    {hireResult.tempPassword && <div style={{ fontSize: '0.9rem' }}><strong>Temp Password:</strong> {hireResult.tempPassword}</div>}
                  </div>
                )}
                {hireResult.message && <p style={{ fontSize: '0.88rem', textAlign: 'left', marginBottom: '1rem' }}>{hireResult.message}</p>}
                {hireResult.packetUrl && (
                  <p style={{ fontSize: '0.8rem', textAlign: 'left', marginBottom: '1.5rem', wordBreak: 'break-all' }}>
                    Onboarding packet link: <a href={hireResult.packetUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--hc-blue-ink)' }}>{hireResult.packetUrl}</a>
                  </p>
                )}
                <button onClick={closeHire}
                  style={{ padding: '0.6rem 2rem', background: HIRE_FILL, color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem', fontWeight: 600 }}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
