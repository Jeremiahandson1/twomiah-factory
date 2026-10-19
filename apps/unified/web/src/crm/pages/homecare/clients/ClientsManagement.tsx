// Moved from templates/crm-homecare/frontend/src/components/admin/ClientsManagement.tsx — the office's client list:
// add a client, search and filter, and open a client's record, care tasks, report and service pause.
import { useState, useEffect, type FormEvent } from 'react'
import { useAuth, useToast } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'
import { formatDate, toLocalYMD } from '../lib/date'
import EditClientModal from './EditClientModal'
import CareTasksManager from './CareTasksManager'
import ClientReportModal from './ClientReportModal'
import { allRows, SECTION_HEAD, HINT, type Client, type ReferralSource, type CareType } from './shared'
import { useMay } from '../lib/useMay'

// AddressLink component - opens Google Maps
const AddressLink = ({ address, city, state, zip }: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }) => {
  if (!address && !city) return <span>-</span>

  const fullAddress = [address, city, state, zip].filter(Boolean).join(', ')
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`

  return (
    <a
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open in Google Maps: ${fullAddress}`}
      style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
    >
      📍 {city || address}
    </a>
  )
}

interface CardProps {
  client: Client
  getReferralSourceName: (id?: string | null) => string
  getCareTypeName: (id?: string | null) => string
  onEdit: (c: Client) => void
  onTasks: (c: Client) => void
  onReport?: (c: Client) => void
}

// Mobile-friendly client card
const ClientCard = ({ client, getReferralSourceName, getCareTypeName, onEdit, onTasks, onReport }: CardProps) => (
  <div className="hc-card" style={{ marginBottom: '0.75rem', padding: '1rem' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
      <div>
        <strong style={{ fontSize: '1.1rem' }}>{client.firstName} {client.lastName}</strong>
        {client.dateOfBirth && (
          <div style={{ color: 'var(--hc-muted)', fontSize: '0.85rem' }}>
            DOB: {formatDate(client.dateOfBirth)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
        <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => onTasks(client)} title="Care tasks checklist">📋 Tasks</button>
        {onReport && <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => onReport(client)} title="Generate comprehensive report">📄 Report</button>}
        <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => onEdit(client)}>✏️ Edit</button>
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.9rem' }}>
      <div>
        <span style={{ color: 'var(--hc-muted)' }}>📞</span>{' '}
        {client.phone ? (
          <a href={`tel:${client.phone}`}>{client.phone}</a>
        ) : (
          <span style={{ color: 'var(--hc-muted)' }}>N/A</span>
        )}
      </div>
      <div>
        <AddressLink address={client.address} city={client.city} state={client.state} zip={client.zip} />
      </div>
    </div>

    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
      {client.isPrivatePay ? (
        <span className="hc-badge hc-badge-info">Private Pay</span>
      ) : (
        <>
          <span className="hc-badge hc-badge-success">Referred</span>
          <span className="hc-badge" style={{ backgroundColor: 'var(--hc-subtle)', color: 'var(--hc-ink)' }}>
            {getReferralSourceName(client.referredById)}
          </span>
        </>
      )}
      {client.careTypeId && (
        <span className="hc-badge" style={{ backgroundColor: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)' }}>
          {getCareTypeName(client.careTypeId)}
        </span>
      )}
    </div>
  </div>
)

// Suspend / resume service for one client — pauses (or brings back) EVERY active schedule the client
// has from a date on. Nothing is deleted: past visits stay and resume restores the schedule exactly.
// (POST /api/schedules/client/:clientId/suspend { fromDate } and /resume, office only.)
const SuspendServicePanel = ({ client, onClose }: { client: Client; onClose: () => void }) => {
  const [fromDate, setFromDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const run = async (action: 'suspend' | 'resume') => {
    setBusy(true); setMessage('')
    try {
      const data: { suspended?: number; resumed?: number; fromDate?: string } =
        await api.post(`/api/schedules/client/${client.id}/${action}`, action === 'suspend' && fromDate ? { fromDate } : {})
      if (action === 'suspend') {
        setMessage(data.suspended === 0 ? 'This client has no active schedules to suspend.'
          : `Service suspended from ${data.fromDate} (${data.suspended} schedule${data.suspended !== 1 ? 's' : ''}).`)
      } else {
        setMessage(data.resumed === 0 ? 'Nothing was suspended for this client.'
          : `Service resumed (${data.resumed} schedule${data.resumed !== 1 ? 's' : ''}).`)
      }
    } catch (err) {
      setMessage('Error: ' + errorMessage(err, `${action} failed`))
    } finally { setBusy(false) }
  }
  const isError = message.startsWith('Error')
  return (
    <div className="modal active" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>⏸ Suspend / resume service — {client.firstName} {client.lastName}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--hc-ink-soft)' }}>
          Pauses every scheduled visit from that date on. Nothing is deleted — past visits stay, and you can resume anytime.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--hc-ink-soft)' }}>Starting</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <span style={{ fontSize: '0.75rem', color: 'var(--hc-muted)' }}>{fromDate ? '' : '(today)'}</span>
        </div>
        {message && (
          <div style={{
            padding: '0.5rem 0.75rem', borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem',
            background: isError ? 'var(--hc-danger-bg)' : 'var(--hc-success-bg)', color: isError ? 'var(--hc-danger-ink)' : 'var(--hc-success-ink)',
          }}>{message}</div>
        )}
        <div className="modal-actions">
          <button type="button" className="hc-btn hc-btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="hc-btn hc-btn-secondary" disabled={busy} onClick={() => run('resume')}>▶ Resume service</button>
          <button type="button" className="hc-btn hc-btn-primary" disabled={busy} onClick={() => run('suspend')}>⏸ Suspend all visits</button>
        </div>
      </div>
    </div>
  )
}

interface NewClientForm {
  firstName: string
  lastName: string
  dateOfBirth: string
  gender: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  zip: string
  referralSourceId: string
  medicaidId: string
  mcoMemberId: string
  careTypeId: string
  isPrivatePay: boolean
  privatePayRate: string
  privatePayRateType: string
  weeklyAuthorizedUnits: string
  emergencyContactName: string
  emergencyContactPhone: string
  emergencyContactRelationship: string
  notes: string
}

const ClientsManagement = () => {
  // Each control for whoever the server lets use it: adding is care-clients:create, suspending care-schedule:update, the report care-billing:read (lib/useMay.ts).
  const may = useMay('care-clients')
  const maySchedule = useMay('care-schedule')
  const mayBilling = useMay('care-billing')
  const { company } = useAuth()
  const toast = useToast()
  const [clients, setClients] = useState<Client[]>([])
  const [reportClient, setReportClient] = useState<Client | null>(null)
  const [referralSources, setReferralSources] = useState<ReferralSource[]>([])
  const [careTypes, setCareTypes] = useState<CareType[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [careTasksClient, setCareTasksClient] = useState<Client | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterReferral, setFilterReferral] = useState('')
  const [filterCareType, setFilterCareType] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [suspendClient, setSuspendClient] = useState<Client | null>(null)

  // Listen for window resize
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // The agency's own state, as the template's generated '{{STATE}}' was.
  const initialFormData = (): NewClientForm => ({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: company?.state || '',
    zip: '',
    referralSourceId: '',
    medicaidId: '',
    mcoMemberId: '',
    careTypeId: '',
    isPrivatePay: false,
    privatePayRate: '',
    privatePayRateType: 'hourly',
    weeklyAuthorizedUnits: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
    notes: '',
  })

  const [formData, setFormData] = useState<NewClientForm>(initialFormData)

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    try {
      const [clientRows, rsData, ctData] = await Promise.all([
        allRows<Client>('/api/clients'),
        api.get('/api/referral-sources'),
        api.get('/api/care-types'),
      ])
      setClients(clientRows)
      setReferralSources(rows<ReferralSource>(rsData))
      setCareTypes(rows<CareType>(ctData))
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load clients'))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const cleanedData = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        dateOfBirth: formData.dateOfBirth || null,
        gender: formData.gender || null,
        phone: formData.phone || null,
        email: formData.email || null,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        zip: formData.zip || null,
        referralSourceId: formData.isPrivatePay ? null : (formData.referralSourceId || null),
        medicaidId: formData.isPrivatePay ? null : (formData.medicaidId.trim() || null),
        mcoMemberId: formData.isPrivatePay ? null : (formData.mcoMemberId.trim() || null),
        careTypeId: formData.careTypeId || null,
        isPrivatePay: formData.isPrivatePay,
        privatePayRate: formData.isPrivatePay ? parseFloat(formData.privatePayRate) : null,
        privatePayRateType: formData.privatePayRateType,
        weeklyAuthorizedUnits: formData.weeklyAuthorizedUnits ? parseInt(formData.weeklyAuthorizedUnits) : null,
        emergencyContactName: formData.emergencyContactName || null,
        emergencyContactPhone: formData.emergencyContactPhone || null,
        emergencyContactRelationship: formData.emergencyContactRelationship || null,
        notes: formData.notes || null,
      }

      await api.post('/api/clients', cleanedData)

      setFormData(initialFormData())
      setShowForm(false)
      loadData()
      toast.success('Client added successfully!')
    } catch (error) {
      toast.error('Failed to create client: ' + errorMessage(error))
    }
  }

  const handleViewClient = (client: Client) => {
    setSelectedClient(client)
    setShowEditModal(true)
  }

  const getReferralSourceName = (id?: string | null) => {
    const rs = referralSources.find((r) => r.id === id)
    return rs ? rs.name : '-'
  }

  const getCareTypeName = (id?: string | null) => {
    const ct = careTypes.find((c) => c.id === id)
    return ct ? ct.name : '-'
  }

  const filteredClients = clients.filter((client) => {
    const matchesSearch = !searchTerm ||
      `${client.firstName} ${client.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.phone && client.phone.includes(searchTerm)) ||
      (client.email && client.email.toLowerCase().includes(searchTerm.toLowerCase()))

    const matchesReferral = !filterReferral || client.referredById === filterReferral
    const matchesCareType = !filterCareType || client.careTypeId === filterCareType
    // Deactivated ("deleted") clients are hidden from the active roster unless
    // the user opts in, so a soft-deleted client no longer reads as active.
    const matchesActive = showInactive || client.isActive !== false

    return matchesSearch && matchesReferral && matchesCareType && matchesActive
  })

  const set = <K extends keyof NewClientForm>(key: K, value: NewClientForm[K]) => setFormData({ ...formData, [key]: value })

  return (
    <div>
      <div className="page-header">
        <h2>👥 Clients</h2>
        {may.create && <button className="hc-btn hc-btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? '✕ Cancel' : '➕ Add'}
        </button>}
      </div>

      {showForm && (
        <div className="hc-card hc-card-form">
          <h3>Add New Client</h3>
          <form onSubmit={handleSubmit}>
            <h4 style={SECTION_HEAD}>📋 Basic Information</h4>
            <div className="form-grid">
              <div className="form-group">
                <label>First Name *</label>
                <input type="text" value={formData.firstName} onChange={(e) => set('firstName', e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Last Name *</label>
                <input type="text" value={formData.lastName} onChange={(e) => set('lastName', e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Date of Birth</label>
                <input type="date" max={toLocalYMD(new Date())} value={formData.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Gender</label>
                <select value={formData.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">Select...</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input type="tel" inputMode="tel" maxLength={20} pattern="[0-9()+\-.\s]{7,20}" title="Enter a valid phone number" value={formData.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={formData.email} onChange={(e) => set('email', e.target.value)} />
              </div>
            </div>

            <h4 style={SECTION_HEAD}>🏠 Address</h4>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: isMobile ? 'span 1' : 'span 2' }}>
                <label>Street Address</label>
                <input type="text" value={formData.address} onChange={(e) => set('address', e.target.value)} />
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
                <label>ZIP Code</label>
                <input type="text" value={formData.zip} onChange={(e) => set('zip', e.target.value)} />
              </div>
            </div>

            <h4 style={SECTION_HEAD}>💰 Billing Information</h4>
            <div className="form-grid">
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={formData.isPrivatePay} onChange={(e) => set('isPrivatePay', e.target.checked)} style={{ width: 'auto' }} />
                  Private Pay Client
                </label>
              </div>

              {!formData.isPrivatePay ? (
                <>
                  <div className="form-group">
                    <label>Payer / referral source</label>
                    <select value={formData.referralSourceId} onChange={(e) => set('referralSourceId', e.target.value)}>
                      <option value="">Select payer...</option>
                      {referralSources.map((rs) => (<option key={rs.id} value={rs.id}>{rs.name}</option>))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Medicaid (MA) ID</label>
                    <input value={formData.medicaidId} onChange={(e) => set('medicaidId', e.target.value)} placeholder="10–12 digits" inputMode="numeric" />
                  </div>
                  <div className="form-group">
                    <label>MCO member ID</label>
                    <input value={formData.mcoMemberId} onChange={(e) => set('mcoMemberId', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Care Type</label>
                    <select value={formData.careTypeId} onChange={(e) => set('careTypeId', e.target.value)}>
                      <option value="">Select care type...</option>
                      {careTypes.map((ct) => (<option key={ct.id} value={ct.id}>{ct.name}</option>))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Care Type</label>
                    <select value={formData.careTypeId} onChange={(e) => set('careTypeId', e.target.value)}>
                      <option value="">Select care type...</option>
                      {careTypes.map((ct) => (<option key={ct.id} value={ct.id}>{ct.name}</option>))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Rate Type</label>
                    <select value={formData.privatePayRateType} onChange={(e) => set('privatePayRateType', e.target.value)}>
                      <option value="hourly">Per Hour</option>
                      <option value="15min">Per 15 Minutes</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Rate Amount *</label>
                    <input type="number" step="0.01" min="0" value={formData.privatePayRate} onChange={(e) => set('privatePayRate', e.target.value)} placeholder={formData.privatePayRateType === '15min' ? 'e.g., 6.25' : 'e.g., 25.00'} required={formData.isPrivatePay} />
                  </div>
                </>
              )}
            </div>

            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label>Weekly Authorized Units</label>
              <input
                type="number"
                step="1"
                min="0"
                max="672"
                value={formData.weeklyAuthorizedUnits}
                onChange={(e) => set('weeklyAuthorizedUnits', e.target.value)}
                placeholder="e.g., 80 units"
              />
              {formData.weeklyAuthorizedUnits && parseFloat(formData.weeklyAuthorizedUnits) >= 0 && (
                <div style={{
                  marginTop: '0.5rem',
                  padding: '0.5rem',
                  background: 'var(--hc-info-bg)',
                  borderRadius: '4px',
                  fontSize: '0.9rem',
                  color: 'var(--hc-info-ink)',
                }}>
                  = <strong>{(parseFloat(formData.weeklyAuthorizedUnits) * 0.25).toFixed(2)} hours</strong> per week
                </div>
              )}
              <small style={HINT}>
                1 unit = 15 minutes. Used to track scheduling coverage.
              </small>
            </div>

            <h4 style={SECTION_HEAD}>🚨 Emergency Contact</h4>
            <div className="form-grid">
              <div className="form-group">
                <label>Contact Name</label>
                <input type="text" value={formData.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input type="tel" value={formData.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Relationship</label>
                <input type="text" value={formData.emergencyContactRelationship} onChange={(e) => set('emergencyContactRelationship', e.target.value)} placeholder="e.g., Spouse, Son, Daughter" />
              </div>
            </div>

            <h4 style={SECTION_HEAD}>📝 Notes</h4>
            <div className="form-group">
              <textarea value={formData.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Any initial notes about the client..." rows={3} />
            </div>

            <div className="form-actions">
              <button type="submit" className="hc-btn hc-btn-primary">Add Client</button>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Search and Filters */}
      <div className="hc-card" style={{ marginBottom: '1rem', padding: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <input type="text" placeholder="🔍 Search by name, phone, or email..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ width: '100%' }} />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.75rem' }}>
            <select value={filterReferral} onChange={(e) => setFilterReferral(e.target.value)}>
              <option value="">All Referral Sources</option>
              {referralSources.map((rs) => (<option key={rs.id} value={rs.id}>{rs.name}</option>))}
            </select>
            <select value={filterCareType} onChange={(e) => setFilterCareType(e.target.value)}>
              <option value="">All Care Types</option>
              {careTypes.map((ct) => (<option key={ct.id} value={ct.id}>{ct.name}</option>))}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show deactivated clients
          </label>
        </div>
      </div>

      {/* Clients List */}
      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : filteredClients.length === 0 ? (
        <div className="hc-card hc-card-centered">
          <p>{clients.length === 0 ? 'No clients yet. Add one to get started.' : 'No clients match your filters.'}</p>
        </div>
      ) : isMobile ? (
        <div>
          {filteredClients.map((client) => (
            <ClientCard key={client.id} client={client} getReferralSourceName={getReferralSourceName} getCareTypeName={getCareTypeName} onEdit={handleViewClient} onTasks={setCareTasksClient} onReport={mayBilling.read ? setReportClient : undefined} />
          ))}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="hc-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Address</th>
                <th>Referral Source</th>
                <th>Care Type</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
                <tr key={client.id} style={client.isActive === false ? { opacity: 0.55 } : undefined}>
                  <td>
                    <strong>{client.firstName} {client.lastName}</strong>
                    {client.dateOfBirth && (<small style={{ display: 'block', color: 'var(--hc-muted)' }}>DOB: {formatDate(client.dateOfBirth)}</small>)}
                  </td>
                  <td><a href={`tel:${client.phone}`}>{client.phone || 'N/A'}</a></td>
                  <td><AddressLink address={client.address} city={client.city} state={client.state} zip={client.zip} /></td>
                  <td>{client.isPrivatePay ? (<span className="text-muted">-</span>) : (getReferralSourceName(client.referredById))}</td>
                  <td>{getCareTypeName(client.careTypeId)}</td>
                  <td>
                    {client.isActive === false
                      ? (<span className="hc-badge hc-badge-danger">Deactivated</span>)
                      : client.isPrivatePay
                        ? (<span className="hc-badge hc-badge-info">Private Pay</span>)
                        : (<span className="hc-badge hc-badge-success">Referred</span>)}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setCareTasksClient(client)} title="Care tasks checklist">📋 Tasks</button>
                      {mayBilling.read && <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setReportClient(client)} title="Generate comprehensive report">📄 Report</button>}
                      <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => handleViewClient(client)}>✏️ Edit</button>
                      {maySchedule.update && <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setSuspendClient(client)} title="Suspend or resume all of this client's visits">⏸ Service</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && clients.length > 0 && (
        <div style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--hc-muted)' }}>
          Showing {filteredClients.length} of {clients.length} clients
        </div>
      )}

      {suspendClient && <SuspendServicePanel client={suspendClient} onClose={() => setSuspendClient(null)} />}
      <ClientReportModal client={reportClient} isOpen={!!reportClient} onClose={() => setReportClient(null)} />
      <EditClientModal client={selectedClient} referralSources={referralSources} careTypes={careTypes} isOpen={showEditModal} onClose={() => { setShowEditModal(false); setSelectedClient(null) }} onSuccess={loadData} />
      {careTasksClient && (
        <CareTasksManager client={careTasksClient} onClose={() => setCareTasksClient(null)} />
      )}
    </div>
  )
}

export default ClientsManagement
