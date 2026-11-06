// Moved from templates/crm-homecare/frontend/src/components/admin/CaregiverProfile.tsx — AdminDashboard's
// caregiver-profile section, now its own address: /crm/caregivers/:id.
//
// Replies read (server/crm/homecare/hr):
//   GET   /api/users/caregivers/:id          caregivers.ts — id, firstName, lastName, email, phone, isActive, role, address,
//                                            city, state, zip, createdAt, activeClients (no hire date, no coordinates:
//                                            "Hire Date" reads N/A and "Not geocoded" always shows — reported)
//   GET   /api/caregiver-profile/:id         caregiverProfile.ts — the row, or 404 none_on_file (read as "no profile yet")
//   PATCH /api/caregiver-profile/:id         care-hr:update — reads notes, capabilities, limitations, preferredHours and
//                                            availableMon … availableSun (the template sent availableDaysOfWeek, which the
//                                            route never read: the days never saved)
//   GET   /api/caregivers/:id/certifications { data }: certificationName, issuer, certificationNumber, issuedDate, expirationDate
//   POST  /api/caregivers/:id/certifications care-hr:create
//   DELETE /api/certifications/:id           care-hr:delete
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth, useConfirm } from '../../../../shared'
import { api, errorMessage, rows } from '../lib/http'
import { formatDate, parseLocalDate } from '../lib/date'
import { agencyDayHasBegun } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'

interface CaregiverSummary {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  role: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  /** Not in this reply (the template read hire_date / latitude; reported). */
  hireDate?: string | null
  latitude?: string | null
  longitude?: string | null
}

type DayKey = 'availableMon' | 'availableTue' | 'availableWed' | 'availableThu' | 'availableFri' | 'availableSat' | 'availableSun'
const DAY_KEYS: DayKey[] = ['availableMon', 'availableTue', 'availableWed', 'availableThu', 'availableFri', 'availableSat', 'availableSun']
const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type ProfileRow = Partial<Record<DayKey, boolean>> & {
  notes?: string | null
  capabilities?: string | null
  limitations?: string | null
  preferredHours?: string | null
  // Row 11 (care_margin_reports): where the caregiver sits, and the day they left.
  branchId?: string | null
  team?: string | null
  department?: string | null
  managerUserId?: string | null
  leftOn?: string | null
  leftReason?: string | null
}
interface Placement { branchId: string; team: string; department: string; managerUserId: string; leftOn: string; leftReason: string }
const EMPTY_PLACEMENT: Placement = { branchId: '', team: '', department: '', managerUserId: '', leftOn: '', leftReason: '' }

interface Certification {
  id: string
  certificationName: string | null
  issuer: string | null
  certificationNumber: string | null
  issuedDate: string | null
  expirationDate: string | null
}

const EMPTY_CERT = { certificationName: '', issuedDate: '', expirationDate: '', certificationNumber: '', issuer: '' }

export default function CaregiverProfile() {
  // Each control for whoever the server lets use it (care-hr create / update / delete) (lib/useMay.ts).
  const mayHr = useMay('care-hr')
  const { id: caregiverId = '' } = useParams()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const onBack = () => navigate('/crm/caregivers')
  const [caregiver, setCaregiver] = useState<CaregiverSummary | null>(null)
  const [certifications, setCertifications] = useState<Certification[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editingCerts, setEditingCerts] = useState(false)
  const [message, setMessage] = useState('')
  const [formData, setFormData] = useState({
    notes: '',
    capabilities: '',
    limitations: '',
    availableDaysOfWeek: [] as number[],
    preferredHours: '',
  })
  const [newCert, setNewCert] = useState(EMPTY_CERT)
  // Row 11 (care_margin_reports): branch, team, department, manager and the leaving date, with the lists the boxes offer.
  const placementOn = useAuth().hasFeature('care_margin_reports')
  const [placement, setPlacement] = useState<Placement>(EMPTY_PLACEMENT)
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [managers, setManagers] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (!placementOn) return
    api.get('/api/margin-reports/filters').then((r: any) => setBranches(r?.branches ?? [])).catch(() => setBranches([]))
    api.get('/api/users/admins', { limit: 200 }).then((r) => setManagers(rows<any>(r).map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() })))).catch(() => setManagers([]))
  }, [placementOn])

  useEffect(() => {
    loadCaregiverData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caregiverId])

  const loadCaregiverData = async () => {
    try {
      const [caregiverData, profileData, certsData] = await Promise.all([
        api.get(`/api/users/caregivers/${caregiverId}`).catch(() => null) as Promise<CaregiverSummary | null>,
        // No profile yet is a 404 (none_on_file): an empty profile, as the template's null was.
        api.get(`/api/caregiver-profile/${caregiverId}`).catch(() => null) as Promise<ProfileRow | null>,
        api.get(`/api/caregivers/${caregiverId}/certifications`).catch(() => null),
      ])

      setCaregiver(caregiverData)
      setCertifications(rows<Certification>(certsData))
      setFormData({
        notes: profileData?.notes || '',
        capabilities: profileData?.capabilities || '',
        limitations: profileData?.limitations || '',
        // The days are seven yes/no columns; the screen's list of day numbers (0 = Mon) is read from them.
        availableDaysOfWeek: profileData ? DAY_KEYS.flatMap((k, i) => (profileData[k] ? [i] : [])) : [],
        preferredHours: profileData?.preferredHours || '',
      })
      setPlacement({
        branchId: profileData?.branchId || '', team: profileData?.team || '', department: profileData?.department || '', managerUserId: profileData?.managerUserId || '',
        leftOn: profileData?.leftOn ? String(profileData.leftOn).slice(0, 10) : '', leftReason: profileData?.leftReason || '',
      })
    } catch (error) {
      console.error('Failed to load caregiver data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveProfile = async () => {
    try {
      const { availableDaysOfWeek, ...rest } = formData
      await api.patch(`/api/caregiver-profile/${caregiverId}`, {
        ...rest,
        ...Object.fromEntries(DAY_KEYS.map((k, i) => [k, availableDaysOfWeek.includes(i)])),
        ...(placementOn ? placement : {}),
      })
      setMessage('Profile updated')
      setTimeout(() => setMessage(''), 2000)
      setEditing(false)
      loadCaregiverData()
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to save'))
    }
  }

  const handleAddCertification = async (e: FormEvent) => {
    e.preventDefault()

    if (!newCert.certificationName || !newCert.issuedDate || !newCert.expirationDate) {
      setMessage('Certification name, issued date, and expiration date are required')
      return
    }

    try {
      await api.post(`/api/caregivers/${caregiverId}/certifications`, newCert)
      setMessage('Certification added')
      setTimeout(() => setMessage(''), 2000)
      setNewCert(EMPTY_CERT)
      setEditingCerts(false)
      loadCaregiverData()
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to add certification'))
    }
  }

  const handleDeleteCertification = async (certId: string) => {
    if (!(await confirm('Delete this certification?', { danger: true }))) return

    try {
      await api.delete(`/api/certifications/${certId}`)
      setMessage('Certification deleted')
      setTimeout(() => setMessage(''), 2000)
      loadCaregiverData()
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to delete'))
    }
  }

  const toggleDay = (day: number) => {
    setFormData((prev) => {
      const days = [...prev.availableDaysOfWeek]
      if (days.includes(day)) return { ...prev, availableDaysOfWeek: days.filter((d) => d !== day) }
      return { ...prev, availableDaysOfWeek: [...days, day].sort() }
    })
  }

  const isExpiringSoon = (expirationDate: string | null) => {
    const expDate = parseLocalDate(expirationDate)
    const daysUntilExpire = Math.floor((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    return daysUntilExpire < 90 && daysUntilExpire >= 0
  }

  const isExpired = (expirationDate: string | null) => agencyDayHasBegun(expirationDate)

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    )
  }

  if (!caregiver) {
    return <div className="hc-card hc-card-centered"><p>Caregiver not found</p></div>
  }

  return (
    <div>
      <div className="page-header">
        <button className="hc-btn hc-btn-secondary" onClick={onBack}>Back</button>
        <h2>{caregiver.firstName} {caregiver.lastName}</h2>
        {mayHr.update && <button className="hc-btn hc-btn-primary" onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>}
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Basic Info */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        <div className="hc-card">
          <h3>Contact Information</h3>
          <p><strong>Email:</strong> {caregiver.email}</p>
          <p><strong>Phone:</strong> {caregiver.phone || 'Not provided'}</p>
          <p><strong>Hire Date:</strong> {caregiver.hireDate ? formatDate(caregiver.hireDate) : 'N/A'}</p>
          <p><strong>Role:</strong> <span className="hc-badge hc-badge-info">{caregiver.role?.toUpperCase()}</span></p>
        </div>

        <div className="hc-card">
          <h3>📍 Home Address</h3>
          {caregiver.address ? (
            <>
              <p>{caregiver.address}</p>
              <p>{[caregiver.city, caregiver.state, caregiver.zip].filter(Boolean).join(', ')}</p>
              <p style={{ fontSize: '0.85rem', color: caregiver.latitude ? 'var(--hc-green-ink)' : 'var(--hc-warning-ink)' }}>
                {caregiver.latitude ? `✅ Geocoded (${Number(caregiver.latitude).toFixed(4)}, ${Number(caregiver.longitude).toFixed(4)})` : '⚠️ Not geocoded — use Route Optimizer → GPS & Geofence tab'}
              </p>
            </>
          ) : (
            <p style={{ color: 'var(--hc-warning-ink)' }}>⚠️ No address on file. Edit via Caregivers → Edit to add home address for route optimization.</p>
          )}
        </div>
      </div>

      {/* Certifications Section */}
      <div className="hc-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--hc-line)' }}>
          <h3 style={{ margin: 0 }}>Certifications &amp; Credentials</h3>
          {mayHr.create && <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => setEditingCerts(!editingCerts)}>
            {editingCerts ? 'Cancel' : 'Add Certification'}
          </button>}
        </div>

        {editingCerts && (
          <form onSubmit={handleAddCertification} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--hc-line)' }}>
            <h4>Add New Certification</h4>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Certification Name *</label>
                <input type="text" value={newCert.certificationName} onChange={(e) => setNewCert({ ...newCert, certificationName: e.target.value })} placeholder="e.g., CNA, LPN, RN, CPR, First Aid" required />
              </div>

              <div className="form-group">
                <label>Issuer / Organization</label>
                <input type="text" value={newCert.issuer} onChange={(e) => setNewCert({ ...newCert, issuer: e.target.value })} placeholder="e.g., American Red Cross" />
              </div>

              <div className="form-group">
                <label>Certification Number</label>
                <input type="text" value={newCert.certificationNumber} onChange={(e) => setNewCert({ ...newCert, certificationNumber: e.target.value })} placeholder="License or cert number" />
              </div>

              <div className="form-group">
                <label>Issued Date *</label>
                <input type="date" value={newCert.issuedDate} onChange={(e) => setNewCert({ ...newCert, issuedDate: e.target.value })} required />
              </div>

              <div className="form-group">
                <label>Expiration Date *</label>
                <input type="date" value={newCert.expirationDate} onChange={(e) => setNewCert({ ...newCert, expirationDate: e.target.value })} required />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="hc-btn hc-btn-primary">Add Certification</button>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setEditingCerts(false)}>Cancel</button>
            </div>
          </form>
        )}

        {certifications.length === 0 ? (
          <p style={{ color: 'var(--hc-muted)', textAlign: 'center', padding: '1rem' }}>No certifications recorded.</p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {certifications.map((cert) => {
              const expired = isExpired(cert.expirationDate)
              const expiringSoon = isExpiringSoon(cert.expirationDate)

              return (
                <div
                  key={cert.id}
                  style={{
                    padding: '1rem',
                    background: expired || expiringSoon ? 'var(--hc-warning-bg)' : 'var(--hc-subtle)',
                    border: `1px solid ${expired || expiringSoon ? 'var(--hc-warning-line)' : 'var(--hc-line)'}`,
                    borderRadius: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                    <div>
                      <strong>{cert.certificationName}</strong>
                      {cert.issuer && <div style={{ fontSize: '0.85rem', color: 'var(--hc-muted)' }}>Issuer: {cert.issuer}</div>}
                      {cert.certificationNumber && <div style={{ fontSize: '0.85rem', color: 'var(--hc-muted)' }}>Cert #: {cert.certificationNumber}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {expired && <span className="hc-badge hc-badge-danger">EXPIRED</span>}
                      {expiringSoon && !expired && <span className="hc-badge hc-badge-warning">EXPIRING SOON</span>}
                      {mayHr.delete && <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => handleDeleteCertification(cert.id)}>
                        Delete
                      </button>}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.9rem' }}>
                    <div><strong>Issued:</strong> {formatDate(cert.issuedDate)}</div>
                    <div><strong>Expires:</strong> {formatDate(cert.expirationDate)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Profile Editing */}
      {editing ? (
        <div className="hc-card hc-card-form">
          <h3>Edit Caregiver Profile</h3>

          <div className="form-group">
            <label>What They Can Do *</label>
            <textarea
              value={formData.capabilities}
              onChange={(e) => setFormData({ ...formData, capabilities: e.target.value })}
              placeholder="Describe tasks and skills (e.g., medication management, meal prep, mobility assistance...)"
              rows={4}
            ></textarea>
          </div>

          <div className="form-group">
            <label>Limitations / Restrictions *</label>
            <textarea
              value={formData.limitations}
              onChange={(e) => setFormData({ ...formData, limitations: e.target.value })}
              placeholder="Any limitations or restrictions (e.g., cannot lift more than X pounds...)"
              rows={4}
            ></textarea>
          </div>

          <div className="form-group">
            <label>Available Days of Week *</label>
            <div className="availability-grid">
              {dayLabels.map((day, idx) => (
                <label key={day} className="checkbox-label">
                  <input type="checkbox" checked={formData.availableDaysOfWeek.includes(idx)} onChange={() => toggleDay(idx)} className="form-checkbox" />
                  <span>{day}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Preferred Hours</label>
            <input
              type="text"
              value={formData.preferredHours}
              onChange={(e) => setFormData({ ...formData, preferredHours: e.target.value })}
              placeholder="e.g., 8am-5pm, No early mornings, Weekends only..."
            />
          </div>

          {placementOn && (
            <div className="hc-card" style={{ marginBottom: '1rem' }}>
              <h4>Where they sit</h4>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                <div className="form-group"><label>Branch</label>
                  <select value={placement.branchId} onChange={(e) => setPlacement({ ...placement, branchId: e.target.value })}>
                    <option value="">None</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select></div>
                <div className="form-group"><label>Team</label><input type="text" value={placement.team} onChange={(e) => setPlacement({ ...placement, team: e.target.value })} placeholder="e.g. North team" /></div>
                <div className="form-group"><label>Department</label><input type="text" value={placement.department} onChange={(e) => setPlacement({ ...placement, department: e.target.value })} placeholder="e.g. Personal care" /></div>
                <div className="form-group"><label>Manager</label>
                  <select value={placement.managerUserId} onChange={(e) => setPlacement({ ...placement, managerUserId: e.target.value })}>
                    <option value="">None</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select></div>
              </div>
              <h4 style={{ marginTop: '0.75rem' }}>Leaving</h4>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                <div className="form-group"><label>Left on</label><input type="date" value={placement.leftOn} onChange={(e) => setPlacement({ ...placement, leftOn: e.target.value })} /></div>
                <div className="form-group"><label>Reason for leaving</label><input type="text" value={placement.leftReason} onChange={(e) => setPlacement({ ...placement, leftReason: e.target.value })} placeholder="e.g. Moved away" /></div>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--hc-muted)' }}>The leaving date makes the turnover report exact. Leave it empty while they are still here.</p>
            </div>
          )}

          <div className="form-group">
            <label>General Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Any other relevant information..."
              rows={4}
            ></textarea>
          </div>

          <div className="form-actions">
            <button className="hc-btn hc-btn-primary" onClick={handleSaveProfile}>Save Changes</button>
            <button className="hc-btn hc-btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {/* View Mode */}
          <div className="hc-card">
            <h3>Capabilities</h3>
            <p>{formData.capabilities || 'Not specified'}</p>
          </div>

          <div className="hc-card">
            <h3>Limitations</h3>
            <p>{formData.limitations || 'None specified'}</p>
          </div>

          {placementOn && (
            <div className="hc-card">
              <h3>Where they sit</h3>
              <p><strong>Branch:</strong> {branches.find((b) => b.id === placement.branchId)?.name || 'None'}</p>
              <p><strong>Team:</strong> {placement.team || 'None'} · <strong>Department:</strong> {placement.department || 'None'}</p>
              <p><strong>Manager:</strong> {managers.find((m) => m.id === placement.managerUserId)?.name || 'None'}</p>
              {placement.leftOn && <p><strong>Left on:</strong> {formatDate(placement.leftOn)}{placement.leftReason ? ` — ${placement.leftReason}` : ''}</p>}
            </div>
          )}

          <div className="hc-card">
            <h3>Availability</h3>
            <div className="availability-display">
              <p><strong>Days Available:</strong></p>
              <div className="availability-badges">
                {formData.availableDaysOfWeek.length > 0 ? (
                  formData.availableDaysOfWeek.map((idx) => (
                    <span key={idx} className="hc-badge hc-badge-success">{dayLabels[idx]}</span>
                  ))
                ) : (
                  <span className="hc-badge hc-badge-secondary">Not specified</span>
                )}
              </div>
              {formData.preferredHours && (
                <p><strong>Preferred Hours:</strong> {formData.preferredHours}</p>
              )}
            </div>
          </div>

          {formData.notes && (
            <div className="hc-card">
              <h3>Notes</h3>
              <p>{formData.notes}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
