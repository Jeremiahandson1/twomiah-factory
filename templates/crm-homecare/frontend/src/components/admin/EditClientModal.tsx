// src/components/admin/EditClientModal.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateForInput, toLocalYMD, parseLocalDate } from '../../utils/date';
import InsuranceCardUploader from './InsuranceCardUploader';

// A JSON list column shown in a textarea, one entry per line, and back.
const listText = (x) => (Array.isArray(x) ? x.map((e) => (typeof e === 'string' ? e : (e?.name ?? JSON.stringify(e)))).join('\n') : (x ? String(x) : ''));
const textList = (t) => String(t || '').split(/\r?\n|,/).map((e) => e.trim()).filter(Boolean);
const idList = (x) => (Array.isArray(x) ? x.map(String) : []);

const EditClientModal = ({ client, referralSources = [], careTypes = [], isOpen, onClose, onSuccess }) => {
  const { token } = useAuth();
  const [caregivers, setCaregivers] = useState([]);
  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE_URL}/api/caregivers?limit=500`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCaregivers(Array.isArray(d) ? d : (d?.caregivers || d?.data || [])))
      .catch(() => setCaregivers([]));
  }, [isOpen, token]);
  const toggleId = (field, id) => setFormData((f) => {
    const cur = new Set(f[field] || []);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    return { ...f, [field]: [...cur] };
  });
  const [activeTab, setActiveTab] = useState('basic');
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // ── Portal state ──────────────────────────────────────────────────────────
  const [portalStatus, setPortalStatus]   = useState(null);
  const [portalEmail, setPortalEmail]     = useState('');
  const [portalName, setPortalName]       = useState('');            // who this login is for
  const [portalAccounts, setPortalAccounts] = useState([]);           // one row per person
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalMessage, setPortalMessage] = useState({ text: '', type: '' });
  const [inviteUrl, setInviteUrl]         = useState('');

  useEffect(() => {
    if (client && isOpen) {
      // GET /api/clients sends the client in camelCase (drizzle's property names); older callers
      // passed snake_case. Read either, so every field opens with what is on file.
      const v = (camel: string, snake: string) => (client[camel] !== undefined && client[camel] !== null ? client[camel] : client[snake]);
      setFormData({
        // Basic Info
        firstName: v('firstName', 'first_name') || '',
        lastName: v('lastName', 'last_name') || '',
        dateOfBirth: formatDateForInput(v('dateOfBirth', 'date_of_birth')),
        gender: client.gender || '',
        phone: client.phone || '',
        email: client.email || '',
        // Address
        address: client.address || '',
        city: client.city || '',
        state: client.state || '{{STATE}}',
        zip: client.zip || '',
        // Billing/Referral (the column is referred_by_id; referralSourceId is the form's name for it)
        referralSourceId: v('referredById', 'referred_by_id') || client.referral_source_id || '',
        medicaidId: v('medicaidId', 'medicaid_id') || '',
        mcoMemberId: v('mcoMemberId', 'mco_member_id') || '',
        careTypeId: v('careTypeId', 'care_type_id') || '',
        isPrivatePay: v('isPrivatePay', 'is_private_pay') || false,
        privatePayRate: v('privatePayRate', 'private_pay_rate') ?? '',
        privatePayRateType: v('privatePayRateType', 'private_pay_rate_type') || 'hourly',
        billingNotes: v('billingNotes', 'billing_notes') || '',
        weeklyAuthorizedUnits: v('weeklyAuthorizedUnits', 'weekly_authorized_units') ?? '',
        // Emergency Contact (filled from the client's contacts below)
        emergencyContactName: '',
        emergencyContactPhone: '',
        emergencyContactRelationship: '',
        // Medical: these three are lists on the client (JSON arrays); the form edits them one per line
        medicalConditions: listText(v('medicalConditions', 'medical_conditions')),
        medications: listText(client.medications),
        allergies: listText(client.allergies),
        medicalNotes: v('medicalNotes', 'medical_notes') || '',
        mobilityAssistanceNeeds: v('assistanceNeeds', 'assistance_needs') || '',
        // Insurance
        insuranceProvider: v('insuranceProvider', 'insurance_provider') || '',
        insuranceId: v('insuranceId', 'insurance_id') || '',
        insuranceGroup: v('insuranceGroup', 'insurance_group') || '',
        // Caregiver Preferences: caregiver ids (the matching engine and the optimizers read them)
        carePreferences: v('carePreferences', 'care_preferences') || '',
        preferredCaregivers: idList(v('preferredCaregivers', 'preferred_caregivers')),
        doNotUseCaregivers: idList(v('doNotUseCaregivers', 'do_not_use_caregivers')),
        // Notes
        notes: client.notes || ''
      });
      setActiveTab('basic');
      setDeleteConfirm(false);
      setMessage('');

      // Load portal status for this client
      setPortalStatus(null);
      setPortalEmail(client.email || '');
      setPortalName('');
      setInviteUrl('');
      setPortalMessage({ text: '', type: '' });
      refreshPortalAccounts();
      fetch(`${API_BASE_URL}/api/portal/admin/clients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(r => { if (!r.ok) throw new Error('Request failed'); return r.json(); })
        .then(data => {
          const found = Array.isArray(data) ? data.find(c => c.id === client.id) : null;
          setPortalStatus(found?.portal_status || 'not_invited');
        })
        .catch(() => setPortalStatus('not_invited'));

      // Emergency contacts live in a separate table (not on the list row), so
      // pull the full client and patch the primary contact into the form —
      // otherwise the Emergency Contact fields always opened blank.
      fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(detail => {
          const contacts = detail?.emergencyContacts || [];
          const ec = contacts.find((x: any) => x.isPrimary ?? x.is_primary) || contacts[0];
          if (ec) {
            setFormData(prev => ({
              ...prev,
              emergencyContactName: ec.name || '',
              emergencyContactPhone: ec.phone || '',
              emergencyContactRelationship: ec.relationship || '',
            }));
          }
        })
        .catch(() => { /* best-effort */ });
    }
  }, [client, isOpen]);

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
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
          notes: formData.notes || null
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update client');
      }

      // Save emergency contact via separate API if fields are filled
      if (formData.emergencyContactName) {
        try {
          // Fetch existing emergency contacts to check for primary
          const ecRes = await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const clientData = await ecRes.json();
          const primaryEc = clientData.emergencyContacts?.find((ec: any) => ec.isPrimary);

          if (primaryEc) {
            // Update not supported via API yet — delete + recreate
            await fetch(`${API_BASE_URL}/api/clients/${client.id}/emergency-contacts/${primaryEc.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
            });
          }
          await fetch(`${API_BASE_URL}/api/clients/${client.id}/emergency-contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              name: formData.emergencyContactName,
              phone: formData.emergencyContactPhone || null,
              relationship: formData.emergencyContactRelationship || null,
              isPrimary: true,
            })
          });
        } catch { /* emergency contact save is best-effort */ }
      }

      setMessage('Client updated successfully!');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (error) {
      setMessage('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete client');

      setMessage('Client deleted.');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (error) {
      setMessage('Error: ' + error.message);
      setDeleteConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  const handleReactivate = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ isActive: true }),
      });
      if (!response.ok) throw new Error('Failed to reactivate client');
      setMessage('Client reactivated.');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (error) {
      setMessage('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !client) return null;

  const tabs = [
    { id: 'basic',     label: '📋 Basic Info' },
    { id: 'billing',   label: '💰 Billing'    },
    { id: 'medical',   label: '🏥 Medical'    },
    { id: 'caregivers',label: '👤 Caregivers' },
    { id: 'portal',    label: '🌐 Portal'     },
  ];

  // ── Portal handlers ───────────────────────────────────────────────────────
  // One portal login per PERSON (their own email + password): their own record of
  // what they viewed, their own revocation, and one person's lockout or password
  // reset never touches the others. Sending to an email that already has a login
  // for this client just makes it a fresh 48-hour link.
  const refreshPortalAccounts = () => {
    if (!client?.id) return;
    fetch(`${API_BASE_URL}/api/portal/admin/clients/${client.id}/accounts`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : []))
      .then(rows => setPortalAccounts(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  };

  const handleSendInvite = async () => {
    if (!portalEmail.trim()) {
      return setPortalMessage({ text: 'Enter an email address first.', type: 'error' });
    }
    setPortalLoading(true);
    setPortalMessage({ text: '', type: '' });
    setInviteUrl('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/portal/admin/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          clientId: client.id,
          invitees: [{ email: portalEmail.trim(), name: portalName.trim() || null }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create invite');
      const ok = (data.results || []).filter(r => !r.error);
      if (ok.length === 0) throw new Error(data.message || 'Invite failed');
      setInviteUrl(ok[0]?.inviteUrl || '');
      setPortalStatus(prev => (prev === 'active' ? prev : 'invite_pending'));
      const msg = data.emailSent
        ? `✉️ Invite email sent to ${portalEmail}. Link is also shown below as a backup.`
        : `⚠️ Invite created but email could NOT be sent. Copy the link below and send it to ${portalEmail} manually.`;
      setPortalMessage({ text: msg, type: data.emailSent ? 'success' : 'warning' });
      setPortalEmail('');
      setPortalName('');
      refreshPortalAccounts();
    } catch (err) {
      setPortalMessage({ text: err.message, type: 'error' });
    } finally {
      setPortalLoading(false);
    }
  };

  const handleRemoveAccount = async (acct) => {
    if (!window.confirm(`Remove portal access for ${acct.display_name || acct.email}? They will no longer be able to log in.`)) return;
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/portal/admin/accounts/${acct.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to remove account');
      setPortalMessage({ text: `Removed portal access for ${acct.email}.`, type: 'warning' });
      refreshPortalAccounts();
    } catch (err) {
      setPortalMessage({ text: err.message, type: 'error' });
    } finally {
      setPortalLoading(false);
    }
  };

  const handleTogglePortal = async (enable) => {
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/portal/admin/clients/${client.id}/toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ enabled: enable }),
      });
      if (!res.ok) throw new Error('Failed to update portal access');
      setPortalStatus(enable ? 'active' : 'disabled');
      setPortalMessage({ text: `Portal access ${enable ? 'enabled' : 'disabled'}.`, type: enable ? 'success' : 'warning' });
      refreshPortalAccounts();
    } catch (err) {
      setPortalMessage({ text: err.message, type: 'error' });
    } finally {
      setPortalLoading(false);
    }
  };

  const copyInviteUrl = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setPortalMessage({ text: 'Invite link copied to clipboard!', type: 'success' });
    });
  };

  const portalStatusDisplay = () => {
    const map = {
      not_invited:    { bg: '#f5f5f5', color: '#666',    icon: '○', label: 'Not Invited'    },
      invite_pending: { bg: '#fef9e7', color: '#d68910', icon: '⏳', label: 'Invite Sent'    },
      invite_expired: { bg: '#fdf2f2', color: '#c0392b', icon: '⚠️', label: 'Invite Expired' },
      active:         { bg: '#eafaf1', color: '#1e8449', icon: '✓', label: 'Active'          },
      disabled:       { bg: '#f0f0f0', color: '#888',    icon: '✕', label: 'Disabled'        },
    };
    const s = map[portalStatus] || map.not_invited;
    return (
      <span style={{
        background: s.bg, color: s.color,
        padding: '4px 12px', borderRadius: '12px',
        fontSize: '0.82rem', fontWeight: 700,
      }}>
        {s.icon} {s.label}
      </span>
    );
  };

  return (
    <div className="modal active">
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h2>Edit: {client.firstName ?? client.first_name} {client.lastName ?? client.last_name}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {message && (
          <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="tabs" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #eee', paddingBottom: '0.5rem' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
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
              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Personal Information</h4>
              <div className="form-grid-2">
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
                <div className="form-group">
                  <label>Date of Birth</label>
                  <input
                    type="date"
                    max={toLocalYMD(new Date())}
                    value={formData.dateOfBirth}
                    onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Gender</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                  >
                    <option value="">Select...</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Address</h4>
              <div className="form-grid-2">
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Street Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>City</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    maxLength="2"
                  />
                </div>
                <div className="form-group">
                  <label>Zip Code</label>
                  <input
                    type="text"
                    value={formData.zip}
                    onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                  />
                </div>
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Emergency Contact</h4>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Contact Name</label>
                  <input
                    type="text"
                    value={formData.emergencyContactName}
                    onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    value={formData.emergencyContactPhone}
                    onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Relationship</label>
                  <input
                    type="text"
                    value={formData.emergencyContactRelationship}
                    onChange={(e) => setFormData({ ...formData, emergencyContactRelationship: e.target.value })}
                    placeholder="e.g., Spouse, Son, Daughter"
                  />
                </div>
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Notes</h4>
              <div className="form-group">
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="General notes about the client..."
                  rows="3"
                />
              </div>
            </div>
          )}

          {/* Billing Tab */}
          {activeTab === 'billing' && (
            <div>
              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Billing Type</h4>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={formData.isPrivatePay}
                    onChange={(e) => setFormData({ ...formData, isPrivatePay: e.target.checked })}
                  />
                  Private Pay (Client pays directly, no referral source)
                </label>
              </div>

              {!formData.isPrivatePay ? (
                <>
                  <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Referral Information</h4>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Payer / referral source</label>
                      <select
                        value={formData.referralSourceId}
                        onChange={(e) => setFormData({ ...formData, referralSourceId: e.target.value })}
                      >
                        <option value="">Select payer...</option>
                        {referralSources.map(rs => (
                          <option key={rs.id} value={rs.id}>{rs.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Care Type</label>
                      <select
                        value={formData.careTypeId}
                        onChange={(e) => setFormData({ ...formData, careTypeId: e.target.value })}
                      >
                        <option value="">Select care type...</option>
                        {careTypes.map(ct => (
                          <option key={ct.id} value={ct.id}>{ct.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Medicaid (MA) ID</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="10–12 digits"
                        value={formData.medicaidId}
                        onChange={(e) => setFormData({ ...formData, medicaidId: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>MCO member ID</label>
                      <input
                        type="text"
                        value={formData.mcoMemberId}
                        onChange={(e) => setFormData({ ...formData, mcoMemberId: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="alert alert-info">
                    <strong>Rate:</strong> Billing rate is determined by the Referral Source + Care Type combination.
                    Manage rates in the Billing Dashboard.
                  </div>
                </>
              ) : (
                <>
                  <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Private Pay Rate</h4>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Care Type</label>
                      <select
                        value={formData.careTypeId}
                        onChange={(e) => setFormData({ ...formData, careTypeId: e.target.value })}
                      >
                        <option value="">Select care type...</option>
                        {careTypes.map(ct => (
                          <option key={ct.id} value={ct.id}>{ct.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Rate Type</label>
                      <select
                        value={formData.privatePayRateType}
                        onChange={(e) => setFormData({ ...formData, privatePayRateType: e.target.value })}
                      >
                        <option value="hourly">Per Hour</option>
                        <option value="15min">Per 15 Minutes</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Rate Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.privatePayRate}
                        onChange={(e) => setFormData({ ...formData, privatePayRate: e.target.value })}
                        placeholder="e.g., 25.00"
                      />
                    </div>
                  </div>
                </>
              )}

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Insurance Information</h4>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Insurance Provider</label>
                  <input
                    type="text"
                    value={formData.insuranceProvider}
                    onChange={(e) => setFormData({ ...formData, insuranceProvider: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Policy Number</label>
                  <input
                    type="text"
                    value={formData.insuranceId}
                    onChange={(e) => setFormData({ ...formData, insuranceId: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Group Number</label>
                  <input
                    type="text"
                    value={formData.insuranceGroup}
                    onChange={(e) => setFormData({ ...formData, insuranceGroup: e.target.value })}
                  />
                </div>
              </div>

              {/* Insurance card photos — their own endpoint, so a 5 MB image is not resent on every save. */}
              {client?.id && <InsuranceCardUploader clientId={client.id} />}

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Weekly Authorized Units</h4>
              <div className="form-group">
                <label>Authorized Units Per Week</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="672"
                  value={formData.weeklyAuthorizedUnits}
                  onChange={(e) => setFormData({ ...formData, weeklyAuthorizedUnits: e.target.value })}
                  placeholder="e.g., 80 units"
                />
                {formData.weeklyAuthorizedUnits && (
                  <div style={{ 
                    marginTop: '0.5rem', 
                    padding: '0.5rem', 
                    background: '#E0F2FE', 
                    borderRadius: '4px',
                    fontSize: '0.9rem',
                    color: '#0369A1'
                  }}>
                    = <strong>{(parseFloat(formData.weeklyAuthorizedUnits) * 0.25).toFixed(2)} hours</strong> per week
                  </div>
                )}
                <small style={{ color: '#666', display: 'block', marginTop: '0.25rem' }}>
                  1 unit = 15 minutes. Used to track if client is fully scheduled.
                </small>
              </div>

              {client?.id && (
                <EvvWeeklyUnits clientId={client.id} initialUnits={client.evv_weekly_units !== undefined ? client.evv_weekly_units : client.evvWeeklyUnits} token={token} />
              )}

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Billing Notes</h4>
              <div className="form-group">
                <textarea
                  value={formData.billingNotes}
                  onChange={(e) => setFormData({ ...formData, billingNotes: e.target.value })}
                  placeholder="Any special billing instructions..."
                  rows="3"
                />
              </div>
            </div>
          )}

          {/* Medical Tab */}
          {activeTab === 'medical' && (
            <div>
              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Medical Conditions</h4>
              <div className="form-group">
                <textarea
                  value={formData.medicalConditions}
                  onChange={(e) => setFormData({ ...formData, medicalConditions: e.target.value })}
                  placeholder="List any medical conditions (diabetes, heart disease, etc.)..."
                  rows="3"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Medications</h4>
              <div className="form-group">
                <textarea
                  value={formData.medications}
                  onChange={(e) => setFormData({ ...formData, medications: e.target.value })}
                  placeholder="List current medications and dosages..."
                  rows="3"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Allergies</h4>
              <div className="form-group">
                <textarea
                  value={formData.allergies}
                  onChange={(e) => setFormData({ ...formData, allergies: e.target.value })}
                  placeholder="List any allergies (medications, foods, etc.)..."
                  rows="2"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Mobility & Assistance Needs</h4>
              <div className="form-group">
                <textarea
                  value={formData.mobilityAssistanceNeeds}
                  onChange={(e) => setFormData({ ...formData, mobilityAssistanceNeeds: e.target.value })}
                  placeholder="Describe mobility limitations, equipment needs (walker, wheelchair), transfer assistance..."
                  rows="3"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Medical Notes</h4>
              <div className="form-group">
                <textarea
                  value={formData.medicalNotes}
                  onChange={(e) => setFormData({ ...formData, medicalNotes: e.target.value })}
                  placeholder="Additional medical notes, care instructions, doctor contacts..."
                  rows="4"
                />
              </div>
            </div>
          )}

          {/* Caregivers Tab */}
          {activeTab === 'caregivers' && (
            <div>
              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Care Preferences & Routines</h4>
              <div className="form-group">
                <textarea
                  value={formData.carePreferences}
                  onChange={(e) => setFormData({ ...formData, carePreferences: e.target.value })}
                  placeholder="Client preferences, daily routines, likes/dislikes, communication style..."
                  rows="4"
                />
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Preferred Caregivers</h4>
              <div className="form-group">
                {caregivers.length === 0 ? <p>No caregivers yet.</p> : caregivers.map((cg) => (
                  <label key={cg.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '2px 0' }}>
                    <input type="checkbox" checked={(formData.preferredCaregivers || []).includes(cg.id)} onChange={() => toggleId('preferredCaregivers', cg.id)} />
                    {cg.firstName ?? cg.first_name} {cg.lastName ?? cg.last_name}
                  </label>
                ))}
              </div>

              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>Do Not Assign</h4>
              <div className="form-group">
                {caregivers.length === 0 ? <p>No caregivers yet.</p> : caregivers.map((cg) => (
                  <label key={cg.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '2px 0' }}>
                    <input type="checkbox" checked={(formData.doNotUseCaregivers || []).includes(cg.id)} onChange={() => toggleId('doNotUseCaregivers', cg.id)} />
                    {cg.firstName ?? cg.first_name} {cg.lastName ?? cg.last_name}
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
              <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
                🌐 Client Portal Access
              </h4>

              {/* Status row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                <span style={{ fontWeight: 600, color: '#444' }}>Status:</span>
                {portalStatus ? portalStatusDisplay() : (
                  <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Loading...</span>
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
                <div style={{
                  background: '#f8f9fa', border: '1px solid #dee2e6',
                  borderRadius: '8px', padding: '14px 16px', marginBottom: '1.5rem',
                }}>
                  <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '6px', fontWeight: 600 }}>
                    INVITE LINK (expires in 48 hours)
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      readOnly
                      value={inviteUrl}
                      style={{ flex: 1, fontSize: '0.8rem', background: '#fff', color: '#333' }}
                      onClick={e => e.target.select()}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={copyInviteUrl}
                      style={{ flexShrink: 0 }}
                    >
                      📋 Copy
                    </button>
                  </div>
                </div>
              )}

              {/* Portal logins — one per person */}
              {portalAccounts.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h5 style={{ marginBottom: '0.75rem', color: '#333' }}>Portal Logins ({portalAccounts.length})</h5>
                  {portalAccounts.map(acct => {
                    const chip = {
                      invite_pending: { bg: '#fef9e7', color: '#8a5a00', label: 'Invite sent' },
                      invite_expired: { bg: '#fdf2f2', color: '#a93226', label: 'Invite expired' },
                      active:         { bg: '#eafaf1', color: '#1e7a43', label: 'Active' },
                      disabled:       { bg: '#f0f0f0', color: '#555',    label: 'Disabled' },
                    }[acct.status] || { bg: '#f5f5f5', color: '#555', label: acct.status };
                    const locked = acct.locked_until && new Date(acct.locked_until) > new Date();
                    return (
                      <div key={acct.id} style={{
                        display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                        background: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '8px',
                        padding: '10px 12px', marginBottom: '6px',
                      }}>
                        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: '#333', fontSize: '0.9rem' }}>
                            {acct.display_name || acct.email}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {acct.display_name ? acct.email : ''}
                            {acct.last_login ? `${acct.display_name ? ' · ' : ''}last login ${parseLocalDate(acct.last_login).toLocaleDateString()}` : ''}
                            {locked ? ' · locked after failed sign-ins (15 min)' : ''}
                          </div>
                        </div>
                        <span style={{
                          background: chip.bg, color: chip.color, fontSize: '0.75rem',
                          fontWeight: 700, padding: '3px 10px', borderRadius: '999px', flexShrink: 0,
                        }}>{chip.label}</span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => handleRemoveAccount(acct)}
                          disabled={portalLoading}
                          title="Remove this person's portal access"
                          style={{ flexShrink: 0, padding: '4px 10px', fontSize: '0.8rem' }}
                        >
                          ✕ Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Invite form — always available, so the office can resend at any point
                  (lost password, new email address). For an existing login it is a
                  re-invite that makes a fresh link. */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h5 style={{ marginBottom: '0.75rem', color: '#333' }}>
                  {portalAccounts.length > 0 ? 'Add Another Login' : 'Invite to Portal'}
                </h5>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: '1 1 160px', margin: 0 }}>
                    <input
                      type="text"
                      value={portalName}
                      onChange={e => setPortalName(e.target.value)}
                      placeholder="Name / relation (e.g. Tyler, son)"
                    />
                  </div>
                  <div className="form-group" style={{ flex: '2 1 220px', margin: 0 }}>
                    <input
                      type="email"
                      value={portalEmail}
                      onChange={e => setPortalEmail(e.target.value)}
                      placeholder="their@email.com"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSendInvite}
                    disabled={portalLoading}
                    style={{ flexShrink: 0 }}
                  >
                    {portalLoading ? 'Sending...' : '✉️ Send Invite'}
                  </button>
                </div>
                <small style={{ color: '#555', marginTop: '6px', display: 'block' }}>
                  Each person gets their <b>own</b> login (their email + their password) to this client's portal —
                  add the client and as many relatives as needed, one at a time. Re-sending to an existing email
                  just generates a fresh 48-hour link (use for lost passwords; the old link stops working).
                </small>
              </div>

              {/* Enable/Disable toggle — shown when portal account exists */}
              {(portalStatus === 'active' || portalStatus === 'disabled') && (
                <div style={{
                  background: '#f8f9fa', borderRadius: '8px',
                  padding: '16px', marginBottom: '1.5rem',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: '8px', color: '#333' }}>
                    Portal Access Control
                  </div>
                  {portalStatus === 'active' ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleTogglePortal(false)}
                      disabled={portalLoading}
                    >
                      {portalLoading ? 'Updating...' : '🚫 Disable Portal Access'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleTogglePortal(true)}
                      disabled={portalLoading}
                    >
                      {portalLoading ? 'Updating...' : '✓ Re-enable Portal Access'}
                    </button>
                  )}
                </div>
              )}

              {/* What the client can see */}
              <div style={{
                background: '#eaf4fd', borderRadius: '8px',
                padding: '14px 16px', fontSize: '0.85rem', color: '#1a5276',
              }}>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>What clients see in their portal:</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {['📅 Upcoming scheduled visits', '🕐 Visit history', '👤 Assigned caregivers', '📄 Invoices & billing', '🔔 Notifications & alerts', '📞 Caregiver contact info'].map(item => (
                    <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="modal-actions" style={{ marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            {client.isActive === false ? (
              <button
                type="button"
                className="btn btn-success"
                onClick={handleReactivate}
                disabled={loading}
                style={{ marginLeft: 'auto' }}
              >
                ♻️ Reactivate Client
              </button>
            ) : !deleteConfirm ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={loading}
                style={{ marginLeft: 'auto' }}
              >
                Delete Client
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={loading}
                style={{ marginLeft: 'auto', background: '#8B0000' }}
              >
                ⚠️ Confirm Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

// EVV (Sandata) units per week — the client's EVV-required allowance from the payer (e.g. MIDAS
// "Attendant care svcs (EVV Required)" in Wisconsin Family Care). Once this Sun–Sat week's Sandata
// minutes reach it, the caregiver app stops sending caregivers to Sandata for this client until
// Sunday (the rest is non-EVV time). Saved on its own (PATCH /api/clients/:id/evv-units), not with
// the main client PUT. Ported from the CVHC CRM.
// Exported: Portal Claim Days opens this same box for a client whose EVV units are blank.
export const EvvWeeklyUnits = ({ clientId, initialUnits, token }) => {
  const [units, setUnits] = useState(initialUnits == null ? '' : String(initialUnits));
  const [week, setWeek] = useState(null);       // this week's usage, or null if not a Sandata client
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: '' });

  const loadWeek = async (adoptUnits = false) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/clients/evv-week?clientId=${encodeURIComponent(clientId)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const rows = await r.json();
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      setWeek(row);
      if (adoptUnits && row && initialUnits === undefined) setUnits(row.evv_weekly_units == null ? '' : String(row.evv_weekly_units));
    } catch { /* the usage line is informational */ }
  };
  useEffect(() => { setUnits(initialUnits == null ? '' : String(initialUnits)); loadWeek(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  // The typed string is kept as typed and checked only on save — never clamped while typing.
  const save = async () => {
    setMsg({ text: '', type: '' });
    const typed = units.trim();
    if (typed !== '' && !/^\d+$/.test(typed)) { setMsg({ text: 'EVV units per week must be a whole number from 0 to 672, or blank.', type: 'error' }); return; }
    if (typed !== '' && Number(typed) > 672) { setMsg({ text: 'EVV units per week must be a whole number from 0 to 672, or blank.', type: 'error' }); return; }
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/clients/${clientId}/evv-units`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ units: typed === '' ? null : Number(typed) }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Save failed (${r.status})`);
      setMsg({ text: 'Saved.', type: 'success' });
      loadWeek();
    } catch (e) {
      setMsg({ text: e.message, type: 'error' });
    } finally { setSaving(false); }
  };

  const fmtH = (min) => `${(min / 60).toFixed(2).replace(/\.?0+$/, '')}h`;
  const typedOk = /^\d+$/.test(units.trim()) && Number(units.trim()) <= 672;
  return (
    <>
      <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>EVV (Sandata) Units Per Week</h4>
      <div className="form-group">
        <label>EVV-required units per week (Sun–Sat)</label>
        <div className="flex items-center gap-2">
          <input type="text" inputMode="numeric" value={units}
            onChange={(e) => setUnits(e.target.value)} placeholder="from the payer's authorization, e.g. 12" style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save EVV units'}</button>
        </div>
        {typedOk && (
          <div className="mt-2 rounded bg-sky-100 p-2 text-sm text-sky-800 dark:bg-sky-950 dark:text-sky-200">
            = <strong>{fmtH(Number(units.trim()) * 15)}</strong> of Sandata visits per week
          </div>
        )}
        {week && (
          <div className={week.next_visit_to_sandata
            ? 'mt-2 rounded bg-amber-100 p-2 text-sm text-gray-700 dark:bg-amber-950 dark:text-amber-100'
            : 'mt-2 rounded bg-emerald-50 p-2 text-sm text-gray-700 dark:bg-emerald-950 dark:text-emerald-100'}>
            This week ({week.week_start} – {week.week_end}): <strong>{fmtH(week.used_minutes)}</strong> sent to Sandata
            {week.allowance_minutes != null && <> of {fmtH(week.allowance_minutes)}</>} across {week.sandata_visits} visit{week.sandata_visits === 1 ? '' : 's'}.
            {' '}{week.allowance_minutes == null
              ? 'No allowance entered — every visit is sent to Sandata.'
              : week.next_visit_to_sandata ? 'The next visit goes to Sandata.' : 'EVV hours met — no more Sandata until Sunday.'}
          </div>
        )}
        {msg.text && <div className={msg.type === 'error' ? 'mt-1 text-sm text-red-700 dark:text-red-300' : 'mt-1 text-sm text-emerald-700 dark:text-emerald-300'}>{msg.text}</div>}
        <small style={{ color: '#666', display: 'block', marginTop: '0.25rem' }}>
          From the payer's EVV-required (attendant care) authorization line. Blank = not entered (caregivers are sent to Sandata every visit). 0 = no EVV hours (never sent).
          Only clients whose payer is a Sandata payer and who have a Medicaid ID on file are in Sandata.
        </small>
      </div>
    </>
  );
};

export default EditClientModal;
