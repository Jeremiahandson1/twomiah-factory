import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Phone, Mail, MapPin, Briefcase, MessageSquare, Key, Send, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

export default function ContactsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<any>(null);
  const [contactJobs, setContactJobs] = useState<any[]>([]);
  const [smsThread, setSmsThread] = useState<any[]>([]);
  const [smsText, setSmsText] = useState('');
  const [sendingSms, setSendingSms] = useState(false);
  const [detailTab, setDetailTab] = useState<'info' | 'jobs' | 'sms'>('info');
  const [togglingPortal, setTogglingPortal] = useState(false);

  const limit = 25;
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set('search', search);
      const res = await fetch(`/api/contacts?${params}`, { headers });
      const data = await res.json();
      setContacts(Array.isArray(data) ? data : data.data || []);
      setTotal(data.pagination?.total || data.total || (Array.isArray(data) ? data.length : 0));
    } catch {
      toast.error('Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [page, search, token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search]);

  const selectContact = async (contact: any) => {
    setSelected(contact);
    setDetailTab('info');
    try {
      const [jobsRes, smsRes] = await Promise.all([
        fetch(`/api/contacts/${contact.id}/jobs`, { headers }).catch(() => null),
        fetch(`/api/contacts/${contact.id}/sms`, { headers }).catch(() => null),
      ]);
      const jobsData = jobsRes ? await jobsRes.json() : [];
      const smsData = smsRes ? await smsRes.json() : [];
      setContactJobs(Array.isArray(jobsData) ? jobsData : jobsData.data || []);
      setSmsThread(Array.isArray(smsData) ? smsData : smsData.data || []);
    } catch {
      setContactJobs([]);
      setSmsThread([]);
    }
  };

  const togglePortal = async () => {
    if (!selected) return;
    setTogglingPortal(true);
    try {
      const res = await fetch(`/api/contacts/${selected.id}/portal`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !selected.portalEnabled }),
      });
      if (!res.ok) throw new Error();
      setSelected((prev: any) => ({ ...prev, portalEnabled: !prev.portalEnabled }));
      toast.success(selected.portalEnabled ? 'Portal access disabled' : 'Portal access enabled');
    } catch {
      toast.error('Failed to toggle portal access');
    } finally {
      setTogglingPortal(false);
    }
  };

  const resendInvite = async () => {
    if (!selected) return;
    try {
      const res = await fetch(`/api/contacts/${selected.id}/portal/invite`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) throw new Error();
      toast.success('Invite sent');
    } catch {
      toast.error('Failed to send invite');
    }
  };

  const sendSms = async () => {
    if (!smsText.trim() || !selected) return;
    setSendingSms(true);
    try {
      const res = await fetch(`/api/contacts/${selected.id}/sms`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: smsText }),
      });
      if (!res.ok) throw new Error();
      const msg = await res.json();
      setSmsThread((prev) => [...prev, msg]);
      setSmsText('');
    } catch {
      toast.error('Failed to send SMS');
    } finally {
      setSendingSms(false);
    }
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
        </div>

        <div className="flex gap-6">
          {/* Contact List */}
          <div className="flex-1">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contacts..."
                className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg"
              />
            </div>

            <div className="bg-white rounded-xl shadow-sm border divide-y">
              {loading ? (
                <div className="py-12 text-center text-gray-400">Loading...</div>
              ) : contacts.length === 0 ? (
                <div className="py-12 text-center text-gray-400">No contacts found</div>
              ) : (
                contacts.map((contact) => (
                  <div
                    key={contact.id}
                    onClick={() => selectContact(contact)}
                    className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selected?.id === contact.id ? 'bg-blue-50 border-l-2 border-l-blue-600' : ''
                    }`}
                  >
                    <p className="font-medium text-gray-900 text-sm">
                      {contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown'}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {contact.phone && (
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{contact.phone}</span>
                      )}
                      {contact.email && (
                        <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{contact.email}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3">
                <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
                <div className="flex gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          {selected && (
            <div className="w-[420px] flex-shrink-0">
              <div className="bg-white rounded-xl shadow-sm border sticky top-6">
                <div className="p-6 border-b">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">
                        {selected.name || `${selected.firstName || ''} ${selected.lastName || ''}`.trim()}
                      </h2>
                    </div>
                    <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b">
                  {(['info', 'jobs', 'sms'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setDetailTab(tab)}
                      className={`flex-1 py-2.5 text-xs font-medium uppercase tracking-wider ${
                        detailTab === tab ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="p-6">
                  {detailTab === 'info' && (
                    <div className="space-y-4">
                      {selected.phone && (
                        <a href={`tel:${selected.phone}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                          <Phone className="w-4 h-4" /> {selected.phone}
                        </a>
                      )}
                      {selected.email && (
                        <a href={`mailto:${selected.email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                          <Mail className="w-4 h-4" /> {selected.email}
                        </a>
                      )}
                      {(selected.address || selected.city) && (
                        <div className="flex items-start gap-2 text-sm text-gray-700">
                          <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                          <span>{[selected.address, selected.city, selected.state, selected.zip].filter(Boolean).join(', ')}</span>
                        </div>
                      )}

                      {/* Portal Access */}
                      <div className="pt-4 border-t space-y-3">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer Portal</h3>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-700">Portal Access</span>
                          <button
                            onClick={togglePortal}
                            disabled={togglingPortal}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              selected.portalEnabled ? 'bg-blue-600' : 'bg-gray-200'
                            }`}
                          >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                              selected.portalEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                          </button>
                        </div>
                        {selected.portalEnabled && (
                          <button
                            onClick={resendInvite}
                            className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                          >
                            <Send className="w-3.5 h-3.5" /> Resend Invite
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {detailTab === 'jobs' && (
                    <div className="space-y-2">
                      {contactJobs.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-4">No jobs</p>
                      ) : (
                        contactJobs.map((job) => (
                          <div
                            key={job.id}
                            onClick={() => navigate(`/crm/jobs/${job.id}`)}
                            className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 cursor-pointer border"
                          >
                            <div>
                              <p className="text-sm font-mono font-semibold text-gray-700">
                                {job.jobNumber || `ROOF-${String(job.id).padStart(4, '0')}`}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5">{job.address || '—'}</p>
                            </div>
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                              {(job.status || '').replace(/_/g, ' ')}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {detailTab === 'sms' && (
                    <div>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto mb-4">
                        {smsThread.length === 0 && (
                          <p className="text-sm text-gray-400 text-center py-4">No messages</p>
                        )}
                        {smsThread.map((msg, i) => (
                          <div
                            key={msg.id || i}
                            className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                              msg.direction === 'inbound'
                                ? 'bg-gray-100 text-gray-900 mr-auto'
                                : 'bg-blue-600 text-white ml-auto'
                            }`}
                          >
                            <p>{msg.body || msg.message}</p>
                            <p className={`text-[10px] mt-1 ${msg.direction === 'inbound' ? 'text-gray-400' : 'text-blue-200'}`}>
                              {msg.createdAt ? new Date(msg.createdAt).toLocaleString() : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={smsText}
                          onChange={(e) => setSmsText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && sendSms()}
                          placeholder="Type a message..."
                          className="flex-1 text-sm border rounded-lg px-3 py-2"
                        />
                        <button
                          onClick={sendSms}
                          disabled={sendingSms || !smsText.trim()}
                          className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
