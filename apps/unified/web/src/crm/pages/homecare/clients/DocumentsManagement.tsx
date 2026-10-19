// Moved from templates/crm-homecare/frontend/src/components/admin/DocumentsManagement.tsx — the document store: files
// kept against a client, a caregiver or the company, uploaded, downloaded, deleted, and signed on screen.
// (server/crm/homecare/clients/documents.ts: rows are camelCase — documentName, fileName, entityType, uploadedAt …)
import { useState, useEffect, type FormEvent } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, rows, downloadBlob, saveBlob, errorMessage } from '../lib/http'
import { formatDate, parseLocalDate } from '../lib/date'
import { formatDateTime } from '../lib/datetime'
import { formatAgencyDate } from '../lib/agencyClock'
import SignaturePad from '../lib/SignaturePad'
import { allRows, type Client, type Caregiver } from './shared'

/** A row of GET /api/documents (data/homecareClients.ts documentRows: never the file bytes). */
interface DocRow {
  id: string
  entityType: string
  entityId?: string | null
  category?: string | null
  documentName?: string | null
  fileName?: string | null
  fileSize?: number | null
  requiresSignature?: boolean
  expirationDate?: string | null
  signedAt?: string | null
  uploadedAt?: string | null
  entityName?: string | null
  entityFirstName?: string | null
  entityLastName?: string | null
}

// The template's white-on-bright chips (#ff9800 2.2:1, #8bc34a 2.0:1, #00bcd4 2.0:1 …) as ink on its own tint.
const CATEGORY_CHIP: Record<string, string> = {
  medical: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200',
  legal: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200',
  insurance: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  care_plan: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
  assessment: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
  contract: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  certification: 'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-200',
  background_check: 'bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200',
  other: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200',
}
const ENTITY_CHIP: Record<string, string> = {
  client: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  caregiver: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  company: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
}

const DocumentsManagement = () => {
  const toast = useToast()
  const confirm = useConfirm()
  const [documents, setDocuments] = useState<DocRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ entityType: '', category: '' })
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [clients, setClients] = useState<Client[]>([])
  const [caregivers, setCaregivers] = useState<Caregiver[]>([])
  const [signTarget, setSignTarget] = useState<DocRow | null>(null) // document being signed

  useEffect(() => {
    loadDocuments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  // The pickers once, not on every filter change (the template reloaded both with each filter).
  useEffect(() => {
    allRows<Client>('/api/clients').then(setClients).catch(() => {})
    allRows<Caregiver>('/api/caregivers').then(setCaregivers).catch(() => {})
  }, [])

  const loadDocuments = async () => {
    try {
      const params: Record<string, string> = {}
      if (filter.entityType) params.entityType = filter.entityType
      if (filter.category) params.category = filter.category
      setDocuments(rows<DocRow>(await api.get('/api/documents', params)))
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load documents'))
    } finally {
      setLoading(false)
    }
  }

  const uploadDocument = async (formData: FormData) => {
    try {
      await api.upload('/api/documents', formData)
      setShowUploadModal(false)
      loadDocuments()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const deleteDocument = async (docId: string) => {
    if (!(await confirm('Delete this document? This cannot be undone.', { danger: true }))) return
    try {
      await api.delete(`/api/documents/${docId}`)
      loadDocuments()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const submitSignature = async (dataUri: string, typedName: string | null) => {
    if (!signTarget) return
    // A refusal is thrown with the server's sentence; SignaturePad shows it.
    await api.post(`/api/documents/${signTarget.id}/sign`, { signatureImageBase64: dataUri, typedName })
    toast.success('Signature captured ✓')
    setSignTarget(null)
    loadDocuments()
  }

  const downloadDocument = async (doc: DocRow) => {
    try {
      saveBlob(await downloadBlob(`/api/documents/${doc.id}/download`), doc.fileName || 'document')
    } catch (error) {
      toast.error('Failed to download: ' + errorMessage(error))
    }
  }

  const getCategoryBadge = (category?: string | null) => (
    <span className={CATEGORY_CHIP[category || ''] || CATEGORY_CHIP.other} style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold' }}>
      {category?.replace('_', ' ').toUpperCase()}
    </span>
  )

  const getFileIcon = (fileName?: string | null) => {
    const ext = fileName?.split('.').pop()?.toLowerCase() || ''
    const icons: Record<string, string> = {
      pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', txt: '📃',
    }
    return icons[ext] || '📁'
  }

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return '-'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  const clientDocs = documents.filter((d) => d.entityType === 'client')
  const caregiverDocs = documents.filter((d) => d.entityType === 'caregiver')
  const companyDocs = documents.filter((d) => d.entityType === 'company')

  return (
    <div>
      <div className="page-header">
        <h2>📁 Document Management</h2>
        <button className="hc-btn hc-btn-primary" onClick={() => setShowUploadModal(true)}>
          + Upload Document
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div className="hc-stat-card" onClick={() => setFilter({ ...filter, entityType: '' })} style={{ cursor: 'pointer' }}>
          <h4>Total</h4>
          <div className="value">{documents.length}</div>
        </div>
        <div className="hc-stat-card" onClick={() => setFilter({ ...filter, entityType: 'client' })} style={{ cursor: 'pointer' }}>
          <h4>Client Docs</h4>
          <div className="value" style={{ color: 'var(--hc-blue-ink)' }}>{clientDocs.length}</div>
        </div>
        <div className="hc-stat-card" onClick={() => setFilter({ ...filter, entityType: 'caregiver' })} style={{ cursor: 'pointer' }}>
          <h4>Caregiver Docs</h4>
          <div className="value" style={{ color: 'var(--hc-green-ink)' }}>{caregiverDocs.length}</div>
        </div>
        <div className="hc-stat-card" onClick={() => setFilter({ ...filter, entityType: 'company' })} style={{ cursor: 'pointer' }}>
          <h4>Company Docs</h4>
          <div className="value text-violet-700 dark:text-violet-300">{companyDocs.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="hc-card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Type</label>
            <select value={filter.entityType} onChange={(e) => setFilter({ ...filter, entityType: e.target.value })}>
              <option value="">All Types</option>
              <option value="client">Client</option>
              <option value="caregiver">Caregiver</option>
              <option value="company">Company</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Category</label>
            <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
              <option value="">All Categories</option>
              <option value="medical">Medical</option>
              <option value="legal">Legal</option>
              <option value="insurance">Insurance</option>
              <option value="care_plan">Care Plan</option>
              <option value="assessment">Assessment</option>
              <option value="contract">Contract</option>
              <option value="certification">Certification</option>
              <option value="background_check">Background Check</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      </div>

      {/* Documents Table */}
      <div className="hc-card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : documents.length === 0 ? (
          <p>No documents found. Upload a document to get started.</p>
        ) : (
          <table className="hc-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}></th>
                <th>Document Name</th>
                <th>For</th>
                <th>Category</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td style={{ fontSize: '1.5rem' }}>{getFileIcon(doc.fileName)}</td>
                  <td>
                    <strong>{doc.documentName || doc.fileName}</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--hc-muted)' }}>{doc.fileName}</div>
                  </td>
                  <td>
                    <span className={ENTITY_CHIP[doc.entityType] || ENTITY_CHIP.caregiver} style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem' }}>
                      {doc.entityType?.toUpperCase()}
                    </span>
                    <div style={{ fontWeight: 'bold', marginTop: '2px' }}>
                      {doc.entityName || `${doc.entityFirstName || ''} ${doc.entityLastName || ''}`}
                    </div>
                  </td>
                  <td>{getCategoryBadge(doc.category)}</td>
                  <td>{formatFileSize(doc.fileSize)}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {formatAgencyDate(doc.uploadedAt, { year: 'numeric', month: 'numeric', day: 'numeric' })}
                  </td>
                  <td>
                    {doc.expirationDate ? (
                      <span style={{ color: parseLocalDate(doc.expirationDate) < new Date() ? 'var(--hc-red-ink)' : 'var(--hc-ink)' }}>
                        {formatDate(doc.expirationDate)}
                      </span>
                    ) : '-'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      {doc.requiresSignature && !doc.signedAt && doc.entityType !== 'client' && (
                        <button
                          className="hc-btn hc-btn-sm"
                          style={{ background: '#0f766e', color: '#fff', border: 'none' }}
                          onClick={() => setSignTarget(doc)}
                          title="Capture electronic signature"
                        >
                          ✍️ Sign
                        </button>
                      )}
                      {doc.signedAt && (
                        <span title={`Signed ${formatDateTime(doc.signedAt)}`}
                          className="self-center px-1.5 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                          ✓ Signed
                        </span>
                      )}
                      <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => downloadDocument(doc)} title="Download">
                        ⬇️
                      </button>
                      <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => deleteDocument(doc.id)} title="Delete">
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal active" onClick={() => setShowUploadModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Upload Document</h3>
              <button className="modal-close" onClick={() => setShowUploadModal(false)}>×</button>
            </div>
            <UploadForm clients={clients} caregivers={caregivers} onSubmit={uploadDocument} onCancel={() => setShowUploadModal(false)} />
          </div>
        </div>
      )}

      <SignaturePad
        open={!!signTarget}
        onClose={() => setSignTarget(null)}
        documentName={signTarget?.documentName || signTarget?.fileName || undefined}
        onSign={submitSignature}
      />
    </div>
  )
}

// Upload Form Component
const UploadForm = ({ clients, caregivers, onSubmit, onCancel }: {
  clients: Client[]; caregivers: Caregiver[]; onSubmit: (d: FormData) => void; onCancel: () => void
}) => {
  const toast = useToast()
  const [formData, setFormData] = useState({
    entityType: 'client',
    entityId: '',
    category: 'other',
    documentName: '',
    expirationDate: '',
    notes: '',
    requiresSignature: false,
  })
  const [file, setFile] = useState<File | null>(null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!file) {
      toast.warning('Please select a file')
      return
    }
    if (formData.entityType !== 'company' && !formData.entityId) {
      toast.warning('Please select a client or caregiver')
      return
    }

    const data = new FormData()
    data.append('file', file)
    data.append('entityType', formData.entityType)
    data.append('entityId', formData.entityId)
    data.append('category', formData.category)
    data.append('documentName', formData.documentName || file.name)
    if (formData.expirationDate) data.append('expirationDate', formData.expirationDate)
    if (formData.notes) data.append('notes', formData.notes)
    if (formData.requiresSignature) data.append('requiresSignature', 'true')

    onSubmit(data)
  }

  const entities: Array<{ id: string; firstName: string; lastName: string }> = formData.entityType === 'client' ? clients : caregivers

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Document Type *</label>
        <select value={formData.entityType} onChange={(e) => setFormData({ ...formData, entityType: e.target.value, entityId: '' })}>
          <option value="client">Client Document</option>
          <option value="caregiver">Caregiver Document</option>
          <option value="company">Company Document (policy every caregiver signs)</option>
        </select>
      </div>

      {formData.entityType !== 'company' && (
        <div className="form-group">
          <label>{formData.entityType === 'client' ? 'Client' : 'Caregiver'} *</label>
          <select value={formData.entityId} onChange={(e) => setFormData({ ...formData, entityId: e.target.value })} required>
            <option value="">Select {formData.entityType === 'client' ? 'Client' : 'Caregiver'}</option>
            {entities.map((p) => (
              <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
            ))}
          </select>
        </div>
      )}

      {formData.entityType !== 'client' && (
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={formData.requiresSignature} onChange={(e) => setFormData({ ...formData, requiresSignature: e.target.checked })} />
            Needs a signature ({formData.entityType === 'company' ? 'every caregiver signs it from their phone' : 'the caregiver signs it from their phone'})
          </label>
        </div>
      )}

      <div className="form-group">
        <label>Category</label>
        <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })}>
          <option value="medical">Medical</option>
          <option value="legal">Legal</option>
          <option value="insurance">Insurance</option>
          <option value="care_plan">Care Plan</option>
          <option value="assessment">Assessment</option>
          <option value="contract">Contract</option>
          <option value="certification">Certification</option>
          <option value="background_check">Background Check</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="form-group">
        <label>Document Name</label>
        <input type="text" value={formData.documentName} onChange={(e) => setFormData({ ...formData, documentName: e.target.value })} placeholder="Optional display name" />
      </div>

      <div className="form-group">
        <label>Expiration Date</label>
        <input type="date" value={formData.expirationDate} onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })} />
      </div>

      <div className="form-group">
        <label>File *</label>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.txt" required />
        <small style={{ color: 'var(--hc-muted)' }}>Max 10MB. Accepted: PDF, Word, Excel, Images, Text</small>
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Optional notes about this document" />
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Upload</button>
      </div>
    </form>
  )
}

export default DocumentsManagement
