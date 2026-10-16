import { toast } from '../Toast';
// src/components/admin/FamilyPortalAdmin.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateTime } from '../../utils/datetime';

// A relative's switches: [the API's name, the list row's snake alias, the label].
const PERMISSIONS = [
  ['canViewSchedule', 'can_view_schedule', 'Schedule'],
  ['canViewCarePlan', 'can_view_care_plan', 'Care plan'],
  ['canViewMedications', 'can_view_medications', 'Medications & vitals'],
  ['canMessage', 'can_message', 'Messages'],
];

const FamilyPortalAdmin = () => {
  const { token } = useAuth();
  const [familyMembers, setFamilyMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('members');
  const [filter, setFilter] = useState({ status: '', clientId: '' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [editingMember, setEditingMember] = useState(null);
  const [clients, setClients] = useState([]);
  // The client portal's message threads (client → office) are answered here too.
  const [threads, setThreads] = useState([]);
  const [openThread, setOpenThread] = useState(null); // { thread, messages }
  const [threadReply, setThreadReply] = useState('');
  // 'loading' until the first answer: an empty list before then is not "no messages" (Run 5 saw
  // "0 unread · No messages from family members." flash over a message that was there).
  const [messagesState, setMessagesState] = useState('loading');
  const [threadsState, setThreadsState] = useState('loading');

  useEffect(() => {
    loadFamilyMembers();
    loadClients();
  }, [filter]);

  // Both inboxes load with the page, so the unread counts on the tiles and tabs are real from the start.
  useEffect(() => {
    loadMessages();
    loadThreads();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'messages') {
      loadMessages();
    }
    if (activeTab === 'threads') {
      loadThreads();
    }
  }, [activeTab]);

  const loadFamilyMembers = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      if (filter.clientId) params.append('clientId', filter.clientId);
      
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/members?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setFamilyMembers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load family members:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/clients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setClients(Array.isArray(data) ? data : (data.clients || []));
    } catch (error) {
      console.error('Failed to load clients:', error);
    }
  };

  const loadMessages = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
      setMessagesState('ready');
    } catch (error) {
      console.error('Failed to load messages:', error);
      setMessagesState(prev => (prev === 'ready' ? 'ready' : 'error'));
    }
  };

  const loadThreads = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/portal-threads`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setThreads(Array.isArray(data) ? data : []);
      setThreadsState('ready');
    } catch (error) {
      console.error('Failed to load portal messages:', error);
      setThreadsState(prev => (prev === 'ready' ? 'ready' : 'error'));
    }
  };

  const viewThread = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/portal-threads/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Could not open that conversation');
      setOpenThread(await res.json());
      setThreadReply('');
      loadThreads();
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const replyToThread = async (e) => {
    e.preventDefault();
    if (!openThread || !threadReply.trim()) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/portal-threads/${openThread.thread.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ body: threadReply.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Reply failed');
      viewThread(openThread.thread.id);
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  // Save a relative's details and permission switches (PUT /admin/members/:id — anything not sent
  // stays as it is). The family portal re-reads them on every request, so a switch turned off takes
  // effect on the relative's next screen.
  const updateMember = async (memberId, patch) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/members/${memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(patch)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Update failed');
      setEditingMember(null);
      toast('Family member saved', 'success');
      loadFamilyMembers();
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const createFamilyMember = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowAddModal(false);
        loadFamilyMembers();
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const updateMemberStatus = async (memberId, isActive) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/members/${memberId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ isActive })
      });
      if (res.ok) {
        loadFamilyMembers();
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const resetPassword = async (memberId) => {
    const newPassword = prompt('Enter new password (min 8 characters):');
    if (!newPassword || newPassword.length < 8) {
      toast('Password must be at least 8 characters');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/members/${memberId}/reset-password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ password: newPassword })
      });
      if (res.ok) {
        toast('Password reset successfully');
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const replyToMessage = async (messageId, reply) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/family-portal/admin/messages/${messageId}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reply })
      });
      if (res.ok) {
        setShowMessageModal(false);
        loadMessages();
      } else {
        const err = await res.json();
        toast('Failed: ' + err.error, 'error');
      }
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const getStatusBadge = (isActive) => (
    <span style={{
      padding: '2px 6px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: 'bold',
      color: 'white',
      backgroundColor: isActive ? '#4caf50' : '#9e9e9e'
    }}>
      {isActive ? 'ACTIVE' : 'INACTIVE'}
    </span>
  );

  const getRelationshipBadge = (relationship) => {
    const colors = {
      spouse: '#e91e63',
      child: '#2196f3',
      parent: '#9c27b0',
      sibling: '#00bcd4',
      guardian: '#ff9800',
      other: '#9e9e9e'
    };
    return (
      <span style={{
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: colors[relationship] || '#9e9e9e'
      }}>
        {relationship?.toUpperCase()}
      </span>
    );
  };

  const activeCount = familyMembers.filter(m => m.is_active).length;
  const unreadMessages = messages.filter(m => !(m.is_read ?? m.isRead)).length;
  const unreadThreads = threads.filter(t => t.has_unread ?? t.hasUnread).length;

  return (
    <div>
      <div className="page-header">
        <h2>👨‍👩‍👧 Family Portal Management</h2>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          + Add Family Member
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div className="stat-card">
          <h4>Total Members</h4>
          <div className="value">{familyMembers.length}</div>
        </div>
        <div className="stat-card">
          <h4>Active</h4>
          <div className="value" style={{ color: '#4caf50' }}>{activeCount}</div>
        </div>
        <div className="stat-card" onClick={() => setActiveTab('messages')} style={{ cursor: 'pointer' }}>
          <h4>Unread Messages</h4>
          <div className="value" style={{ color: unreadMessages > 0 ? '#f44336' : '#333' }}>
            {messagesState === 'loading' ? '…' : unreadMessages}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button 
          className={`btn ${activeTab === 'members' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('members')}
        >
          Family Members ({familyMembers.length})
        </button>
        <button 
          className={`btn ${activeTab === 'messages' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('messages')}
        >
          Messages {unreadMessages > 0 && `(${unreadMessages} new)`}
        </button>
        <button
          className={`btn ${activeTab === 'threads' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('threads')}
        >
          Client Portal Messages {unreadThreads > 0 && `(${unreadThreads} new)`}
        </button>
      </div>

      {/* Members Tab */}
      {activeTab === 'members' && (
        <>
          {/* Filters */}
          <div className="card" style={{ marginBottom: '1rem' }}>
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
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Members Table */}
          <div className="card">
            {loading ? (
              <div className="loading"><div className="spinner"></div></div>
            ) : familyMembers.length === 0 ? (
              <p>No family members found. Add family members to give them portal access.</p>
            ) : (
              <table className="table">
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
                  {familyMembers.map(member => (
                    <tr key={member.id}>
                      <td><strong>{member.name}</strong>{(member.is_primary_contact ?? member.isPrimaryContact) && <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem', color: '#555' }}>(primary)</span>}</td>
                      <td>{member.email}</td>
                      <td>{member.phone || '-'}</td>
                      <td>{member.client_first_name} {member.client_last_name}</td>
                      <td>{getRelationshipBadge(member.relationship)}</td>
                      <td>
                        {/* What the relative can see; changed in ✏️ Edit (one door, saved together). */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {PERMISSIONS.map(([camel, snake, label]) => {
                            const on = !!(member[snake] ?? member[camel]);
                            return <span key={camel}>{on ? '✓' : '✗'} {label}{on ? '' : ' (off)'}</span>;
                          })}
                        </div>
                      </td>
                      <td>{getStatusBadge(member.is_active)}</td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {member.last_login ? formatDateTime(member.last_login) : 'Never'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => setEditingMember(member)}
                            title="Edit details and what they can see"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => resetPassword(member.id)}
                            title="Reset Password"
                          >
                            🔑
                          </button>
                          {member.is_active ? (
                            <button 
                              className="btn btn-sm btn-danger"
                              onClick={() => updateMemberStatus(member.id, false)}
                              title="Deactivate"
                            >
                              ✗
                            </button>
                          ) : (
                            <button 
                              className="btn btn-sm btn-success"
                              onClick={() => updateMemberStatus(member.id, true)}
                              title="Activate"
                            >
                              ✓
                            </button>
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

      {/* Messages Tab */}
      {activeTab === 'messages' && (
        <div className="card">
          {messagesState === 'loading' ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : messagesState === 'error' ? (
            <p>Could not load the family messages — refresh to try again.</p>
          ) : messages.length === 0 ? (
            <p>No messages from family members.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {messages.map(msg => (
                <div 
                  key={msg.id} 
                  style={{ 
                    border: '1px solid #ddd', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    backgroundColor: (msg.is_read ?? msg.isRead) ? '#fff' : '#fff3e0'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong>{msg.sender_name || msg.senderName}</strong>
                      <span style={{ marginLeft: '0.5rem', color: '#666', fontSize: '0.85rem' }}>
                        (Family of {msg.client_first_name} {msg.client_last_name})
                      </span>
                    </div>
                    <span style={{ fontSize: '0.85rem', color: '#666' }}>
                      {formatDateTime(msg.created_at)}
                    </span>
                  </div>
                  
                  {msg.subject && (
                    <div style={{ fontWeight: 'bold', marginTop: '0.5rem' }}>
                      {msg.subject}
                    </div>
                  )}
                  
                  <div style={{ 
                    marginTop: '0.5rem', 
                    padding: '0.75rem',
                    backgroundColor: '#f5f5f5',
                    borderRadius: '4px'
                  }}>
                    {msg.message}
                  </div>

                  {msg.reply && (
                    <div style={{ 
                      marginTop: '0.5rem', 
                      marginLeft: '1rem',
                      padding: '0.75rem',
                      backgroundColor: '#e3f2fd',
                      borderRadius: '4px',
                      borderLeft: '3px solid #2196f3'
                    }}>
                      <strong>Your Reply:</strong> {msg.reply}
                    </div>
                  )}

                  {!msg.reply && (
                    <button 
                      className="btn btn-sm btn-primary"
                      style={{ marginTop: '0.5rem' }}
                      onClick={() => { setSelectedMember(msg); setShowMessageModal(true); }}
                    >
                      Reply
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Client Portal Messages Tab */}
      {activeTab === 'threads' && (
        <div className="card">
          {threadsState === 'loading' ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : threadsState === 'error' ? (
            <p>Could not load the client portal messages — refresh to try again.</p>
          ) : threads.length === 0 ? (
            <p>No messages from the client portal.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Subject</th>
                  <th>Last message</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {threads.map(t => (
                  <tr key={t.id} style={{ fontWeight: (t.has_unread ?? t.hasUnread) ? 700 : 400 }}>
                    <td>{t.client_first_name || t.clientFirstName} {t.client_last_name || t.clientLastName}</td>
                    <td>{t.subject}{(t.has_unread ?? t.hasUnread) && <span style={{ marginLeft: '0.4rem', color: '#B91C1C', fontSize: '0.75rem' }}>● new</span>}</td>
                    <td style={{ fontSize: '0.85rem' }}>{formatDateTime(t.last_message_at || t.lastMessageAt)}</td>
                    <td><button className="btn btn-sm btn-primary" onClick={() => viewThread(t.id)}>Open</button></td>
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
              {(openThread.messages || []).map(m => {
                const staff = (m.sender_type || m.senderType) === 'staff';
                return (
                  <div key={m.id} style={{
                    padding: '0.6rem 0.75rem', borderRadius: '6px',
                    background: staff ? '#e3f2fd' : '#f5f5f5',
                    borderLeft: staff ? '3px solid #1976d2' : '3px solid #9e9e9e',
                  }}>
                    <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: '0.25rem' }}>
                      <strong>{m.sender_name || m.senderName || (staff ? 'Staff' : 'Client')}</strong> · {formatDateTime(m.created_at || m.createdAt)}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                  </div>
                );
              })}
            </div>
            <form onSubmit={replyToThread}>
              <div className="form-group">
                <label>Reply</label>
                <textarea value={threadReply} onChange={(e) => setThreadReply(e.target.value)} rows={3} placeholder="Type your reply..." required />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setOpenThread(null)}>Close</button>
                <button type="submit" className="btn btn-primary">Send Reply</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Family Member Modal */}
      {editingMember && (
        <div className="modal active" onClick={() => setEditingMember(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit {editingMember.name}</h3>
              <button className="modal-close" aria-label="Close" onClick={() => setEditingMember(null)}>×</button>
            </div>
            <EditMemberForm
              member={editingMember}
              onSubmit={(patch) => updateMember(editingMember.id, patch)}
              onCancel={() => setEditingMember(null)}
            />
          </div>
        </div>
      )}

      {/* Add Family Member Modal */}
      {showAddModal && (
        <div className="modal active" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Family Member</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <AddMemberForm 
              clients={clients}
              onSubmit={createFamilyMember}
              onCancel={() => setShowAddModal(false)}
            />
          </div>
        </div>
      )}

      {/* Reply Modal */}
      {showMessageModal && selectedMember && (
        <div className="modal active" onClick={() => setShowMessageModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reply to Message</h3>
              <button className="modal-close" onClick={() => setShowMessageModal(false)}>×</button>
            </div>
            <ReplyForm 
              message={selectedMember}
              onSubmit={(reply) => replyToMessage(selectedMember.id, reply)}
              onCancel={() => setShowMessageModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Add Member Form Component
const AddMemberForm = ({ clients, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    clientId: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    relationship: 'child',
    password: '',
    canViewSchedule: true,
    canViewCarePlan: true,
    canViewMedications: false,
    canMessage: true
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.clientId || !formData.firstName || !formData.email || !formData.password) {
      toast('Client, name, email and password are required');
      return;
    }
    if (formData.password.length < 8) {
      toast('Password must be at least 8 characters');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Client *</label>
        <select 
          value={formData.clientId}
          onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
          required
        >
          <option value="">Select Client</option>
          {clients.filter(c => c.is_active !== false).map(c => (
            <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>First Name *</label>
          <input 
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label>Last Name *</label>
          <input 
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            required
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Email *</label>
          <input 
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label>Phone</label>
          <input 
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Relationship *</label>
          <select 
            value={formData.relationship}
            onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
          >
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
          <input 
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="Min 8 characters"
            required
          />
        </div>
      </div>

      <div className="form-group">
        <label>Portal Permissions</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <label>
            <input 
              type="checkbox"
              checked={formData.canViewSchedule}
              onChange={(e) => setFormData({ ...formData, canViewSchedule: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            View Schedule
          </label>
          <label>
            <input 
              type="checkbox"
              checked={formData.canViewCarePlan}
              onChange={(e) => setFormData({ ...formData, canViewCarePlan: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            View Care Plan
          </label>
          <label>
            <input 
              type="checkbox"
              checked={formData.canViewMedications}
              onChange={(e) => setFormData({ ...formData, canViewMedications: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            View Medications
          </label>
          <label>
            <input 
              type="checkbox"
              checked={formData.canMessage}
              onChange={(e) => setFormData({ ...formData, canMessage: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            Send Messages
          </label>
        </div>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Create Account</button>
      </div>
    </form>
  );
};

// Edit Member Form — the relative's contact details and every switch, saved in one PUT with exactly
// the keys PUT /api/family-portal/admin/members/:id reads.
const RELATIONSHIPS = ['spouse', 'child', 'parent', 'sibling', 'guardian', 'other'];
const EditMemberForm = ({ member, onSubmit, onCancel }) => {
  const flag = (camel, snake) => !!(member[snake] ?? member[camel]);
  const [form, setForm] = useState({
    name: member.name || '',
    phone: member.phone || '',
    relationship: member.relationship || 'other',
    canViewSchedule: flag('canViewSchedule', 'can_view_schedule'),
    canViewCarePlan: flag('canViewCarePlan', 'can_view_care_plan'),
    canViewMedications: flag('canViewMedications', 'can_view_medications'),
    canMessage: flag('canMessage', 'can_message'),
    isPrimaryContact: flag('isPrimaryContact', 'is_primary_contact'),
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast('Name is required'); return; }
    setSaving(true);
    try { await onSubmit({ ...form, name: form.name.trim(), phone: form.phone.trim() }); }
    finally { setSaving(false); }
  };

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
          {PERMISSIONS.map(([camel, , label]) => (
            <label key={camel} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={form[camel]} onChange={(e) => setForm({ ...form, [camel]: e.target.checked })} />
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
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
};

// Reply Form Component
const ReplyForm = ({ message, onSubmit, onCancel }) => {
  const [reply, setReply] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!reply.trim()) {
      toast('Please enter a reply');
      return;
    }
    onSubmit(reply);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
        <strong>Original Message from {message.sender_name || message.senderName}:</strong>
        <p style={{ margin: '0.5rem 0 0 0' }}>{message.message}</p>
      </div>

      <div className="form-group">
        <label>Your Reply *</label>
        <textarea 
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Type your reply..."
          rows={4}
          required
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Send Reply</button>
      </div>
    </form>
  );
};

export default FamilyPortalAdmin;
