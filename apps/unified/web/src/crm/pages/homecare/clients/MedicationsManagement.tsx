// Moved from templates/crm-homecare/frontend/src/components/admin/MedicationsManagement.tsx — a client's medications,
// the administration record (MAR) and vitals. (server/crm/homecare/clients/medications.ts: rows are camelCase; a
// medication carries medicationName / prescriber / isActive beside the table's name / prescribedBy / status.)
import { useState, useEffect, type FormEvent } from 'react'
import { useAuth, useConfirm, useToast } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'
import { formatDate, toLocalYMD } from '../lib/date'
import { formatDateTime } from '../lib/datetime'
import { agencyTodayDate } from '../lib/agencyClock'
import VitalsTracker from './VitalsTracker'
import { allRows, type Client } from './shared'
import { useMay } from '../lib/useMay'

/** A medication of GET /api/medications/client/:clientId. */
interface Medication {
  id: string
  medicationName: string
  dosage?: string | null
  frequency?: string | null
  route?: string | null
  prescriber?: string | null
  pharmacy?: string | null
  rxNumber?: string | null
  startDate?: string | null
  endDate?: string | null
  instructions?: string | null
  sideEffects?: string | null
  isPrn?: boolean | null
  isActive: boolean
}

/** A row of GET /api/medications/logs/client/:clientId. */
interface MedLog {
  id: string
  administeredTime: string
  /** When the entry reached the server (the row's created_at). */
  createdAt?: string | null
  medicationName: string
  dosage?: string | null
  dosageGiven?: string | null
  status?: string | null
  effectiveStatus?: string | null
  caregiverFirst?: string | null
  caregiverLast?: string | null
  witnessedBy?: string | null
  notes?: string | null
}

interface MedForm {
  medicationName: string
  dosage: string
  frequency: string
  route: string
  prescriber: string
  pharmacy: string
  rxNumber: string
  startDate: string
  endDate: string
  instructions: string
  sideEffects: string
  isPrn: boolean
  isActive: boolean
}

interface LogFormData { medicationId: string; status: string; dosageGiven: string; notes: string; witnessedBy: string }

// The template's white-on-bright chips (#4caf50 2.8:1, #ff9800 2.2:1) as ink on its own tint, in both themes.
const LOG_STATUS_CHIP: Record<string, string> = {
  administered: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  given: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  self_administered: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
  refused: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  missed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  held: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200',
}
const GREY_CHIP = 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200'
const chipStyle = { padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' } as const

const MedicationsManagement = () => {
  // Each control for whoever the server lets use it: the list is care-clients, a log entry is evv:create (lib/useMay.ts).
  const may = useMay('care-clients')
  const mayEvv = useMay('evv')
  const toast = useToast()
  // Item 4 (care_offline_saves): an entry that reached us long after it was given says so (it was saved on a phone without signal).
  const showLate = useAuth().hasFeature('care_offline_saves')
  const confirm = useConfirm()
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState('')
  const [medications, setMedications] = useState<Medication[]>([])
  const [logs, setLogs] = useState<MedLog[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('medications')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [editingMed, setEditingMed] = useState<Medication | null>(null)

  useEffect(() => {
    loadClients()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedClient) {
      loadMedications()
      loadLogs()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient])

  const loadClients = async () => {
    try {
      setClients((await allRows<Client>('/api/clients', { isActive: true })).filter((c) => c.isActive !== false))
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load clients'))
    }
  }

  const loadMedications = async () => {
    setLoading(true)
    try {
      setMedications(rows<Medication>(await api.get(`/api/medications/client/${selectedClient}`)))
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load medications'))
    } finally {
      setLoading(false)
    }
  }

  const getDateRange = () => {
    const end = agencyTodayDate() // the agency's today
    const start = agencyTodayDate()
    start.setDate(start.getDate() - 30)
    return { start: toLocalYMD(start), end: toLocalYMD(end) }
  }

  const loadLogs = async () => {
    try {
      const range = getDateRange()
      setLogs(rows<MedLog>(await api.get(`/api/medications/logs/client/${selectedClient}`, { startDate: range.start, endDate: range.end })))
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load logs'))
    }
  }

  const saveMedication = async (formData: MedForm) => {
    try {
      const body = { ...formData, clientId: selectedClient }
      if (editingMed) await api.put(`/api/medications/${editingMed.id}`, body)
      else await api.post('/api/medications', body)
      setShowAddModal(false)
      setEditingMed(null)
      loadMedications()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const discontinueMedication = async (medId: string) => {
    if (!(await confirm('Discontinue this medication?', { danger: true }))) return
    try {
      await api.put(`/api/medications/${medId}/discontinue`)
      loadMedications()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const logAdministration = async (formData: LogFormData & { administeredTime: string }) => {
    try {
      await api.post('/api/medications/log', { ...formData, clientId: selectedClient })
      setShowLogModal(false)
      loadLogs()
    } catch (error) {
      toast.error('Not saved: ' + errorMessage(error))
    }
  }

  const getStatusBadge = (isActive: boolean) => (
    <span className={isActive ? LOG_STATUS_CHIP.given : GREY_CHIP} style={chipStyle}>
      {isActive ? 'ACTIVE' : 'DISCONTINUED'}
    </span>
  )

  const getLogStatusBadge = (status?: string | null) => (
    <span className={LOG_STATUS_CHIP[status || ''] || GREY_CHIP} style={chipStyle}>
      {status?.toUpperCase()}
    </span>
  )

  const activeMeds = medications.filter((m) => m.isActive)
  const inactiveMeds = medications.filter((m) => !m.isActive)

  return (
    <div>
      <div className="page-header">
        <h2>💊 Medication reminders</h2>
      </div>

      {/* Client Selector */}
      <div className="hc-card" style={{ marginBottom: '1rem' }}>
        <div className="form-group" style={{ margin: 0, maxWidth: '400px' }}>
          <label>Select Client</label>
          <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
            <option value="">-- Select a Client --</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
            ))}
          </select>
        </div>
      </div>

      {!selectedClient ? (
        <div className="hc-card">
          <p style={{ color: 'var(--hc-muted)' }}>Select a client to view their medications.</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button className={`hc-btn ${activeTab === 'medications' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('medications')}>
              Medications ({activeMeds.length})
            </button>
            <button className={`hc-btn ${activeTab === 'logs' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('logs')}>
              Administration Log ({logs.length})
            </button>
            <button className={`hc-btn ${activeTab === 'vitals' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('vitals')}>
              📋 Vitals
            </button>
            <div style={{ marginLeft: 'auto' }}>
              {may.create && activeTab === 'medications' && (
                <button className="hc-btn hc-btn-primary" onClick={() => { setEditingMed(null); setShowAddModal(true) }}>
                  + Add Medication
                </button>
              )}
              {mayEvv.create && activeTab === 'logs' && (
                <button className="hc-btn hc-btn-primary" onClick={() => setShowLogModal(true)}>
                  + Log Administration
                </button>
              )}
            </div>
          </div>

          {/* Vitals Tab */}
          {activeTab === 'vitals' && (
            <VitalsTracker clientId={selectedClient} />
          )}

          {/* Medications Tab */}
          {activeTab === 'medications' && (
            <div className="hc-card">
              {loading ? (
                <div className="loading"><div className="spinner"></div></div>
              ) : activeMeds.length === 0 && inactiveMeds.length === 0 ? (
                <p>No medications recorded for this client.</p>
              ) : (
                <>
                  {activeMeds.length > 0 && (
                    <>
                      <h4 style={{ marginBottom: '1rem' }}>Active Medications</h4>
                      <table className="hc-table">
                        <thead>
                          <tr>
                            <th>Medication</th>
                            <th>Dosage</th>
                            <th>Frequency</th>
                            <th>Route</th>
                            <th>Prescriber</th>
                            <th>PRN</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeMeds.map((med) => (
                            <tr key={med.id}>
                              <td>
                                <strong>{med.medicationName}</strong>
                                {med.instructions && (
                                  <div style={{ fontSize: '0.8rem', color: 'var(--hc-muted)' }}>{med.instructions}</div>
                                )}
                              </td>
                              <td>{med.dosage || '-'}</td>
                              <td>{med.frequency || '-'}</td>
                              <td>{med.route || '-'}</td>
                              <td>{med.prescriber || '-'}</td>
                              <td>{med.isPrn ? '✓ Yes' : 'No'}</td>
                              <td>
                                <div style={{ display: 'flex', gap: '0.25rem' }}>
                                  {may.update && <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => { setEditingMed(med); setShowAddModal(true) }}>
                                    Edit
                                  </button>}
                                  {may.update && <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => discontinueMedication(med.id)}>
                                    D/C
                                  </button>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  {inactiveMeds.length > 0 && (
                    <>
                      <h4 style={{ marginTop: '2rem', marginBottom: '1rem', color: 'var(--hc-muted)' }}>Discontinued Medications</h4>
                      <table className="hc-table">
                        <thead>
                          <tr>
                            <th>Medication</th>
                            <th>Dosage</th>
                            <th>End Date</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inactiveMeds.map((med) => (
                            <tr key={med.id} style={{ opacity: 0.6 }}>
                              <td>{med.medicationName}</td>
                              <td>{med.dosage || '-'}</td>
                              <td>{med.endDate ? formatDate(med.endDate) : '-'}</td>
                              <td>{getStatusBadge(false)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <div className="hc-card">
              {logs.length === 0 ? (
                <p>No administration logs for the past 30 days.</p>
              ) : (
                <table className="hc-table">
                  <thead>
                    <tr>
                      <th>Date/Time</th>
                      <th>Medication</th>
                      <th>Dosage</th>
                      <th>Status</th>
                      <th>Caregiver</th>
                      <th>Witnessed</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td>{formatDateTime(log.administeredTime)}{showLate && log.createdAt && Date.parse(log.createdAt) - Date.parse(log.administeredTime) > 15 * 60_000 && (
                          <div className="text-xs text-gray-500 dark:text-slate-400">Saved on the phone, sent {formatDateTime(log.createdAt)}</div>
                        )}</td>
                        <td><strong>{log.medicationName}</strong></td>
                        <td>{log.dosageGiven || log.dosage || '-'}</td>
                        <td>{getLogStatusBadge(log.effectiveStatus || log.status)}</td>
                        <td>{log.caregiverFirst || ''} {log.caregiverLast || ''}</td>
                        <td>{log.witnessedBy || <span className="text-gray-500 dark:text-slate-400">—</span>}</td>
                        <td>{log.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {/* Add/Edit Medication Modal */}
      {showAddModal && (
        <div className="modal active" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>{editingMed ? 'Edit Medication' : 'Add Medication'}</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <MedicationForm medication={editingMed} onSubmit={saveMedication} onCancel={() => setShowAddModal(false)} />
          </div>
        </div>
      )}

      {/* Log Administration Modal */}
      {showLogModal && (
        <div className="modal active" onClick={() => setShowLogModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Log Medication Administration</h3>
              <button className="modal-close" onClick={() => setShowLogModal(false)}>×</button>
            </div>
            <LogForm medications={activeMeds} onSubmit={logAdministration} onCancel={() => setShowLogModal(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

// Medication Form Component
const MedicationForm = ({ medication, onSubmit, onCancel }: { medication: Medication | null; onSubmit: (f: MedForm) => void; onCancel: () => void }) => {
  const toast = useToast()
  const [formData, setFormData] = useState<MedForm>({
    medicationName: medication?.medicationName || '',
    dosage: medication?.dosage || '',
    frequency: medication?.frequency || '',
    route: medication?.route || 'oral',
    prescriber: medication?.prescriber || '',
    pharmacy: medication?.pharmacy || '',
    rxNumber: medication?.rxNumber || '',
    startDate: medication?.startDate?.split('T')[0] || '',
    endDate: medication?.endDate?.split('T')[0] || '',
    instructions: medication?.instructions || '',
    sideEffects: medication?.sideEffects || '',
    isPrn: !!medication?.isPrn,
    isActive: medication?.isActive ?? true,
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!formData.medicationName) {
      toast.warning('Medication name is required')
      return
    }
    onSubmit(formData)
  }

  const set = <K extends keyof MedForm>(key: K, value: MedForm[K]) => setFormData({ ...formData, [key]: value })

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Medication Name *</label>
        <input type="text" value={formData.medicationName} onChange={(e) => set('medicationName', e.target.value)} placeholder="e.g., Metformin" required />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Dosage</label>
          <input type="text" value={formData.dosage} onChange={(e) => set('dosage', e.target.value)} placeholder="e.g., 500mg" />
        </div>
        <div className="form-group">
          <label>Frequency</label>
          <input type="text" value={formData.frequency} onChange={(e) => set('frequency', e.target.value)} placeholder="e.g., Twice daily" />
        </div>
        <div className="form-group">
          <label>Route</label>
          <select value={formData.route} onChange={(e) => set('route', e.target.value)}>
            <option value="oral">Oral</option>
            <option value="topical">Topical</option>
            <option value="injection">Injection</option>
            <option value="inhaled">Inhaled</option>
            <option value="sublingual">Sublingual</option>
            <option value="rectal">Rectal</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Prescriber</label>
          <input type="text" value={formData.prescriber} onChange={(e) => set('prescriber', e.target.value)} placeholder="Dr. Smith" />
        </div>
        <div className="form-group">
          <label>Pharmacy</label>
          <input type="text" value={formData.pharmacy} onChange={(e) => set('pharmacy', e.target.value)} placeholder="Walgreens" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>RX Number</label>
          <input type="text" value={formData.rxNumber} onChange={(e) => set('rxNumber', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Start Date</label>
          <input type="date" value={formData.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </div>
        <div className="form-group">
          <label>End Date</label>
          <input type="date" value={formData.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label>Instructions</label>
        <textarea value={formData.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="Take with food..." />
      </div>

      <div className="form-group">
        <label>Side Effects</label>
        <textarea value={formData.sideEffects} onChange={(e) => set('sideEffects', e.target.value)} placeholder="May cause drowsiness..." />
      </div>

      <div className="form-group">
        <label>
          <input type="checkbox" checked={formData.isPrn} onChange={(e) => set('isPrn', e.target.checked)} style={{ marginRight: '0.5rem' }} />
          PRN (As Needed)
        </label>
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Save Medication</button>
      </div>
    </form>
  )
}

// Log Administration Form
const LogForm = ({ medications, onSubmit, onCancel }: {
  medications: Medication[]; onSubmit: (f: LogFormData & { administeredTime: string }) => void; onCancel: () => void
}) => {
  const toast = useToast()
  // Status uses the MAR list exactly, so the server records it as given and as effective status.
  const [formData, setFormData] = useState<LogFormData>({
    medicationId: '',
    status: 'given',
    dosageGiven: '',
    notes: '',
    witnessedBy: '',
  })

  const selectedMed = medications.find((m) => m.id === formData.medicationId)
  // No controlled-substance flag on a medication, so suggest a witness on the common names.
  const looksControlled = selectedMed && /(oxy|hydroco|fentanyl|morphine|methadone|adderall|ritalin|xanax|valium|ativan|klonopin|tramadol|codeine|lorazepam|alprazolam|clonazepam)/i.test(selectedMed.medicationName || '')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!formData.medicationId) {
      toast.warning('Select a medication')
      return
    }
    onSubmit({ ...formData, administeredTime: new Date().toISOString() })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Medication *</label>
        <select value={formData.medicationId} onChange={(e) => setFormData({ ...formData, medicationId: e.target.value })} required>
          <option value="">Select Medication</option>
          {medications.map((med) => (
            <option key={med.id} value={med.id}>
              {med.medicationName} - {med.dosage}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Status *</label>
          <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
            <option value="given">Given</option>
            <option value="refused">Refused by client</option>
            <option value="missed">Missed dose</option>
            <option value="held">Held (per RN / parameters)</option>
            <option value="self_administered">Self-administered (witnessed)</option>
          </select>
        </div>
        <div className="form-group">
          <label>Dosage Given</label>
          <input type="text" value={formData.dosageGiven} onChange={(e) => setFormData({ ...formData, dosageGiven: e.target.value })} placeholder={selectedMed?.dosage || 'e.g., 500mg'} />
        </div>
      </div>

      {/* Witness: suggested for likely-controlled substances, always available for agencies that
          require it for everything. */}
      <div className="form-group">
        <label>
          Witnessed by {looksControlled && <span className="font-bold text-red-700 dark:text-red-400">★ controlled — recommended</span>}
        </label>
        <input type="text" value={formData.witnessedBy} onChange={(e) => setFormData({ ...formData, witnessedBy: e.target.value })} placeholder="Name of person who witnessed administration" />
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder={
            formData.status === 'refused' ? 'Why did client refuse?'
            : formData.status === 'held' ? 'Reason for holding (e.g., BP < 110/70 per parameters)'
            : formData.status === 'missed' ? 'Why was dose missed?'
            : 'Any observations…'
          }
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Log Administration</button>
      </div>
    </form>
  )
}

export default MedicationsManagement
