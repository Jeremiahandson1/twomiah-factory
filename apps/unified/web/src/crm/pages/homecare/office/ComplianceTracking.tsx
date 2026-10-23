// Moved from templates/crm-homecare/frontend/src/components/admin/ComplianceTracking.tsx.
// Changes in the move:
//   · every reply is read as the unified server answers it (camelCase): the caregivers ({ data } from
//     GET /api/users/caregivers: firstName, lastName), the latest background check (GET /api/caregivers/:id/background-check:
//     checkDate, expirationDate, clearanceNumber, status, notes — a 404 "none on file" is no check), the training records
//     ({ data } of trainingType, completionDate, expirationDate, certificationNumber, provider, status). The template read
//     first_name, check_date, expiration_date, training_type… which its server never sent, so names, dates and every
//     expiry warning were blank.
//   · saving a background check is always POST /api/caregivers/:id/background-check (each save records a check; the
//     newest by check date is the one shown). The template sent PUT when one existed, a route neither server has, so
//     "Edit" always failed. The edit form now opens filled in with the check on file.
//   · the Documents tab no longer calls GET /api/caregivers/:id/compliance-documents: no server has that route (the
//     template's 404 read as "no documents"). It says so and points at the Documents page.
//   · the all-caregivers overview reads GET /api/background-checks/overview/expiring as answered: the checks expiring
//     within 30 days or already expired (with caregiverFirstName/LastName), not one row per caregiver with an
//     expiry_status. So it shows Expired and Expiring Soon (worked out from the expiration date); the "No check on
//     file" and "Current" counts and the 30/60/90/180-day choice are gone (the server answers neither, nor reads `days`).
//   · Add / Edit / Delete show only to whoever may (care-hr:create, care-hr:delete); refusals show the server's sentence.
//   · every colour is a light/dark pair (the frame's tokens); the confirm is the app's.
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, rows, errorMessage } from '../lib/http'
import { formatDate, parseLocalDate } from '../lib/date'
import { useAuth, useConfirm, useMayWrite, useToast } from '../../../../shared'

interface Caregiver { id: string; firstName: string | null; lastName: string | null; email?: string | null; phone?: string | null }

/** GET /api/caregivers/:id/background-check — the latest check (a background_checks row without its secrets). */
interface BackgroundCheck {
  id: string
  status: string | null
  checkDate: string | null
  expirationDate: string | null
  clearanceNumber: string | null
  notes: string | null
}

/** One row of GET /api/caregivers/:id/training-records. */
interface TrainingRecord {
  id: string
  trainingType: string | null
  completionDate: string | null
  expirationDate: string | null
  certificationNumber: string | null
  provider: string | null
  status: string | null
}

/** One row of GET /api/background-checks/overview/expiring. */
interface ExpiringCheck {
  id: string
  caregiverId: string
  checkType: string | null
  status: string | null
  expirationDate: string | null
  caregiverFirstName: string | null
  caregiverLastName: string | null
}

type Tone = 'success' | 'warning' | 'info' | 'danger' | 'neutral'

/** A status's tone: its ground, ink and line are the frame's light/dark tokens. */
const toneOf = (status: string | null | undefined): Tone => {
  switch (status) {
    case 'cleared':
    case 'completed': return 'success'
    case 'conditional':
    case 'pending': return 'warning'
    case 'in_progress': return 'info'
    case 'denied':
    case 'expired':
    case 'failed': return 'danger'
    default: return 'neutral'
  }
}
const toneInk = (t: Tone) => (t === 'neutral' ? 'var(--hc-ink-soft)' : `var(--hc-${t}-ink)`)
const toneBg = (t: Tone) => (t === 'neutral' ? 'var(--hc-subtle)' : `var(--hc-${t}-bg)`)
const toneLine = (t: Tone) => (t === 'neutral' ? 'var(--hc-line)' : `var(--hc-${t}-line)`)

const trainingTypes = [
  { value: 'cpr', label: 'CPR Certification' },
  { value: 'first_aid', label: 'First Aid' },
  { value: 'hipaa', label: 'HIPAA Training' },
  { value: 'infection_control', label: 'Infection Control' },
  { value: 'bloodborne_pathogen', label: 'Bloodborne Pathogen' },
  { value: 'safety', label: 'Workplace Safety' },
  { value: 'dementia_care', label: 'Dementia Care' },
  { value: 'fall_prevention', label: 'Fall Prevention' },
  { value: 'manual_handling', label: 'Manual Handling' },
  { value: 'medication_administration', label: 'Medication Administration' },
  { value: 'medication_reminders', label: 'Medication Reminders & Handling (PCW)' },
  { value: 'misappropriation_policy', label: 'Client Funds, Property & Misappropriation Policy' },
  { value: 'other', label: 'Other' },
]

const DAY_MS = 1000 * 60 * 60 * 24

const isExpiringSoon = (expirationDate: string | null | undefined) => {
  if (!expirationDate) return false
  const daysUntilExpire = Math.floor((parseLocalDate(expirationDate).getTime() - Date.now()) / DAY_MS)
  return daysUntilExpire < 30 && daysUntilExpire >= 0
}

const isExpired = (expirationDate: string | null | undefined) => {
  if (!expirationDate) return false
  return parseLocalDate(expirationDate).getTime() < Date.now()
}

const getTrainingTypeLabel = (type: string | null) => {
  const training = trainingTypes.find((t) => t.value === type)
  return training ? training.label : type || ''
}

/** A 404 with the server's "none on file" code (or any 404) means no check, not an error. */
const isNotFound = (err: unknown) => (err as { status?: number })?.status === 404

interface BackgroundForm { checkDate: string; expirationDate: string; status: string; clearanceNumber: string; notes: string }
interface TrainingForm {
  trainingType: string; completionDate: string; expirationDate: string; certificationNumber: string; provider: string; status: string
}

const EMPTY_BACKGROUND: BackgroundForm = { checkDate: '', expirationDate: '', status: 'pending', clearanceNumber: '', notes: '' }
const EMPTY_TRAINING: TrainingForm = {
  trainingType: 'cpr', completionDate: '', expirationDate: '', certificationNumber: '', provider: '', status: 'completed',
}

const ComplianceTracking = () => {
  const confirm = useConfirm()
  // The Documents page is the documents switch's: off, nothing here links to it.
  const documentsOn = useAuth().hasFeature('documents')
  const mayCreate = useMayWrite('care-hr:create')
  const mayDelete = useMayWrite('care-hr:delete')
  const [caregivers, setCaregivers] = useState<Caregiver[]>([])
  const [selectedCaregiverId, setSelectedCaregiverId] = useState('')
  const [backgroundCheck, setBackgroundCheck] = useState<BackgroundCheck | null>(null)
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [showBackgroundForm, setShowBackgroundForm] = useState(false)
  const [showTrainingForm, setShowTrainingForm] = useState(false)
  const [tab, setTab] = useState<'background' | 'training' | 'documents' | 'overview'>('background')
  const [backgroundFormData, setBackgroundFormData] = useState<BackgroundForm>(EMPTY_BACKGROUND)
  const [trainingFormData, setTrainingFormData] = useState<TrainingForm>(EMPTY_TRAINING)

  useEffect(() => {
    api.get('/api/users/caregivers')
      .then((reply) => setCaregivers(rows<Caregiver>(reply)))
      .catch((err) => setMessage('Error: ' + errorMessage(err, 'Could not load caregivers.')))
      .finally(() => setLoading(false))
  }, [])

  const handleCaregiverSelect = async (caregiverId: string) => {
    setSelectedCaregiverId(caregiverId)
    setMessage('')
    setShowBackgroundForm(false)
    setShowTrainingForm(false)
    if (!caregiverId) { setBackgroundCheck(null); setTrainingRecords([]); return }

    const [bg, training] = await Promise.all([
      api.get(`/api/caregivers/${caregiverId}/background-check`)
        .then((r) => r as BackgroundCheck)
        .catch((err) => {
          if (!isNotFound(err)) setMessage('Error: ' + errorMessage(err, 'Could not load the background check.'))
          return null
        }),
      api.get(`/api/caregivers/${caregiverId}/training-records`)
        .then((r) => rows<TrainingRecord>(r))
        .catch((err) => {
          setMessage('Error: ' + errorMessage(err, 'Could not load the training records.'))
          return [] as TrainingRecord[]
        }),
    ])
    setBackgroundCheck(bg)
    setTrainingRecords(training)
  }

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 2000)
  }

  const openBackgroundForm = () => {
    if (showBackgroundForm) { setShowBackgroundForm(false); return }
    setBackgroundFormData(backgroundCheck ? {
      checkDate: backgroundCheck.checkDate ? String(backgroundCheck.checkDate).slice(0, 10) : '',
      expirationDate: backgroundCheck.expirationDate ? String(backgroundCheck.expirationDate).slice(0, 10) : '',
      status: backgroundCheck.status || 'pending',
      clearanceNumber: backgroundCheck.clearanceNumber || '',
      notes: backgroundCheck.notes || '',
    } : EMPTY_BACKGROUND)
    setShowBackgroundForm(true)
  }

  const handleSaveBackgroundCheck = async (e: FormEvent) => {
    e.preventDefault()
    if (!backgroundFormData.checkDate) {
      setMessage('Check date is required')
      return
    }
    try {
      await api.post(`/api/caregivers/${selectedCaregiverId}/background-check`, backgroundFormData)
      flash('Background check record saved!')
      setShowBackgroundForm(false)
      handleCaregiverSelect(selectedCaregiverId)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to save background check'))
    }
  }

  const handleAddTraining = async (e: FormEvent) => {
    e.preventDefault()
    if (!trainingFormData.completionDate) {
      setMessage('Completion date is required')
      return
    }
    try {
      await api.post(`/api/caregivers/${selectedCaregiverId}/training-records`, trainingFormData)
      flash('Training record added!')
      setTrainingFormData(EMPTY_TRAINING)
      setShowTrainingForm(false)
      handleCaregiverSelect(selectedCaregiverId)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to add training record'))
    }
  }

  const handleDeleteTraining = async (trainingId: string) => {
    if (!(await confirm('Delete this training record?', { confirmText: 'Delete' }))) return
    try {
      await api.delete(`/api/training-records/${trainingId}`)
      flash('Training record deleted')
      handleCaregiverSelect(selectedCaregiverId)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to delete'))
    }
  }

  const getComplianceOverview = () => {
    let status = 'compliant'
    const issues: string[] = []

    if (!backgroundCheck) {
      issues.push('No background check on file')
      status = 'non-compliant'
    } else if (backgroundCheck.status === 'denied') {
      issues.push('Background check denied')
      status = 'non-compliant'
    } else if (backgroundCheck.status === 'pending') {
      issues.push('Background check pending')
      status = 'incomplete'
    } else if (isExpired(backgroundCheck.expirationDate)) {
      issues.push('Background check expired')
      status = 'non-compliant'
    } else if (isExpiringSoon(backgroundCheck.expirationDate)) {
      issues.push('Background check expiring soon')
      status = 'at-risk'
    }

    const expiredTraining = trainingRecords.filter((t) => isExpired(t.expirationDate))
    if (expiredTraining.length > 0) {
      issues.push(`${expiredTraining.length} training certification(s) expired`)
      status = status === 'non-compliant' ? 'non-compliant' : 'at-risk'
    }

    const expiringTraining = trainingRecords.filter((t) => !isExpired(t.expirationDate) && isExpiringSoon(t.expirationDate))
    if (expiringTraining.length > 0) {
      issues.push(`${expiringTraining.length} training certification(s) expiring soon`)
      status = status === 'non-compliant' ? 'non-compliant' : 'at-risk'
    }

    return { status, issues }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    )
  }

  const overview = selectedCaregiverId ? getComplianceOverview() : null
  const overviewTone: Tone = overview?.status === 'compliant' ? 'success' : overview?.status === 'at-risk' ? 'warning' : 'danger'
  const sortedTraining = [...trainingRecords].sort(
    (a, b) => parseLocalDate(b.completionDate).getTime() - parseLocalDate(a.completionDate).getTime(),
  )
  const bgTone = toneOf(backgroundCheck?.status)

  return (
    <div>
      <div className="page-header">
        <h2>Compliance & Training Tracking</h2>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') || message.includes('required') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Caregiver Selection */}
      <div className="hc-card">
        <h3>Select Caregiver</h3>
        <select
          value={selectedCaregiverId}
          onChange={(e) => handleCaregiverSelect(e.target.value)}
          style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid var(--hc-line)' }}
        >
          <option value="">Select a caregiver...</option>
          {caregivers.map((cg) => (
            <option key={cg.id} value={cg.id}>
              {cg.firstName} {cg.lastName}
            </option>
          ))}
        </select>
      </div>

      {selectedCaregiverId && (
        <>
          {/* Compliance Overview Card */}
          {overview && (
            <div className="hc-card" style={{ marginBottom: '1.5rem' }}>
              <h3>Compliance Status</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{
                  padding: '1rem',
                  borderRadius: '50%',
                  background: toneBg(overviewTone),
                  color: toneInk(overviewTone),
                  border: `2px solid ${toneLine(overviewTone)}`,
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  minWidth: '80px',
                  textAlign: 'center',
                }}>
                  {overview.status === 'compliant' ? '✓' : '⚠'}
                </div>
                <div>
                  <strong>{overview.status.toUpperCase()}</strong>
                  {overview.issues.length > 0 && (
                    <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.5rem' }}>
                      {overview.issues.map((issue, idx) => (
                        <li key={idx} style={{ color: 'var(--hc-red-ink)' }}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="hc-card" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--hc-line)', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {(['background', 'training', 'documents', 'overview'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: '1rem',
                    background: tab === t ? 'var(--hc-brand-deep)' : 'transparent',
                    color: tab === t ? '#ffffff' : 'inherit',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    fontWeight: tab === t ? 'bold' : 'normal',
                  }}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Background Check Tab */}
          {tab === 'background' && (
            <div className="hc-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--hc-line)' }}>
                <h3 style={{ margin: 0 }}>Background Check</h3>
                {mayCreate && (
                  <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={openBackgroundForm}>
                    {showBackgroundForm ? 'Cancel' : backgroundCheck ? 'Edit' : 'Add'}
                  </button>
                )}
              </div>

              {showBackgroundForm && (
                <form onSubmit={handleSaveBackgroundCheck} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--hc-line)' }}>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Check Date *</label>
                      <input
                        type="date"
                        value={backgroundFormData.checkDate}
                        onChange={(e) => setBackgroundFormData({ ...backgroundFormData, checkDate: e.target.value })}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Expiration Date</label>
                      <input
                        type="date"
                        value={backgroundFormData.expirationDate}
                        onChange={(e) => setBackgroundFormData({ ...backgroundFormData, expirationDate: e.target.value })}
                      />
                    </div>

                    <div className="form-group">
                      <label>Status *</label>
                      <select
                        value={backgroundFormData.status}
                        onChange={(e) => setBackgroundFormData({ ...backgroundFormData, status: e.target.value })}
                      >
                        <option value="pending">Pending</option>
                        <option value="cleared">Cleared</option>
                        <option value="conditional">Conditional</option>
                        <option value="denied">Denied</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Clearance Number</label>
                      <input
                        type="text"
                        value={backgroundFormData.clearanceNumber}
                        onChange={(e) => setBackgroundFormData({ ...backgroundFormData, clearanceNumber: e.target.value })}
                        placeholder="Reference number..."
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Notes</label>
                    <textarea
                      value={backgroundFormData.notes}
                      onChange={(e) => setBackgroundFormData({ ...backgroundFormData, notes: e.target.value })}
                      placeholder="Any notes or conditions..."
                      rows={2}
                    ></textarea>
                  </div>

                  <div className="form-actions">
                    <button type="submit" className="hc-btn hc-btn-primary">Save Background Check</button>
                    <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowBackgroundForm(false)}>Cancel</button>
                  </div>
                </form>
              )}

              {backgroundCheck ? (
                <div style={{
                  padding: '1rem',
                  background: 'var(--hc-subtle)',
                  borderLeft: `4px solid ${toneInk(bgTone)}`,
                  borderRadius: '4px',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <strong>Check Date:</strong>
                      <p>{formatDate(backgroundCheck.checkDate)}</p>
                    </div>
                    <div>
                      <strong>Status:</strong>
                      <p>
                        <span className="hc-badge" style={{ background: toneBg(bgTone), color: toneInk(bgTone), border: `1px solid ${toneLine(bgTone)}` }}>
                          {(backgroundCheck.status ?? '').toUpperCase()}
                        </span>
                      </p>
                    </div>
                    {backgroundCheck.expirationDate && (
                      <div>
                        <strong>Expiration:</strong>
                        <p>
                          {formatDate(backgroundCheck.expirationDate)}
                          {isExpired(backgroundCheck.expirationDate) && <span style={{ color: 'var(--hc-red-ink)' }}> (EXPIRED)</span>}
                          {isExpiringSoon(backgroundCheck.expirationDate) && <span style={{ color: 'var(--hc-warning-ink)' }}> (EXPIRING SOON)</span>}
                        </p>
                      </div>
                    )}
                    {backgroundCheck.clearanceNumber && (
                      <div>
                        <strong>Clearance #:</strong>
                        <p>{backgroundCheck.clearanceNumber}</p>
                      </div>
                    )}
                  </div>
                  {backgroundCheck.notes && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--hc-line)' }}>
                      <strong>Notes:</strong>
                      <p>{backgroundCheck.notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ color: 'var(--hc-muted)', textAlign: 'center', padding: '1rem' }}>
                  No background check on file.
                </p>
              )}
            </div>
          )}

          {/* Training Tab */}
          {tab === 'training' && (
            <div className="hc-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--hc-line)' }}>
                <h3 style={{ margin: 0 }}>Training Records</h3>
                {mayCreate && (
                  <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => setShowTrainingForm(!showTrainingForm)}>
                    {showTrainingForm ? 'Cancel' : 'Add Training'}
                  </button>
                )}
              </div>

              {showTrainingForm && (
                <form onSubmit={handleAddTraining} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--hc-line)' }}>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Training Type *</label>
                      <select
                        value={trainingFormData.trainingType}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, trainingType: e.target.value })}
                      >
                        {trainingTypes.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Completion Date *</label>
                      <input
                        type="date"
                        value={trainingFormData.completionDate}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, completionDate: e.target.value })}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Expiration Date</label>
                      <input
                        type="date"
                        value={trainingFormData.expirationDate}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, expirationDate: e.target.value })}
                      />
                    </div>

                    <div className="form-group">
                      <label>Certification #</label>
                      <input
                        type="text"
                        value={trainingFormData.certificationNumber}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, certificationNumber: e.target.value })}
                        placeholder="Reference number..."
                      />
                    </div>

                    <div className="form-group">
                      <label>Provider</label>
                      <input
                        type="text"
                        value={trainingFormData.provider}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, provider: e.target.value })}
                        placeholder="Training provider name..."
                      />
                    </div>

                    <div className="form-group">
                      <label>Status</label>
                      <select
                        value={trainingFormData.status}
                        onChange={(e) => setTrainingFormData({ ...trainingFormData, status: e.target.value })}
                      >
                        <option value="completed">Completed</option>
                        <option value="in_progress">In Progress</option>
                        <option value="expired">Expired</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-actions">
                    <button type="submit" className="hc-btn hc-btn-primary">Add Training Record</button>
                    <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowTrainingForm(false)}>Cancel</button>
                  </div>
                </form>
              )}

              {sortedTraining.length === 0 ? (
                <p style={{ color: 'var(--hc-muted)', textAlign: 'center', padding: '1rem' }}>
                  No training records on file.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {sortedTraining.map((training) => (
                    <div
                      key={training.id}
                      style={{
                        padding: '1rem',
                        background: 'var(--hc-subtle)',
                        borderLeft: `4px solid ${toneInk(toneOf(training.status))}`,
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                      }}
                    >
                      <div>
                        <strong>{getTrainingTypeLabel(training.trainingType)}</strong>
                        <div style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)', marginTop: '0.25rem' }}>
                          Completed: {formatDate(training.completionDate)}
                        </div>
                        {training.expirationDate && (
                          <div style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>
                            Expires: {formatDate(training.expirationDate)}
                            {isExpired(training.expirationDate) && <span style={{ color: 'var(--hc-red-ink)' }}> (EXPIRED)</span>}
                            {isExpiringSoon(training.expirationDate) && <span style={{ color: 'var(--hc-warning-ink)' }}> (EXPIRING SOON)</span>}
                          </div>
                        )}
                        {training.certificationNumber && (
                          <div style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>
                            Cert #: {training.certificationNumber}
                          </div>
                        )}
                        {training.provider && (
                          <div style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>
                            Provider: {training.provider}
                          </div>
                        )}
                      </div>
                      {mayDelete && (
                        <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => handleDeleteTraining(training.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Documents Tab */}
          {tab === 'documents' && (
            <div className="hc-card">
              <h3>Compliance Documents</h3>
              <p style={{ color: 'var(--hc-ink-soft)', marginBottom: '1rem' }}>
                Scans of background check clearance, certifications, training documentation, etc.
              </p>
              <p style={{ color: 'var(--hc-muted)', textAlign: 'center', padding: '2rem' }}>
                Compliance documents are not listed here yet. Background check letters are on the{' '}
                <Link to="/crm/background-checks" style={{ color: 'var(--color-teal-dark)', textDecoration: 'underline' }}>Background Checks</Link>{' '}
                page{documentsOn ? <>; the agency&apos;s files are under{' '}<Link to="/crm/documents" style={{ color: 'var(--color-teal-dark)', textDecoration: 'underline' }}>Documents</Link></> : null}.
              </p>
            </div>
          )}

          {/* Overview Tab */}
          {tab === 'overview' && <ExpiryOverview />}
        </>
      )}
    </div>
  )
}

// ─── All-Caregivers Expiry Overview ───────────────────────────────────────────
type ExpiryStatus = 'expired' | 'expiring_soon'

const statusLabel: Record<ExpiryStatus, { label: string; tone: Tone }> = {
  expired: { label: 'Expired', tone: 'danger' },
  expiring_soon: { label: 'Expiring Soon', tone: 'warning' },
}

const ExpiryOverview = () => {
  const toast = useToast()
  const [data, setData] = useState<ExpiringCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | ExpiryStatus>('all')

  const loadData = async () => {
    setLoading(true)
    try {
      const reply = await api.get('/api/background-checks/overview/expiring')
      setData(rows<ExpiringCheck>(reply))
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to load expiry overview'))
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData() }, [])

  const expiryStatus = (row: ExpiringCheck): ExpiryStatus => (isExpired(row.expirationDate) ? 'expired' : 'expiring_soon')
  const daysUntil = (row: ExpiringCheck): number | null =>
    row.expirationDate ? Math.ceil((parseLocalDate(row.expirationDate).getTime() - Date.now()) / DAY_MS) : null

  const filtered = data.filter((row) => filter === 'all' || expiryStatus(row) === filter)
  const counts: Record<ExpiryStatus, number> = {
    expired: data.filter((row) => expiryStatus(row) === 'expired').length,
    expiring_soon: data.filter((row) => expiryStatus(row) === 'expiring_soon').length,
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 1rem' }}>🛡️ Background Check Expiry — All Caregivers</h3>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>Checks expired or expiring in the next 30 days</span>
        <button className="hc-btn hc-btn-primary hc-btn-sm" onClick={loadData}>Refresh</button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        {(Object.keys(counts) as ExpiryStatus[]).map((key) => {
          const s = statusLabel[key]
          const on = filter === key
          return (
            <button
              key={key}
              onClick={() => setFilter(on ? 'all' : key)}
              style={{
                padding: '0.75rem',
                background: on ? toneBg(s.tone) : 'var(--hc-surface)',
                border: `2px solid ${on ? toneLine(s.tone) : 'var(--hc-line)'}`,
                borderRadius: '8px', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: toneInk(s.tone) }}>{counts[key]}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink-soft)', fontWeight: 600 }}>{s.label}</div>
            </button>
          )
        })}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-ink-soft)' }}>Loading...</div> : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-ink-soft)' }}>
          {filter === 'all' ? 'No background checks expired or expiring soon.' : `No checks with "${statusLabel[filter].label}" status.`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {filtered.map((row) => {
            const s = statusLabel[expiryStatus(row)]
            const days = daysUntil(row)
            return (
              <div key={row.id} style={{ padding: '0.875rem', background: 'var(--hc-surface)', borderRadius: '8px', border: `1px solid ${toneLine(s.tone)}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--hc-ink)' }}>{row.caregiverFirstName} {row.caregiverLastName}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)' }}>
                    {row.checkType || 'Background check'}{row.status ? ` • ${row.status}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700, background: toneBg(s.tone), color: toneInk(s.tone), border: `1px solid ${toneLine(s.tone)}` }}>
                    {s.label}
                  </span>
                  <div style={{ fontSize: '0.78rem', color: 'var(--hc-ink-soft)', marginTop: '0.2rem' }}>
                    {row.expirationDate ? `Expires: ${formatDate(row.expirationDate)}` : 'No expiration date'}
                    {days !== null && days > 0 && ` (${days} days)`}
                    {days !== null && days <= 0 && ` (${Math.abs(days)} days ago)`}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ComplianceTracking
