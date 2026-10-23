// Moved from templates/crm-homecare/frontend/src/components/admin/AlertsManagement.tsx.
// The office's alert queue (server/crm/homecare/visits/alerts.ts).
//
// Changes from the template:
//   · the list is read as { data, pagination } (rows()) and each alert as the server answers it (alertType,
//     relatedEntityType, dueDate, createdAt). The "Related" line no longer prints a related entity's name: the route
//     answers none (relatedEntityId only);
//   · Resolve asks for its notes in the app's dialog; backing out of it no longer resolves the alert (the template's
//     prompt() resolved on Cancel too);
//   · a failed acknowledge / resolve / dismiss says so (the template swallowed a refusal);
//   · the priority and status badges were white on light fills (2.4–3:1); they are the frame's badge pairs, and each
//     type's colour edge has a dark partner;
//   · "+ Create Alert" shows with care-compliance:create and the alert's actions with care-compliance:update (the
//     server's).
import { useEffect, useState, type FormEvent } from 'react'
import { api, rows, errorMessage } from '../lib/http'
import { formatDate } from '../lib/date'
import { agencyDayHasBegun } from '../lib/agencyClock'
import { formatDateTime } from '../lib/datetime'
import { useConfirm, usePermissions, usePrompt, useToast } from '../../../../shared'

/** A row of GET /api/alerts. */
interface Alert {
  id: string
  alertType: string
  priority: string | null
  message: string
  status: string
  dueDate: string | null
  relatedEntityType: string | null
  relatedEntityId: string | null
  resolution: string | null
  createdAt: string
}

interface AlertType { id: string; name: string; icon: string; edge: string }

// Each type's left edge, light and dark.
const ALERT_TYPES: AlertType[] = [
  { id: 'certification_expiring', name: 'Certification Expiring', icon: '📜', edge: 'border-l-orange-500 dark:border-l-orange-400' },
  { id: 'background_check_expiring', name: 'Background Check Expiring', icon: '🔒', edge: 'border-l-red-500 dark:border-l-red-400' },
  { id: 'schedule_conflict', name: 'Schedule Conflict', icon: '📅', edge: 'border-l-pink-600 dark:border-l-pink-400' },
  { id: 'missed_clock_in', name: 'Missed Clock In', icon: '⏰', edge: 'border-l-red-500 dark:border-l-red-400' },
  { id: 'overtime_warning', name: 'Overtime Warning', icon: '⚠️', edge: 'border-l-orange-500 dark:border-l-orange-400' },
  { id: 'authorization_expiring', name: 'Authorization Expiring', icon: '📋', edge: 'border-l-purple-600 dark:border-l-purple-400' },
  { id: 'care_plan_review', name: 'Care Plan Review Due', icon: '📝', edge: 'border-l-blue-500 dark:border-l-blue-400' },
  { id: 'medication_refill', name: 'Medication Refill Needed', icon: '💊', edge: 'border-l-cyan-500 dark:border-l-cyan-400' },
  { id: 'incident_report', name: 'Incident Report Filed', icon: '🚨', edge: 'border-l-red-500 dark:border-l-red-400' },
  { id: 'compliance_issue', name: 'Compliance Issue', icon: '⚖️', edge: 'border-l-orange-600 dark:border-l-orange-400' },
  { id: 'billing_issue', name: 'Billing Issue', icon: '💰', edge: 'border-l-amber-800 dark:border-l-amber-500' },
  { id: 'custom', name: 'Custom Alert', icon: '🔔', edge: 'border-l-slate-500 dark:border-l-slate-400' },
]

const PRIORITY_BADGE: Record<string, string> = {
  low: 'hc-badge-success',
  medium: 'hc-badge-warning',
  high: 'hc-badge-danger',
  critical: 'hc-badge-danger',
}
const STATUS_BADGE: Record<string, string> = {
  active: 'hc-badge-danger',
  acknowledged: 'hc-badge-warning',
  resolved: 'hc-badge-success',
  dismissed: 'hc-badge-secondary',
}

const H4 = 'mb-1 text-xs font-bold uppercase tracking-wide text-[var(--hc-ink)]'

interface AlertForm {
  alertType: string
  priority: string
  message: string
  dueDate: string
  relatedEntityType: string
  relatedEntityId: string
}

const AlertsManagement = () => {
  const toast = useToast()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { can } = usePermissions()
  const mayCreate = can('care-compliance:create')
  const mayUpdate = can('care-compliance:update')

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ type: '', priority: '', status: 'active' })
  const [showCreateModal, setShowCreateModal] = useState(false)

  useEffect(() => { void loadAlerts() }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadAlerts = async () => {
    try {
      const params: Record<string, string> = {}
      if (filter.type) params.type = filter.type
      if (filter.priority) params.priority = filter.priority
      if (filter.status) params.status = filter.status
      setAlerts(rows<Alert>(await api.get('/api/alerts', params)))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load alerts'))
    } finally {
      setLoading(false)
    }
  }

  const createAlert = async (formData: AlertForm) => {
    try {
      await api.post('/api/alerts', formData)
      setShowCreateModal(false)
      void loadAlerts()
    } catch (e) {
      toast.error('Failed: ' + errorMessage(e))
    }
  }

  const acknowledgeAlert = async (alertId: string) => {
    try { await api.put(`/api/alerts/${alertId}/acknowledge`); void loadAlerts() } catch (e) { toast.error('Failed: ' + errorMessage(e)) }
  }

  const resolveAlert = async (alertId: string) => {
    const resolution = await prompt('Resolution notes (optional):', { title: 'Resolve alert', confirmText: 'Resolve' })
    if (resolution === null) return
    try { await api.put(`/api/alerts/${alertId}/resolve`, { resolution }); void loadAlerts() } catch (e) { toast.error('Failed: ' + errorMessage(e)) }
  }

  const dismissAlert = async (alertId: string) => {
    if (!(await confirm('Dismiss this alert without resolving?', { title: 'Dismiss alert', confirmText: 'Dismiss' }))) return
    try { await api.put(`/api/alerts/${alertId}/dismiss`); void loadAlerts() } catch (e) { toast.error('Failed: ' + errorMessage(e)) }
  }

  const badge = (map: Record<string, string>, value: string | null) => (
    <span className={`hc-badge ${map[value || ''] || 'hc-badge-secondary'}`}>{value?.toUpperCase()}</span>
  )

  const typeInfo = (typeId: string): AlertType => ALERT_TYPES.find((t) => t.id === typeId) || { id: typeId, icon: '🔔', name: typeId, edge: 'border-l-slate-500 dark:border-l-slate-400' }

  const criticalCount = alerts.filter((a) => a.priority === 'critical' && a.status === 'active').length
  const highCount = alerts.filter((a) => a.priority === 'high' && a.status === 'active').length
  const activeCount = alerts.filter((a) => a.status === 'active').length
  const acknowledgedCount = alerts.filter((a) => a.status === 'acknowledged').length

  return (
    <div>
      <div className="page-header">
        <h2>🚨 Alerts &amp; Notifications</h2>
        {mayCreate && <button type="button" className="hc-btn hc-btn-primary" onClick={() => setShowCreateModal(true)}>+ Create Alert</button>}
      </div>

      {/* Summary */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div className="hc-stat-card cursor-pointer !border-l-red-800 dark:!border-l-red-400" onClick={() => setFilter({ ...filter, priority: 'critical', status: 'active' })}>
          <h4 className={H4}>Critical</h4>
          <div className="value" style={{ color: 'var(--hc-red-ink)' }}>{criticalCount}</div>
        </div>
        <div className="hc-stat-card cursor-pointer !border-l-red-500 dark:!border-l-red-400" onClick={() => setFilter({ ...filter, priority: 'high', status: 'active' })}>
          <h4 className={H4}>High Priority</h4>
          <div className="value" style={{ color: 'var(--hc-red-ink)' }}>{highCount}</div>
        </div>
        <div className="hc-stat-card cursor-pointer !border-l-orange-500 dark:!border-l-orange-400" onClick={() => setFilter({ ...filter, priority: '', status: 'active' })}>
          <h4 className={H4}>Active</h4>
          <div className="value" style={{ color: 'var(--hc-warning-ink)' }}>{activeCount}</div>
        </div>
        <div className="hc-stat-card cursor-pointer !border-l-blue-500 dark:!border-l-blue-400" onClick={() => setFilter({ ...filter, status: 'acknowledged' })}>
          <h4 className={H4}>Acknowledged</h4>
          <div className="value" style={{ color: 'var(--hc-blue-ink)' }}>{acknowledgedCount}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="hc-card" style={{ marginBottom: '1rem' }}>
        <div className="flex flex-wrap gap-4">
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="alerts-type">Type</label>
            <select id="alerts-type" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
              <option value="">All Types</option>
              {ALERT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="alerts-priority">Priority</label>
            <select id="alerts-priority" value={filter.priority} onChange={(e) => setFilter({ ...filter, priority: e.target.value })}>
              <option value="">All Priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="alerts-status">Status</label>
            <select id="alerts-status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
          <button type="button" className="hc-btn hc-btn-secondary self-end" onClick={() => setFilter({ type: '', priority: '', status: 'active' })}>
            Reset Filters
          </button>
        </div>
      </div>

      {/* List */}
      <div className="hc-card">
        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : alerts.length === 0 ? (
          <p>No alerts found. 🎉</p>
        ) : (
          <div className="flex flex-col gap-3">
            {alerts.map((alert) => {
              const ti = typeInfo(alert.alertType)
              const overdue = !!alert.dueDate && agencyDayHasBegun(alert.dueDate)
              return (
                <div
                  key={alert.id}
                  className={`rounded-lg border border-l-4 p-4 ${ti.edge}`}
                  style={{
                    borderTopColor: 'var(--hc-line)', borderRightColor: 'var(--hc-line)', borderBottomColor: 'var(--hc-line)',
                    background: alert.status === 'active' ? 'var(--hc-surface)' : 'var(--hc-subtle)',
                    opacity: alert.status === 'dismissed' ? 0.6 : 1,
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{ti.icon}</span>
                      <div>
                        <strong>{ti.name}</strong>
                        <div className="mt-1 flex gap-2">
                          {badge(PRIORITY_BADGE, alert.priority)}
                          {badge(STATUS_BADGE, alert.status)}
                        </div>
                      </div>
                    </div>
                    <span className="text-sm" style={{ color: 'var(--hc-muted)' }}>{formatDateTime(alert.createdAt)}</span>
                  </div>

                  <div className="mt-3" style={{ color: 'var(--hc-ink)' }}>{alert.message}</div>

                  {alert.relatedEntityType && (
                    <div className="mt-2 text-sm" style={{ color: 'var(--hc-muted)' }}>
                      <strong>Related:</strong> {alert.relatedEntityType}
                    </div>
                  )}

                  {alert.dueDate && (
                    <div className="mt-1 text-sm" style={{ color: overdue ? 'var(--hc-red-ink)' : 'var(--hc-muted)' }}>
                      <strong>Due:</strong> {formatDate(alert.dueDate)}
                      {overdue && ' (OVERDUE)'}
                    </div>
                  )}

                  {alert.resolution && (
                    <div className="mt-2 rounded p-2 text-sm" style={{ background: 'var(--hc-success-bg)', color: 'var(--hc-success-ink)' }}>
                      <strong>Resolution:</strong> {alert.resolution}
                    </div>
                  )}

                  {mayUpdate && (alert.status === 'active' || alert.status === 'acknowledged') && (
                    <div className="mt-3 flex gap-2">
                      {alert.status === 'active' && (
                        <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => acknowledgeAlert(alert.id)}>👁️ Acknowledge</button>
                      )}
                      <button type="button" className="hc-btn hc-btn-sm hc-btn-success" onClick={() => resolveAlert(alert.id)}>✓ Resolve</button>
                      <button type="button" className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => dismissAlert(alert.id)}>✗ Dismiss</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="modal active" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Alert</h3>
              <button type="button" className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <CreateAlertForm onSubmit={createAlert} onCancel={() => setShowCreateModal(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

const CreateAlertForm = ({ onSubmit, onCancel }: { onSubmit: (f: AlertForm) => void; onCancel: () => void }) => {
  const toast = useToast()
  const [formData, setFormData] = useState<AlertForm>({
    alertType: 'custom', priority: 'medium', message: '', dueDate: '', relatedEntityType: '', relatedEntityId: '',
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!formData.message) { toast.warning('Message is required'); return }
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label htmlFor="alert-new-type">Alert Type *</label>
          <select id="alert-new-type" value={formData.alertType} onChange={(e) => setFormData({ ...formData, alertType: e.target.value })}>
            {ALERT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="alert-new-priority">Priority *</label>
          <select id="alert-new-priority" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value })}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="alert-new-message">Message *</label>
        <textarea id="alert-new-message" value={formData.message} onChange={(e) => setFormData({ ...formData, message: e.target.value })} placeholder="Describe the alert..." rows={3} required />
      </div>

      <div className="form-group">
        <label htmlFor="alert-new-due">Due Date (Optional)</label>
        <input id="alert-new-due" type="date" value={formData.dueDate} onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label htmlFor="alert-new-rel-type">Related Entity Type</label>
          <select id="alert-new-rel-type" value={formData.relatedEntityType} onChange={(e) => setFormData({ ...formData, relatedEntityType: e.target.value })}>
            <option value="">None</option>
            <option value="client">Client</option>
            <option value="caregiver">Caregiver</option>
            <option value="schedule">Schedule</option>
            <option value="invoice">Invoice</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="alert-new-rel-id">Related Entity ID</label>
          <input id="alert-new-rel-id" type="text" value={formData.relatedEntityId} onChange={(e) => setFormData({ ...formData, relatedEntityId: e.target.value })} placeholder="ID (optional)" />
        </div>
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Create Alert</button>
      </div>
    </form>
  )
}

export default AlertsManagement
