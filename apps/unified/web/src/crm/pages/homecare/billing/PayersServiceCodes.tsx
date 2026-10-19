// Payers & Service Codes: the agency's payers (referral_sources rows with a payer type) and its billing codes, in two
// tabs. Moved from templates/crm-homecare/frontend/src/components/admin/PayersServiceCodes.tsx.
//
// Server: /api/payers (server/crm/homecare/billing/payers.ts: GET a list of drizzle rows, POST/PUT the record; only
// PAYER_FIELDS are written), /api/service-codes (server/crm/homecare/clients/serviceCodes.ts: GET a list, POST/PUT the
// record; only code, modifier1/2, description, serviceCategory, payerType, unitType, ratePerUnit, requiresEvv,
// isActive, revenueCode, requiresAuth and notes are written) and /api/sandata/payer-presets (server/crm/homecare/visits/sandata.ts: { state, presets }).
import { useEffect, useState, type FormEvent } from 'react'
import { useToast } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'

// The payer's billing classification (referral_sources.payer_type). Claims, EVV, the punch rules and the
// reports read it; the values match server/crm/homecare/billing/payers.ts PAYER_TYPES and payerRouter.PAYER_ROUTES.
const PAYER_TYPE_OPTIONS = [
  { value: 'MCO', label: 'Family Care MCO' },
  { value: 'IRIS', label: 'IRIS (self-directed)' },
  { value: 'medicaid', label: 'Medicaid fee-for-service' },
  { value: 'HMO', label: 'Medicaid HMO' },
  { value: 'medicare', label: 'Medicare' },
  { value: 'va', label: 'Veterans Affairs (VA)' },
  { value: 'managed_care', label: 'Commercial insurance' },
  { value: 'private_pay', label: 'Private pay' },
  { value: 'other', label: 'Other' },
]
const LEGACY_TYPE_LABELS: Record<string, string> = { mco_family_care: 'Family Care MCO', FFS: 'Medicaid fee-for-service' }
const payerTypeLabel = (v: string | null | undefined) =>
  PAYER_TYPE_OPTIONS.find((o) => o.value === v)?.label || (v ? LEGACY_TYPE_LABELS[v] : undefined) || v || '—'
// A Sandata preset's program decides the payer type: WIMCO is a Family Care MCO, WIHMO an HMO, FFS fee-for-service.
const TYPE_FOR_PROGRAM: Record<string, string> = { WIMCO: 'MCO', WIHMO: 'HMO', FFS: 'medicaid' }

interface Payer {
  id: string; name: string; payerType: string | null; contactName: string | null; email: string | null; phone: string | null
  address: string | null; city: string | null; state: string | null; zip: string | null; payerIdNumber: string | null
  isActivePayer: boolean | null; notes: string | null
  sandataEvvRequired: boolean | null; sandataPayerId: string | null; sandataPayerProgram: string | null
}
interface ServiceCode {
  id: string; code: string; description: string | null; ratePerUnit: string | number | null; unitType: string | null
  // Stored since migration 0011 (the template's server never kept them).
  revenueCode?: string | null; requiresAuth?: boolean | null; notes?: string | null
}
interface SandataPreset { label: string; sandataPayerId: string; sandataPayerProgram: string }

const EMPTY_PAYER = {
  // No default type: a wrong one silently changes how claims and EVV treat the payer, so the form makes you choose.
  name: '', payerType: '', contactName: '', email: '', phone: '',
  address: '', city: '', state: '', zip: '', payerIdNumber: '', isActivePayer: true, notes: '',
  sandataEvvRequired: false, sandataPayerId: '', sandataPayerProgram: '',
}
type PayerForm = typeof EMPTY_PAYER
const EMPTY_CODE = { code: '', description: '', ratePerUnit: '', unitType: 'hour', revenueCode: '', requiresAuth: false, notes: '' }
type CodeForm = typeof EMPTY_CODE

// Grounds dark enough for white text (≥ 4.5:1) in either theme.
const TYPE_COLOURS: Record<string, string> = {
  MCO: '#6a1b9a', mco_family_care: '#6a1b9a', IRIS: '#4527a0', medicaid: '#7b1fa2', FFS: '#7b1fa2', HMO: '#283593',
  medicare: '#2e7d32', va: '#1565c0', managed_care: '#1565c0', private_pay: '#b45309', other: '#616161',
}
const pill = (bg: string) => ({ padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' as const, color: 'white', backgroundColor: bg })

const PayersServiceCodes = () => {
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<'payers' | 'service-codes'>('payers')
  const [payers, setPayers] = useState<Payer[]>([])
  const [serviceCodes, setServiceCodes] = useState<ServiceCode[]>([])
  const [loading, setLoading] = useState(true)
  const [showPayerModal, setShowPayerModal] = useState(false)
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [editingPayer, setEditingPayer] = useState<Payer | null>(null)
  const [editingCode, setEditingCode] = useState<ServiceCode | null>(null)

  const [payerForm, setPayerForm] = useState<PayerForm>(EMPTY_PAYER)
  // Sandata payer-code presets — offered only to an agency in a state that has them (Wisconsin).
  const [sandataPresets, setSandataPresets] = useState<SandataPreset[]>([])

  const [codeForm, setCodeForm] = useState<CodeForm>(EMPTY_CODE)

  useEffect(() => {
    loadPayers()
    loadServiceCodes()
    api.get('/api/sandata/payer-presets')
      .then((d: { presets?: SandataPreset[] } | null) => setSandataPresets(Array.isArray(d?.presets) ? d!.presets! : []))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPayers = async () => {
    try {
      setPayers(rows<Payer>(await api.get('/api/payers')))
    } catch (error) {
      console.error('Failed to load payers:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadServiceCodes = async () => {
    try {
      setServiceCodes(rows<ServiceCode>(await api.get('/api/service-codes')))
    } catch (error) {
      console.error('Failed to load service codes:', error)
    }
  }

  const savePayer = async (e: FormEvent) => {
    e.preventDefault()
    try {
      if (editingPayer) await api.put(`/api/payers/${editingPayer.id}`, payerForm)
      else await api.post('/api/payers', payerForm)
      toast.success(editingPayer ? 'Payer updated' : 'Payer created')
      setShowPayerModal(false)
      setEditingPayer(null)
      resetPayerForm()
      loadPayers()
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to save payer'))
    }
  }

  const saveServiceCode = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const payload = { ...codeForm, ratePerUnit: codeForm.ratePerUnit ? parseFloat(codeForm.ratePerUnit) : null }
      if (editingCode) await api.put(`/api/service-codes/${editingCode.id}`, payload)
      else await api.post('/api/service-codes', payload)
      toast.success(editingCode ? 'Service code updated' : 'Service code created')
      setShowCodeModal(false)
      setEditingCode(null)
      resetCodeForm()
      loadServiceCodes()
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to save service code'))
    }
  }

  const resetPayerForm = () => setPayerForm(EMPTY_PAYER)
  const resetCodeForm = () => setCodeForm(EMPTY_CODE)

  const openEditPayer = (payer: Payer) => {
    setEditingPayer(payer)
    setPayerForm({
      name: payer.name || '', payerType: payer.payerType || '',
      contactName: payer.contactName || '', email: payer.email || '',
      phone: payer.phone || '', address: payer.address || '',
      city: payer.city || '', state: payer.state || '', zip: payer.zip || '',
      payerIdNumber: payer.payerIdNumber || '', isActivePayer: payer.isActivePayer ?? true,
      notes: payer.notes || '',
      sandataEvvRequired: payer.sandataEvvRequired === true,
      sandataPayerId: payer.sandataPayerId || '', sandataPayerProgram: payer.sandataPayerProgram || '',
    })
    setShowPayerModal(true)
  }

  const openEditCode = (code: ServiceCode) => {
    setEditingCode(code)
    setCodeForm({
      code: code.code || '', description: code.description || '',
      ratePerUnit: code.ratePerUnit?.toString() || '', unitType: code.unitType || 'hour',
      revenueCode: code.revenueCode || '', requiresAuth: code.requiresAuth ?? false,
      notes: code.notes || '',
    })
    setShowCodeModal(true)
  }

  const getTypeBadge = (type: string | null) => (
    <span style={pill((type && TYPE_COLOURS[type]) || '#616161')}>{payerTypeLabel(type)}</span>
  )

  if (loading) return <div className="loading"><div className="spinner"></div></div>

  return (
    <div>
      <div className="page-header">
        <h2>🏦 Payers & Service Codes</h2>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button className={`hc-btn ${activeTab === 'payers' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('payers')}>
          Payers ({payers.length})
        </button>
        <button className={`hc-btn ${activeTab === 'service-codes' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('service-codes')}>
          Service Codes ({serviceCodes.length})
        </button>
      </div>

      {/* PAYERS TAB */}
      {activeTab === 'payers' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button className="hc-btn hc-btn-primary" onClick={() => { resetPayerForm(); setEditingPayer(null); setShowPayerModal(true) }}>
              + Add Payer
            </button>
          </div>

          <div className="hc-card" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Payer ID</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Active Payer</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payers.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)' }}>No payers found</td></tr>
                ) : payers.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>{getTypeBadge(p.payerType)}</td>
                    <td>{p.payerIdNumber || '—'}</td>
                    <td>{p.contactName || '—'}</td>
                    <td>{p.phone || '—'}</td>
                    <td>
                      <span style={pill(p.isActivePayer ? '#2e7d32' : '#616161')}>{p.isActivePayer ? 'YES' : 'NO'}</span>
                    </td>
                    <td>
                      <button className="hc-btn hc-btn-sm" onClick={() => openEditPayer(p)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SERVICE CODES TAB */}
      {activeTab === 'service-codes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button className="hc-btn hc-btn-primary" onClick={() => { resetCodeForm(); setEditingCode(null); setShowCodeModal(true) }}>
              + Add Service Code
            </button>
          </div>

          <div className="hc-card" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Rate</th>
                  <th>Unit Type</th>
                  <th>Revenue Code</th>
                  <th>Requires Auth</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {serviceCodes.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)' }}>No service codes found</td></tr>
                ) : serviceCodes.map((sc) => (
                  <tr key={sc.id}>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{sc.code}</td>
                    <td>{sc.description || '—'}</td>
                    <td>{sc.ratePerUnit ? `$${parseFloat(String(sc.ratePerUnit)).toFixed(2)}` : '—'}</td>
                    <td>{sc.unitType || '—'}</td>
                    <td>{sc.revenueCode || '—'}</td>
                    <td>
                      <span style={pill(sc.requiresAuth ? '#b45309' : '#616161')}>{sc.requiresAuth ? 'YES' : 'NO'}</span>
                    </td>
                    <td>
                      <button className="hc-btn hc-btn-sm" onClick={() => openEditCode(sc)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAYER MODAL */}
      {showPayerModal && (
        <div className="modal active" onClick={() => setShowPayerModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>{editingPayer ? 'Edit Payer' : 'Add Payer'}</h3>
              <button className="modal-close" onClick={() => setShowPayerModal(false)}>&times;</button>
            </div>
            <form onSubmit={savePayer}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Name *</label>
                  <input type="text" value={payerForm.name} onChange={(e) => setPayerForm({ ...payerForm, name: e.target.value })} required />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Payer type *</label>
                    <select value={payerForm.payerType} onChange={(e) => setPayerForm({ ...payerForm, payerType: e.target.value })} required>
                      <option value="">Choose…</option>
                      {PAYER_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      {payerForm.payerType && !PAYER_TYPE_OPTIONS.some((o) => o.value === payerForm.payerType) && (
                        <option value={payerForm.payerType}>{payerTypeLabel(payerForm.payerType)}</option>
                      )}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Payer ID</label>
                    <input type="text" value={payerForm.payerIdNumber} onChange={(e) => setPayerForm({ ...payerForm, payerIdNumber: e.target.value })} placeholder="e.g. MCFC-CW" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Contact Name</label>
                    <input type="text" value={payerForm.contactName} onChange={(e) => setPayerForm({ ...payerForm, contactName: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Contact Phone</label>
                    <input type="text" value={payerForm.phone} onChange={(e) => setPayerForm({ ...payerForm, phone: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Contact Email</label>
                  <input type="email" value={payerForm.email} onChange={(e) => setPayerForm({ ...payerForm, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>
                    <input type="checkbox" checked={payerForm.isActivePayer} onChange={(e) => setPayerForm({ ...payerForm, isActivePayer: e.target.checked })} style={{ marginRight: '0.5rem' }} />
                    Active Payer
                  </label>
                </div>
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-slate-800">
                  <div className="mb-2 font-bold text-blue-900 dark:text-blue-200">Sandata EVV</div>
                  <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-slate-200">
                    <input type="checkbox" checked={!!payerForm.sandataEvvRequired} onChange={(e) => setPayerForm({ ...payerForm, sandataEvvRequired: e.target.checked })} className="mt-1" />
                    <span>This payer's clients are in Sandata — caregivers are reminded to check in and out on Sandata Mobile Connect for clients with a Medicaid ID on file.</span>
                  </label>
                  {sandataPresets.length > 0 && (
                    <div className="form-group mt-2">
                      <label>Fill Sandata codes from a known payer</label>
                      <select value="" onChange={(e) => {
                        const pr = sandataPresets.find((x) => x.sandataPayerId === e.target.value)
                        if (pr) setPayerForm({
                          ...payerForm, sandataPayerId: pr.sandataPayerId, sandataPayerProgram: pr.sandataPayerProgram,
                          // The same code routes the claim (payerRouter: MCO + MCFC-CW → My Choice Wisconsin).
                          payerIdNumber: payerForm.payerIdNumber || pr.sandataPayerId,
                          payerType: payerForm.payerType || TYPE_FOR_PROGRAM[pr.sandataPayerProgram] || '',
                        })
                      }}>
                        <option value="">Choose…</option>
                        {sandataPresets.map((pr) => <option key={pr.sandataPayerId} value={pr.sandataPayerId}>{pr.label} — {pr.sandataPayerId} / {pr.sandataPayerProgram}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="form-group">
                      <label>Sandata Payer ID</label>
                      <input type="text" value={payerForm.sandataPayerId} onChange={(e) => setPayerForm({ ...payerForm, sandataPayerId: e.target.value })} placeholder="from your state's EVV addendum" />
                    </div>
                    <div className="form-group">
                      <label>Sandata Payer Program</label>
                      <input type="text" value={payerForm.sandataPayerProgram} onChange={(e) => setPayerForm({ ...payerForm, sandataPayerProgram: e.target.value })} />
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">Both codes are required before this payer's visits can be submitted to Sandata.</div>
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <textarea value={payerForm.notes} onChange={(e) => setPayerForm({ ...payerForm, notes: e.target.value })} rows={3} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowPayerModal(false)}>Cancel</button>
                <button type="submit" className="hc-btn hc-btn-primary">{editingPayer ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SERVICE CODE MODAL */}
      {showCodeModal && (
        <div className="modal active" onClick={() => setShowCodeModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>{editingCode ? 'Edit Service Code' : 'Add Service Code'}</h3>
              <button className="modal-close" onClick={() => setShowCodeModal(false)}>&times;</button>
            </div>
            <form onSubmit={saveServiceCode}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Code *</label>
                    <input type="text" value={codeForm.code} onChange={(e) => setCodeForm({ ...codeForm, code: e.target.value })} required placeholder="e.g. T1019" />
                  </div>
                  <div className="form-group">
                    <label>Revenue Code</label>
                    <input type="text" value={codeForm.revenueCode} onChange={(e) => setCodeForm({ ...codeForm, revenueCode: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <input type="text" value={codeForm.description} onChange={(e) => setCodeForm({ ...codeForm, description: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Rate Per Unit ($)</label>
                    <input type="number" step="0.01" value={codeForm.ratePerUnit} onChange={(e) => setCodeForm({ ...codeForm, ratePerUnit: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Unit Type</label>
                    <select value={codeForm.unitType} onChange={(e) => setCodeForm({ ...codeForm, unitType: e.target.value })}>
                      <option value="hour">Hour</option>
                      <option value="15min">15-Minute</option>
                      <option value="visit">Visit</option>
                      <option value="day">Day</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>
                    <input type="checkbox" checked={codeForm.requiresAuth} onChange={(e) => setCodeForm({ ...codeForm, requiresAuth: e.target.checked })} style={{ marginRight: '0.5rem' }} />
                    Requires Authorization
                  </label>
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <textarea value={codeForm.notes} onChange={(e) => setCodeForm({ ...codeForm, notes: e.target.value })} rows={3} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowCodeModal(false)}>Cancel</button>
                <button type="submit" className="hc-btn hc-btn-primary">{editingCode ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default PayersServiceCodes
