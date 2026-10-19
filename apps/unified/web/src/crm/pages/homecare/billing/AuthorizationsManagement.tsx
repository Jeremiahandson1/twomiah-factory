// Client authorizations: the units a payer authorizes for a client, with their burn-down. Moved from
// templates/crm-homecare/frontend/src/components/admin/AuthorizationsManagement.tsx.
//
// Server: /api/authorizations (server/crm/homecare/billing/authorizations.ts): GET a list (each row with
// client: { firstName, lastName } and payer: { name }), POST/PUT the record, DELETE a soft cancel ({ success }).
// The pickers read /api/clients (a paged list: clients/clients.ts) and /api/payers (a list: billing/payers.ts).
import { useEffect, useState, type FormEvent } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { parseLocalDate } from '../lib/date'
import { useMay } from '../lib/useMay'

const parseDate = (dateStr: string | null | undefined): Date | null => {
  if (!dateStr) return null
  if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateStr.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  if (typeof dateStr === 'string' && dateStr.includes('T')) {
    const [datePart] = dateStr.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  return parseLocalDate(dateStr)
}

const formatDate = (dateStr: string | null | undefined) => {
  const date = parseDate(dateStr)
  if (!date || isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US')
}

type Num = string | number | null | undefined
interface Authorization {
  id: string; clientId: string; payerId: string | null; authNumber: string | null; procedureCode: string | null
  modifier: string | null; authorizedUnits: Num; unitType: string | null; usedUnits: Num
  startDate: string | null; endDate: string | null; status: string | null; lowUnitsAlertThreshold: Num; notes: string | null
  client?: { firstName: string | null; lastName: string | null }
  payer?: { name: string | null }
}
interface ClientOption { id: string; firstName: string; lastName: string }
interface PayerOption { id: string; name: string }

const EMPTY_FORM = {
  clientId: '', payerId: '', authNumber: '', procedureCode: '', modifier: '',
  authorizedUnits: '', unitType: 'hours', usedUnits: '0',
  startDate: '', endDate: '', status: 'active', lowUnitsAlertThreshold: '10', notes: '',
}

// Status grounds dark enough for white text (≥ 4.5:1) in either theme.
const STATUS_COLOURS: Record<string, string> = {
  active: '#2e7d32', pending: '#b45309', expired: '#c62828', cancelled: '#616161', exhausted: '#b71c1c',
}

/** Enough rows for the pickers: /api/clients pages at 50 by default. */

const AuthorizationsManagement = () => {
  // Each control for whoever the server lets use it (care-billing create / update / delete — lib/useMay.ts).
  const may = useMay('care-billing')
  const toast = useToast()
  const confirm = useConfirm()
  const [authorizations, setAuthorizations] = useState<Authorization[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [payers, setPayers] = useState<PayerOption[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ status: '', clientId: '', payerId: '' })
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Authorization | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    loadAuthorizations()
    loadClients()
    loadPayers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const loadAuthorizations = async () => {
    try {
      setAuthorizations(rows<Authorization>(await api.get('/api/authorizations', {
        status: filter.status || undefined, clientId: filter.clientId || undefined, payerId: filter.payerId || undefined,
      })))
    } catch (error) {
      console.error('Failed to load authorizations:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadClients = async () => {
    try {
      setClients(rows<ClientOption>(await listAll('/api/clients')))
    } catch (error) {
      console.error('Failed to load clients:', error)
    }
  }

  const loadPayers = async () => {
    try {
      setPayers(rows<PayerOption>(await api.get('/api/payers')))
    } catch (error) {
      console.error('Failed to load payers:', error)
    }
  }

  const saveAuthorization = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const payload = {
        ...form,
        authorizedUnits: form.authorizedUnits ? parseFloat(form.authorizedUnits) : 0,
        usedUnits: form.usedUnits ? parseFloat(form.usedUnits) : 0,
        lowUnitsAlertThreshold: form.lowUnitsAlertThreshold ? parseFloat(form.lowUnitsAlertThreshold) : null,
      }
      if (editing) await api.put(`/api/authorizations/${editing.id}`, payload)
      else await api.post('/api/authorizations', payload)
      toast.success(editing ? 'Authorization updated' : 'Authorization created')
      setShowModal(false)
      setEditing(null)
      resetForm()
      loadAuthorizations()
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to save'))
    }
  }

  const cancelAuthorization = async (auth: Authorization) => {
    const ok = await confirm(`Cancel authorization ${auth.authNumber || auth.id}? This will mark it as cancelled.`, { title: 'Cancel authorization' })
    if (!ok) return
    try {
      await api.delete(`/api/authorizations/${auth.id}`)
      toast.success('Authorization cancelled')
      loadAuthorizations()
    } catch (error) {
      toast.error('Failed to cancel: ' + errorMessage(error))
    }
  }

  const resetForm = () => setForm(EMPTY_FORM)

  const openEdit = (auth: Authorization) => {
    setEditing(auth)
    setForm({
      clientId: auth.clientId || '', payerId: auth.payerId || '',
      authNumber: auth.authNumber || '', procedureCode: auth.procedureCode || '',
      modifier: auth.modifier || '',
      authorizedUnits: auth.authorizedUnits?.toString() || '',
      unitType: auth.unitType || 'hours',
      usedUnits: auth.usedUnits?.toString() || '0',
      startDate: auth.startDate ? auth.startDate.split('T')[0] : '',
      endDate: auth.endDate ? auth.endDate.split('T')[0] : '',
      status: auth.status || 'active',
      lowUnitsAlertThreshold: auth.lowUnitsAlertThreshold?.toString() || '10',
      notes: auth.notes || '',
    })
    setShowModal(true)
  }

  const getStatusBadge = (status: string | null) => (
    <span style={{
      padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem',
      fontWeight: 'bold', color: 'white', backgroundColor: (status && STATUS_COLOURS[status]) || '#616161',
    }}>
      {status?.toUpperCase() || 'N/A'}
    </span>
  )

  const getUtilizationBar = (used: Num, authorized: Num) => {
    const usedNum = parseFloat(String(used ?? '')) || 0
    const authNum = parseFloat(String(authorized ?? '')) || 0
    if (authNum === 0) return null
    const pct = Math.min((usedNum / authNum) * 100, 100)
    const remaining = authNum - usedNum
    const color = pct > 90 ? '#f44336' : pct > 75 ? '#ff9800' : '#4caf50'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ flex: 1, background: 'var(--hc-line)', borderRadius: '4px', height: '8px', minWidth: '60px' }}>
          <div style={{ width: `${pct}%`, background: color, borderRadius: '4px', height: '8px' }} />
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--hc-muted)', whiteSpace: 'nowrap' }}>
          {remaining.toFixed(1)} left
        </span>
      </div>
    )
  }

  if (loading) return <div className="loading"><div className="spinner"></div></div>

  return (
    <div>
      <div className="page-header">
        <h2>📋 Authorizations</h2>
        {may.create && <button className="hc-btn hc-btn-primary" onClick={() => { resetForm(); setEditing(null); setShowModal(true) }}>
          + New Authorization
        </button>}
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '1rem' }}>
        <div className="hc-stat-card">
          <h4>Total</h4>
          <div className="value">{authorizations.length}</div>
        </div>
        <div className="hc-stat-card">
          <h4>Active</h4>
          <div className="value" style={{ color: 'var(--hc-green-ink)' }}>{authorizations.filter((a) => a.status === 'active').length}</div>
        </div>
        <div className="hc-stat-card">
          <h4>Expiring Soon</h4>
          <div className="value" style={{ color: 'var(--hc-warning-ink)' }}>
            {authorizations.filter((a) => {
              if (a.status !== 'active' || !a.endDate) return false
              const end = parseDate(a.endDate)
              if (!end) return false
              const now = new Date()
              const diff = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
              return diff >= 0 && diff <= 30
            }).length}
          </div>
          <small>Within 30 days</small>
        </div>
        <div className="hc-stat-card">
          <h4>Low Units</h4>
          <div className="value" style={{ color: 'var(--hc-red-ink)' }}>
            {authorizations.filter((a) => {
              if (a.status !== 'active') return false
              const used = parseFloat(String(a.usedUnits ?? '')) || 0
              const auth = parseFloat(String(a.authorizedUnits ?? '')) || 0
              return auth > 0 && ((auth - used) / auth) < 0.15
            }).length}
          </div>
          <small>&lt; 15% remaining</small>
        </div>
      </div>

      {/* Filters */}
      <div className="hc-card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Client</label>
            <select value={filter.clientId} onChange={(e) => setFilter({ ...filter, clientId: e.target.value })}>
              <option value="">All Clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
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
        </div>
      </div>

      {/* Table */}
      <div className="hc-card" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Payer</th>
              <th>Auth #</th>
              <th>Procedure</th>
              <th>Authorized</th>
              <th>Used</th>
              <th>Utilization</th>
              <th>Start</th>
              <th>End</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {authorizations.length === 0 ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)' }}>No authorizations found</td></tr>
            ) : authorizations.map((auth) => (
              <tr key={auth.id}>
                <td style={{ fontWeight: 600 }}>
                  {auth.client ? `${auth.client.firstName || ''} ${auth.client.lastName || ''}`.trim() : '—'}
                </td>
                <td>{auth.payer?.name || '—'}</td>
                <td style={{ fontFamily: 'monospace' }}>{auth.authNumber || '—'}</td>
                <td style={{ fontFamily: 'monospace' }}>{auth.procedureCode || '—'}{auth.modifier ? `:${auth.modifier}` : ''}</td>
                <td>{auth.authorizedUnits || 0} {auth.unitType || ''}</td>
                <td>{auth.usedUnits || 0}</td>
                <td style={{ minWidth: '120px' }}>{getUtilizationBar(auth.usedUnits, auth.authorizedUnits)}</td>
                <td>{formatDate(auth.startDate)}</td>
                <td>{formatDate(auth.endDate)}</td>
                <td>{getStatusBadge(auth.status)}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    {may.update && <button className="hc-btn hc-btn-sm" onClick={() => openEdit(auth)}>Edit</button>}
                    {may.delete && auth.status === 'active' && (
                      <button className="hc-btn hc-btn-sm" style={{ color: 'var(--hc-red-ink)' }} onClick={() => cancelAuthorization(auth)}>Cancel</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL */}
      {showModal && (
        <div className="modal active" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <h3>{editing ? 'Edit Authorization' : 'New Authorization'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={saveAuthorization}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Client *</label>
                    <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required>
                      <option value="">Select client...</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Payer *</label>
                    <select value={form.payerId} onChange={(e) => setForm({ ...form, payerId: e.target.value })} required>
                      <option value="">Select payer...</option>
                      {payers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Auth Number</label>
                    <input type="text" value={form.authNumber} onChange={(e) => setForm({ ...form, authNumber: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Procedure Code</label>
                    <input type="text" value={form.procedureCode} onChange={(e) => setForm({ ...form, procedureCode: e.target.value })} placeholder="e.g. T1019" />
                  </div>
                  <div className="form-group">
                    <label>Modifier</label>
                    <input type="text" value={form.modifier} onChange={(e) => setForm({ ...form, modifier: e.target.value })} placeholder="e.g. U3" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Authorized Units *</label>
                    <input type="number" step="0.01" value={form.authorizedUnits} onChange={(e) => setForm({ ...form, authorizedUnits: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Unit Type</label>
                    <select value={form.unitType} onChange={(e) => setForm({ ...form, unitType: e.target.value })}>
                      <option value="hours">Hours</option>
                      <option value="15min">15-Minute Units</option>
                      <option value="visits">Visits</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Used Units</label>
                    <input type="number" step="0.01" value={form.usedUnits} onChange={(e) => setForm({ ...form, usedUnits: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Start Date *</label>
                    <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>End Date *</label>
                    <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="expired">Expired</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Low Units Alert Threshold</label>
                  <input type="number" step="1" value={form.lowUnitsAlertThreshold} onChange={(e) => setForm({ ...form, lowUnitsAlertThreshold: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="hc-btn hc-btn-primary">{editing ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default AuthorizationsManagement
