// Moved from templates/crm-homecare/frontend/src/components/admin/ApplicationDetail.tsx — one application, opened in
// place from Job Applications (ApplicationsDashboard), as in the template.
//
// Replies read (server/crm/homecare/hr/applications.ts):
//   GET  /api/applications/:id          care-hr:read — the row (camelCase) and statusHistory
//   PUT  /api/applications/:id/status   care-hr:update — { success, application }
//   POST /api/applications/:id/notes    care-hr:update — appended, dated
//   POST /api/applications/:id/hire     care-hr:create — { message, credentialsEmailed, tempPassword? }
import { useEffect, useState } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, errorMessage } from '../lib/http'
import { formatDate } from '../lib/date'

interface Reference { name?: string; relationship?: string; phone?: string; email?: string }

interface Application {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  status: string | null
  dateOfBirth: string | null
  createdAt: string
  yearsExperience: number | null
  cnaLicense: string | null
  previousEmployer: string | null
  reasonForLeaving: string | null
  certifications: unknown
  references: unknown
  hasDriversLicense: boolean | null
  hasTransportation: boolean | null
  legalToWork: boolean | null
  willingBackgroundCheck: boolean | null
  felonyConviction: boolean | null
  felonyExplanation: string | null
  availabilityDays: string | null
  availabilityShifts: string | null
  hoursDesired: string | null
  availableStartDate: string | null
  whyInterested: string | null
  notes: string | null
  interviewNotes: string | null
}

interface Props {
  applicationId: string
  onBack: () => void
}

export default function ApplicationDetail({ applicationId, onBack }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [app, setApp] = useState<Application | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [interviewNotes, setInterviewNotes] = useState('')
  const [hiring, setHiring] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadApplication()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId])

  const loadApplication = async () => {
    try {
      const data: Application = await api.get(`/api/applications/${applicationId}`)
      setApp(data)
      setStatus(data.status || '')
      setInterviewNotes('')
    } catch (error) {
      console.error('Failed to load application:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateStatus = async (newStatus: string) => {
    try {
      await api.put(`/api/applications/${applicationId}/status`, { status: newStatus, notes: interviewNotes })
      setStatus(newStatus)
      setMessage(`Status updated to ${newStatus}`)
      setTimeout(() => setMessage(''), 2000)
      loadApplication()
    } catch (error) {
      toast.error('Failed to update: ' + errorMessage(error))
    }
  }

  const handleSaveNotes = async () => {
    try {
      await api.post(`/api/applications/${applicationId}/notes`, { notes: interviewNotes })
      setMessage('Notes saved')
      setTimeout(() => setMessage(''), 2000)
      setInterviewNotes('')
      loadApplication()
    } catch (error) {
      toast.error('Failed to save notes: ' + errorMessage(error))
    }
  }

  const handleHireApplicant = async () => {
    if (!(await confirm('Convert this applicant to a caregiver account?', { danger: true }))) return

    setHiring(true)
    try {
      const data: { message?: string; credentialsEmailed?: boolean; tempPassword?: string } =
        await api.post(`/api/applications/${applicationId}/hire`, { hourlyRate: 15.0 })
      // The login is emailed to the new caregiver; the password comes back (and is shown) only when that email did not go.
      setMessage(`✓ ${data.message || 'Applicant hired and caregiver account created!'}${!data.credentialsEmailed && data.tempPassword ? ` Temporary password: ${data.tempPassword}` : ''}`)
      loadApplication()
    } catch (error) {
      toast.error('Failed to hire: ' + errorMessage(error))
    } finally {
      setHiring(false)
    }
  }

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>
  }

  if (!app) {
    return <div className="hc-card hc-card-centered"><p>Application not found</p></div>
  }

  // Parse certifications from comma-separated string
  const certifications: string[] = Array.isArray(app.certifications)
    ? app.certifications.map(String)
    : (app.certifications ? String(app.certifications).split(',').map((c) => c.trim()).filter(Boolean) : [])
  // References: the template keeps them as a list ([{ name, relationship, phone, email }]).
  const references: Reference[] = Array.isArray(app.references)
    ? (app.references as Reference[]).filter((r) => r && (r.name || r.phone || r.email))
    : []

  // Parse availability days
  const availabilityDays = app.availabilityDays ? app.availabilityDays.split(',').map((d) => d.trim()).filter(Boolean) : []

  // Parse shifts
  const shifts = app.availabilityShifts ? app.availabilityShifts.split(',').map((s) => s.trim()).filter(Boolean) : []

  return (
    <div>
      <div className="page-header">
        <button className="hc-btn hc-btn-secondary" onClick={onBack}>← Back</button>
        <h2>{app.firstName} {app.lastName}</h2>
        <span className={`hc-badge ${
          app.status === 'hired' ? 'hc-badge-success'
            : app.status === 'rejected' ? 'hc-badge-danger'
              : 'hc-badge-warning'
        }`}>{app.status?.toUpperCase()}</span>
      </div>

      {message && <div className="alert alert-success">{message}</div>}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Contact Info */}
        <div className="hc-card">
          <h3>Contact Information</h3>
          <p><strong>Email:</strong> <a href={`mailto:${app.email}`}>{app.email}</a></p>
          <p><strong>Phone:</strong> <a href={`tel:${app.phone}`}>{app.phone}</a></p>
          {app.dateOfBirth && <p><strong>DOB:</strong> {formatDate(app.dateOfBirth)}</p>}
          {app.address && <p><strong>Address:</strong> {app.address}, {app.city}, {app.state} {app.zip}</p>}
          <p><strong>Applied:</strong> {formatDate(app.createdAt)}</p>
        </div>

        {/* Experience */}
        <div className="hc-card">
          <h3>Experience</h3>
          {Number(app.yearsExperience) > 0 && <p><strong>Years:</strong> {app.yearsExperience} years</p>}
          {app.cnaLicense && <p><strong>CNA License:</strong> {app.cnaLicense}</p>}
          {app.previousEmployer && (
            <div className="experience-item">
              <p><strong>Previous Employer:</strong> {app.previousEmployer}</p>
              {app.reasonForLeaving && <p><strong>Reason for Leaving:</strong> {app.reasonForLeaving}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Certifications */}
      {certifications.length > 0 && (
        <div className="hc-card">
          <h3>Certifications</h3>
          <div className="cert-badges">
            {certifications.map((cert) => (
              <span key={cert} className="hc-badge hc-badge-success" style={{ marginRight: '0.5rem' }}>{cert}</span>
            ))}
          </div>
        </div>
      )}

      {/* Eligibility */}
      <div className="hc-card">
        <h3>Eligibility</h3>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <p><strong>Driver's License:</strong> {app.hasDriversLicense ? '✓ Yes' : '✗ No'}</p>
          <p><strong>Transportation:</strong> {app.hasTransportation ? '✓ Yes' : '✗ No'}</p>
          <p><strong>Legal to Work:</strong> {app.legalToWork ? '✓ Yes' : '✗ No'}</p>
          <p><strong>Background Check:</strong> {app.willingBackgroundCheck ? '✓ Yes' : '✗ No'}</p>
          <p><strong>Felony:</strong> {app.felonyConviction ? 'Yes' : 'No'}</p>
        </div>
        {app.felonyConviction && app.felonyExplanation && (
          <p style={{ marginTop: '1rem' }}><strong>Felony Explanation:</strong> {app.felonyExplanation}</p>
        )}
      </div>

      {/* References */}
      <div className="hc-card">
        <h3>Professional References</h3>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {references.map((r, i) => (
            <div className="reference-item" key={i}>
              <p><strong>{r.name}</strong>{r.relationship ? ` (${r.relationship})` : ''}</p>
              {r.phone && <p>Phone: <a href={`tel:${r.phone}`}>{r.phone}</a></p>}
              {r.email && <p>Email: <a href={`mailto:${r.email}`}>{r.email}</a></p>}
            </div>
          ))}
        </div>
        {references.length === 0 && <p style={{ color: 'var(--hc-muted)' }}>No references provided</p>}
      </div>

      {/* Availability & Expectations */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="hc-card">
          <h3>Availability</h3>
          {availabilityDays.length > 0 && <p><strong>Days:</strong> {availabilityDays.join(', ')}</p>}
          {shifts.length > 0 && <p><strong>Shifts:</strong> {shifts.join(', ')}</p>}
          {app.hoursDesired && <p><strong>Hours Desired:</strong> {app.hoursDesired}</p>}
          {app.availableStartDate && <p><strong>Can Start:</strong> {formatDate(app.availableStartDate)}</p>}
        </div>

        <div className="hc-card">
          <h3>Additional Information</h3>
          {app.whyInterested && (
            <div>
              <p><strong>Why Interested:</strong></p>
              <p style={{ color: 'var(--hc-muted)' }}>{app.whyInterested}</p>
            </div>
          )}
          {app.notes && (
            <div style={{ marginTop: '1rem' }}>
              <p><strong>Additional Notes:</strong></p>
              <p style={{ color: 'var(--hc-muted)' }}>{app.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Interview Notes */}
      <div className="hc-card">
        <h3>Interview Notes</h3>
        {/* Saved notes are kept, each dated; a save ADDS the note below to them. */}
        {app.interviewNotes && (
          <div style={{ whiteSpace: 'pre-wrap', background: 'var(--hc-subtle)', border: '1px solid var(--hc-line)', borderRadius: 8, padding: '0.75rem', marginBottom: '0.75rem', color: 'var(--hc-ink)' }}>
            {String(app.interviewNotes).trim()}
          </div>
        )}
        <textarea
          value={interviewNotes}
          onChange={(e) => setInterviewNotes(e.target.value)}
          placeholder="Add interview observations, concerns, or recommendations..."
          rows={5}
          style={{ width: '100%', marginBottom: '1rem', background: 'var(--hc-surface)', color: 'var(--hc-ink)', border: '1px solid var(--hc-line)', borderRadius: 6, padding: '0.5rem' }}
        ></textarea>
        <button className="hc-btn hc-btn-secondary" onClick={handleSaveNotes} disabled={!interviewNotes.trim()}>Add Note</button>
      </div>

      {/* Status & Actions */}
      <div className="hc-card">
        <h3>Application Status</h3>
        <div className="status-buttons" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['new', 'reviewing', 'interviewed', 'offered', 'rejected'].map((s) => (
            <button key={s} className={`hc-btn ${status === s ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => handleUpdateStatus(s)} disabled={s === status}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {status === 'offered' && (
          <div style={{ marginTop: '1rem' }}>
            <button className="hc-btn hc-btn-success" onClick={handleHireApplicant} disabled={hiring} style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}>
              {hiring ? 'Creating account...' : '✓ Hire & Create Account'}
            </button>
            <p style={{ color: 'var(--hc-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              This will create a caregiver user account and copy application data to their profile.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
