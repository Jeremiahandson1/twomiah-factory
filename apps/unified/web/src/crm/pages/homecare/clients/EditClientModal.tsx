// Moved from templates/crm-homecare/frontend/src/components/admin/EditClientModal.tsx — a client's record in tabs (basic
// info, billing, medical, caregivers, portal), with deactivate / reactivate. EvvWeeklyUnits is exported for the billing
// group's Portal Claim Days (it opens the same box for a client whose EVV units are blank).
import { useState, useEffect, type FormEvent } from 'react'
import { useAuth, useConfirm } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'
import { formatDateForInput, toLocalYMD } from '../lib/date'
import { formatAgencyDate, agencyToday } from '../lib/agencyClock'
import InsuranceCardUploader from './InsuranceCardUploader'
import { useMay } from '../lib/useMay'
import PayerSelect from './PayerSelect'
import { allRows, SECTION_HEAD, HINT, type Client, type Caregiver, type CareType, type EmergencyContact, type ReferralSource } from './shared'

// A JSON list column shown in a textarea, one entry per line, and back.
const listText = (x: unknown): string => (Array.isArray(x)
  ? x.map((e) => (typeof e === 'string' ? e : ((e as { name?: string } | null)?.name ?? JSON.stringify(e)))).join('\n')
  : (x ? String(x) : ''))
const textList = (t: unknown): string[] => String(t || '').split(/\r?\n|,/).map((e) => e.trim()).filter(Boolean)
const idList = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : [])

interface EditForm {
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
  billingNotes: string
  weeklyAuthorizedUnits: string
  emergencyContactName: string
  emergencyContactPhone: string
  emergencyContactRelationship: string
  medicalConditions: string
  medications: string
  allergies: string
  medicalNotes: string
  mobilityAssistanceNeeds: string
  insuranceProvider: string
  insuranceId: string
  insuranceGroup: string
  carePreferences: string
  preferredCaregivers: string[]
  doNotUseCaregivers: string[]
  notes: string
}

const EMPTY_FORM: EditForm = {
  firstName: '', lastName: '', dateOfBirth: '', gender: '', phone: '', email: '', address: '', city: '', state: '', zip: '',
  referralSourceId: '', medicaidId: '', mcoMemberId: '', careTypeId: '', isPrivatePay: false, privatePayRate: '',
  privatePayRateType: 'hourly', billingNotes: '', weeklyAuthorizedUnits: '', emergencyContactName: '',
  emergencyContactPhone: '', emergencyContactRelationship: '', medicalConditions: '', medications: '', allergies: '',
  medicalNotes: '', mobilityAssistanceNeeds: '', insuranceProvider: '', insuranceId: '', insuranceGroup: '',
  carePreferences: '', preferredCaregivers: [], doNotUseCaregivers: [], notes: '',
}

/** One login on the client's portal (GET /api/portal/admin/clients/:clientId/accounts). */
interface PortalAccount {
  id: string
  email: string
  displayName?: string | null
  portalEnabled?: boolean
  lastLogin?: string | null
  lockedUntil?: string | null
  status: string
}

/** POST /api/portal/admin/invite's reply. */
interface InviteReply {
  success: boolean
  results?: Array<{ email: string; error?: string; inviteUrl?: string }>
  inviteUrl?: string | null
  emailSent?: boolean
  message?: string
}

type MessageKind = '' | 'success' | 'warning' | 'error'

interface Props {
  client: Client | null
  referralSources?: ReferralSource[]
  careTypes?: CareType[]
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

// The portal's status chip: each ink on its own ground, in both themes.
const STATUS_CHIP: Record<string, { cls: string; icon: string; label: string }> = {
  not_invited:    { cls: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300',         icon: '○', label: 'Not Invited' },
  invite_pending: { cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',        icon: '⏳', label: 'Invite Sent' },
  invite_expired: { cls: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',                icon: '⚠️', label: 'Invite Expired' },
  active:         { cls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200', icon: '✓', label: 'Active' },
  disabled:       { cls: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200',          icon: '✕', label: 'Disabled' },
}
const ACCOUNT_CHIP: Record<string, { cls: string; label: string }> = {
  invite_pending: { cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200', label: 'Invite sent' },
  invite_expired: { cls: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300', label: 'Invite expired' },
  active:         { cls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200', label: 'Active' },
  disabled:       { cls: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200', label: 'Disabled' },
}

const EditClientModal = ({ client, referralSources = [], careTypes = [], isOpen, onClose, onSuccess }: Props) => {
  // Each control for whoever the server lets use it: the record is care-clients, portal logins care-portal (lib/useMay.ts).
  const may = useMay('care-clients')
  const mayPortal = useMay('care-portal')
  const { company } = useAuth()
  const confirm = useConfirm()
  const [caregivers, setCaregivers] = useState<Caregiver[]>([])
  useEffect(() => {
    if (!isOpen) return
    allRows<Caregiver>('/api/caregivers')
      .then(setCaregivers)
      .catch(() => setCaregivers([]))
  }, [isOpen])
  const toggleId = (field: 'preferredCaregivers' | 'doNotUseCaregivers', id: string) => setFormData((f) => {
    const cur = new Set(f[field] || [])
    if (cur.has(id)) cur.delete(id); else cur.add(id)
    return { ...f, [field]: [...cur] }
  })
  const [activeTab, setActiveTab] = useState('basic')
  const [formData, setFormData] = useState<EditForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  // ── Portal state ──────────────────────────────────────────────────────────
  const [portalStatus, setPortalStatus] = useState<string | null>(null)
  const [portalEmail, setPortalEmail] = useState('')
  const [portalName, setPortalName] = useState('')            // who this login is for
  const [portalAccounts, setPortalAccounts] = useState<PortalAccount[]>([])           // one row per person
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalMessage, setPortalMessage] = useState<{ text: string; type: MessageKind }>({ text: '', type: '' })
  const [inviteUrl, setInviteUrl] = useState('')

  // One portal login per PERSON (their own email + password): their own record of
  // what they viewed, their own revocation, and one person's lockout or password
  // reset never touches the others. Sending to an email that already has a login
  // for this client just makes it a fresh 48-hour link.
  const refreshPortalAccounts = () => {
    if (!client?.id) return
    api.get(`/api/portal/admin/clients/${client.id}/accounts`)
      .then((reply: unknown) => setPortalAccounts(rows<PortalAccount>(reply)))
      .catch(() => {})
  }

  useEffect(() => {
    if (client && isOpen) {
      setFormData({
        // Basic Info
        firstName: client.firstName || '',
        lastName: client.lastName || '',
        dateOfBirth: formatDateForInput(client.dateOfBirth),
        gender: client.gender || '',
        phone: client.phone || '',
        email: client.email || '',
        // Address
        address: client.address || '',
        city: client.city || '',
        state: client.state || company?.state || '',
        zip: client.zip || '',
        // Billing/Referral (the column is referred_by_id; referralSourceId is the form's name for it)
        referralSourceId: client.referredById || '',
        medicaidId: client.medicaidId || '',
        mcoMemberId: client.mcoMemberId || '',
        careTypeId: client.careTypeId || '',
        isPrivatePay: !!client.isPrivatePay,
        privatePayRate: client.privatePayRate == null ? '' : String(client.privatePayRate),
        privatePayRateType: client.privatePayRateType || 'hourly',
        billingNotes: client.billingNotes || '',
        weeklyAuthorizedUnits: client.weeklyAuthorizedUnits == null ? '' : String(client.weeklyAuthorizedUnits),
        // Emergency Contact (filled from the client's contacts below)
        emergencyContactName: '',
        emergencyContactPhone: '',
        emergencyContactRelationship: '',
        // Medical: these three are lists on the client (JSON arrays); the form edits them one per line
        medicalConditions: listText(client.medicalConditions),
        medications: listText(client.medications),
        allergies: listText(client.allergies),
        medicalNotes: client.medicalNotes || '',
        mobilityAssistanceNeeds: client.assistanceNeeds || '',
        // Insurance
        insuranceProvider: client.insuranceProvider || '',
        insuranceId: client.insuranceId || '',
        insuranceGroup: client.insuranceGroup || '',
        // Caregiver Preferences: caregiver ids (the matching engine and the optimizers read them)
        carePreferences: client.carePreferences || '',
        preferredCaregivers: idList(client.preferredCaregivers),
        doNotUseCaregivers: idList(client.doNotUseCaregivers),
        // Notes
        notes: client.notes || '',
      })
      setActiveTab('basic')
      setDeleteConfirm(false)
      setMessage('')

      // Load portal status for this client
      setPortalStatus(null)
      setPortalEmail(client.email || '')
      setPortalName('')
      setInviteUrl('')
      setPortalMessage({ text: '', type: '' })
      refreshPortalAccounts()
      api.get('/api/portal/admin/clients')
        .then((reply: unknown) => {
          const found = rows<{ id: string; portalStatus?: string }>(reply).find((c) => c.id === client.id)
          setPortalStatus(found?.portalStatus || 'not_invited')
        })
        .catch(() => setPortalStatus('not_invited'))

      // Emergency contacts live in a separate table (not on the list row), so
      // pull the full client and patch the primary contact into the form —
      // otherwise the Emergency Contact fields always opened blank.
      api.get(`/api/clients/${client.id}`)
        .then((detail: Client) => {
          const contacts = detail?.emergencyContacts || []
          const ec = contacts.find((x) => x.isPrimary) || contacts[0]
          if (ec) {
            setFormData((prev) => ({
              ...prev,
              emergencyContactName: ec.name || '',
              emergencyContactPhone: ec.phone || '',
              emergencyContactRelationship: ec.relationship || '',
            }))
          }
        })
        .catch(() => { /* best-effort */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, isOpen])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!client) return
    setLoading(true)
    setMessage('')

    try {
      await api.put(`/api/clients/${client.id}`, {
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
        referralSourceId: formData.referralSourceId || null,
        medicaidId: String(formData.medicaidId || '').trim() || null,
        mcoMemberId: String(formData.mcoMemberId || '').trim() || null,
        careTypeId: formData.careTypeId || null,
        isPrivatePay: formData.isPrivatePay,
        privatePayRate: formData.isPrivatePay ? parseFloat(formData.privatePayRate) : null,
        privatePayRateType: formData.privatePayRateType,
        billingNotes: formData.billingNotes || null,
        weeklyAuthorizedUnits: formData.weeklyAuthorizedUnits ? parseInt(formData.weeklyAuthorizedUnits) : null,
        // List columns are NOT NULL JSON arrays: an empty box is [], never null.
        medicalConditions: textList(formData.medicalConditions),
        medications: textList(formData.medications),
        allergies: textList(formData.allergies),
        assistanceNeeds: formData.mobilityAssistanceNeeds || null,
        medicalNotes: formData.medicalNotes || null,
        carePreferences: formData.carePreferences || null,
        insuranceProvider: formData.insuranceProvider || null,
        insuranceId: formData.insuranceId || null,
        insuranceGroup: formData.insuranceGroup || null,
        preferredCaregivers: formData.preferredCaregivers || [],
        doNotUseCaregivers: formData.doNotUseCaregivers || [],
        notes: formData.notes || null,
      })

      // Save emergency contact via separate API if fields are filled. There is no edit for a contact, so the new one is
      // added first and the old primary removed only once the new one is saved (the template removed first, and a
      // refused add then left the client with no contact). The phone column is NOT NULL: a name-only contact sends ''.
      if (formData.emergencyContactName) {
        try {
          const clientData: Client = await api.get(`/api/clients/${client.id}`)
          const primaryEc = clientData.emergencyContacts?.find((ec: EmergencyContact) => ec.isPrimary)
          const same = primaryEc && primaryEc.name === formData.emergencyContactName
            && (primaryEc.phone || '') === formData.emergencyContactPhone
            && (primaryEc.relationship || '') === formData.emergencyContactRelationship
          if (!same) {
            await api.post(`/api/clients/${client.id}/emergency-contacts`, {
              name: formData.emergencyContactName,
              phone: formData.emergencyContactPhone || '',
              relationship: formData.emergencyContactRelationship || null,
              isPrimary: true,
            })
            if (primaryEc) await api.delete(`/api/clients/${client.id}/emergency-contacts/${primaryEc.id}`)
          }
        } catch { /* emergency contact save is best-effort */ }
      }

      setMessage('Client updated successfully!')
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 1000)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to update client'))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!client) return
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }

    setLoading(true)
    try {
      await api.delete(`/api/clients/${client.id}`)
      setMessage('Client deleted.')
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 1000)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to delete client'))
      setDeleteConfirm(false)
    } finally {
      setLoading(false)
    }
  }

  const handleReactivate = async () => {
    if (!client) return
    setLoading(true)
    try {
      await api.put(`/api/clients/${client.id}`, { isActive: true })
      setMessage('Client reactivated.')
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 1000)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to reactivate client'))
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !client) return null

  const tabs = [
    { id: 'basic', label: '📋 Basic Info' },
    { id: 'billing', label: '💰 Billing' },
    { id: 'medical', label: '📋 Medical' },
    { id: 'caregivers', label: '👤 Caregivers' },
    { id: 'portal', label: '🌐 Portal' },
  ]

  // ── Portal handlers ───────────────────────────────────────────────────────
  const handleSendInvite = async () => {
    if (!portalEmail.trim()) {
      setPortalMessage({ text: 'Enter an email address first.', type: 'error' })
      return
    }
    setPortalLoading(true)
    setPortalMessage({ text: '', type: '' })
    setInviteUrl('')
    try {
      const data: InviteReply = await api.post('/api/portal/admin/invite', {
        clientId: client.id,
        invitees: [{ email: portalEmail.trim(), name: portalName.trim() || null }],
      })
      const ok = (data.results || []).filter((r) => !r.error)
      if (ok.length === 0) throw new Error(data.message || 'Invite failed')
      setInviteUrl(ok[0]?.inviteUrl || '')
      setPortalStatus((prev) => (prev === 'active' ? prev : 'invite_pending'))
      const msg = data.emailSent
        ? `✉️ Invite email sent to ${portalEmail}. Link is also shown below as a backup.`
        : `⚠️ Invite created but email could NOT be sent. Copy the link below and send it to ${portalEmail} manually.`
      setPortalMessage({ text: msg, type: data.emailSent ? 'success' : 'warning' })
      setPortalEmail('')
      setPortalName('')
      refreshPortalAccounts()
    } catch (err) {
      setPortalMessage({ text: errorMessage(err, 'Failed to create invite'), type: 'error' })
    } finally {
      setPortalLoading(false)
    }
  }

  const handleRemoveAccount = async (acct: PortalAccount) => {
    if (!(await confirm(`Remove portal access for ${acct.displayName || acct.email}? They will no longer be able to log in.`, { danger: true }))) return
    setPortalLoading(true)
    try {
      await api.delete(`/api/portal/admin/accounts/${acct.id}`)
      setPortalMessage({ text: `Removed portal access for ${acct.email}.`, type: 'warning' })
      refreshPortalAccounts()
    } catch (err) {
      setPortalMessage({ text: errorMessage(err, 'Failed to remove account'), type: 'error' })
    } finally {
      setPortalLoading(false)
    }
  }

  const handleTogglePortal = async (enable: boolean) => {
    setPortalLoading(true)
    try {
      await api.put(`/api/portal/admin/clients/${client.id}/toggle`, { enabled: enable })
      setPortalStatus(enable ? 'active' : 'disabled')
      setPortalMessage({ text: `Portal access ${enable ? 'enabled' : 'disabled'}.`, type: enable ? 'success' : 'warning' })
      refreshPortalAccounts()
    } catch (err) {
      setPortalMessage({ text: errorMessage(err, 'Failed to update portal access'), type: 'error' })
    } finally {
      setPortalLoading(false)
    }
  }

  const copyInviteUrl = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setPortalMessage({ text: 'Invite link copied to clipboard!', type: 'success' })
    })
  }

  const portalStatusDisplay = () => {
    const s = STATUS_CHIP[portalStatus || ''] || STATUS_CHIP.not_invited
    return (
      <span className={s.cls} style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.82rem', fontWeight: 700 }}>
        {s.icon} {s.label}
      </span>
    )
  }

  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) => setFormData({ ...formData, [key]: value })
  const subtlePanel = { background: 'var(--hc-subtle)', border: '1px solid var(--hc-line)', borderRadius: '8px' }

  return (
    <div className="modal active">
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h2>Edit: {client.firstName} {client.lastName}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {message && (
          <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="tabs" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--hc-line)', paddingBottom: '0.5rem' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`hc-btn ${activeTab === tab.id ? 'hc-btn-primary' : 'hc-btn-secondary'}`}
              onClick={() => setActiveTab(tab.id)}
              style={{ flex: 1 }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSave}>

          {/* Basic Info Tab */}
          {activeTab === 'basic' && (
            <div>
              <h4 style={SECTION_HEAD}>Personal Information</h4>
              <div className="form-grid-2">
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
                  <input type="date" max={agencyToday()} value={formData.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
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
                  <input type="tel" value={formData.phone} onChange={(e) => set('phone', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={formData.email} onChange={(e) => set('email', e.target.value)} />
                </div>
              </div>

              <h4 style={SECTION_HEAD}>Address</h4>
              <div className="form-grid-2">
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
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
                  <label>Zip Code</label>
                  <input type="text" value={formData.zip} onChange={(e) => set('zip', e.target.value)} />
                </div>
              </div>

              <h4 style={SECTION_HEAD}>Emergency Contact</h4>
              <div className="form-grid-2">
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

              <h4 style={SECTION_HEAD}>Notes</h4>
              <div className="form-group">
                <textarea value={formData.notes} onChange={(e) => set('notes', e.target.value)} placeholder="General notes about the client..." rows={3} />
              </div>
            </div>
          )}

          {/* Billing Tab */}
          {activeTab === 'billing' && (
            <div>
              <h4 style={SECTION_HEAD}>Billing Type</h4>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={formData.isPrivatePay} onChange={(e) => set('isPrivatePay', e.target.checked)} />
                  Private Pay (Client pays directly, no referral source)
                </label>
              </div>

              {!formData.isPrivatePay ? (
                <>
                  <h4 style={SECTION_HEAD}>Referral Information</h4>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label htmlFor="edit-client-payer">Payer / referral source</label>
                      <PayerSelect id="edit-client-payer" payers={referralSources} value={formData.referralSourceId} onChange={(v) => set('referralSourceId', v)} onPrivatePay={() => set('isPrivatePay', true)} />
                    </div>
                    <div className="form-group">
                      <label>Care Type</label>
                      <select value={formData.careTypeId} onChange={(e) => set('careTypeId', e.target.value)}>
                        <option value="">Select care type...</option>
                        {careTypes.map((ct) => (
                          <option key={ct.id} value={ct.id}>{ct.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Medicaid (MA) ID</label>
                      <input type="text" inputMode="numeric" placeholder="10–12 digits" value={formData.medicaidId} onChange={(e) => set('medicaidId', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>MCO member ID</label>
                      <input type="text" value={formData.mcoMemberId} onChange={(e) => set('mcoMemberId', e.target.value)} />
                    </div>
                  </div>
                  <div className="alert alert-info">
                    <strong>Rate:</strong> Billing rate is determined by the Referral Source + Care Type combination.
                    Manage rates in the Billing Dashboard.
                  </div>
                </>
              ) : (
                <>
                  <h4 style={SECTION_HEAD}>Private Pay Rate</h4>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Care Type</label>
                      <select value={formData.careTypeId} onChange={(e) => set('careTypeId', e.target.value)}>
                        <option value="">Select care type...</option>
                        {careTypes.map((ct) => (
                          <option key={ct.id} value={ct.id}>{ct.name}</option>
                        ))}
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
                      <label>Rate Amount</label>
                      <input type="number" step="0.01" min="0" value={formData.privatePayRate} onChange={(e) => set('privatePayRate', e.target.value)} placeholder="e.g., 25.00" />
                    </div>
                  </div>
                </>
              )}

              <h4 style={SECTION_HEAD}>Insurance Information</h4>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Insurance Provider</label>
                  <input type="text" value={formData.insuranceProvider} onChange={(e) => set('insuranceProvider', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Policy Number</label>
                  <input type="text" value={formData.insuranceId} onChange={(e) => set('insuranceId', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Group Number</label>
                  <input type="text" value={formData.insuranceGroup} onChange={(e) => set('insuranceGroup', e.target.value)} />
                </div>
              </div>

              {/* Insurance card photos — their own endpoint, so a 5 MB image is not resent on every save. */}
              {client.id && <InsuranceCardUploader clientId={client.id} />}

              <h4 style={SECTION_HEAD}>Weekly Authorized Units</h4>
              <div className="form-group">
                <label>Authorized Units Per Week</label>
                <input type="number" step="1" min="0" max="672" value={formData.weeklyAuthorizedUnits} onChange={(e) => set('weeklyAuthorizedUnits', e.target.value)} placeholder="e.g., 80 units" />
                {formData.weeklyAuthorizedUnits && (
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
                  1 unit = 15 minutes. Used to track if client is fully scheduled.
                </small>
              </div>

              {client.id && <EvvWeeklyUnits clientId={client.id} initialUnits={client.evvWeeklyUnits} />}

              <h4 style={SECTION_HEAD}>Billing Notes</h4>
              <div className="form-group">
                <textarea value={formData.billingNotes} onChange={(e) => set('billingNotes', e.target.value)} placeholder="Any special billing instructions..." rows={3} />
              </div>
            </div>
          )}

          {/* Medical Tab */}
          {activeTab === 'medical' && (
            <div>
              <h4 style={SECTION_HEAD}>Medical Conditions</h4>
              <div className="form-group">
                <textarea value={formData.medicalConditions} onChange={(e) => set('medicalConditions', e.target.value)} placeholder="List any medical conditions (diabetes, heart disease, etc.)..." rows={3} />
              </div>

              <h4 style={SECTION_HEAD}>Medications</h4>
              <div className="form-group">
                <textarea value={formData.medications} onChange={(e) => set('medications', e.target.value)} placeholder="List current medications and dosages..." rows={3} />
              </div>

              <h4 style={SECTION_HEAD}>Allergies</h4>
              <div className="form-group">
                <textarea value={formData.allergies} onChange={(e) => set('allergies', e.target.value)} placeholder="List any allergies (medications, foods, etc.)..." rows={2} />
              </div>

              <h4 style={SECTION_HEAD}>Mobility &amp; Assistance Needs</h4>
              <div className="form-group">
                <textarea value={formData.mobilityAssistanceNeeds} onChange={(e) => set('mobilityAssistanceNeeds', e.target.value)} placeholder="Describe mobility limitations, equipment needs (walker, wheelchair), transfer assistance..." rows={3} />
              </div>

              <h4 style={SECTION_HEAD}>Medical Notes</h4>
              <div className="form-group">
                <textarea value={formData.medicalNotes} onChange={(e) => set('medicalNotes', e.target.value)} placeholder="Additional medical notes, care instructions, doctor contacts..." rows={4} />
              </div>
            </div>
          )}

          {/* Caregivers Tab */}
          {activeTab === 'caregivers' && (
            <div>
              <h4 style={SECTION_HEAD}>Care Preferences &amp; Routines</h4>
              <div className="form-group">
                <textarea value={formData.carePreferences} onChange={(e) => set('carePreferences', e.target.value)} placeholder="Client preferences, daily routines, likes/dislikes, communication style..." rows={4} />
              </div>

              <h4 style={SECTION_HEAD}>Preferred Caregivers</h4>
              <div className="form-group">
                {caregivers.length === 0 ? <p>No caregivers yet.</p> : caregivers.map((cg) => (
                  <label key={cg.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '2px 0' }}>
                    <input type="checkbox" checked={(formData.preferredCaregivers || []).includes(cg.id)} onChange={() => toggleId('preferredCaregivers', cg.id)} />
                    {cg.firstName} {cg.lastName}
                  </label>
                ))}
              </div>

              <h4 style={SECTION_HEAD}>Do Not Assign</h4>
              <div className="form-group">
                {caregivers.length === 0 ? <p>No caregivers yet.</p> : caregivers.map((cg) => (
                  <label key={cg.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '2px 0' }}>
                    <input type="checkbox" checked={(formData.doNotUseCaregivers || []).includes(cg.id)} onChange={() => toggleId('doNotUseCaregivers', cg.id)} />
                    {cg.firstName} {cg.lastName}
                  </label>
                ))}
              </div>

              <div className="alert alert-info">
                <strong>Note:</strong> Caregiver pay rates are set by care type in Caregiver Management.
                When a caregiver works with this client, they'll be paid based on the client's care type.
              </div>
            </div>
          )}

          {/* Portal Tab */}
          {activeTab === 'portal' && (
            <div style={{ padding: '0.5rem 0' }}>
              <h4 style={{ ...SECTION_HEAD, marginTop: 0, marginBottom: '1.5rem' }}>
                🌐 Client Portal Access
              </h4>

              {/* Status row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                <span style={{ fontWeight: 600, color: 'var(--hc-ink-soft)' }}>Status:</span>
                {portalStatus ? portalStatusDisplay() : (
                  <span style={{ color: 'var(--hc-muted)', fontSize: '0.85rem' }}>Loading...</span>
                )}
              </div>

              {/* Portal message */}
              {portalMessage.text && (
                <div className={`alert ${portalMessage.type === 'error' ? 'alert-error' : portalMessage.type === 'warning' ? 'alert-warning' : 'alert-success'}`}
                  style={{ marginBottom: '1.5rem' }}>
                  {portalMessage.text}
                </div>
              )}

              {/* Invite link display */}
              {inviteUrl && (
                <div style={{ ...subtlePanel, padding: '14px 16px', marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--hc-muted)', marginBottom: '6px', fontWeight: 600 }}>
                    INVITE LINK (expires in 48 hours)
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      readOnly
                      value={inviteUrl}
                      style={{ flex: 1, fontSize: '0.8rem', background: 'var(--hc-surface)', color: 'var(--hc-ink)' }}
                      onClick={(e) => e.currentTarget.select()}
                    />
                    <button type="button" className="hc-btn hc-btn-secondary" onClick={copyInviteUrl} style={{ flexShrink: 0 }}>
                      📋 Copy
                    </button>
                  </div>
                </div>
              )}

              {/* Portal logins — one per person */}
              {portalAccounts.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h5 style={{ marginBottom: '0.75rem', color: 'var(--hc-ink)' }}>Portal Logins ({portalAccounts.length})</h5>
                  {portalAccounts.map((acct) => {
                    const chip = ACCOUNT_CHIP[acct.status] || { cls: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-200', label: acct.status }
                    const lockedUntil = acct.lockedUntil ? new Date(acct.lockedUntil) : null
                    const locked = lockedUntil !== null && lockedUntil.getTime() > Date.now()
                    return (
                      <div key={acct.id} style={{
                        ...subtlePanel, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                        padding: '10px 12px', marginBottom: '6px',
                      }}>
                        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: 'var(--hc-ink)', fontSize: '0.9rem' }}>
                            {acct.displayName || acct.email}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--hc-ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {acct.displayName ? acct.email : ''}
                            {acct.lastLogin ? `${acct.displayName ? ' · ' : ''}last login ${formatAgencyDate(acct.lastLogin)}` : ''}
                            {locked ? ' · locked after failed sign-ins (15 min)' : ''}
                          </div>
                        </div>
                        <span className={chip.cls} style={{ fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', flexShrink: 0 }}>{chip.label}</span>
                        {mayPortal.delete && <button
                          type="button"
                          className="hc-btn hc-btn-secondary"
                          onClick={() => handleRemoveAccount(acct)}
                          disabled={portalLoading}
                          title="Remove this person's portal access"
                          style={{ flexShrink: 0, padding: '4px 10px', fontSize: '0.8rem' }}
                        >
                          ✕ Remove
                        </button>}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Invite form — always available, so the office can resend at any point
                  (lost password, new email address). For an existing login it is a
                  re-invite that makes a fresh link. */}
              {mayPortal.create && <div style={{ marginBottom: '1.5rem' }}>
                <h5 style={{ marginBottom: '0.75rem', color: 'var(--hc-ink)' }}>
                  {portalAccounts.length > 0 ? 'Add Another Login' : 'Invite to Portal'}
                </h5>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: '1 1 160px', margin: 0 }}>
                    <input type="text" value={portalName} onChange={(e) => setPortalName(e.target.value)} placeholder="Name / relation (e.g. Tyler, son)" />
                  </div>
                  <div className="form-group" style={{ flex: '2 1 220px', margin: 0 }}>
                    <input type="email" value={portalEmail} onChange={(e) => setPortalEmail(e.target.value)} placeholder="their@email.com" />
                  </div>
                  <button type="button" className="hc-btn hc-btn-primary" onClick={handleSendInvite} disabled={portalLoading} style={{ flexShrink: 0 }}>
                    {portalLoading ? 'Sending...' : '✉️ Send Invite'}
                  </button>
                </div>
                <small style={{ color: 'var(--hc-ink-soft)', marginTop: '6px', display: 'block' }}>
                  Each person gets their <b>own</b> login (their email + their password) to this client's portal —
                  add the client and as many relatives as needed, one at a time. Re-sending to an existing email
                  just generates a fresh 48-hour link (use for lost passwords; the old link stops working).
                </small>
              </div>}

              {/* Enable/Disable toggle — shown when portal account exists */}
              {mayPortal.update && (portalStatus === 'active' || portalStatus === 'disabled') && (
                <div style={{ background: 'var(--hc-subtle)', borderRadius: '8px', padding: '16px', marginBottom: '1.5rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--hc-ink)' }}>
                    Portal Access Control
                  </div>
                  {portalStatus === 'active' ? (
                    <button type="button" className="hc-btn hc-btn-danger" onClick={() => handleTogglePortal(false)} disabled={portalLoading}>
                      {portalLoading ? 'Updating...' : '🚫 Disable Portal Access'}
                    </button>
                  ) : (
                    <button type="button" className="hc-btn hc-btn-primary" onClick={() => handleTogglePortal(true)} disabled={portalLoading}>
                      {portalLoading ? 'Updating...' : '✓ Re-enable Portal Access'}
                    </button>
                  )}
                </div>
              )}

              {/* What the client can see */}
              <div style={{ background: 'var(--hc-info-bg)', borderRadius: '8px', padding: '14px 16px', fontSize: '0.85rem', color: 'var(--hc-info-ink)' }}>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>What clients see in their portal:</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {['📅 Upcoming scheduled visits', '🕐 Visit history', '👤 Assigned caregivers', '📄 Invoices & billing', '🔔 Notifications & alerts', '📞 Caregiver contact info'].map((item) => (
                    <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="modal-actions" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--hc-line)', paddingTop: '1rem' }}>
            {may.update && <button type="submit" className="hc-btn hc-btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>}
            <button type="button" className="hc-btn hc-btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            {client.isActive === false ? (
              may.update && <button type="button" className="hc-btn hc-btn-success" onClick={handleReactivate} disabled={loading} style={{ marginLeft: 'auto' }}>
                ♻️ Reactivate Client
              </button>
            ) : !may.delete ? null : !deleteConfirm ? (
              <button type="button" className="hc-btn hc-btn-danger" onClick={handleDelete} disabled={loading} style={{ marginLeft: 'auto' }}>
                Delete Client
              </button>
            ) : (
              <button type="button" className="hc-btn hc-btn-danger" onClick={handleDelete} disabled={loading} style={{ marginLeft: 'auto', background: '#8B0000' }}>
                ⚠️ Confirm Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

/** A row of GET /api/clients/evv-week (server/data/homecareClients.ts evvWeekRows, with the route's allowance figures). */
interface EvvWeek {
  clientId: string
  evvWeeklyUnits: number | null
  weekStart: string
  weekEnd: string
  usedMinutes: number
  sandataVisits: number
  allowanceMinutes: number | null
  remainingMinutes: number | null
  nextVisitToSandata: boolean
}

// EVV (Sandata) units per week — the client's EVV-required allowance from the payer (e.g. MIDAS
// "Attendant care svcs (EVV Required)" in Wisconsin Family Care). Once this Sun–Sat week's Sandata
// minutes reach it, the caregiver app stops sending caregivers to Sandata for this client until
// Sunday (the rest is non-EVV time). Saved on its own (PATCH /api/clients/:id/evv-units), not with
// the main client PUT. Ported from the CVHC CRM.
// Exported: Portal Claim Days opens this same box for a client whose EVV units are blank. `initialUnits` undefined means
// "not known here": the box then takes the units from this week's EVV row.
export const EvvWeeklyUnits = ({ clientId, initialUnits }: { clientId: string; initialUnits?: number | string | null }) => {
  // Saving is care-clients:update, the server's check (lib/useMay.ts).
  const may = useMay('care-clients')
  const [units, setUnits] = useState(initialUnits == null ? '' : String(initialUnits))
  const [week, setWeek] = useState<EvvWeek | null>(null)       // this week's usage, or null if not a Sandata client
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: MessageKind }>({ text: '', type: '' })

  const loadWeek = async (adoptUnits = false) => {
    try {
      const reply = await api.get('/api/clients/evv-week', { clientId })
      const row = rows<EvvWeek>(reply)[0] || null
      setWeek(row)
      if (adoptUnits && row && initialUnits === undefined) setUnits(row.evvWeeklyUnits == null ? '' : String(row.evvWeeklyUnits))
    } catch { /* the usage line is informational */ }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setUnits(initialUnits == null ? '' : String(initialUnits)); loadWeek(true) }, [clientId])

  // The typed string is kept as typed and checked only on save — never clamped while typing.
  const save = async () => {
    setMsg({ text: '', type: '' })
    const typed = units.trim()
    if (typed !== '' && !/^\d+$/.test(typed)) { setMsg({ text: 'EVV units per week must be a whole number from 0 to 672, or blank.', type: 'error' }); return }
    if (typed !== '' && Number(typed) > 672) { setMsg({ text: 'EVV units per week must be a whole number from 0 to 672, or blank.', type: 'error' }); return }
    setSaving(true)
    try {
      await api.patch(`/api/clients/${clientId}/evv-units`, { units: typed === '' ? null : Number(typed) })
      setMsg({ text: 'Saved.', type: 'success' })
      loadWeek()
    } catch (e) {
      setMsg({ text: errorMessage(e, 'Save failed'), type: 'error' })
    } finally { setSaving(false) }
  }

  const fmtH = (min: number) => `${(min / 60).toFixed(2).replace(/\.?0+$/, '')}h`
  const typedOk = /^\d+$/.test(units.trim()) && Number(units.trim()) <= 672
  return (
    <>
      <h4 style={SECTION_HEAD}>EVV (Sandata) Units Per Week</h4>
      <div className="form-group">
        <label>EVV-required units per week (Sun–Sat)</label>
        <div className="flex items-center gap-2">
          <input type="text" inputMode="numeric" value={units}
            onChange={(e) => setUnits(e.target.value)} placeholder="from the payer's authorization, e.g. 12" style={{ flex: 1 }} />
          {may.update && <button type="button" className="hc-btn hc-btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save EVV units'}</button>}
        </div>
        {typedOk && (
          <div className="mt-2 rounded bg-sky-100 p-2 text-sm text-sky-800 dark:bg-sky-950 dark:text-sky-200">
            = <strong>{fmtH(Number(units.trim()) * 15)}</strong> of Sandata visits per week
          </div>
        )}
        {week && (
          <div className={week.nextVisitToSandata
            ? 'mt-2 rounded bg-amber-100 p-2 text-sm text-gray-700 dark:bg-amber-950 dark:text-amber-100'
            : 'mt-2 rounded bg-emerald-50 p-2 text-sm text-gray-700 dark:bg-emerald-950 dark:text-emerald-100'}>
            This week ({week.weekStart} – {week.weekEnd}): <strong>{fmtH(week.usedMinutes)}</strong> sent to Sandata
            {week.allowanceMinutes != null && <> of {fmtH(week.allowanceMinutes)}</>} across {week.sandataVisits} visit{week.sandataVisits === 1 ? '' : 's'}.
            {' '}{week.allowanceMinutes == null
              ? 'No allowance entered — every visit is sent to Sandata.'
              : week.nextVisitToSandata ? 'The next visit goes to Sandata.' : 'EVV hours met — no more Sandata until Sunday.'}
          </div>
        )}
        {msg.text && <div className={msg.type === 'error' ? 'mt-1 text-sm text-red-700 dark:text-red-300' : 'mt-1 text-sm text-emerald-700 dark:text-emerald-300'}>{msg.text}</div>}
        <small style={HINT}>
          From the payer's EVV-required (attendant care) authorization line. Blank = not entered (caregivers are sent to Sandata every visit). 0 = no EVV hours (never sent).
          Only clients whose payer is a Sandata payer and who have a Medicaid ID on file are in Sandata.
        </small>
      </div>
    </>
  )
}

export default EditClientModal
