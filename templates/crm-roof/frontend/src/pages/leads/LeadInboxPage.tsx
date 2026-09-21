import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useIsDark } from '../../shared';
import {
  Inbox, Phone, MessageSquare, UserPlus, XCircle,
  Search, RefreshCw, Clock, TrendingUp, ChevronDown
} from 'lucide-react';

interface Lead {
  id: string;
  sourcePlatform: string;
  homeownerName: string;
  email?: string;
  phone?: string;
  jobType?: string;
  location?: string;
  budget?: string;
  description?: string;
  status: string;
  receivedAt: string;
  contactedAt?: string;
  convertedContactId?: string;
}

interface LeadStats {
  stats: { platform: string; leadsReceived: number; conversionRate: number; avgResponseTimeMin: number | null }[];
  totals: { total: number; new: number; contacted: number; converted: number; dismissed: number };
}

const SOURCE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  angi: { bg: '#e8f5e9', text: '#2e7d32', label: 'Angi' },
  homeadvisor: { bg: '#fff3e0', text: '#e65100', label: 'HomeAdvisor' },
  thumbtack: { bg: '#e3f2fd', text: '#1565c0', label: 'Thumbtack' },
  google_lsa: { bg: '#fce4ec', text: '#c62828', label: 'Google LSA' },
  houzz: { bg: '#f3e5f5', text: '#6a1b9a', label: 'Houzz' },
  other: { bg: '#f5f5f5', text: '#616161', label: 'Other' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new: { bg: '#e3f2fd', text: '#1565c0' },
  contacted: { bg: '#fff3e0', text: '#e65100' },
  converted: { bg: '#e8f5e9', text: '#2e7d32' },
  dismissed: { bg: '#f5f5f5', text: '#9e9e9e' },
};

// This page paints itself with inline styles instead of utility classes, and an inline style is the
// one thing a `dark:` variant can never reach — the cascade can override a class, but not a style
// attribute. So the toggle left the page exactly as it was: a white panel, and (once the base ink rule
// landed) light text on it. useIsDark() reads the `dark` class the shell puts on <html> and re-renders
// when it changes, which is what lets these values follow the theme at all.
//
// The hexes are the Tailwind tokens the rest of the app already uses, so the page matches its
// neighbours rather than inventing a second palette: slate-900 panel, slate-800 raised row, slate-700
// border. `muted` is the pair the contrast guard pins — gray-500 at 4.83:1 on white, slate-400 at
// 6.96:1 on slate-900. The old #999 was 2.85:1 and failed in light mode too.
const themeColors = (dark: boolean) => ({
  panel: dark ? '#0f172a' : '#fff',
  alt: dark ? '#1e293b' : '#f0f0f0',
  hover: dark ? '#1e293b' : '#fafafa',
  border: dark ? '#334155' : '#e5e7eb',
  control: dark ? '#334155' : '#ddd',
  muted: dark ? '#94a3b8' : '#6b7280',
  // The three counters on the stats card sit directly on the panel, so they move with it. Measured on
  // the two grounds they actually have: #1565c0 is 5.75 on white but 3.11 on slate-900, and #2e7d32 is
  // 5.13 then 3.48 — both fine until the panel went dark. #e65100 was already failing the other way,
  // 3.79 on white, so its light value moves to orange-700 (5.18) rather than being kept for symmetry.
  countNew: dark ? '#60a5fa' : '#1565c0',
  countContacted: dark ? '#fb923c' : '#c2410c',
  countConverted: dark ? '#4ade80' : '#2e7d32',
});

export default function LeadInboxPage() {
  const { token } = useAuth();
  const c = themeColors(useIsDark());
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showStats, setShowStats] = useState(true);
  const [expandedLead, setExpandedLead] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (statusFilter) params.set('status', statusFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    if (search) params.set('search', search);

    const res = await fetch(`/api/leads?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    setLeads(json.data || []);
    setTotalPages(json.pagination?.pages || 1);
    setLoading(false);
  }, [token, page, statusFilter, sourceFilter, search]);

  const fetchStats = useCallback(async () => {
    const res = await fetch('/api/leads/stats', { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    setStats(json);
  }, [token]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const updateStatus = async (id: string, status: string) => {
    await fetch(`/api/leads/${id}/status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    fetchLeads();
    fetchStats();
  };

  const convertToContact = async (id: string) => {
    const res = await fetch(`/api/leads/${id}/convert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      fetchLeads();
      fetchStats();
    }
  };

  const timeAgo = (date: string) => {
    const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  const getSourceInfo = (platform: string) => SOURCE_COLORS[platform] || SOURCE_COLORS.other;
  const getStatusStyle = (status: string) => STATUS_COLORS[status] || STATUS_COLORS.new;

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Inbox size={24} /> Lead Inbox
          </h1>
          <p style={{ color: c.muted, marginTop: 4, fontSize: 14 }}>All inbound leads from Angi, Thumbtack, Google LSA & more</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowStats(!showStats)}
            style={{ padding: '8px 16px', border: `1px solid ${c.control}`, borderRadius: 6, background: showStats ? c.alt : c.panel, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          >
            <TrendingUp size={14} /> Stats
          </button>
          <button
            onClick={() => { fetchLeads(); fetchStats(); }}
            style={{ padding: '8px 16px', border: `1px solid ${c.control}`, borderRadius: 6, background: c.panel, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats Panel */}
      {showStats && stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, background: c.panel, borderRadius: 8, border: `1px solid ${c.border}` }}>
            <div style={{ fontSize: 12, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total (30d)</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{stats.totals.total}</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12 }}>
              <span style={{ color: c.countNew }}>{stats.totals.new} new</span>
              <span style={{ color: c.countContacted }}>{stats.totals.contacted} contacted</span>
              <span style={{ color: c.countConverted }}>{stats.totals.converted} converted</span>
            </div>
          </div>
          {stats.stats.map(s => {
            const info = getSourceInfo(s.platform);
            return (
              <div key={s.platform} style={{ padding: 16, background: c.panel, borderRadius: 8, border: `1px solid ${c.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: info.bg, color: info.text }}>{info.label}</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>{s.leadsReceived} leads</div>
                <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12, color: c.muted }}>
                  <span>{s.conversionRate}% conv.</span>
                  {s.avgResponseTimeMin !== null && <span>{s.avgResponseTimeMin}min avg resp.</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: c.muted }} />
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ width: '100%', padding: '8px 12px 8px 34px', border: `1px solid ${c.control}`, borderRadius: 6, fontSize: 14 }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          style={{ padding: '8px 12px', border: `1px solid ${c.control}`, borderRadius: 6, fontSize: 14, background: c.panel }}
        >
          <option value="">All Statuses</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="converted">Converted</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select
          value={sourceFilter}
          onChange={e => { setSourceFilter(e.target.value); setPage(1); }}
          style={{ padding: '8px 12px', border: `1px solid ${c.control}`, borderRadius: 6, fontSize: 14, background: c.panel }}
        >
          <option value="">All Sources</option>
          <option value="angi">Angi</option>
          <option value="homeadvisor">HomeAdvisor</option>
          <option value="thumbtack">Thumbtack</option>
          <option value="google_lsa">Google LSA</option>
          <option value="houzz">Houzz</option>
        </select>
      </div>

      {/* Lead List */}
      <div style={{ background: c.panel, borderRadius: 8, border: `1px solid ${c.border}`, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: c.muted }}>Loading leads...</div>
        ) : leads.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: c.muted }}>
            <Inbox size={48} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontSize: 16, fontWeight: 600 }}>No leads yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Set up your lead sources to start receiving leads</div>
          </div>
        ) : (
          leads.map(lead => {
            const srcInfo = getSourceInfo(lead.sourcePlatform);
            const statusStyle = getStatusStyle(lead.status);
            const isExpanded = expandedLead === lead.id;

            return (
              <div key={lead.id} style={{ borderBottom: `1px solid ${c.alt}` }}>
                <div
                  onClick={() => setExpandedLead(isExpanded ? null : lead.id)}
                  style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'background 0.15s', background: isExpanded ? c.hover : 'transparent' }}
                  onMouseOver={e => { if (!isExpanded) (e.currentTarget as HTMLDivElement).style.background = c.hover; }}
                  onMouseOut={e => { if (!isExpanded) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  <span style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: srcInfo.bg, color: srcInfo.text, whiteSpace: 'nowrap', minWidth: 80, textAlign: 'center' }}>
                    {srcInfo.label}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{lead.homeownerName}</span>
                      {lead.jobType && <span style={{ fontSize: 12, color: c.muted }}>- {lead.jobType}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: c.muted, marginTop: 2 }}>
                      {lead.location && <span>{lead.location}</span>}
                      {lead.budget && <span>Budget: {lead.budget}</span>}
                      {lead.phone && <span>{lead.phone}</span>}
                    </div>
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: statusStyle.bg, color: statusStyle.text, textTransform: 'capitalize' }}>
                    {lead.status}
                  </span>
                  <span style={{ fontSize: 12, color: c.muted, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} /> {timeAgo(lead.receivedAt)}
                  </span>
                  <ChevronDown size={16} style={{ color: c.muted, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${c.alt}` }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '12px 0', fontSize: 13 }}>
                      <div>
                        <div style={{ color: c.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>Contact</div>
                        {lead.homeownerName && <div><strong>Name:</strong> {lead.homeownerName}</div>}
                        {lead.email && <div><strong>Email:</strong> {lead.email}</div>}
                        {lead.phone && <div><strong>Phone:</strong> {lead.phone}</div>}
                        {lead.location && <div><strong>Location:</strong> {lead.location}</div>}
                      </div>
                      <div>
                        <div style={{ color: c.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>Details</div>
                        {lead.jobType && <div><strong>Job Type:</strong> {lead.jobType}</div>}
                        {lead.budget && <div><strong>Budget:</strong> {lead.budget}</div>}
                        {lead.description && <div style={{ marginTop: 4 }}>{lead.description}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: `1px solid ${c.alt}` }}>
                      {lead.phone && (
                        <a
                          href={`tel:${lead.phone.replace(/\D/g, '')}`}
                          style={{ padding: '6px 14px', borderRadius: 6, background: '#2e7d32', color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
                          onClick={e => { e.stopPropagation(); updateStatus(lead.id, 'contacted'); }}
                        >
                          <Phone size={14} /> Call
                        </a>
                      )}
                      {lead.phone && (
                        <a
                          href={`sms:${lead.phone.replace(/\D/g, '')}`}
                          style={{ padding: '6px 14px', borderRadius: 6, background: '#1565c0', color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
                          onClick={e => { e.stopPropagation(); updateStatus(lead.id, 'contacted'); }}
                        >
                          <MessageSquare size={14} /> Text
                        </a>
                      )}
                      {lead.status !== 'converted' && (
                        <button
                          onClick={e => { e.stopPropagation(); convertToContact(lead.id); }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                        >
                          <UserPlus size={14} /> Convert to Contact
                        </button>
                      )}
                      {lead.status !== 'dismissed' && lead.status !== 'converted' && (
                        <button
                          onClick={e => { e.stopPropagation(); updateStatus(lead.id, 'dismissed'); }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.alt, color: c.muted, border: `1px solid ${c.control}`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                        >
                          <XCircle size={14} /> Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ padding: '6px 14px', border: `1px solid ${c.control}`, borderRadius: 6, background: c.panel, cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}
          >
            Prev
          </button>
          <span style={{ padding: '6px 14px', fontSize: 14 }}>Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{ padding: '6px 14px', border: `1px solid ${c.control}`, borderRadius: 6, background: c.panel, cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
