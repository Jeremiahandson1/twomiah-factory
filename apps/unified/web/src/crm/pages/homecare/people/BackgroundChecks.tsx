// Moved from templates/crm-homecare/frontend/src/components/admin/BackgroundChecks.tsx (/crm/background-checks).
//
// Replies read (server/crm/homecare/hr, care-hr):
//   GET    /api/onboarding-packets                     onboardingPackets.ts — { data }: status, firstName, lastName
//   GET    /api/background-checks                      backgroundChecks.ts — { data }: checkType, status, result,
//                                                      initiatedDate, completedDate, expirationDate, referenceNumber,
//                                                      findings, notes, caregiverFirst, caregiverLast, documentCount
//   GET    /api/caregivers                             caregivers.ts — every page (lib/http.ts listAll; the picker stopped at 50)
//   POST   /api/background-checks                      create;  PUT /api/background-checks/:id  update
//   GET    /api/background-checks/:id/documents        { data }: fileName, fileSize, createdAt, uploadedByFirst/Last
//   GET    /api/background-checks/:id/documents/:docId the file
//   POST   /api/background-checks/:id/documents        { fileName, dataUri }
//   DELETE /api/background-checks/:id/documents/:docId done
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth, useConfirm, useToast } from '../../../../shared'
import { api, downloadBlob, errorMessage, listAll, rows } from '../lib/http'
import { formatDate, parseLocalDate } from '../lib/date'
import type { CaregiverRow } from './shared'
import { useMay } from '../lib/useMay'

// Result letters: PDF or image, 7 MB max (the server refuses anything larger).
const DOCUMENT_MAX_BYTES = 7_000_000
const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/gif,image/webp'

interface Check {
  id: string
  caregiverId: string
  checkType: string
  provider: string | null
  status: string
  result: string | null
  initiatedDate: string | null
  completedDate: string | null
  expirationDate: string | null
  referenceNumber: string | null
  findings: string | null
  notes: string | null
  caregiverFirst: string | null
  caregiverLast: string | null
  documentCount: number | null
}

interface CheckDoc {
  id: string
  fileName: string
  fileSize: number | null
  createdAt: string
  uploadedByFirst: string | null
  uploadedByLast: string | null
}

interface PacketLite { status: string; firstName: string | null; lastName: string | null }
interface CheckType { id: string; name: string; icon: string }

// The template's badges were white text on mid colours (2.2–3.7:1); the frame's ink-on-ground pairs instead.
const STATUS_BADGE: Record<string, string> = {
  pending: 'hc-badge-warning', in_progress: 'hc-badge-info', completed: 'hc-badge-success', failed: 'hc-badge-danger', expired: 'hc-badge-secondary',
}
const RESULT_BADGE: Record<string, string> = { clear: 'hc-badge-success', flagged: 'hc-badge-warning', disqualifying: 'hc-badge-danger' }

const isExpiringSoon = (expirationDate: string | null) => {
  if (!expirationDate) return false
  const expDate = parseLocalDate(expirationDate)
  const thirtyDaysFromNow = new Date()
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
  return expDate <= thirtyDaysFromNow && expDate > new Date()
}

const isExpired = (expirationDate: string | null) => (expirationDate ? parseLocalDate(expirationDate) < new Date() : false)

export default function BackgroundChecks() {
  // Each control for whoever the server lets use it (care-hr create / update / delete) (lib/useMay.ts).
  const mayHr = useMay('care-hr')
  const { company } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const wisconsin = String(company?.state || '').trim().toUpperCase() === 'WI'
  const [checks, setChecks] = useState<Check[]>([])
  const [loading, setLoading] = useState(true)
  // The whole list is loaded once and filtered here, so the cards count every check whatever is filtered, and a card
  // filters by expiry, which is a date, not a status (the Expired card did nothing and Expiring Soon cleared the filter).
  const [filter, setFilter] = useState<{ status: string; type: string; expiry: '' | 'soon' | 'expired' }>({ status: '', type: '', expiry: '' })
  const [showAddModal, setShowAddModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [currentCheck, setCurrentCheck] = useState<Check | null>(null)
  const [caregivers, setCaregivers] = useState<CaregiverRow[]>([])
  const [docsCheck, setDocsCheck] = useState<Check | null>(null) // the check whose documents window is open
  const [docs, setDocs] = useState<CheckDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  // New hires whose onboarding packet (with the background-check consent) is not signed yet. A check
  // is created when the packet is signed — no consent, no check — so until then they are listed here,
  // not as a "pending" check that was never requested.
  const [awaitingConsent, setAwaitingConsent] = useState<PacketLite[]>([])
  useEffect(() => {
    api.get('/api/onboarding-packets')
      .then((list) => setAwaitingConsent(rows<PacketLite>(list).filter((p) => p.status === 'sent' || p.status === 'opened')))
      .catch(() => setAwaitingConsent([]))
  }, [])

  // The Wisconsin registries (WORCS, the state Caregiver Registry) are offered to a WI agency only.
  const checkTypes: CheckType[] = [
    { id: 'criminal', name: 'Criminal Background', icon: '🔍' },
    ...(wisconsin ? [{ id: 'worcs', name: 'WI DOJ WORCS', icon: '🏛️' }] : []),
    { id: 'sex_offender', name: 'Sex Offender Registry', icon: '⚠️' },
    ...(wisconsin ? [{ id: 'caregiver_registry', name: 'Caregiver Registry (WI)', icon: '📋' }] : []),
    { id: 'oci', name: 'OCI Misconduct', icon: '🏛️' },
    { id: 'driving', name: 'Driving Record', icon: '🚗' },
    { id: 'drug_screen', name: 'Drug Screen', icon: '🧪' },
    { id: 'reference', name: 'Reference Check', icon: '📞' },
    { id: 'employment_verification', name: 'Employment Verification', icon: '💼' },
    { id: 'education_verification', name: 'Education Verification', icon: '🎓' },
    { id: 'professional_license', name: 'Professional License', icon: '📜' },
  ]

  const docsUrl = (checkId: string, docId?: string) => `/api/background-checks/${checkId}/documents${docId ? `/${docId}` : ''}`

  const openDocs = async (check: Check) => {
    setDocsCheck(check); setDocs([]); setDocsLoading(true)
    try {
      setDocs(rows<CheckDoc>(await api.get(docsUrl(check.id))))
    } catch (e) { toast.error(errorMessage(e, 'Could not load documents')) }
    finally { setDocsLoading(false) }
  }

  const uploadDoc = async (file: File | undefined) => {
    if (!file || !docsCheck) return
    if (file.size > DOCUMENT_MAX_BYTES) { toast.error('File is too large (7 MB max)'); return }
    setUploading(true)
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file)
      })
      await api.post(docsUrl(docsCheck.id), { fileName: file.name, dataUri })
      toast.success('Uploaded')
      await openDocs(docsCheck)
      loadChecks()
    } catch (e) { toast.error('Upload failed: ' + errorMessage(e)) }
    finally { setUploading(false) }
  }

  const viewDoc = async (doc: CheckDoc) => {
    if (!docsCheck) return
    try {
      const url = URL.createObjectURL(await downloadBlob(docsUrl(docsCheck.id, doc.id)))
      const a = document.createElement('a')
      a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = doc.fileName
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) { toast.error(errorMessage(e, 'Could not open file')) }
  }

  const deleteDoc = async (doc: CheckDoc) => {
    if (!docsCheck) return
    if (!(await confirm(`Delete "${doc.fileName}"? This cannot be undone.`, { danger: true }))) return
    try {
      await api.delete(docsUrl(docsCheck.id, doc.id))
      toast.success('Deleted')
      await openDocs(docsCheck)
      loadChecks()
    } catch (e) { toast.error(errorMessage(e, 'Delete failed')) }
  }

  useEffect(() => {
    loadChecks()
    loadCaregivers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadChecks = async () => {
    try {
      setChecks(rows<Check>(await api.get('/api/background-checks')))
    } catch (error) {
      console.error('Failed to load checks:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCaregivers = async () => {
    try {
      setCaregivers(rows<CaregiverRow>(await listAll('/api/caregivers')))
    } catch (error) {
      console.error('Failed to load caregivers:', error)
    }
  }

  const createCheck = async (formData: AddForm) => {
    try {
      await api.post('/api/background-checks', formData)
      setShowAddModal(false)
      loadChecks()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const updateCheck = async (checkId: string, updateData: UpdateForm) => {
    try {
      await api.put(`/api/background-checks/${checkId}`, updateData)
      setShowDetailModal(false)
      setCurrentCheck(null)
      loadChecks()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const getTypeIcon = (typeId: string) => checkTypes.find((t) => t.id === typeId)?.icon || '📋'
  const getTypeName = (typeId: string) => checkTypes.find((t) => t.id === typeId)?.name || typeId

  const pendingCount = checks.filter((c) => c.status === 'pending').length
  const expiringSoonCount = checks.filter((c) => isExpiringSoon(c.expirationDate)).length
  const expiredCount = checks.filter((c) => isExpired(c.expirationDate)).length
  const shown = checks.filter((c) => (!filter.status || c.status === filter.status) && (!filter.type || c.checkType === filter.type)
    && (filter.expiry === 'soon' ? isExpiringSoon(c.expirationDate) : filter.expiry === 'expired' ? isExpired(c.expirationDate) : true))
  /** A card: picks its filter, or clears it when it is the one already picked. */
  const card = (active: boolean, pick: typeof filter) => ({
    role: 'button' as const, tabIndex: 0, 'aria-pressed': active,
    onClick: () => setFilter(active ? { status: '', type: '', expiry: '' } : pick),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilter(active ? { status: '', type: '', expiry: '' } : pick) } },
    style: { cursor: 'pointer', outline: active ? '2px solid var(--hc-blue-ink)' : undefined },
  })

  return (
    <div>
      <div className="page-header">
        <h2>🔒 Background Checks</h2>
        {mayHr.create && <button className="hc-btn hc-btn-primary" onClick={() => setShowAddModal(true)}>
          + New Background Check
        </button>}
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div className="hc-stat-card" {...card(filter.status === 'pending' && !filter.expiry, { status: 'pending', type: '', expiry: '' })}>
          <h4>Pending</h4>
          <div className="value" style={{ color: 'var(--hc-warning-ink)' }}>{pendingCount}</div>
        </div>
        <div className="hc-stat-card" {...card(filter.expiry === 'soon', { status: '', type: '', expiry: 'soon' })}>
          <h4>Expiring Soon</h4>
          <div className="value" style={{ color: 'var(--hc-warning-ink)' }}>{expiringSoonCount}</div>
          <small>Within 30 days</small>
        </div>
        <div className="hc-stat-card" {...card(filter.expiry === 'expired', { status: '', type: '', expiry: 'expired' })}>
          <h4>Expired</h4>
          <div className="value" style={{ color: 'var(--hc-red-ink)' }}>{expiredCount}</div>
        </div>
        <div className="hc-stat-card" {...card(false, { status: '', type: '', expiry: '' })}>
          <h4>Total</h4>
          <div className="value">{checks.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="hc-card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Check Type</label>
            <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
              <option value="">All Types</option>
              {checkTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Checks Table */}
      <div className="hc-card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : shown.length === 0 ? (
          <div>
            <p>No background checks found.</p>
            {awaitingConsent.length > 0 && (
              <p style={{ color: 'var(--hc-ink)' }}>
                {awaitingConsent.length} new hire{awaitingConsent.length === 1 ? ' has' : 's have'} not signed the onboarding packet yet
                ({awaitingConsent.map((p) => [p.firstName, p.lastName].filter(Boolean).join(' ')).join(', ')}).
                Their background check starts when they sign its consent{wisconsin ? ', and the Wisconsin eligibility card appears on their caregiver record once the WORCS result is in' : ''}.
                See Caregivers → Onboarding Queue.
              </p>
            )}
          </div>
        ) : (
          <table className="hc-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}></th>
                <th>Caregiver</th>
                <th>Check Type</th>
                <th>Status</th>
                <th>Result</th>
                <th>Initiated</th>
                <th>Completed</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((check) => {
                const expired = isExpired(check.expirationDate)
                const soon = isExpiringSoon(check.expirationDate)
                return (
                  <tr key={check.id} style={{ backgroundColor: expired ? 'var(--hc-danger-bg)' : soon ? 'var(--hc-warning-bg)' : 'transparent' }}>
                    <td style={{ fontSize: '1.3rem' }}>{getTypeIcon(check.checkType)}</td>
                    <td><strong>{check.caregiverFirst} {check.caregiverLast}</strong></td>
                    <td>{getTypeName(check.checkType)}</td>
                    <td><span className={`hc-badge ${STATUS_BADGE[check.status] || 'hc-badge-secondary'}`}>{check.status?.replace(/_/g, ' ').toUpperCase()}</span></td>
                    <td>{check.result ? <span className={`hc-badge ${RESULT_BADGE[check.result] || 'hc-badge-secondary'}`}>{check.result.toUpperCase()}</span> : null}</td>
                    <td style={{ fontSize: '0.85rem' }}>{check.initiatedDate ? formatDate(check.initiatedDate) : '-'}</td>
                    <td style={{ fontSize: '0.85rem' }}>{check.completedDate ? formatDate(check.completedDate) : '-'}</td>
                    <td>
                      {check.expirationDate ? (
                        <span style={{
                          color: expired ? 'var(--hc-danger-ink)' : soon ? 'var(--hc-warning-ink)' : 'var(--hc-ink)',
                          fontWeight: expired || soon ? 'bold' : 'normal',
                        }}>
                          {formatDate(check.expirationDate)}
                          {expired && ' ⚠️'}
                        </span>
                      ) : '-'}
                    </td>
                    <td>
                      {mayHr.update && <><button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => { setCurrentCheck(check); setShowDetailModal(true) }}>
                        Update
                      </button>{' '}</>}
                      <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => openDocs(check)}>
                        📎 Documents{check.documentCount ? ` (${check.documentCount})` : ''}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Documents Modal */}
      {docsCheck && (
        <div className="modal active" onClick={() => setDocsCheck(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📎 Documents — {docsCheck.caregiverFirst} {docsCheck.caregiverLast} · {getTypeName(docsCheck.checkType)}</h3>
              <button className="modal-close" onClick={() => setDocsCheck(null)}>×</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--hc-ink-soft)', marginTop: 0 }}>
              Upload the result letter for this check (PDF or image, 7 MB max). Record its completed date and reference number with <b>Update</b>.
            </p>
            {mayHr.create && <label className="hc-btn hc-btn-primary" style={{ display: 'inline-block', cursor: uploading ? 'wait' : 'pointer', marginBottom: '1rem' }}>
              {uploading ? 'Uploading…' : '⬆️ Upload file'}
              <input type="file" accept={DOCUMENT_ACCEPT} disabled={uploading} style={{ display: 'none' }}
                onChange={(e) => { uploadDoc(e.target.files?.[0]); e.target.value = '' }} />
            </label>}
            {docsLoading ? (
              <div className="loading"><div className="spinner"></div></div>
            ) : docs.length === 0 ? (
              <p style={{ color: 'var(--hc-muted)' }}>No documents uploaded for this check.</p>
            ) : (
              <table className="hc-table">
                <thead><tr><th>File</th><th>Uploaded</th><th></th></tr></thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td>{d.fileName}<div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)' }}>{Math.max(1, Math.round((d.fileSize || 0) / 1024))} KB</div></td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {formatDate(d.createdAt)}
                        {d.uploadedByFirst && <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)' }}>{d.uploadedByFirst} {d.uploadedByLast}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => viewDoc(d)}>View</button>{' '}
                        {mayHr.delete && <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => deleteDoc(d)}>Delete</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Add Check Modal — .modal.active > .modal-content: a bare .modal is display:none (CVHC a73aa9a) */}
      {showAddModal && (
        <div className="modal active" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Background Check</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <AddCheckForm caregivers={caregivers} checkTypes={checkTypes} onSubmit={createCheck} onCancel={() => setShowAddModal(false)} />
          </div>
        </div>
      )}

      {/* Update Check Modal */}
      {showDetailModal && currentCheck && (
        <div className="modal active" onClick={() => setShowDetailModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Update Background Check</h3>
              <button className="modal-close" onClick={() => setShowDetailModal(false)}>×</button>
            </div>
            <UpdateCheckForm check={currentCheck} onSubmit={(data) => updateCheck(currentCheck.id, data)} onCancel={() => setShowDetailModal(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

interface AddForm { caregiverId: string; checkType: string; provider: string; cost: string; notes: string }

// Add Check Form Component
function AddCheckForm({ caregivers, checkTypes, onSubmit, onCancel }: {
  caregivers: CaregiverRow[]; checkTypes: CheckType[]; onSubmit: (f: AddForm) => void; onCancel: () => void
}) {
  const toast = useToast()
  const [formData, setFormData] = useState<AddForm>({ caregiverId: '', checkType: '', provider: '', cost: '', notes: '' })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!formData.caregiverId || !formData.checkType) {
      // A warning: the template's toast() defaulted to its green "success" look for this refusal.
      toast.warning('Please select caregiver and check type')
      return
    }
    const cost = String(formData.cost).trim()
    if (cost !== '' && (!Number.isFinite(Number(cost)) || Number(cost) < 0)) {
      toast.error('Cost must be a number of zero or more')
      return
    }
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Caregiver *</label>
        <select value={formData.caregiverId} onChange={(e) => setFormData({ ...formData, caregiverId: e.target.value })} required>
          <option value="">Select Caregiver</option>
          {caregivers.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label>Check Type *</label>
        <select value={formData.checkType} onChange={(e) => setFormData({ ...formData, checkType: e.target.value })} required>
          <option value="">Select Type</option>
          {checkTypes.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Provider</label>
          <input type="text" value={formData.provider} onChange={(e) => setFormData({ ...formData, provider: e.target.value })} placeholder="e.g., Checkr, GoodHire" />
        </div>
        <div className="form-group">
          <label>Cost ($)</label>
          <input type="text" inputMode="decimal" value={formData.cost} onChange={(e) => setFormData({ ...formData, cost: e.target.value })} placeholder="0.00" />
        </div>
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Any notes..." />
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Create Check</button>
      </div>
    </form>
  )
}

interface UpdateForm { status: string; result: string; completedDate: string; expirationDate: string; referenceNumber: string; findings: string; notes: string }

// Update Check Form Component
function UpdateCheckForm({ check, onSubmit, onCancel }: { check: Check; onSubmit: (f: UpdateForm) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState<UpdateForm>({
    status: check.status || 'pending',
    result: check.result || '',
    completedDate: check.completedDate?.split('T')[0] || '',
    expirationDate: check.expirationDate?.split('T')[0] || '',
    referenceNumber: check.referenceNumber || '',
    findings: check.findings || '',
    notes: check.notes || '',
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit}>
      <p><strong>Caregiver:</strong> {check.caregiverFirst} {check.caregiverLast}</p>
      <p><strong>Check Type:</strong> {check.checkType}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Status</label>
          <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="form-group">
          <label>Result</label>
          <select value={formData.result} onChange={(e) => setFormData({ ...formData, result: e.target.value })}>
            <option value="">Not Yet</option>
            <option value="clear">Clear</option>
            <option value="flagged">Flagged (Review Required)</option>
            <option value="disqualifying">Disqualifying</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Completed Date</label>
          <input type="date" value={formData.completedDate} onChange={(e) => setFormData({ ...formData, completedDate: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Expiration Date</label>
          <input type="date" value={formData.expirationDate} onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })} />
        </div>
      </div>

      <div className="form-group">
        <label>Reference Number</label>
        <input type="text" value={formData.referenceNumber} onChange={(e) => setFormData({ ...formData, referenceNumber: e.target.value })} placeholder="External reference/case number" />
      </div>

      <div className="form-group">
        <label>Findings</label>
        <textarea value={formData.findings} onChange={(e) => setFormData({ ...formData, findings: e.target.value })} placeholder="Document any findings..." rows={3} />
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Additional notes..." />
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Update Check</button>
      </div>
    </form>
  )
}
