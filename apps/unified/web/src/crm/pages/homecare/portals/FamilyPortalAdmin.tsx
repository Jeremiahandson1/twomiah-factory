// The office's Family Portal page (/crm/family-portal): relatives' logins and what each may see, the messages they
// send, and the client portal's message threads. Moved from templates/crm-homecare/frontend/src/components/admin/FamilyPortalAdmin.tsx.
//
// Server (server/crm/homecare/portals/familyPortal.ts, /api/family-portal, the staff session):
//   GET  /admin/members?status&clientId          care-portal:update — a list of members (memberColumns, camelCase:
//                                                isActive, isPrimaryContact, canViewSchedule…, lastLogin) + clientFirstName,
//                                                clientLastName
//   POST /admin/members                          care-portal:create — { clientId, firstName, lastName, email, phone,
//                                                relationship, password, can* } → the member (201)
//   PUT  /admin/members/:id                      care-portal:update — { name, phone, relationship, can*, isPrimaryContact }
//   PUT  /admin/members/:id/status               care-portal:update — { isActive } → { success, member }
//   PUT  /admin/members/:id/reset-password       care-portal:update — { password } → { success }
//   GET  /admin/messages                         care-portal:update — a list of { id, subject, message, isRead, reply,
//                                                createdAt, senderName, clientFirstName, clientLastName, … }
//   POST /admin/messages/:id/reply               care-portal:create — { reply } → { success }
//   GET  /admin/portal-threads                   care-portal:update — a list of threads + clientFirstName/LastName, hasUnread
//   GET  /admin/portal-threads/:id               care-portal:update — { thread, messages } (marks it read)
//   POST /admin/portal-threads/:id/reply         care-portal:create — { body } → the message (201)
// and GET /api/clients (care-clients:read) for the client pickers — a page of clients ({ data, pagination }).
//
// The template read every list row in snake_case (is_active, client_first_name, last_login, created_at); the replies are
// camelCase. Its buttons were the office's (requireAdmin); here adding a relative and replying need care-portal:create,
// the rest care-portal:update, both sides.
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth, usePermissions, usePrompt, useToast } from '../../../../shared'
import { api, errorMessage, rows, listAll } from '../lib/http'
import { formatDateTime } from '../lib/datetime'
import { PasswordInput } from '../../../../shared'

type PermKey = 'canViewSchedule' | 'canViewCarePlan' | 'canViewMedications' | 'canViewVitals' | 'canViewDocuments' | 'canMessage'
// A relative's switches: [the API's name, the label].
const PERMISSIONS: Array<[PermKey, string]> = [
  ['canViewSchedule', 'Schedule'],
  ['canViewCarePlan', 'Care plan'],
  ['canViewMedications', 'Medications & vitals'],
  ['canMessage', 'Messages'],
]
// With care_family_content on, vitals and documents are their own switches and the medicines one says so.
const permissionsFor = (content: boolean): Array<[PermKey, string]> => !content ? PERMISSIONS : [
  ['canViewSchedule', 'Schedule'],
  ['canViewCarePlan', 'Care plan and daily care'],
  ['canViewMedications', 'Medicine list'],
  ['canViewVitals', 'View vitals'],
  ['canViewDocuments', 'View documents'],
  ['canMessage', 'Messages'],
]

interface Member {
  id: string
  clientId: string
  name: string
  relationship: string | null
  email: string | null
  phone: string | null
  isActive: boolean
  isPrimaryContact: boolean | null
  visitTextOptIn?: boolean | null
  visitTextConsentWording?: string | null
  visitTextOptOutAt?: string | null
  visitEmailOptIn?: boolean | null
  canViewSchedule: boolean | null
  canViewCarePlan: boolean | null
  canViewMedications: boolean | null
  canViewVitals?: boolean | null
  canViewDocuments?: boolean | null
  canMessage: boolean | null
  lastLogin: string | null
  clientFirstName: string | null
  clientLastName: string | null
}

interface FamilyMessage {
  id: string
  subject: string | null
  message: string
  isRead: boolean
  reply: string | null
  createdAt: string
  senderName: string | null
  clientFirstName: string | null
  clientLastName: string | null
}

interface PortalThread { id: string; subject: string; lastMessageAt: string | null; hasUnread: boolean; clientFirstName: string | null; clientLastName: string | null }
interface ThreadMessage { id: string; senderType: string; senderName: string | null; body: string; createdAt: string }
interface OpenThread { thread: { id: string; subject: string }; messages: ThreadMessage[] }
interface ClientOption { id: string; firstName: string; lastName: string; isActive: boolean | null }

type LoadState = 'loading' | 'ready' | 'error'

// White on each relationship's colour, in both themes. The template's shades held white at 2.2–4.0:1 (cyan, orange,
// grey, blue, pink); these are the same hues, deep enough for 4.5:1 or better.
const RELATIONSHIP_COLOURS: Record<string, string> = {
  spouse: '#ad1457',
  child: '#1565c0',
  parent: '#7b1fa2',
  sibling: '#00838f',
  guardian: '#b45309',
  other: '#616161',
}

/** The hours when no arrival text goes out (the agency's own clock). GET/PUT /api/family-portal/admin/family-texts. */
function QuietHours() {
  const toast = useToast()
  const [start, setStart] = useState('21:00')
  const [end, setEnd] = useState('08:00')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api.get('/api/family-portal/admin/family-texts').then((r: any) => {
      const h = r?.data ?? r
      if (h?.quietHoursStart) setStart(h.quietHoursStart)
      if (h?.quietHoursEnd) setEnd(h.quietHoursEnd)
    }).catch(() => { /* keeps the defaults shown */ })
  }, [])
  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/family-portal/admin/family-texts', { quietHoursStart: start, quietHoursEnd: end })
      toast.success('Quiet hours saved')
    } catch (error) { toast.error(errorMessage(error, 'Could not save the quiet hours')) } finally { setSaving(false) }
  }
  return (
    <div className="hc-card" style={{ marginBottom: '1rem' }}>
      <h4 style={{ marginTop: 0 }}>Arrival texts: quiet hours</h4>
      <p style={{ color: 'var(--hc-muted)', marginTop: 0 }}>No arrival or departure text is sent between these times (your agency's clock). A text held back is not sent later.</p>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ margin: 0 }}><label>Quiet from</label><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="form-group" style={{ margin: 0 }}><label>until</label><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <button className="hc-btn hc-btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

export default function FamilyPortalAdmin() {
  const toast = useToast()
  const prompt = usePrompt()
  const { can } = usePermissions()
  const mayCreate = can('care-portal:create')
  const showQuietHours = useAuth().hasFeature('care_family_texts') && can('care-portal:update')
  const contentOn = useAuth().hasFeature('care_family_content')
  const [familyMembers, setFamilyMembers] = useState<Member[]>([])
  const [messages, setMessages] = useState<FamilyMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'members' | 'messages' | 'threads'>('members')
  const [filter, setFilter] = useState({ status: '', clientId: '' })
  const [showAddModal, setShowAddModal] = useState(false)
  const [showMessageModal, setShowMessageModal] = useState(false)
  const [selectedMessage, setSelectedMessage] = useState<FamilyMessage | null>(null)
  const [editingMember, setEditingMember] = useState<Member | null>(null)
  const [clients, setClients] = useState<ClientOption[]>([])
  // The client portal's message threads (client → office) are answered here too.
  const [threads, setThreads] = useState<PortalThread[]>([])
  const [openThread, setOpenThread] = useState<OpenThread | null>(null)
  const [threadReply, setThreadReply] = useState('')
  // 'loading' until the first answer: an empty list before then is not "no messages".
  const [messagesState, setMessagesState] = useState<LoadState>('loading')
  const [threadsState, setThreadsState] = useState<LoadState>('loading')

  const loadFamilyMembers = async () => {
    try {
      const reply = await api.get('/api/family-portal/admin/members', { status: filter.status || undefined, clientId: filter.clientId || undefined })
      setFamilyMembers(rows<Member>(reply))
    } catch (error) {
      console.error('Failed to load family members:', error)
    } finally {
      setLoading(false)
    }
  }

  // The pickers' clients. GET /api/clients answers a page (50 by default); a larger page so an agency past 50 clients
  // can pick every one (the template asked for the default and showed the first 50).
  const loadClients = async () => {
    try {
      setClients(rows<ClientOption>(await listAll('/api/clients')))
    } catch (error) {
      console.error('Failed to load clients:', error)
    }
  }

  const loadMessages = async () => {
    try {
      setMessages(rows<FamilyMessage>(await api.get('/api/family-portal/admin/messages')))
      setMessagesState('ready')
    } catch (error) {
      console.error('Failed to load messages:', error)
      setMessagesState((prev) => (prev === 'ready' ? 'ready' : 'error'))
    }
  }

  const loadThreads = async () => {
    try {
      setThreads(rows<PortalThread>(await api.get('/api/family-portal/admin/portal-threads')))
      setThreadsState('ready')
    } catch (error) {
      console.error('Failed to load portal messages:', error)
      setThreadsState((prev) => (prev === 'ready' ? 'ready' : 'error'))
    }
  }

  useEffect(() => {
    loadFamilyMembers()
    loadClients()
  }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Both inboxes load with the page, so the unread counts on the tiles and tabs are real from the start.
  useEffect(() => {
    loadMessages()
    loadThreads()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'messages') loadMessages()
    if (activeTab === 'threads') loadThreads()
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const viewThread = async (id: string) => {
    try {
      setOpenThread(await api.get(`/api/family-portal/admin/portal-threads/${id}`) as OpenThread)
      setThreadReply('')
      loadThreads()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error, 'Could not open that conversation'))
    }
  }

  const replyToThread = async (e: FormEvent) => {
    e.preventDefault()
    if (!openThread || !threadReply.trim()) return
    try {
      await api.post(`/api/family-portal/admin/portal-threads/${openThread.thread.id}/reply`, { body: threadReply.trim() })
      viewThread(openThread.thread.id)
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error, 'Reply failed'))
    }
  }

  // A relative's details and switches (anything not sent stays as it is). The family portal re-reads them on every
  // request, so a switch turned off takes effect on the relative's next screen.
  const updateMember = async (memberId: string, patch: EditPatch) => {
    try {
      await api.put(`/api/family-portal/admin/members/${memberId}`, patch)
      setEditingMember(null)
      toast.success('Family member saved')
      loadFamilyMembers()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error, 'Update failed'))
    }
  }

  const createFamilyMember = async (formData: AddForm) => {
    try {
      await api.post('/api/family-portal/admin/members', formData)
      setShowAddModal(false)
      loadFamilyMembers()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const updateMemberStatus = async (memberId: string, isActive: boolean) => {
    try {
      await api.put(`/api/family-portal/admin/members/${memberId}/status`, { isActive })
      loadFamilyMembers()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const resetPassword = async (memberId: string) => {
    const newPassword = await prompt('Enter new password (min 8 characters):', { title: 'Reset password', confirmText: 'Reset' })
    if (newPassword === null) return // backed out
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    try {
      await api.put(`/api/family-portal/admin/members/${memberId}/reset-password`, { password: newPassword })
      toast.success('Password reset successfully')
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const replyToMessage = async (messageId: string, reply: string) => {
    try {
      await api.post(`/api/family-portal/admin/messages/${messageId}/reply`, { reply })
      setShowMessageModal(false)
      loadMessages()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  // Ink and ground set together (homecare.css tokens); the template's white on #4caf50 / #9e9e9e was 2.8 / 2.7:1.
  const getStatusBadge = (isActive: boolean) => (
    <span style={{
      padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold',
      color: isActive ? 'var(--hc-success-ink)' : 'var(--hc-ink-soft)',
      backgroundColor: isActive ? 'var(--hc-success-bg)' : 'var(--hc-subtle)',
    }}>
      {isActive ? 'ACTIVE' : 'INACTIVE'}
    </span>
  )

  const getRelationshipBadge = (relationship: string | null) => (
    <span style={{
      padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold', color: 'white',
      backgroundColor: (relationship && RELATIONSHIP_COLOURS[relationship]) || RELATIONSHIP_COLOURS.other,
    }}>
      {relationship?.toUpperCase()}
    </span>
  )

  const activeCount = familyMembers.filter((m) => m.isActive).length
  const unreadMessages = messages.filter((m) => !m.isRead).length
  const unreadThreads = threads.filter((t) => t.hasUnread).length

  return (
    <div>
      <div className="page-header">
        <h2>👨‍👩‍👧 Family Portal Management</h2>
        {mayCreate && <button className="hc-btn hc-btn-primary" onClick={() => setShowAddModal(true)}>+ Add Family Member</button>}
      </div>

      {showQuietHours && <QuietHours />}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div className="hc-stat-card">
          <h4>Total Members</h4>
          <div className="value">{familyMembers.length}</div>
        </div>
        <div className="hc-stat-card">
          <h4>Active</h4>
          <div className="value" style={{ color: 'var(--hc-green-ink)' }}>{activeCount}</div>
        </div>
        <div className="hc-stat-card" onClick={() => setActiveTab('messages')} style={{ cursor: 'pointer' }}>
          <h4>Unread Messages</h4>
          <div className="value" style={{ color: unreadMessages > 0 ? 'var(--hc-red-ink)' : 'var(--hc-ink)' }}>
            {messagesState === 'loading' ? '…' : unreadMessages}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button className={`hc-btn ${activeTab === 'members' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('members')}>
          Family Members ({familyMembers.length})
        </button>
        <button className={`hc-btn ${activeTab === 'messages' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('messages')}>
          Messages {unreadMessages > 0 && `(${unreadMessages} new)`}
        </button>
        <button className={`hc-btn ${activeTab === 'threads' ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab('threads')}>
          Client Portal Messages {unreadThreads > 0 && `(${unreadThreads} new)`}
        </button>
      </div>

      {/* Members */}
      {activeTab === 'members' && (
        <>
          <div className="hc-card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Status</label>
                <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Client</label>
                <select value={filter.clientId} onChange={(e) => setFilter({ ...filter, clientId: e.target.value })}>
                  <option value="">All Clients</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="hc-card">
            {loading ? (
              <div className="loading"><div className="spinner" /></div>
            ) : familyMembers.length === 0 ? (
              <p>No family members found. Add family members to give them portal access.</p>
            ) : (
              <table className="hc-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Client</th>
                    <th>Relationship</th>
                    <th>Can see</th>
                    <th>Status</th>
                    <th>Last Login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {familyMembers.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <strong>{member.name}</strong>
                        {member.isPrimaryContact && <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem', color: 'var(--hc-ink-soft)' }}>(primary)</span>}
                      </td>
                      <td>{member.email}</td>
                      <td>{member.phone || '-'}</td>
                      <td>{member.clientFirstName} {member.clientLastName}</td>
                      <td>{getRelationshipBadge(member.relationship)}</td>
                      <td>
                        {/* What the relative can see; changed in ✏️ Edit (one door, saved together). */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {permissionsFor(contentOn).map(([key, label]) => {
                            const on = !!member[key]
                            return <span key={key}>{on ? '✓' : '✗'} {label}{on ? '' : ' (off)'}</span>
                          })}
                        </div>
                      </td>
                      <td>{getStatusBadge(member.isActive)}</td>
                      <td style={{ fontSize: '0.85rem' }}>{member.lastLogin ? formatDateTime(member.lastLogin) : 'Never'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          <button type="button" className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => setEditingMember(member)} title="Edit details and what they can see">
                            ✏️ Edit
                          </button>
                          <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => resetPassword(member.id)} title="Reset Password">🔑</button>
                          {member.isActive ? (
                            <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => updateMemberStatus(member.id, false)} title="Deactivate">✗</button>
                          ) : (
                            <button className="hc-btn hc-btn-sm hc-btn-success" onClick={() => updateMemberStatus(member.id, true)} title="Activate">✓</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Family messages */}
      {activeTab === 'messages' && (
        <div className="hc-card">
          {messagesState === 'loading' ? (
            <div className="loading"><div className="spinner" /></div>
          ) : messagesState === 'error' ? (
            <p>Could not load the family messages — refresh to try again.</p>
          ) : messages.length === 0 ? (
            <p>No messages from family members.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{ border: '1px solid var(--hc-line)', borderRadius: '8px', padding: '1rem', backgroundColor: msg.isRead ? 'var(--hc-surface)' : 'var(--hc-warning-bg)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong>{msg.senderName}</strong>
                      <span style={{ marginLeft: '0.5rem', color: 'var(--hc-ink-soft)', fontSize: '0.85rem' }}>(Family of {msg.clientFirstName} {msg.clientLastName})</span>
                    </div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--hc-ink-soft)' }}>{formatDateTime(msg.createdAt)}</span>
                  </div>

                  {msg.subject && <div style={{ fontWeight: 'bold', marginTop: '0.5rem' }}>{msg.subject}</div>}

                  <div style={{ marginTop: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--hc-subtle)', borderRadius: '4px' }}>{msg.message}</div>

                  {msg.reply && (
                    <div style={{ marginTop: '0.5rem', marginLeft: '1rem', padding: '0.75rem', backgroundColor: 'var(--hc-info-bg)', borderRadius: '4px', borderLeft: '3px solid var(--hc-info-ink)' }}>
                      <strong>Your Reply:</strong> {msg.reply}
                    </div>
                  )}

                  {!msg.reply && mayCreate && (
                    <button className="hc-btn hc-btn-sm hc-btn-primary" style={{ marginTop: '0.5rem' }} onClick={() => { setSelectedMessage(msg); setShowMessageModal(true) }}>
                      Reply
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Client portal threads */}
      {activeTab === 'threads' && (
        <div className="hc-card">
          {threadsState === 'loading' ? (
            <div className="loading"><div className="spinner" /></div>
          ) : threadsState === 'error' ? (
            <p>Could not load the client portal messages — refresh to try again.</p>
          ) : threads.length === 0 ? (
            <p>No messages from the client portal.</p>
          ) : (
            <table className="hc-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Subject</th>
                  <th>Last message</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {threads.map((t) => (
                  <tr key={t.id} style={{ fontWeight: t.hasUnread ? 700 : 400 }}>
                    <td>{t.clientFirstName} {t.clientLastName}</td>
                    <td>{t.subject}{t.hasUnread && <span style={{ marginLeft: '0.4rem', color: 'var(--hc-red-ink)', fontSize: '0.75rem' }}>● new</span>}</td>
                    <td style={{ fontSize: '0.85rem' }}>{formatDateTime(t.lastMessageAt)}</td>
                    <td><button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => viewThread(t.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {openThread && (
        <div className="modal active" onClick={() => setOpenThread(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{openThread.thread?.subject}</h3>
              <button className="modal-close" onClick={() => setOpenThread(null)}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '50vh', overflowY: 'auto', marginBottom: '1rem' }}>
              {(openThread.messages || []).map((m) => {
                const staff = m.senderType === 'staff'
                return (
                  <div key={m.id} style={{
                    padding: '0.6rem 0.75rem', borderRadius: '6px',
                    background: staff ? 'var(--hc-info-bg)' : 'var(--hc-subtle)',
                    borderLeft: staff ? '3px solid var(--hc-info-ink)' : '3px solid var(--hc-line)',
                  }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--hc-ink-soft)', marginBottom: '0.25rem' }}>
                      <strong>{m.senderName || (staff ? 'Staff' : 'Client')}</strong> · {formatDateTime(m.createdAt)}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                  </div>
                )
              })}
            </div>
            {mayCreate ? (
              <form onSubmit={replyToThread}>
                <div className="form-group">
                  <label>Reply</label>
                  <textarea value={threadReply} onChange={(e) => setThreadReply(e.target.value)} rows={3} placeholder="Type your reply..." required />
                </div>
                <div className="modal-actions">
                  <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setOpenThread(null)}>Close</button>
                  <button type="submit" className="hc-btn hc-btn-primary">Send Reply</button>
                </div>
              </form>
            ) : (
              <div className="modal-actions">
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setOpenThread(null)}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {editingMember && (
        <div className="modal active" onClick={() => setEditingMember(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit {editingMember.name}</h3>
              <button className="modal-close" aria-label="Close" onClick={() => setEditingMember(null)}>×</button>
            </div>
            <EditMemberForm member={editingMember} onSubmit={(patch) => updateMember(editingMember.id, patch)} onCancel={() => setEditingMember(null)} />
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="modal active" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Family Member</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <AddMemberForm clients={clients} onSubmit={createFamilyMember} onCancel={() => setShowAddModal(false)} />
          </div>
        </div>
      )}

      {showMessageModal && selectedMessage && (
        <div className="modal active" onClick={() => setShowMessageModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reply to Message</h3>
              <button className="modal-close" onClick={() => setShowMessageModal(false)}>×</button>
            </div>
            <ReplyForm message={selectedMessage} onSubmit={(reply) => replyToMessage(selectedMessage.id, reply)} onCancel={() => setShowMessageModal(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add a relative ──
interface AddForm {
  clientId: string; firstName: string; lastName: string; email: string; phone: string; relationship: string; password: string
  canViewSchedule: boolean; canViewCarePlan: boolean; canViewMedications: boolean; canViewVitals: boolean; canViewDocuments: boolean; canMessage: boolean
}

function AddMemberForm({ clients, onSubmit, onCancel }: { clients: ClientOption[]; onSubmit: (f: AddForm) => void; onCancel: () => void }) {
  const toast = useToast()
  const [formData, setFormData] = useState<AddForm>({
    clientId: '', firstName: '', lastName: '', email: '', phone: '', relationship: 'child', password: '',
    canViewSchedule: true, canViewCarePlan: true, canViewMedications: false, canViewVitals: false, canViewDocuments: false, canMessage: true,
  })
  const contentOn = useAuth().hasFeature('care_family_content')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!formData.clientId || !formData.firstName || !formData.email || !formData.password) {
      toast.error('Client, name, email and password are required')
      return
    }
    if (formData.password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    // Feature off: the vitals and documents switches are not shown, so leave them out and the server keeps vitals with the medicines switch.
    const { canViewVitals, canViewDocuments, ...rest } = formData
    onSubmit((contentOn ? formData : rest) as AddForm)
  }

  const box = (key: PermKey, label: string) => (
    <label>
      <input type="checkbox" checked={formData[key]} onChange={(e) => setFormData({ ...formData, [key]: e.target.checked })} style={{ marginRight: '0.5rem' }} />
      {label}
    </label>
  )

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Client *</label>
        <select value={formData.clientId} onChange={(e) => setFormData({ ...formData, clientId: e.target.value })} required>
          <option value="">Select Client</option>
          {clients.filter((c) => c.isActive !== false).map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>First Name *</label>
          <input type="text" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} required />
        </div>
        <div className="form-group">
          <label>Last Name *</label>
          <input type="text" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} required />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Email *</label>
          <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
        </div>
        <div className="form-group">
          <label>Phone</label>
          <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Relationship *</label>
          <select value={formData.relationship} onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}>
            <option value="spouse">Spouse</option>
            <option value="child">Child</option>
            <option value="parent">Parent</option>
            <option value="sibling">Sibling</option>
            <option value="guardian">Guardian</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-group">
          <label>Password *</label>
          <PasswordInput value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="Min 8 characters" required />
        </div>
      </div>

      <div className="form-group">
        <label>Portal Permissions</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          {box('canViewSchedule', 'View Schedule')}
          {box('canViewCarePlan', 'View Care Plan')}
          {box('canViewMedications', contentOn ? 'View Medicine list' : 'View Medications')}
          {contentOn && box('canViewVitals', 'View vitals')}
          {contentOn && box('canViewDocuments', 'View documents')}
          {box('canMessage', 'Send Messages')}
        </div>
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Create Account</button>
      </div>
    </form>
  )
}

// ── Edit a relative: the contact details and every switch, in one PUT with exactly the keys the route reads ──
const RELATIONSHIPS = ['spouse', 'child', 'parent', 'sibling', 'guardian', 'other']
interface EditPatch {
  name: string; phone: string; relationship: string
  canViewSchedule: boolean; canViewCarePlan: boolean; canViewMedications: boolean; canViewVitals: boolean; canViewDocuments: boolean; canMessage: boolean; isPrimaryContact: boolean
  visitTextOptIn: boolean
  visitEmailOptIn: boolean
}

function EditMemberForm({ member, onSubmit, onCancel }: { member: Member; onSubmit: (patch: EditPatch) => Promise<void>; onCancel: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState<EditPatch>({
    name: member.name || '',
    phone: member.phone || '',
    relationship: member.relationship || 'other',
    canViewSchedule: !!member.canViewSchedule,
    canViewCarePlan: !!member.canViewCarePlan,
    canViewMedications: !!member.canViewMedications,
    canViewVitals: !!member.canViewVitals,
    canViewDocuments: !!member.canViewDocuments,
    canMessage: !!member.canMessage,
    isPrimaryContact: !!member.isPrimaryContact,
    visitTextOptIn: !!member.visitTextOptIn,
    visitEmailOptIn: !!member.visitEmailOptIn,
  })
  const textsOn = useAuth().hasFeature('care_family_texts')
  const editContentOn = useAuth().hasFeature('care_family_content')
  const commsOn = useAuth().hasFeature('care_family_comms')
  const [words, setWords] = useState('')
  useEffect(() => {
    if (commsOn && textsOn) api.get('/api/family-comms/consent-wording').then((r: any) => setWords(r?.text || '')).catch(() => {})
  }, [commsOn, textsOn])
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try { await onSubmit({ ...form, name: form.name.trim(), phone: form.phone.trim() }) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        <div className="form-group">
          <label htmlFor="fm-name">Name *</label>
          <input id="fm-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="form-group">
          <label htmlFor="fm-phone">Phone</label>
          <input id="fm-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="fm-rel">Relationship</label>
          <select id="fm-rel" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>
            {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label>What they can see in the family portal</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          {permissionsFor(editContentOn).map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={form.isPrimaryContact} onChange={(e) => setForm({ ...form, isPrimaryContact: e.target.checked })} />
          Primary contact for this client
        </label>
      </div>
      {textsOn && (
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input type="checkbox" checked={form.visitTextOptIn} onChange={(e) => setForm({ ...form, visitTextOptIn: e.target.checked })} />
            Text them when the caregiver arrives and when they leave
          </label>
          <small style={{ color: 'var(--hc-ink-soft)' }}>Only with their yes. Needs a phone number. No texts between 9 PM and 8 AM; they can reply STOP at any time.</small>
          {commsOn && (
            <div style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: 'var(--hc-ink-soft)' }}>
              {member.visitTextOptIn && member.visitTextConsentWording
                ? <>What they agreed to, kept with their yes: &ldquo;{member.visitTextConsentWording}&rdquo;</>
                : member.visitTextOptIn
                  ? <>Their yes was recorded before the words were kept.</>
                  : words ? <>Ticking this records their yes to: &ldquo;{words}&rdquo; Read it to them first.</> : null}
              {member.visitTextOptOutAt && !member.visitTextOptIn ? <div>They replied STOP on {formatDateTime(member.visitTextOptOutAt)}. Texts stay off until you record a new yes.</div> : null}
            </div>
          )}
        </div>
      )}
      {commsOn && (
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input type="checkbox" checked={form.visitEmailOptIn} onChange={(e) => setForm({ ...form, visitEmailOptIn: e.target.checked })} />
            Email them when the caregiver arrives and when they leave
          </label>
          <small style={{ color: 'var(--hc-ink-soft)' }}>Only with their yes. Goes to their login email.</small>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}

// ── Reply to a relative's message ──
function ReplyForm({ message, onSubmit, onCancel }: { message: FamilyMessage; onSubmit: (reply: string) => void; onCancel: () => void }) {
  const toast = useToast()
  const [reply, setReply] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!reply.trim()) { toast.error('Please enter a reply'); return }
    onSubmit(reply)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: 'var(--hc-subtle)', borderRadius: '4px' }}>
        <strong>Original Message from {message.senderName}:</strong>
        <p style={{ margin: '0.5rem 0 0 0' }}>{message.message}</p>
      </div>

      <div className="form-group">
        <label>Your Reply *</label>
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your reply..." rows={4} required />
      </div>

      <div className="modal-actions">
        <button type="button" className="hc-btn hc-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-btn hc-btn-primary">Send Reply</button>
      </div>
    </form>
  )
}
