// Moved from templates/crm-homecare/frontend/src/components/admin/ReferralSources.tsx — who refers clients (a hospital,
// a doctor, an agency): add, edit, delete. (server/crm/homecare/clients/referralSources.ts: the referral fields only.)
import { useState, useEffect, type FormEvent } from 'react'
import { useAuth, useConfirm, useToast } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'
import type { ReferralSource } from './shared'

interface SourceForm {
  name: string
  type: string
  contactName: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  zip: string
}

const ReferralSources = () => {
  const { company } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [sources, setSources] = useState<ReferralSource[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)

  // The agency's own state, as the template's generated '{{STATE}}' was.
  const emptyForm = (): SourceForm => ({
    name: '',
    type: 'doctor',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: company?.state || '',
    zip: '',
  })
  const [formData, setFormData] = useState<SourceForm>(emptyForm)

  useEffect(() => {
    loadSources()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadSources = async () => {
    try {
      setSources(rows<ReferralSource>(await api.get('/api/referral-sources')))
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load referral sources'))
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (source: ReferralSource) => {
    setEditingId(source.id)
    setFormData({
      name: source.name || '',
      type: source.type || 'doctor',
      contactName: source.contactName || '',
      email: source.email || '',
      phone: source.phone || '',
      address: source.address || '',
      city: source.city || '',
      state: source.state || company?.state || '',
      zip: source.zip || '',
    })
    setShowForm(true)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData(emptyForm())
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      if (editingId) await api.put(`/api/referral-sources/${editingId}`, formData)
      else await api.post('/api/referral-sources', formData)

      setFormData(emptyForm())
      setShowForm(false)
      setEditingId(null)
      loadSources()
    } catch (error) {
      toast.error(`Failed to ${editingId ? 'update' : 'create'} referral source: ` + errorMessage(error))
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`, { danger: true }))) {
      return
    }

    try {
      await api.delete(`/api/referral-sources/${id}`)
      loadSources()
    } catch (error) {
      toast.error('Failed to delete referral source: ' + errorMessage(error))
    }
  }

  const set = <K extends keyof SourceForm>(key: K, value: string) => setFormData({ ...formData, [key]: value })

  return (
    <div>
      <div className="page-header">
        <h2>🏥 Referral Sources</h2>
        <button
          className="hc-btn hc-btn-primary"
          onClick={() => {
            if (showForm) handleCancel()
            else setShowForm(true)
          }}
        >
          {showForm ? '✕ Cancel' : '➕ Add Referral Source'}
        </button>
      </div>

      {showForm && (
        <div className="hc-card hc-card-form">
          <h3>{editingId ? 'Edit Referral Source' : 'Add New Referral Source'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Organization Name *</label>
                <input type="text" value={formData.name} onChange={(e) => set('name', e.target.value)} required placeholder="Hospital, Doctor's Office, etc." />
              </div>

              <div className="form-group">
                <label>Type *</label>
                <select value={formData.type} onChange={(e) => set('type', e.target.value)}>
                  <option value="hospital">Hospital</option>
                  <option value="doctor">Doctor</option>
                  <option value="agency">Agency</option>
                  <option value="social_services">Social Services</option>
                  <option value="family">Family</option>
                </select>
              </div>

              <div className="form-group">
                <label>Contact Name</label>
                <input type="text" value={formData.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="John Doe" />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input type="email" value={formData.email} onChange={(e) => set('email', e.target.value)} />
              </div>

              <div className="form-group">
                <label>Phone</label>
                <input type="tel" value={formData.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>

              <div className="form-group">
                <label>Address</label>
                <input type="text" value={formData.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Main St" />
              </div>

              <div className="form-group">
                <label>City</label>
                <input type="text" value={formData.city} onChange={(e) => set('city', e.target.value)} />
              </div>

              <div className="form-group">
                <label>State</label>
                <input type="text" value={formData.state} onChange={(e) => set('state', e.target.value)} maxLength={2} />
              </div>

              <div className="form-group">
                <label>ZIP</label>
                <input type="text" value={formData.zip} onChange={(e) => set('zip', e.target.value)} maxLength={10} />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="hc-btn hc-btn-primary">
                {editingId ? 'Update Referral Source' : 'Save Referral Source'}
              </button>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : sources.length === 0 ? (
        <div className="hc-card hc-card-centered">
          <p>No referral sources yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid">
          {sources.map((source) => (
            <div key={source.id} className="hc-card">
              <div className="source-card-header">
                <h4>{source.name}</h4>
                <span className="hc-badge hc-badge-info">{source.type}</span>
              </div>

              {source.contactName && <p><strong>Contact:</strong> {source.contactName}</p>}
              {source.phone && <p><strong>Phone:</strong> <a href={`tel:${source.phone}`}>{source.phone}</a></p>}
              {source.email && <p><strong>Email:</strong> <a href={`mailto:${source.email}`}>{source.email}</a></p>}
              {(source.address || source.city) && (
                <p><strong>Location:</strong> {source.address && `${source.address}, `}{source.city}, {source.state} {source.zip}</p>
              )}

              <div className="source-card-footer" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--hc-line)' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="hc-btn hc-btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }} onClick={() => handleEdit(source)}>
                    ✏️ Edit
                  </button>
                  <button className="hc-btn hc-btn-danger" style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }} onClick={() => handleDelete(source.id, source.name)}>
                    🗑️ Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ReferralSources
