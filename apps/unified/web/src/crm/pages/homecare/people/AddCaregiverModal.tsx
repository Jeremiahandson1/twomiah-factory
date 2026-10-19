// Moved from templates/crm-homecare/frontend/src/components/admin/AddCaregiverModal.tsx.
// POST /api/caregivers (care-hr:create) reads firstName, lastName, email, phone, defaultPayRate and password; a plan's
// seat limit is refused with its sentence (403 seat_limit), shown here as the form's error.
import { useState, type FormEvent } from 'react'
import { useToast } from '../../../../shared'
import { api, errorMessage } from '../lib/http'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const EMPTY = { email: '', password: '', firstName: '', lastName: '', phone: '', payRate: '15.00' }

export default function AddCaregiverModal({ isOpen, onClose, onSuccess }: Props) {
  const toast = useToast()
  const [formData, setFormData] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/api/caregivers', {
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone,
        defaultPayRate: String(parseFloat(formData.payRate) || 15.0),
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
            <input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required />
          </div>

          <div className="form-group">
            <label>Phone</label>
            <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
          </div>

          <div className="form-group">
            <label>Default Hourly Pay Rate *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.payRate}
              onChange={(e) => setFormData({ ...formData, payRate: e.target.value })}
              placeholder="15.00"
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
