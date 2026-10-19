// Moved from templates/crm-homecare/frontend/src/components/admin/CaregiverManagement.tsx (/crm/caregivers).
//
// Replies read (server/crm/homecare):
//   GET  /api/caregivers?isActive=all            hr/caregivers.ts — every page (lib/http.ts listAll: the list stopped at 50)
//   GET  /api/care-types                         clients/careTypes.ts — { data }
//   GET  /api/caregiver-care-type-rates?caregiverId=   payroll/caregiverCareTypeRates.ts — { data }: careTypeName, hourlyRate
//   POST /api/caregiver-care-type-rates          care-payroll:update
//   PUT  /api/caregivers/:id                     care-hr:update (payRate becomes defaultPayRate)
//   POST /api/users/convert-to-admin             team:update
//   POST /api/sms/send-bulk                      portals/sms.ts — { recipientType, recipientIds, body } → { sent, skipped, failed }
//
// The template's sections became addresses: the profile is /crm/caregivers/:id and the history
// /crm/caregivers/:id/history (AdminDashboard's caregiver-profile / caregiver-history). "Full Profile" still opens the
// caregiver's record in place (CaregiverDetail), as it did.
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfirm, useToast } from '../../../../shared'
import { api, errorMessage, rows, listAll } from '../lib/http'
import { formatDate } from '../lib/date'
import AddCaregiverModal from './AddCaregiverModal'
import CaregiverDetail from './CaregiverDetail'
import { fullName, money, type CaregiverRow } from './shared'

interface CareType { id: string; name: string }
interface CareTypeRate {
  id: string
  careTypeId: string
  careTypeName: string | null
  hourlyRate: string | null
  /** Not in the reply (caregiver_care_type_rates has no effective date); the template read effective_date. */
  effectiveDate?: string | null
}

const inputStyle = {
  padding: '0.5rem 0.75rem', border: '1px solid var(--hc-line)', borderRadius: '8px', fontSize: '0.9rem',
  background: 'var(--hc-surface)', color: 'var(--hc-ink)',
} as const

// The "Full Profile" button: the template's slate-900 with white, which vanished into the dark page; ink on its ground.
const fullProfileBtn = {
  background: 'var(--hc-ink)', color: 'var(--hc-surface)', border: 'none', borderRadius: 6, padding: '0.25rem 0.6rem',
  cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem',
} as const

interface CardProps {
  caregiver: CaregiverRow
  onEdit: (c: CaregiverRow) => void
  onRates: (c: CaregiverRow) => void
  onProfile: (id: string) => void
  onPromote: (id: string) => void
}

// Mobile-friendly caregiver card
function CaregiverCard({ caregiver, onEdit, onRates, onProfile, onPromote }: CardProps) {
  return (
    <div className="hc-card" style={{ marginBottom: '0.75rem', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <div>
          <strong style={{ fontSize: '1.1rem' }}>{caregiver.firstName} {caregiver.lastName}</strong>
          <div style={{ fontSize: '0.85rem', color: 'var(--hc-muted)' }}>{caregiver.email}</div>
        </div>
        <span className={`hc-badge ${caregiver.role === 'admin' ? 'hc-badge-danger' : 'hc-badge-info'}`}>
          {(caregiver.role ?? '').toUpperCase()}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
        <div>
          <span style={{ color: 'var(--hc-muted)' }}>📞</span>{' '}
          {caregiver.phone ? (
            <a href={`tel:${caregiver.phone}`}>{caregiver.phone}</a>
          ) : (
            <span style={{ color: 'var(--hc-muted)' }}>N/A</span>
          )}
        </div>
        <div>
          <span style={{ color: 'var(--hc-muted)' }}>💰</span>{' '}
          <strong>{money(caregiver.defaultPayRate)}</strong>/hr
        </div>
        <div style={{ gridColumn: '1 / -1', fontSize: '0.82rem' }}>
          {caregiver.address ? (
            <span>📍 {[caregiver.address, caregiver.city, caregiver.state, caregiver.zip].filter(Boolean).join(', ')}
              {caregiver.latitude ? ' ✅' : ' ⚠️ Not geocoded'}
            </span>
          ) : (
            <span style={{ color: 'var(--hc-warning-ink)' }}>⚠️ No home address — needed for route optimization</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="hc-btn hc-btn-sm" style={fullProfileBtn} onClick={() => onProfile(caregiver.id)}>👁 Full Profile</button>
        <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => onEdit(caregiver)}>✏️ Edit</button>
        <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => onRates(caregiver)}>💰 Rates</button>
        <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => onProfile(caregiver.id)}>👤 Profile</button>
        {caregiver.role !== 'admin' && (
          <button className="hc-btn hc-btn-sm hc-btn-warning" onClick={() => onPromote(caregiver.id)}>⬆️ Admin</button>
        )}
      </div>
    </div>
  )
}

export default function CaregiverManagement() {
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [caregivers, setCaregivers] = useState<CaregiverRow[]>([])
  const [careTypes, setCareTypes] = useState<CareType[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showRatesModal, setShowRatesModal] = useState(false)
  const [selectedCaregiver, setSelectedCaregiver] = useState<CaregiverRow | null>(null)
  const [caregiverRates, setCaregiverRates] = useState<CareTypeRate[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkMessage, setBulkMessage] = useState('')
  const [showBulkMsg, setShowBulkMsg] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // all, active, inactive

  const [editData, setEditData] = useState({ firstName: '', lastName: '', phone: '', payRate: '', address: '', city: '', state: '', zip: '' })
  const [rateFormData, setRateFormData] = useState({ careTypeId: '', hourlyRate: '' })

  // Listen for window resize
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    try {
      const [cgData, ctData] = await Promise.all([
        // isActive=all so deactivated caregivers still load — otherwise the
        // Inactive filter finds nothing and a deactivated aide is unreachable.
        listAll('/api/caregivers', { isActive: 'all' }),
        api.get('/api/care-types'),
      ])
      setCaregivers(rows<CaregiverRow>(cgData))
      setCareTypes(rows<CareType>(ctData))
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePromoteToAdmin = async (userId: string) => {
    if (await confirm('Promote this caregiver to admin?', { danger: false })) {
      try {
        await api.post('/api/users/convert-to-admin', { userId })
        loadData()
        toast.success('Caregiver promoted to admin!')
      } catch (error) {
        toast.error('Failed to promote: ' + errorMessage(error))
      }
    }
  }

  const handleOpenEdit = (caregiver: CaregiverRow) => {
    setSelectedCaregiver(caregiver)
    setEditData({
      firstName: caregiver.firstName || '',
      lastName: caregiver.lastName || '',
      phone: caregiver.phone || '',
      payRate: caregiver.defaultPayRate || '',
      address: caregiver.address || '',
      city: caregiver.city || '',
      state: caregiver.state || '',
      zip: caregiver.zip || '',
    })
    setShowEditModal(true)
  }

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedCaregiver) return
    try {
      await api.put(`/api/caregivers/${selectedCaregiver.id}`, {
        firstName: editData.firstName,
        lastName: editData.lastName,
        phone: editData.phone,
        payRate: parseFloat(editData.payRate) || null,
        address: editData.address || null,
        city: editData.city || null,
        state: editData.state || null,
        zip: editData.zip || null,
      })
      setShowEditModal(false)
      setSelectedCaregiver(null)
      loadData()
      toast.success('Caregiver updated!')
    } catch (error) {
      toast.error('Failed to update: ' + errorMessage(error))
    }
  }

  const loadRates = async (caregiverId: string) =>
    setCaregiverRates(rows<CareTypeRate>(await api.get('/api/caregiver-care-type-rates', { caregiverId })))

  const handleOpenRates = async (caregiver: CaregiverRow) => {
    setSelectedCaregiver(caregiver)
    try {
      await loadRates(caregiver.id)
      setShowRatesModal(true)
    } catch (error) {
      toast.error('Failed to load rates: ' + errorMessage(error))
    }
  }

  const handleAddRate = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedCaregiver) return
    try {
      await api.post('/api/caregiver-care-type-rates', {
        caregiverId: selectedCaregiver.id,
        careTypeId: rateFormData.careTypeId,
        hourlyRate: parseFloat(rateFormData.hourlyRate),
      })
      setRateFormData({ careTypeId: '', hourlyRate: '' })
      await loadRates(selectedCaregiver.id)
    } catch (error) {
      toast.error('Failed to add rate: ' + errorMessage(error))
    }
  }

  // DELETE /api/caregiver-care-type-rates/:id (server/crm/homecare/payroll/caregiverCareTypeRates.ts). The template had no
  // such route and swallowed the 404, so Remove looked as if it worked; a refusal now shows.
  const handleDeleteRate = async (rateId: string) => {
    const ok = await confirm('Remove this rate?', { danger: true })
    if (!ok || !selectedCaregiver) return
    try {
      await api.delete(`/api/caregiver-care-type-rates/${rateId}`)
      await loadRates(selectedCaregiver.id)
    } catch (error) {
      toast.error('Failed to delete rate: ' + errorMessage(error))
    }
  }

  const getAvailableCareTypes = () => {
    const assignedIds = caregiverRates.map((r) => r.careTypeId)
    return careTypes.filter((ct) => !assignedIds.includes(ct.id))
  }

  const filteredCaregivers = caregivers.filter((cg) => {
    const q = searchQuery.toLowerCase()
    const matchesSearch = !q ||
      (cg.firstName + ' ' + cg.lastName).toLowerCase().includes(q) ||
      (cg.email || '').toLowerCase().includes(q) ||
      (cg.phone || '').includes(q) ||
      (cg.city || '').toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'active' && cg.isActive !== false) ||
      (statusFilter === 'inactive' && cg.isActive === false)
    return matchesSearch && matchesStatus
  })

  const exportCsv = () => {
    // Export selected as CSV
    const selected = caregivers.filter((c) => selectedIds.includes(c.id))
    const csv = ['Name,Email,Phone,Pay Rate,Status'].concat(
      selected.map((c) => `"${c.firstName} ${c.lastName}","${c.email}","${c.phone || ''}","${c.defaultPayRate || ''}","${c.isActive ? 'Active' : 'Inactive'}"`),
    ).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'caregivers.csv'; a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${selected.length} caregivers`)
  }

  // The template posted { phones, message } to /api/sms/bulk, which no server had: nothing was sent and it still said
  // "SMS sent". The texting screen's own bulk send is /api/sms/send-bulk, by caregiver id.
  const sendBulkSms = async () => {
    if (!bulkMessage.trim()) { toast.warning('Enter a message'); return }
    try {
      const r: { sent?: number; skipped?: number; failed?: number } = await api.post('/api/sms/send-bulk', {
        recipientType: 'caregiver', recipientIds: selectedIds, body: bulkMessage,
      })
      const sent = Number(r?.sent) || 0
      const extra = [r?.skipped ? `${r.skipped} skipped` : '', r?.failed ? `${r.failed} failed` : ''].filter(Boolean).join(', ')
      toast.success(`SMS sent to ${sent} caregiver${sent === 1 ? '' : 's'}${extra ? ` (${extra})` : ''}`)
      setShowBulkMsg(false); setBulkMessage(''); setSelectedIds([])
    } catch (error) {
      toast.error('SMS send failed: ' + errorMessage(error))
    }
  }

  const onViewProfile = (id: string) => navigate(`/crm/caregivers/${id}`)
  const onViewHistory = (id: string) => navigate(`/crm/caregivers/${id}/history`)

  // Show full detail view when a caregiver is clicked
  if (detailId) {
    return <CaregiverDetail caregiverId={detailId} onBack={() => { setDetailId(null); loadData() }} />
  }

  return (
    <div>
      <div className="page-header">
        <h2>👤 Caregivers</h2>
        <button className="hc-btn hc-btn-primary" onClick={() => setShowModal(true)}>
          ➕ Add
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="🔍 Search caregivers..." value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ ...inputStyle, flex: '1', minWidth: '180px' }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <span style={{ fontSize: '0.85rem', color: 'var(--hc-muted)' }}>{filteredCaregivers.length} of {caregivers.length}</span>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.875rem', background: 'var(--hc-info-bg)', border: '1px solid var(--hc-info-line)', borderRadius: '8px', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--hc-info-ink)' }}>
            ✅ {selectedIds.length} selected
          </span>
          <button onClick={exportCsv} style={{ padding: '0.35rem 0.75rem', background: 'var(--hc-surface)', color: 'var(--hc-ink)', border: '1px solid var(--hc-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
            📥 Export CSV
          </button>
          <button onClick={() => setShowBulkMsg(true)}
            style={{ padding: '0.35rem 0.75rem', background: 'var(--hc-brand-deep)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
            📱 Send SMS
          </button>
          <button onClick={() => setSelectedIds([])} style={{ padding: '0.35rem 0.75rem', background: 'none', border: '1px solid var(--hc-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--hc-muted)' }}>
            Clear
          </button>
        </div>
      )}

      {/* Bulk SMS Modal */}
      {showBulkMsg && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: '12px', padding: '1.5rem', maxWidth: '420px', width: '100%' }}>
            <h3 style={{ margin: '0 0 0.75rem 0' }}>📱 Send SMS to {selectedIds.length} Caregiver{selectedIds.length !== 1 ? 's' : ''}</h3>
            <textarea
              placeholder="Type your message here..."
              value={bulkMessage}
              onChange={(e) => setBulkMessage(e.target.value)}
              rows={4}
              style={{ ...inputStyle, width: '100%', padding: '0.75rem', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowBulkMsg(false)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--hc-line)', borderRadius: '8px', background: 'var(--hc-surface)', color: 'var(--hc-ink)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={sendBulkSms} style={{ padding: '0.5rem 1rem', background: 'var(--hc-brand-deep)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Send</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="spinner"></div>
      ) : caregivers.length === 0 ? (
        <div className="hc-card hc-card-centered">
          <p>No caregivers yet.</p>
        </div>
      ) : isMobile ? (
        <div>
          {filteredCaregivers.map((caregiver) => (
            <CaregiverCard
              key={caregiver.id}
              caregiver={caregiver}
              onEdit={handleOpenEdit}
              onRates={handleOpenRates}
              onProfile={onViewProfile}
              onPromote={handlePromoteToAdmin}
            />
          ))}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="hc-table">
            <thead>
              <tr>
                <th style={{ width: '36px' }}>
                  <input type="checkbox" checked={selectedIds.length === filteredCaregivers.length && filteredCaregivers.length > 0}
                    onChange={(e) => setSelectedIds(e.target.checked ? filteredCaregivers.map((c) => c.id) : [])} />
                </th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Address</th>
                <th>Default Rate</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCaregivers.map((caregiver) => (
                <tr key={caregiver.id} style={{ background: selectedIds.includes(caregiver.id) ? 'var(--hc-info-bg)' : undefined }}>
                  <td>
                    <input type="checkbox" checked={selectedIds.includes(caregiver.id)}
                      onChange={(e) => setSelectedIds((prev) => (e.target.checked ? [...prev, caregiver.id] : prev.filter((id) => id !== caregiver.id)))} />
                  </td>
                  <td><strong>{caregiver.firstName} {caregiver.lastName}</strong></td>
                  <td>{caregiver.email}</td>
                  <td><a href={`tel:${caregiver.phone}`}>{caregiver.phone || 'N/A'}</a></td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {caregiver.address ? (
                      <span>{[caregiver.city, caregiver.state].filter(Boolean).join(', ')} {caregiver.latitude ? '📍' : '⚠️'}</span>
                    ) : (
                      <span style={{ color: 'var(--hc-warning-ink)' }}>⚠️ Missing</span>
                    )}
                  </td>
                  <td><strong>{money(caregiver.defaultPayRate)}</strong>/hr</td>
                  <td>
                    <span className={`hc-badge ${caregiver.role === 'admin' ? 'hc-badge-danger' : 'hc-badge-info'}`}>
                      {(caregiver.role ?? '').toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button className="hc-btn hc-btn-sm" style={fullProfileBtn} onClick={() => setDetailId(caregiver.id)}>👁 Full Profile</button>
                      <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => handleOpenEdit(caregiver)}>Edit</button>
                      <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => handleOpenRates(caregiver)}>💰 Pay Rates</button>
                      <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => onViewHistory(caregiver.id)}>🕐 History</button>
                      {caregiver.role !== 'admin' && (
                        <button className="hc-btn hc-btn-sm hc-btn-warning" onClick={() => handlePromoteToAdmin(caregiver.id)}>Make Admin</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddCaregiverModal isOpen={showModal} onClose={() => setShowModal(false)} onSuccess={loadData} />

      {/* Edit Caregiver Modal */}
      {showEditModal && selectedCaregiver && (
        <div className="modal active" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: isMobile ? '95%' : '500px' }}>
            <div className="modal-header">
              <h2>Edit Caregiver</h2>
              <button className="close-btn" onClick={() => setShowEditModal(false)}>×</button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div className="form-group">
                <label>First Name</label>
                <input type="text" value={editData.firstName} onChange={(e) => setEditData({ ...editData, firstName: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Last Name</label>
                <input type="text" value={editData.lastName} onChange={(e) => setEditData({ ...editData, lastName: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Phone</label>
                <input type="tel" value={editData.phone} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Default Hourly Pay Rate</label>
                <input type="number" step="0.01" min="0" value={editData.payRate} onChange={(e) => setEditData({ ...editData, payRate: e.target.value })} placeholder="15.00" />
                <small className="text-muted">Used when no care-type-specific rate is set</small>
              </div>

              <div style={{ borderTop: '1px solid var(--hc-line)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <label style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem', display: 'block' }}>
                  📍 Home Address <small style={{ fontWeight: 400, color: 'var(--hc-muted)' }}>(needed for route optimization)</small>
                </label>
              </div>

              <div className="form-group">
                <label>Street Address</label>
                <input type="text" value={editData.address} onChange={(e) => setEditData({ ...editData, address: e.target.value })} placeholder="123 Main St" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label>City</label>
                  <input type="text" value={editData.city} onChange={(e) => setEditData({ ...editData, city: e.target.value })} placeholder="City" />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <input type="text" value={editData.state} onChange={(e) => setEditData({ ...editData, state: e.target.value })} placeholder="ST" maxLength={2} />
                </div>
                <div className="form-group">
                  <label>Zip</label>
                  <input type="text" value={editData.zip} onChange={(e) => setEditData({ ...editData, zip: e.target.value })} placeholder="00000" maxLength={10} />
                </div>
              </div>

              <div className="modal-actions">
                <button type="submit" className="hc-btn hc-btn-primary">Save Changes</button>
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Rates by Care Type Modal */}
      {showRatesModal && selectedCaregiver && (
        <div className="modal active" onClick={() => setShowRatesModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: isMobile ? '95%' : '700px' }}>
            <div className="modal-header">
              <h2>💰 Pay Rates</h2>
              <button className="close-btn" onClick={() => setShowRatesModal(false)}>×</button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <strong>{fullName(selectedCaregiver)}</strong>
            </div>

            <div className="hc-card" style={{ background: 'var(--hc-subtle)', marginBottom: '1.5rem', padding: '1rem' }}>
              <p style={{ margin: 0 }}>
                <strong>Default Rate:</strong> {money(selectedCaregiver.defaultPayRate)}/hr
              </p>
              <small className="text-muted">Used when no care-type-specific rate is set</small>
            </div>

            <h4>Care Type Rates</h4>

            {getAvailableCareTypes().length > 0 && (
              <form onSubmit={handleAddRate} style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Care Type</label>
                    <select value={rateFormData.careTypeId} onChange={(e) => setRateFormData({ ...rateFormData, careTypeId: e.target.value })} required>
                      <option value="">Select care type...</option>
                      {getAvailableCareTypes().map((ct) => (
                        <option key={ct.id} value={ct.id}>{ct.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Hourly Rate</label>
                    <input type="number" step="0.01" min="0" value={rateFormData.hourlyRate} onChange={(e) => setRateFormData({ ...rateFormData, hourlyRate: e.target.value })} placeholder="15.00" required />
                  </div>

                  <button type="submit" className="hc-btn hc-btn-primary" style={{ height: 'fit-content' }}>Add</button>
                </div>
              </form>
            )}

            {caregiverRates.length === 0 ? (
              <div className="hc-card hc-card-centered">
                <p>No care-type-specific rates. Default rate will be used.</p>
              </div>
            ) : isMobile ? (
              <div>
                {caregiverRates.map((rate) => (
                  <div key={rate.id} className="hc-card" style={{ marginBottom: '0.5rem', padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{rate.careTypeName}</strong>
                      <div style={{ fontSize: '0.9rem' }}>{money(rate.hourlyRate)}/hr</div>
                    </div>
                    <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => handleDeleteRate(rate.id)}>✕</button>
                  </div>
                ))}
              </div>
            ) : (
              <table className="hc-table">
                <thead>
                  <tr>
                    <th>Care Type</th>
                    <th>Hourly Rate</th>
                    <th>Effective Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {caregiverRates.map((rate) => (
                    <tr key={rate.id}>
                      <td><strong>{rate.careTypeName}</strong></td>
                      <td><strong>{money(rate.hourlyRate)}</strong>/hr</td>
                      <td>{formatDate(rate.effectiveDate)}</td>
                      <td>
                        <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => handleDeleteRate(rate.id)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button className="hc-btn hc-btn-secondary" onClick={() => setShowRatesModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
