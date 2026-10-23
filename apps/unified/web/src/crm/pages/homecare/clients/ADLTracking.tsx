// Moved from templates/crm-homecare/frontend/src/components/admin/ADLTracking.tsx — a client's ADL (activities of daily
// living) requirements and the log of what was done, with the office logging on a caregiver's behalf.
// (server/crm/homecare/clients/adl.ts: lists are { data, pagination } in camelCase.)
import { useState, useEffect, type FormEvent } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'
import { toLocalYMD } from '../lib/date'
import { formatAgencyDate, formatAgencyDateTime, agencyLocalInput, agencyFromLocalInput, agencyToday } from '../lib/agencyClock'
import { allRows, type Client, type Caregiver } from './shared'
import { useMay } from '../lib/useMay'

interface Category { id: string; name: string; icon: string }

/** A row of GET /api/adl/client/:clientId/requirements. */
interface Requirement {
  id: string
  adlCategory: string
  assistanceLevel?: string | null
  frequency?: string | null
  specialInstructions?: string | null
}

/** A row of GET /api/adl/client/:clientId/logs. */
interface AdlLog {
  id: string
  adlCategory: string
  status: string
  assistanceLevel?: string | null
  performedAt: string
  notes?: string | null
  caregiverFirst?: string | null
  caregiverLast?: string | null
}

interface RequirementBody { adlCategory: string; assistanceLevel: string; frequency: string; specialInstructions: string }
interface LogBody { adlCategory: string; status: string; assistanceLevel: string; notes: string; performedAt: string; caregiverId: string }

const adlCategories: Category[] = [
  { id: 'bathing', name: 'Bathing', icon: '🛁' },
  { id: 'dressing', name: 'Dressing', icon: '👕' },
  { id: 'grooming', name: 'Grooming', icon: '💇' },
  { id: 'feeding', name: 'Feeding/Eating', icon: '🍽️' },
  { id: 'toileting', name: 'Toileting', icon: '🚽' },
  { id: 'transferring', name: 'Transferring', icon: '🧑‍🦽' },
  { id: 'mobility', name: 'Mobility', icon: '🚶' },
  { id: 'medication', name: 'Medication Reminders', icon: '💊' },
  { id: 'housekeeping', name: 'Light Housekeeping', icon: '🧹' },
  { id: 'laundry', name: 'Laundry', icon: '🧺' },
  { id: 'meal_prep', name: 'Meal Preparation', icon: '👨‍🍳' },
  { id: 'companionship', name: 'Companionship', icon: '💬' },
  { id: 'errands', name: 'Errands/Shopping', icon: '🛒' },
  { id: 'transportation', name: 'Transportation', icon: '🚗' },
]

// Assistance levels and log statuses as chips. The template's were white on bright fills (#4caf50 2.8:1, #ff9800
// 2.2:1, #8bc34a 2.0:1) and dark on yellow; each is now an ink on its own tint, readable in both themes.
const ASSISTANCE_CHIP: Record<string, string> = {
  independent: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  supervision: 'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-200',
  limited_assistance: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
  extensive_assistance: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  total_dependence: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
}
const STATUS_CHIP: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  partial: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  refused: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  not_needed: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200',
}
const GREY_CHIP = 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200'
const chipStyle = { padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold' } as const

const ADLTracking = () => {
  // Each control for whoever the server lets use it: requirements are care-clients, a log entry is evv:create (lib/useMay.ts).
  const may = useMay('care-clients')
  const mayEvv = useMay('evv')
  const toast = useToast()
  const confirm = useConfirm()
  const [clients, setClients] = useState<Client[]>([])
  const [caregivers, setCaregivers] = useState<Caregiver[]>([])
  const [selectedClient, setSelectedClient] = useState('')
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [logs, setLogs] = useState<AdlLog[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('logs')
  const [showAddReqModal, setShowAddReqModal] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [dateRange, setDateRange] = useState({
    start: toLocalYMD(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    end: agencyToday(),
  })

  useEffect(() => {
    loadClients()
    loadCaregivers()
  }, [])

  useEffect(() => {
    if (selectedClient) {
      loadRequirements()
      loadLogs()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient, dateRange])

  const loadClients = async () => {
    try {
      setClients((await allRows<Client>('/api/clients', { isActive: true })).filter((c) => c.isActive !== false))
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load clients'))
    }
  }

  // The office may record an ADL on behalf of the caregiver who performed it.
  const loadCaregivers = async () => {
    try {
      setCaregivers(await allRows<Caregiver>('/api/caregivers'))
    } catch { /* the picker offers "Me" alone */ }
  }

  const loadRequirements = async () => {
    setLoading(true)
    try {
      setRequirements(rows<Requirement>(await api.get(`/api/adl/client/${selectedClient}/requirements`)))
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load requirements'))
    } finally {
      setLoading(false)
    }
  }

  const loadLogs = async () => {
    try {
      setLogs(rows<AdlLog>(await api.get(`/api/adl/client/${selectedClient}/logs`, { startDate: dateRange.start, endDate: dateRange.end })))
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load logs'))
    }
  }

  const saveRequirement = async (formData: RequirementBody) => {
    try {
      await api.post('/api/adl/requirements', { ...formData, clientId: selectedClient })
      setShowAddReqModal(false)
      loadRequirements()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const logADL = async (formData: LogBody) => {
    try {
      await api.post('/api/adl/log', { ...formData, clientId: selectedClient })
      setShowLogModal(false)
      loadLogs()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const deleteRequirement = async (reqId: string) => {
    if (!(await confirm('Remove this ADL requirement?', { danger: true }))) return
    try {
      await api.delete(`/api/adl/requirements/${reqId}`)
      loadRequirements()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const getAssistanceBadge = (level?: string | null) => (
    <span className={ASSISTANCE_CHIP[level || ''] || GREY_CHIP} style={chipStyle}>
      {level?.replace(/_/g, ' ').toUpperCase()}
    </span>
  )

  const getStatusBadge = (status?: string | null) => (
    <span className={STATUS_CHIP[status || ''] || GREY_CHIP} style={chipStyle}>
      {status?.replace(/_/g, ' ').toUpperCase()}
    </span>
  )

  const getCategoryIcon = (categoryId: string) => adlCategories.find((c) => c.id === categoryId)?.icon || '📋'
  const getCategoryName = (categoryId: string) => adlCategories.find((c) => c.id === categoryId)?.name || categoryId

  // Group logs by the agency's calendar day of the moment each was performed.
  const logsByDate = logs.reduce<Record<string, AdlLog[]>>((acc, log) => {
    const date = formatAgencyDate(log.performedAt, { year: 'numeric', month: 'numeric', day: 'numeric' })
    if (!acc[date]) acc[date] = []
    acc[date].push(log)
    return acc
  }, {})

  return (
    <div>
      <div className="page-header">
        <h2>🏠 ADL Tracking</h2>
      </div>

      {/* Client Selector */}
      <div className="hc-card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, minWidth: '250px' }}>
            <label>Select Client</label>
            <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
              <option value="">-- Select a Client --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </select>
          </div>
          {selectedClient && (
            <>
              <div className="form-group" style={{ margin: 0 }}>
                <label>From</label>
                <input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>To</label>
                <input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} />
              </div>
            </>
          )}
        </div>
      </div>

      {!selectedClient ? (
        <div className="hc-card">
          <p style={{ color: 'var(--hc-muted)' }}>Select a client to view their ADL requirements and logs.</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button className={`hc-btn ${activeTab === 'logs' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('logs')}>
              Daily Logs ({logs.length})
            </button>
            <button className={`hc-btn ${activeTab === 'requirements' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('requirements')}>
              Care Requirements ({requirements.length})
            </button>
            <div style={{ marginLeft: 'auto' }}>
              {mayEvv.create && activeTab === 'logs' && (
                <button className="hc-btn hc-btn-primary" onClick={() => setShowLogModal(true)}>
                  + Log ADL
                </button>
              )}
              {may.create && activeTab === 'requirements' && (
                <button className="hc-btn hc-btn-primary" onClick={() => setShowAddReqModal(true)}>
                  + Add Requirement
                </button>
              )}
            </div>
          </div>

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <div className="hc-card">
              {loading ? (
                <div className="loading"><div className="spinner"></div></div>
              ) : logs.length === 0 ? (
                <p>No ADL logs for this date range.</p>
              ) : (
                Object.entries(logsByDate).map(([date, dateLogs]) => (
                  <div key={date} style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ borderBottom: '1px solid var(--hc-line)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                      {date}
                    </h4>
                    <table className="hc-table">
                      <thead>
                        <tr>
                          <th style={{ width: '40px' }}></th>
                          <th>Activity</th>
                          <th>Status</th>
                          <th>Assistance</th>
                          <th>Time</th>
                          <th>Caregiver</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dateLogs.map((log) => (
                          <tr key={log.id}>
                            <td style={{ fontSize: '1.3rem' }}>{getCategoryIcon(log.adlCategory)}</td>
                            <td><strong>{getCategoryName(log.adlCategory)}</strong></td>
                            <td>{getStatusBadge(log.status)}</td>
                            <td>{getAssistanceBadge(log.assistanceLevel)}</td>
                            <td>{formatAgencyDateTime(log.performedAt, { hour: '2-digit', minute: '2-digit' })}</td>
                            <td>{log.caregiverFirst} {log.caregiverLast}</td>
                            <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {log.notes || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Requirements Tab */}
          {activeTab === 'requirements' && (
            <div className="hc-card">
              {loading ? (
                <div className="loading"><div className="spinner"></div></div>
              ) : requirements.length === 0 ? (
                <p>No ADL requirements set for this client. Add requirements to define their care needs.</p>
              ) : (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                  {requirements.map((req) => (
                    <div key={req.id} style={{ border: '1px solid var(--hc-line)', borderRadius: '8px', padding: '1rem', backgroundColor: 'var(--hc-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '1.5rem' }}>{getCategoryIcon(req.adlCategory)}</span>
                          <strong>{getCategoryName(req.adlCategory)}</strong>
                        </div>
                        {may.delete && <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => deleteRequirement(req.id)}>
                          ×
                        </button>}
                      </div>
                      <div style={{ marginTop: '0.5rem' }}>
                        {getAssistanceBadge(req.assistanceLevel)}
                      </div>
                      <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                        <strong>Frequency:</strong> {req.frequency || 'As needed'}
                      </div>
                      {req.specialInstructions && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--hc-ink-soft)' }}>
                          {req.specialInstructions}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Add Requirement Modal */}
      {showAddReqModal && (
        <div className="modal active" onClick={() => setShowAddReqModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add ADL Requirement</h3>
              <button className="modal-close" onClick={() => setShowAddReqModal(false)}>×</button>
            </div>
            <RequirementForm
              categories={adlCategories}
              existingCategories={requirements.map((r) => r.adlCategory)}
              onSubmit={saveRequirement}
              onCancel={() => setShowAddReqModal(false)}
            />
          </div>
        </div>
      )}

      {/* Log ADL Modal */}
      {showLogModal && (
        <div className="modal active" onClick={() => setShowLogModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Log ADL Activity</h3>
              <button className="modal-close" onClick={() => setShowLogModal(false)}>×</button>
            </div>
            <LogADLForm
              categories={adlCategories}
              requirements={requirements}
              caregivers={caregivers}
              onSubmit={logADL}
              onCancel={() => setShowLogModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Requirement Form Component
const RequirementForm = ({ categories, existingCategories, onSubmit, onCancel }: {
  categories: Category[]; existingCategories: string[]; onSubmit: (b: RequirementBody) => void; onCancel: () => void
}) => {
  const toast = useToast()
  const [formData, setFormData] = useState<RequirementBody>({
    adlCategory: '',
    assistanceLevel: 'limited_assistance',
    frequency: '',
    specialInstructions: '',
  })

  const availableCategories = categories.filter((c) => !existingCategories.includes(c.id))

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!formData.adlCategory) {
      toast.warning('Please select an ADL category')
      return
    }
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>ADL Category *</label>
        <select value={formData.adlCategory} onChange={(e) => setFormData({ ...formData, adlCategory: e.target.value })} required>
          <option value="">Select Category</option>
          {availableCategories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Assistance Level *</label>
        <select value={formData.assistanceLevel} onChange={(e) => setFormData({ ...formData, assistanceLevel: e.target.value })}>
          <option value="independent">Independent - No help needed</option>
          <option value="supervision">Supervision - Standby/cueing only</option>
          <option value="limited_assistance">Limited Assistance - Some hands-on help</option>
          <option value="extensive_assistance">Extensive Assistance - Significant help needed</option>
          <option value="total_dependence">Total Dependence - Full assistance required</option>
        </select>
      </div>

      <div className="form-group">
        <label>Frequency</label>
        <input type="text" value={formData.frequency} onChange={(e) => setFormData({ ...formData, frequency: e.target.value })} placeholder="e.g., Daily, Twice daily, As needed" />
      </div>

      <div className="form-group">
        <label>Special Instructions</label>
        <textarea value={formData.specialInstructions} onChange={(e) => setFormData({ ...formData, specialInstructions: e.target.value })} placeholder="Any specific instructions for caregivers..." />
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Add Requirement</button>
      </div>
    </form>
  )
}

// Log ADL Form Component
const LogADLForm = ({ categories, requirements, caregivers, onSubmit, onCancel }: {
  categories: Category[]; requirements: Requirement[]; caregivers: Caregiver[]; onSubmit: (b: LogBody) => void; onCancel: () => void
}) => {
  const toast = useToast()
  // The datetime-local box is the AGENCY's wall clock (YYYY-MM-DDTHH:MM), defaulting to now there — not the browser's.
  const nowLocal = () => agencyLocalInput(new Date())
  const [formData, setFormData] = useState<LogBody>({
    adlCategory: '',
    status: 'completed',
    assistanceLevel: 'limited_assistance',
    notes: '',
    performedAt: nowLocal(),
    caregiverId: '',
  })

  // Use requirements to pre-fill assistance level when category is selected
  const handleCategoryChange = (categoryId: string) => {
    const req = requirements.find((r) => r.adlCategory === categoryId)
    setFormData({
      ...formData,
      adlCategory: categoryId,
      assistanceLevel: req?.assistanceLevel || 'limited_assistance',
    })
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!formData.adlCategory) {
      toast.warning('Please select an ADL category')
      return
    }
    const when = agencyFromLocalInput(formData.performedAt)
    if (!formData.performedAt || isNaN(when.getTime())) {
      toast.warning('Please enter the date and time this activity was performed')
      return
    }
    onSubmit({ ...formData, performedAt: when.toISOString() })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Date &amp; Time Performed *</label>
        <input type="datetime-local" value={formData.performedAt} onChange={(e) => setFormData({ ...formData, performedAt: e.target.value })} required />
      </div>

      <div className="form-group">
        <label>Performed By</label>
        <select value={formData.caregiverId} onChange={(e) => setFormData({ ...formData, caregiverId: e.target.value })}>
          <option value="">Me (log as myself)</option>
          {(caregivers || []).map((cg) => (
            <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>ADL Activity *</label>
        <select value={formData.adlCategory} onChange={(e) => handleCategoryChange(e.target.value)} required>
          <option value="">Select Activity</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Status *</label>
          <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
            <option value="completed">Completed</option>
            <option value="partial">Partial</option>
            <option value="refused">Refused</option>
            <option value="not_needed">Not Needed</option>
          </select>
        </div>

        <div className="form-group">
          <label>Assistance Level</label>
          <select value={formData.assistanceLevel} onChange={(e) => setFormData({ ...formData, assistanceLevel: e.target.value })}>
            <option value="independent">Independent</option>
            <option value="supervision">Supervision</option>
            <option value="limited_assistance">Limited Assistance</option>
            <option value="extensive_assistance">Extensive Assistance</option>
            <option value="total_dependence">Total Dependence</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Any observations or notes..." />
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Log Activity</button>
      </div>
    </form>
  )
}

export default ADLTracking
