// Moved from templates/crm-homecare/frontend/src/components/admin/SMSManagement.tsx.
// The office's texting screen: a single text, a bulk text to caregivers or clients, and the message templates
// (home care's /api/sms routes, composed in front of the CRM's: server/crm/homecare/portals/sms.ts).
//
// Changes from the template:
//   · lists are read as { data, pagination } (rows()); people as the server answers them (firstName, lastName); the
//     caregiver and client pickers ask for everyone (lib/http.ts listAll, page by page), not the first page of 50;
//   · a single send's toast no longer prints "SID: null" when the reply carries no Twilio id;
//   · the template's "Variables:" line printed the stored JSON array (default []), so every template showed an empty
//     "Variables:" line; it now shows only when the array has entries. The form's free-text "variables" was never
//     stored by either server and is not sent;
//   · the status badges were white on light fills (green #4caf50 is 2.8:1); they are the frame's badge pairs;
//   · "+ Send Message" and "+ New Template" show with care-portal:create, edit with care-portal:update (the server's).
import { useEffect, useState, type FormEvent } from 'react'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { formatDateTime } from '../lib/datetime'
import { useConfirm, usePermissions, useToast } from '../../../../shared'

interface SmsMessage {
  id: string
  direction?: string
  status?: string
  toNumber?: string
  fromNumber?: string
  recipientName?: string
  body?: string
  createdAt?: string
}

/** A row of GET /api/sms/templates (sms_templates, camelCase). `variables` is a JSON column. */
interface SmsTemplate {
  id: string
  name: string
  body: string
  category: string | null
  variables?: unknown
}

interface Person { id: string; firstName?: string | null; lastName?: string | null; phone?: string | null }

interface SinglePayload { to: string; body: string }
interface BulkPayload { recipientType: string; recipientIds: string[]; body: string }
interface TemplatePayload { name: string; body: string; category: string }

const STATUS_BADGE: Record<string, string> = {
  queued: 'hc-badge-secondary',
  sending: 'hc-badge-info',
  sent: 'hc-badge-success',
  delivered: 'hc-badge-success',
  failed: 'hc-badge-danger',
  undelivered: 'hc-badge-warning',
  received: 'hc-badge-success',
}

const H4 = 'mb-1 text-xs font-bold uppercase tracking-wide text-[var(--hc-ink)]'

const SMSManagement = () => {
  const toast = useToast()
  const confirm = useConfirm()
  const { can } = usePermissions()
  const mayCreate = can('care-portal:create')
  const mayUpdate = can('care-portal:update')
  const mayDelete = can('care-portal:delete') // DELETE /api/sms/templates/:id asks care-portal:delete

  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [templates, setTemplates] = useState<SmsTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'messages' | 'templates'>('messages')
  const [filter, setFilter] = useState({ direction: '', status: '' })
  const [showSendModal, setShowSendModal] = useState(false)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<SmsTemplate | null>(null)
  const [caregivers, setCaregivers] = useState<Person[]>([])
  const [clients, setClients] = useState<Person[]>([])

  useEffect(() => {
    void loadMessages()
    void loadTemplates()
    void loadCaregivers()
    void loadClients()
  }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMessages = async () => {
    try {
      const params: Record<string, string> = {}
      if (filter.direction) params.direction = filter.direction
      if (filter.status) params.status = filter.status
      setMessages(rows<SmsMessage>(await api.get('/api/sms/messages', params)))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load messages'))
    } finally {
      setLoading(false)
    }
  }

  const loadTemplates = async () => {
    try { setTemplates(rows<SmsTemplate>(await api.get('/api/sms/templates'))) } catch (e) { toast.error(errorMessage(e, 'Failed to load templates')) }
  }

  const loadCaregivers = async () => {
    try { setCaregivers(rows<Person>(await listAll('/api/caregivers'))) } catch { /* the bulk picker shows none */ }
  }

  const loadClients = async () => {
    try { setClients(rows<Person>(await listAll('/api/clients'))) } catch { /* the bulk picker shows none */ }
  }

  const sendMessage = async (formData: SinglePayload) => {
    try {
      const result: { sid?: string | null } = await api.post('/api/sms/send', formData)
      toast.success(result?.sid ? `Message sent successfully! SID: ${result.sid}` : 'Message sent successfully!')
      setShowSendModal(false)
      void loadMessages()
    } catch (e) {
      toast.error('Failed: ' + errorMessage(e))
    }
  }

  const sendBulk = async (formData: BulkPayload) => {
    try {
      const result: { sent: number; skipped?: number; failed?: number; unknown?: number } = await api.post('/api/sms/send-bulk', formData)
      const notSent = (result.skipped || 0) + (result.failed || 0) + (result.unknown || 0)
      const text = `Sent ${result.sent} message${result.sent === 1 ? '' : 's'}` + (notSent ? ` · ${notSent} not sent (texts switched off, no valid phone, or failed)` : '')
      if (notSent && !result.sent) toast.error(text); else toast.success(text)
      setShowSendModal(false)
      void loadMessages()
    } catch (e) {
      toast.error('Failed: ' + errorMessage(e))
    }
  }

  const saveTemplate = async (formData: TemplatePayload) => {
    try {
      if (editingTemplate) await api.put(`/api/sms/templates/${editingTemplate.id}`, formData)
      else await api.post('/api/sms/templates', formData)
      setShowTemplateModal(false)
      setEditingTemplate(null)
      void loadTemplates()
    } catch (e) {
      toast.error('Failed: ' + errorMessage(e))
    }
  }

  const deleteTemplate = async (templateId: string) => {
    if (!(await confirm('Delete this template?', { title: 'Delete template', confirmText: 'Delete' }))) return
    try {
      await api.delete(`/api/sms/templates/${templateId}`)
      void loadTemplates()
    } catch (e) {
      toast.error('Failed: ' + errorMessage(e))
    }
  }

  const statusBadge = (status?: string) => (
    <span className={`hc-badge ${STATUS_BADGE[status || ''] || 'hc-badge-secondary'}`}>{status?.toUpperCase()}</span>
  )

  const sentCount = messages.filter((m) => m.direction === 'outbound').length
  const receivedCount = messages.filter((m) => m.direction === 'inbound').length
  const failedCount = messages.filter((m) => m.status === 'failed' || m.status === 'undelivered').length

  const variablesOf = (t: SmsTemplate): string => {
    const v = t.variables
    if (Array.isArray(v)) return v.map(String).join(', ')
    return typeof v === 'string' ? v : ''
  }

  return (
    <div>
      <div className="page-header">
        <h2>📱 SMS Management</h2>
        {mayCreate && <button type="button" className="hc-btn hc-btn-primary" onClick={() => setShowSendModal(true)}>+ Send Message</button>}
      </div>

      {/* Summary */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div className="hc-stat-card cursor-pointer" onClick={() => setFilter({ ...filter, direction: '' })}>
          <h4 className={H4}>Total</h4>
          <div className="value">{messages.length}</div>
        </div>
        <div className="hc-stat-card cursor-pointer" onClick={() => setFilter({ ...filter, direction: 'outbound' })}>
          <h4 className={H4}>Sent</h4>
          <div className="value" style={{ color: 'var(--hc-blue-ink)' }}>{sentCount}</div>
        </div>
        <div className="hc-stat-card cursor-pointer" onClick={() => setFilter({ ...filter, direction: 'inbound' })}>
          <h4 className={H4}>Received</h4>
          <div className="value" style={{ color: 'var(--hc-green-ink)' }}>{receivedCount}</div>
        </div>
        <div className="hc-stat-card cursor-pointer" onClick={() => setFilter({ ...filter, status: 'failed' })}>
          <h4 className={H4}>Failed</h4>
          <div className="value" style={{ color: 'var(--hc-red-ink)' }}>{failedCount}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        <button type="button" className={`hc-btn ${activeTab === 'messages' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('messages')}>
          Messages ({messages.length})
        </button>
        <button type="button" className={`hc-btn ${activeTab === 'templates' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('templates')}>
          Templates ({templates.length})
        </button>
        {activeTab === 'templates' && mayCreate && (
          <button type="button" className="hc-btn hc-btn-primary ml-auto" onClick={() => { setEditingTemplate(null); setShowTemplateModal(true) }}>
            + New Template
          </button>
        )}
      </div>

      {activeTab === 'messages' && (
        <>
          <div className="hc-card" style={{ marginBottom: '1rem' }}>
            <div className="flex flex-wrap gap-4">
              <div className="form-group" style={{ margin: 0 }}>
                <label htmlFor="sms-direction">Direction</label>
                <select id="sms-direction" value={filter.direction} onChange={(e) => setFilter({ ...filter, direction: e.target.value })}>
                  <option value="">All</option>
                  <option value="outbound">Sent</option>
                  <option value="inbound">Received</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label htmlFor="sms-status">Status</label>
                <select id="sms-status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                  <option value="">All</option>
                  <option value="sent">Sent</option>
                  <option value="delivered">Delivered</option>
                  <option value="failed">Failed</option>
                  <option value="received">Received</option>
                </select>
              </div>
            </div>
          </div>

          <div className="hc-card">
            {loading ? (
              <div className="loading"><div className="spinner" /></div>
            ) : messages.length === 0 ? (
              <p>No messages found.</p>
            ) : (
              <div className="hc-table-wrapper">
                <table className="hc-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }} />
                      <th>To/From</th>
                      <th>Message</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages.map((msg) => (
                      <tr key={msg.id}>
                        <td className="text-xl">{msg.direction === 'outbound' ? '📤' : '📥'}</td>
                        <td>
                          <strong>{msg.direction === 'outbound' ? msg.toNumber : msg.fromNumber}</strong>
                          {msg.recipientName && <div className="text-xs text-[var(--hc-muted)]">{msg.recipientName}</div>}
                        </td>
                        <td style={{ maxWidth: '400px' }}>
                          <div className="truncate">{msg.body}</div>
                        </td>
                        <td>{statusBadge(msg.status)}</td>
                        <td className="text-sm">{formatDateTime(msg.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'templates' && (
        <div className="hc-card">
          {templates.length === 0 ? (
            <p>No templates found. Create templates to quickly send common messages.</p>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {templates.map((template) => (
                <div key={template.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--hc-line)', background: 'var(--hc-subtle)' }}>
                  <div className="flex items-start justify-between">
                    <strong>{template.name}</strong>
                    <div className="flex gap-1">
                      {mayUpdate && (
                        <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" title="Edit" onClick={() => { setEditingTemplate(template); setShowTemplateModal(true) }}>✏️</button>
                      )}
                      {mayDelete && (
                        <button type="button" className="hc-btn hc-btn-sm hc-btn-danger" title="Delete" onClick={() => deleteTemplate(template.id)}>🗑️</button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 rounded p-2 text-sm" style={{ background: 'var(--hc-surface)', color: 'var(--hc-ink)' }}>{template.body}</div>
                  <div className="mt-2 text-xs" style={{ color: 'var(--hc-muted)' }}>
                    <strong>Category:</strong> {template.category || 'General'}
                  </div>
                  {variablesOf(template) && (
                    <div className="mt-1 text-xs" style={{ color: 'var(--hc-muted)' }}>Variables: {variablesOf(template)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showSendModal && (
        <div className="modal active" onClick={() => setShowSendModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>Send SMS</h3>
              <button type="button" className="modal-close" onClick={() => setShowSendModal(false)}>×</button>
            </div>
            <SendMessageForm
              templates={templates}
              caregivers={caregivers}
              clients={clients}
              onSend={sendMessage}
              onSendBulk={sendBulk}
              onCancel={() => setShowSendModal(false)}
            />
          </div>
        </div>
      )}

      {showTemplateModal && (
        <div className="modal active" onClick={() => setShowTemplateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTemplate ? 'Edit Template' : 'New Template'}</h3>
              <button type="button" className="modal-close" onClick={() => setShowTemplateModal(false)}>×</button>
            </div>
            <TemplateForm template={editingTemplate} onSubmit={saveTemplate} onCancel={() => setShowTemplateModal(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

interface SendFormProps {
  templates: SmsTemplate[]
  caregivers: Person[]
  clients: Person[]
  onSend: (p: SinglePayload) => void
  onSendBulk: (p: BulkPayload) => void
  onCancel: () => void
}

const SendMessageForm = ({ templates, caregivers, clients, onSend, onSendBulk, onCancel }: SendFormProps) => {
  const toast = useToast()
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [formData, setFormData] = useState<{ to: string; body: string; recipientType: string; recipientIds: string[] }>({
    to: '', body: '', recipientType: 'caregiver', recipientIds: [],
  })
  const [selectedTemplate, setSelectedTemplate] = useState('')

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId)
    const template = templates.find((t) => String(t.id) === String(templateId))
    if (template) setFormData({ ...formData, body: template.body })
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'single') {
      if (!formData.to || !formData.body) { toast.warning('Phone number and message are required'); return }
      onSend({ to: formData.to, body: formData.body })
    } else {
      if (formData.recipientIds.length === 0 || !formData.body) { toast.warning('Select recipients and enter a message'); return }
      onSendBulk({ recipientType: formData.recipientType, recipientIds: formData.recipientIds, body: formData.body })
    }
  }

  const recipients = formData.recipientType === 'caregiver' ? caregivers : clients

  const toggleRecipient = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      recipientIds: prev.recipientIds.includes(id) ? prev.recipientIds.filter((r) => r !== id) : [...prev.recipientIds, id],
    }))
  }

  const selectAll = () => setFormData({ ...formData, recipientIds: recipients.map((r) => r.id) })

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4 flex gap-2">
        <button type="button" className={`hc-btn ${mode === 'single' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setMode('single')}>Single Message</button>
        <button type="button" className={`hc-btn ${mode === 'bulk' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setMode('bulk')}>Bulk Message</button>
      </div>

      {mode === 'single' ? (
        <div className="form-group">
          <label htmlFor="sms-to">Phone Number *</label>
          <input id="sms-to" type="tel" value={formData.to} onChange={(e) => setFormData({ ...formData, to: e.target.value })} placeholder="+1234567890" required />
        </div>
      ) : (
        <>
          <div className="form-group">
            <label htmlFor="sms-recipient-type">Recipient Type</label>
            <select id="sms-recipient-type" value={formData.recipientType} onChange={(e) => setFormData({ ...formData, recipientType: e.target.value, recipientIds: [] })}>
              <option value="caregiver">Caregivers</option>
              <option value="client">Clients</option>
            </select>
          </div>
          <div className="form-group">
            <label>
              Recipients ({formData.recipientIds.length} selected)
              <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary ml-2" onClick={selectAll}>Select All</button>
            </label>
            <div className="max-h-[150px] overflow-y-auto rounded border p-2" style={{ borderColor: 'var(--hc-line)' }}>
              {recipients.map((r) => (
                <label key={r.id} className="block cursor-pointer p-1">
                  <input type="checkbox" checked={formData.recipientIds.includes(r.id)} onChange={() => toggleRecipient(r.id)} className="mr-2" />
                  {r.firstName} {r.lastName} {r.phone ? `(${r.phone})` : '(no phone)'}
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="form-group">
        <label htmlFor="sms-template">Template (Optional)</label>
        <select id="sms-template" value={selectedTemplate} onChange={(e) => handleTemplateSelect(e.target.value)}>
          <option value="">-- Select Template --</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="sms-body">Message *</label>
        <textarea id="sms-body" value={formData.body} onChange={(e) => setFormData({ ...formData, body: e.target.value })} placeholder="Type your message..." rows={4} required />
        <small style={{ color: 'var(--hc-muted)' }}>{formData.body.length} characters</small>
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">
          {mode === 'single' ? 'Send Message' : `Send to ${formData.recipientIds.length} Recipients`}
        </button>
      </div>
    </form>
  )
}

interface TemplateFormProps {
  template: SmsTemplate | null
  onSubmit: (p: TemplatePayload) => void
  onCancel: () => void
}

const TemplateForm = ({ template, onSubmit, onCancel }: TemplateFormProps) => {
  const toast = useToast()
  const [formData, setFormData] = useState<TemplatePayload>({
    name: template?.name || '',
    body: template?.body || '',
    category: template?.category || 'general',
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.body) { toast.warning('Name and message body are required'); return }
    onSubmit(formData)
  }

  const insertVariable = (variable: string) => setFormData({ ...formData, body: formData.body + `{{${variable}}}` })

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="sms-tpl-name">Template Name *</label>
        <input id="sms-tpl-name" type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Shift Reminder" required />
      </div>

      <div className="form-group">
        <label htmlFor="sms-tpl-category">Category</label>
        <select id="sms-tpl-category" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })}>
          <option value="general">General</option>
          <option value="scheduling">Scheduling</option>
          <option value="reminder">Reminder</option>
          <option value="emergency">Emergency</option>
          <option value="payroll">Payroll</option>
        </select>
      </div>

      <div className="form-group">
        <label>
          Message Body *
          <span className="ml-4 text-xs">
            Insert:
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary ml-1" onClick={() => insertVariable('first_name')}>First Name</button>
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary ml-1" onClick={() => insertVariable('last_name')}>Last Name</button>
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary ml-1" onClick={() => insertVariable('date')}>Date</button>
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary ml-1" onClick={() => insertVariable('time')}>Time</button>
          </span>
        </label>
        <textarea
          value={formData.body}
          onChange={(e) => setFormData({ ...formData, body: e.target.value })}
          placeholder="Hi {{first_name}}, your shift is scheduled for {{date}} at {{time}}."
          rows={4}
          required
        />
        <small style={{ color: 'var(--hc-muted)' }}>{formData.body.length} characters</small>
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Save Template</button>
      </div>
    </form>
  )
}

export default SMSManagement
