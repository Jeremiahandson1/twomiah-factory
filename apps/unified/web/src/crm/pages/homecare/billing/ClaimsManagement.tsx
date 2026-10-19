// Claims: claims made from invoices, their status, the A/R aging, and the 837P export. Moved from
// templates/crm-homecare/frontend/src/components/admin/ClaimsManagement.tsx.
//
// Server: /api/claims (server/crm/homecare/billing/claims.ts; rows from server/data/homecareBillingRoutes.ts claimRows,
// camelCase with CVHC's aliases: claimNumber, clientFirstName, clientLastName, payerName, serviceDateFrom, chargeAmount),
// /api/claims/reports/summary (aging: under30 / days30To60 / days60To90 / over90), POST /api/claims (a draft from an
// invoice), PUT /api/claims/:id/status, POST /api/claims/export/837p (an EDI file). The payer filter reads
// /api/referral-sources and the invoice picker /api/billing/invoices (lists).
import { useEffect, useState, type FormEvent } from 'react'
import { useToast } from '../../../../shared'
import { api, rows, errorMessage, saveBlob } from '../lib/http'
import { formatDate, toLocalYMD } from '../lib/date'

interface Claim {
  id: string; claimNumber: string | null; clientFirstName: string | null; clientLastName: string | null
  payerName: string | null; serviceDateFrom: string | null; chargeAmount: string | number | null; status: string
}
interface Payer { id: string; name: string }
interface InvoiceOption { id: string; seqNumber: number | null; invoiceNumber: string; firstName: string | null; lastName: string | null; total: string | number | null }
interface ClaimsSummary { aging?: { under30?: string | number; days30To60?: string | number; days60To90?: string | number; over90?: string | number } }
interface NewClaim { invoiceId: string; procedureCode: string; diagnosisCode: string; modifier: string; placeOfService: string }
interface StatusExtras { paidAmount?: number; denialReason?: string; notes?: string }

// Status grounds dark enough for white text (≥ 4.5:1) in either theme.
const STATUS_COLOURS: Record<string, string> = {
  draft: '#616161', ready: '#1565c0', submitted: '#b45309', accepted: '#33691e', paid: '#2e7d32', rejected: '#c62828', denied: '#c62828',
}
const money = (v: string | number | null | undefined) => (parseFloat(String(v ?? '')) || 0)

const ClaimsManagement = () => {
  const toast = useToast()
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ status: '', payerId: '' })
  const [payers, setPayers] = useState<Payer[]>([])
  const [selectedClaims, setSelectedClaims] = useState<string[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [currentClaim, setCurrentClaim] = useState<Claim | null>(null)
  const [invoices, setInvoices] = useState<InvoiceOption[]>([])
  const [summary, setSummary] = useState<ClaimsSummary | null>(null)

  useEffect(() => {
    loadClaims()
    loadPayers()
    loadSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const loadClaims = async () => {
    try {
      setClaims(rows<Claim>(await api.get('/api/claims', { status: filter.status || undefined, payerId: filter.payerId || undefined })))
    } catch (error) {
      console.error('Failed to load claims:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadPayers = async () => {
    try {
      setPayers(rows<Payer>(await api.get('/api/referral-sources')))
    } catch (error) {
      console.error('Failed to load payers:', error)
    }
  }

  const loadSummary = async () => {
    try {
      setSummary(await api.get('/api/claims/reports/summary'))
    } catch (error) {
      console.error('Failed to load summary:', error)
    }
  }

  const loadInvoices = async () => {
    try {
      setInvoices(rows<InvoiceOption>(await api.get('/api/billing/invoices')))
    } catch (error) {
      console.error('Failed to load invoices:', error)
    }
  }

  const createClaim = async (formData: NewClaim) => {
    try {
      await api.post('/api/claims', formData)
      setShowCreateModal(false)
      loadClaims()
      loadSummary()
    } catch (error) {
      toast.error('Failed to create claim: ' + errorMessage(error))
    }
  }

  const updateClaimStatus = async (status: string, additionalData: StatusExtras = {}) => {
    if (!currentClaim) return
    try {
      await api.put(`/api/claims/${currentClaim.id}/status`, { status, ...additionalData })
      setShowStatusModal(false)
      setCurrentClaim(null)
      loadClaims()
      loadSummary()
    } catch (error) {
      toast.error('Failed to update status: ' + errorMessage(error))
    }
  }

  const export837P = async () => {
    if (selectedClaims.length === 0) {
      toast.info('Select at least one claim to export')
      return
    }
    try {
      const res = await api.raw('/api/claims/export/837p', { method: 'POST', body: JSON.stringify({ claimIds: selectedClaims }) })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error((b as { error?: string }).error || 'Export failed')
      }
      saveBlob(await res.blob(), `claims-837p-${toLocalYMD(new Date())}.edi`)
      loadClaims()
      setSelectedClaims([])
    } catch (error) {
      toast.error('Failed to export: ' + errorMessage(error))
    }
  }

  const toggleClaimSelection = (claimId: string) => {
    setSelectedClaims((prev) => (prev.includes(claimId) ? prev.filter((id) => id !== claimId) : [...prev, claimId]))
  }

  const selectAllDraft = () => {
    setSelectedClaims(claims.filter((c) => c.status === 'draft' || c.status === 'ready').map((c) => c.id))
  }

  const getStatusBadge = (status: string) => (
    <span style={{
      padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold', color: 'white',
      backgroundColor: STATUS_COLOURS[status] || '#616161',
    }}>
      {status?.toUpperCase()}
    </span>
  )

  return (
    <div>
      <div className="page-header">
        <h2>💼 Claims Management</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="hc-btn hc-btn-primary" onClick={() => { loadInvoices(); setShowCreateModal(true) }}>
            + New Claim
          </button>
          <button className="hc-btn hc-btn-secondary" onClick={export837P} disabled={selectedClaims.length === 0}>
            📤 Export 837P ({selectedClaims.length})
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '1rem' }}>
          <div className="hc-stat-card">
            <h4>Pending</h4>
            <div className="value">${money(summary.aging?.under30).toLocaleString()}</div>
            <small>&lt; 30 days</small>
          </div>
          <div className="hc-stat-card">
            <h4>30-60 Days</h4>
            <div className="value" style={{ color: 'var(--hc-warning-ink)' }}>${money(summary.aging?.days30To60).toLocaleString()}</div>
          </div>
          <div className="hc-stat-card">
            <h4>60-90 Days</h4>
            <div className="value" style={{ color: 'var(--hc-red-ink)' }}>${money(summary.aging?.days60To90).toLocaleString()}</div>
          </div>
          <div className="hc-stat-card">
            <h4>90+ Days</h4>
            <div className="value" style={{ color: 'var(--hc-danger-ink)' }}>${money(summary.aging?.over90).toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="hc-card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="ready">Ready</option>
              <option value="submitted">Submitted</option>
              <option value="accepted">Accepted</option>
              <option value="paid">Paid</option>
              <option value="denied">Denied</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Payer</label>
            <select value={filter.payerId} onChange={(e) => setFilter({ ...filter, payerId: e.target.value })}>
              <option value="">All Payers</option>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <button className="hc-btn hc-btn-secondary" onClick={selectAllDraft} style={{ marginTop: '1.5rem' }}>
            Select All Draft/Ready
          </button>
        </div>
      </div>

      {/* Claims Table */}
      <div className="hc-card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : claims.length === 0 ? (
          <p>No claims found. Create a claim from an invoice to get started.</p>
        ) : (
          <table className="hc-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>
                  <input
                    type="checkbox"
                    aria-label="Select all draft and ready claims"
                    onChange={(e) => (e.target.checked ? selectAllDraft() : setSelectedClaims([]))}
                    checked={selectedClaims.length > 0}
                  />
                </th>
                <th>Claim #</th>
                <th>Client</th>
                <th>Payer</th>
                <th>Service Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr key={claim.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedClaims.includes(claim.id)}
                      onChange={() => toggleClaimSelection(claim.id)}
                      disabled={claim.status === 'paid' || claim.status === 'denied'}
                    />
                  </td>
                  <td><strong>{claim.claimNumber}</strong></td>
                  <td>{claim.clientFirstName} {claim.clientLastName}</td>
                  <td>{claim.payerName}</td>
                  <td>{claim.serviceDateFrom ? formatDate(claim.serviceDateFrom) : '-'}</td>
                  <td><strong>${money(claim.chargeAmount).toFixed(2)}</strong></td>
                  <td>{getStatusBadge(claim.status)}</td>
                  <td>
                    <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => { setCurrentClaim(claim); setShowStatusModal(true) }}>
                      Update
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Claim Modal */}
      {showCreateModal && (
        <div className="modal active" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Claim from Invoice</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <CreateClaimForm invoices={invoices} onSubmit={createClaim} onCancel={() => setShowCreateModal(false)} />
          </div>
        </div>
      )}

      {/* Update Status Modal */}
      {showStatusModal && currentClaim && (
        <div className="modal active" onClick={() => setShowStatusModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Update Claim Status</h3>
              <button className="modal-close" onClick={() => setShowStatusModal(false)}>×</button>
            </div>
            <UpdateStatusForm claim={currentClaim} onSubmit={updateClaimStatus} onCancel={() => setShowStatusModal(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

// Create Claim Form Component
const CreateClaimForm = ({ invoices, onSubmit, onCancel }: { invoices: InvoiceOption[]; onSubmit: (d: NewClaim) => void; onCancel: () => void }) => {
  const toast = useToast()
  const [formData, setFormData] = useState<NewClaim>({
    invoiceId: '', procedureCode: 'T1019', diagnosisCode: 'Z7689', modifier: '', placeOfService: '12',
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!formData.invoiceId) {
      toast.info('Please select an invoice')
      return
    }
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Invoice *</label>
        <select value={formData.invoiceId} onChange={(e) => setFormData({ ...formData, invoiceId: e.target.value })} required>
          <option value="">Select Invoice</option>
          {invoices.map((inv) => (
            <option key={inv.id} value={inv.id}>
              {inv.seqNumber != null ? `#${inv.seqNumber}` : inv.invoiceNumber} - {inv.firstName} {inv.lastName} - ${money(inv.total).toFixed(2)}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Procedure Code (CPT/HCPCS)</label>
        <input type="text" value={formData.procedureCode} onChange={(e) => setFormData({ ...formData, procedureCode: e.target.value })} placeholder="e.g., T1019, S5125" />
      </div>
      <div className="form-group">
        <label>Diagnosis Code (ICD-10)</label>
        <input type="text" value={formData.diagnosisCode} onChange={(e) => setFormData({ ...formData, diagnosisCode: e.target.value })} placeholder="e.g., Z7689" />
      </div>
      <div className="form-group">
        <label>Modifier</label>
        <input type="text" value={formData.modifier} onChange={(e) => setFormData({ ...formData, modifier: e.target.value })} placeholder="e.g., GT, 95" />
      </div>
      <div className="form-group">
        <label>Place of Service</label>
        <select value={formData.placeOfService} onChange={(e) => setFormData({ ...formData, placeOfService: e.target.value })}>
          <option value="12">12 - Home</option>
          <option value="11">11 - Office</option>
          <option value="99">99 - Other</option>
        </select>
      </div>
      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Create Claim</button>
      </div>
    </form>
  )
}

// Update Status Form Component
const UpdateStatusForm = ({ claim, onSubmit, onCancel }: { claim: Claim; onSubmit: (status: string, extra: StatusExtras) => void; onCancel: () => void }) => {
  const [status, setStatus] = useState(claim.status)
  const [paidAmount, setPaidAmount] = useState('')
  const [denialReason, setDenialReason] = useState('')
  const [notes, setNotes] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const additionalData: StatusExtras = {}
    if (status === 'paid') additionalData.paidAmount = parseFloat(paidAmount)
    if (status === 'denied') additionalData.denialReason = denialReason
    additionalData.notes = notes
    onSubmit(status, additionalData)
  }

  return (
    <form onSubmit={handleSubmit}>
      <p><strong>Claim:</strong> {claim.claimNumber}</p>
      <p><strong>Amount:</strong> ${money(claim.chargeAmount).toFixed(2)}</p>

      <div className="form-group">
        <label>New Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="draft">Draft</option>
          <option value="ready">Ready to Submit</option>
          <option value="submitted">Submitted</option>
          <option value="accepted">Accepted</option>
          <option value="paid">Paid</option>
          <option value="denied">Denied</option>
        </select>
      </div>

      {status === 'paid' && (
        <div className="form-group">
          <label>Paid Amount</label>
          <input type="number" step="0.01" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} placeholder="Enter amount received" />
        </div>
      )}

      {status === 'denied' && (
        <div className="form-group">
          <label>Denial Reason</label>
          <textarea value={denialReason} onChange={(e) => setDenialReason(e.target.value)} placeholder="Enter denial reason/code" />
        </div>
      )}

      <div className="form-group">
        <label>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Update Status</button>
      </div>
    </form>
  )
}

export default ClaimsManagement
