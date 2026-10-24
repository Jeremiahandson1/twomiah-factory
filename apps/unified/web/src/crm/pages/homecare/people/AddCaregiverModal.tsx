// Moved from templates/crm-homecare/frontend/src/components/admin/AddCaregiverModal.tsx.
// POST /api/caregivers (care-hr:create) reads firstName, lastName, email, phone, defaultPayRate and password; a plan's
// seat limit is refused with its sentence (403 seat_limit), shown here as the form's error.
import { useEffect, useState, type FormEvent } from 'react'
import { useToast } from '../../../../shared'
import { api, errorMessage } from '../lib/http'
import { PasswordInput } from '../../../../shared'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

// The pay rate starts empty, its example in the placeholder. It was pre-filled "15.00", so typing a rate added to it —
// "15.0018" (live test 2026-10-22) — and a blank one was sent as 15 without anyone choosing it.
const EMPTY = { email: '', password: '', firstName: '', lastName: '', phone: '', payRate: '' }

export default function AddCaregiverModal({ isOpen, onClose, onSuccess }: Props) {
  const toast = useToast()
  const [formData, setFormData] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // A refusal clears once the form is changed — never left over a pay rate now typed.
  useEffect(() => { setError('') }, [formData])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const rate = Number(formData.payRate)
    if (formData.payRate.trim() === '' || !Number.isFinite(rate) || rate < 0) { setError('Enter the default hourly pay rate — a number of zero or more.'); return }
    setError('')
    setLoading(true)
    try {
      await api.post('/api/caregivers', {
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone,
        defaultPayRate: String(rate),
      })
      // The template's alert(); the app's toast.
      toast.success('Caregiver added successfully!')
      setFormData(EMPTY)
      onSuccess()
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Failed to add caregiver'))
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal active">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Add New Caregiver</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>First Name *</label>
            <input type="text" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} required />
          </div>

          <div className="form-group">
            <label>Last Name *</label>
            <input type="text" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} required />
          </div>

          <div className="form-group">
            <label>Email *</label>
            <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
          </div>

          <div className="form-group">
            <label>Password *</label>
            <PasswordInput value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required />
          </div>

          <div className="form-group">
            <label>Phone</label>
            <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
          </div>

          <div className="form-group">
            <label htmlFor="add-caregiver-pay">Default Hourly Pay Rate *</label>
            <input
              id="add-caregiver-pay"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={formData.payRate}
              onChange={(e) => setFormData({ ...formData, payRate: e.target.value })}
              placeholder="e.g. 15.00"
              required
            />
            <small className="text-muted">Can set different rates per care type after adding</small>
          </div>

          <div className="modal-actions">
            <button type="submit" className="hc-btn hc-btn-primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Caregiver'}
            </button>
            <button type="button" className="hc-btn hc-btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
