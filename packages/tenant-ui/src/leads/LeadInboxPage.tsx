// Lead Inbox — ONE page for every CRM (vendored into each template as ../shared). Talks to the shared /api/leads routes.
// Before: three copies; the crm-family one bypassed the api client with a raw fetch + localStorage token, so an access
// token that expired while the page was open turned every load into a silent "No leads yet" and every action into a
// no-op. Now every call goes through the api client (refresh + retry), errors are shown, and the inbox refreshes live
// on lead:created / lead:updated when the template passes its socket subscribe.
import React, { useState, useEffect, useCallback } from 'react'
import { Inbox, Phone, MessageSquare, UserPlus, XCircle, Search, RefreshCw, Clock, TrendingUp, ChevronDown, AlertCircle, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { LeadsApi, LeadsConfig, LeadsSubscribe, LeadsToast, LeadRow, LeadPlatform } from './types'
import { TRADES_LEAD_PLATFORMS } from './types'
import { useLeadPalette, chipColors } from './theme'

interface LeadStats {
  stats: { platform: string; leadsReceived: number; conversionRate: number; avgResponseTimeMin: number | null }[]
  totals: { total: number; new: number; contacted: number; converted: number; dismissed: number }
}
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new: { bg: '#e3f2fd', text: '#1565c0' },
  contacted: { bg: '#fff3e0', text: '#e65100' },
  converted: { bg: '#e8f5e9', text: '#2e7d32' },
  dismissed: { bg: '#f5f5f5', text: '#9e9e9e' },
}
const errMsg = (e: unknown, fallback: string) => (e as Error)?.message || fallback
// The chip's colours are worked out against the card it is ACTUALLY on — see chipColors in ./theme.

export function LeadInboxPage({ api, toast, config, subscribe }: { api: LeadsApi; toast?: LeadsToast; config?: LeadsConfig; subscribe?: LeadsSubscribe }) {
  const c = useLeadPalette()
  const platforms: LeadPlatform[] = config?.platforms || TRADES_LEAD_PLATFORMS
  const jobTypeLabel = config?.jobTypeLabel || 'Job Type'
  const subtitle = config?.inboxSubtitle || 'All inbound leads from external sources in one place'
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [stats, setStats] = useState<LeadStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [showStats, setShowStats] = useState(true)
  const [expandedLead, setExpandedLead] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const json = await api.get('/api/leads', { page, limit: 25, status: statusFilter || undefined, source: sourceFilter || undefined, search: search || undefined })
      setLeads(json?.data || [])
      setTotalPages(json?.pagination?.pages || 1)
      setError('')
    } catch (e) { setError(errMsg(e, 'Failed to load leads')) }
    finally { setLoading(false) }
  }, [api, page, statusFilter, sourceFilter, search])

  const fetchStats = useCallback(async () => {
    try {
      const json = await api.get('/api/leads/stats')
      if (json?.totals && json?.stats) setStats(json)
    } catch { /* stats are decorative; the list error is what the user needs to see */ }
  }, [api])

  useEffect(() => { fetchLeads() }, [fetchLeads])
  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => {
    if (!subscribe) return
    const refresh = () => { fetchLeads(); fetchStats() }
    const offs = [subscribe('lead:created', refresh), subscribe('lead:updated', refresh)]
    return () => { offs.forEach((off) => { try { off() } catch { /* socket gone */ } }) }
  }, [subscribe, fetchLeads, fetchStats])

  const act = async (key: string, fn: () => Promise<void>, fallback: string) => {
    setBusy(key)
    try { await fn(); await Promise.all([fetchLeads(), fetchStats()]) }
    catch (e) { const msg = errMsg(e, fallback); toast ? toast.error(msg) : setError(msg) }
    finally { setBusy(null) }
  }
  const updateStatus = (id: string, status: string) => act(`${id}:${status}`, () => api.put(`/api/leads/${id}/status`, { status }), 'Failed to update lead')
  const convertToContact = (id: string) => act(`${id}:convert`, async () => {
    const res = await api.post(`/api/leads/${id}/convert`)
    if (toast) toast.success(res?.matched ? `Linked to existing contact ${res.contact?.name || ''}`.trim() : `Contact ${res?.contact?.name || ''} created`.trim())
  }, 'Failed to convert lead')

  const timeAgo = (date: string) => {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000))
    if (mins < 60) return `${mins}m ago`
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
    return `${Math.floor(mins / 1440)}d ago`
  }
  const sourceInfo = (platform: string) => {
    const p = platforms.find((x) => x.value === platform)
    const { bg, text } = chipColors(p?.color || '#9e9e9e', c.surface)
    return { bg, text, label: p ? p.label : (platform ? platform.replace(/_/g, ' ') : 'Other') }
  }
  const statusStyle = (status: string) => STATUS_COLORS[status] || STATUS_COLORS.new
  const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({ padding: '8px 16px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, background: c.surface, color: c.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, ...extra })

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', color: c.text }} data-testid="lead-inbox-shared">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Inbox size={24} /> Lead Inbox</h1>
          <p style={{ color: c.muted, marginTop: 4, fontSize: 14 }}>{subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowStats(!showStats)} style={btn({ background: showStats ? c.activeBtn : c.surface })}><TrendingUp size={14} /> Stats</button>
          <button onClick={() => { fetchLeads(); fetchStats() }} style={btn()}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, borderRadius: 8, background: c.errBg, color: c.errText, fontSize: 13 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {showStats && stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, background: c.surface, borderRadius: 8, border: `1px solid ${c.border}` }}>
            <div style={{ fontSize: 12, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total (30d)</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{stats.totals.total}</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12 }}>
              <span style={{ color: c.statNew }}>{stats.totals.new} new</span>
              <span style={{ color: c.statContacted }}>{stats.totals.contacted} contacted</span>
              <span style={{ color: c.statConverted }}>{stats.totals.converted} converted</span>
            </div>
          </div>
          {stats.stats.map((s) => {
            const info = sourceInfo(s.platform)
            return (
              <div key={s.platform} style={{ padding: 16, background: c.surface, borderRadius: 8, border: `1px solid ${c.border}` }}>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: info.bg, color: info.text }}>{info.label}</span>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>{s.leadsReceived} {Number(s.leadsReceived) === 1 ? 'lead' : 'leads'}</div>
                <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12, color: c.muted }}>
                  <span>{s.conversionRate}% conv.</span>
                  {s.avgResponseTimeMin !== null && <span>{s.avgResponseTimeMin}min avg resp.</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: c.faint }} />
          <input type="text" placeholder="Search leads..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            style={{ width: '100%', padding: '8px 12px 8px 34px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, fontSize: 14, background: c.surface, color: c.text }} />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} style={{ padding: '8px 12px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, fontSize: 14, background: c.surface, color: c.text }}>
          <option value="">All Statuses</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="converted">Converted</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1) }} style={{ padding: '8px 12px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, fontSize: 14, background: c.surface, color: c.text }}>
          <option value="">All Sources</option>
          {platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      <div style={{ background: c.surface, borderRadius: 8, border: `1px solid ${c.border}`, overflow: 'hidden' }}>
        {loading && leads.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: c.faint }}>Loading leads...</div>
        ) : leads.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: c.faint }}>
            <Inbox size={48} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontSize: 16, fontWeight: 600 }}>{error ? 'Leads could not be loaded' : (statusFilter || sourceFilter || search) ? 'No leads match these filters' : 'No leads yet'}</div>
            {!error && !(statusFilter || sourceFilter || search) && (
              <div style={{ fontSize: 13, marginTop: 4 }}>
                <Link to="/crm/lead-sources" style={{ color: c.link, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Set up your lead sources <ExternalLink size={12} /></Link> to start receiving leads
              </div>
            )}
          </div>
        ) : (
          leads.map((lead) => {
            const srcInfo = sourceInfo(lead.sourcePlatform)
            const st = statusStyle(lead.status)
            const isExpanded = expandedLead === lead.id
            const tel = (lead.phone || '').replace(/\D/g, '')
            return (
              <div key={lead.id} style={{ borderBottom: `1px solid ${c.divider}` }}>
                <div onClick={() => setExpandedLead(isExpanded ? null : lead.id)}
                  style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: isExpanded ? c.hover : 'transparent' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: srcInfo.bg, color: srcInfo.text, whiteSpace: 'nowrap', minWidth: 80, textAlign: 'center' }}>{srcInfo.label}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{lead.homeownerName}</span>
                      {lead.jobType && <span style={{ fontSize: 12, color: c.muted }}>- {lead.jobType}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: c.faint, marginTop: 2, flexWrap: 'wrap' }}>
                      {lead.location && <span>{lead.location}</span>}
                      {lead.budget && <span>Budget: {lead.budget}</span>}
                      {lead.phone && <span>{lead.phone}</span>}
                    </div>
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: st.bg, color: st.text, textTransform: 'capitalize' }}>{lead.status}</span>
                  <span style={{ fontSize: 12, color: c.faint, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> {timeAgo(lead.receivedAt)}</span>
                  <ChevronDown size={16} style={{ color: c.faint, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${c.divider}` }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '12px 0', fontSize: 13 }}>
                      <div>
                        <div style={{ color: c.faint, fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>Contact</div>
                        <div><strong>Name:</strong> {lead.homeownerName}</div>
                        {lead.email && <div><strong>Email:</strong> {lead.email}</div>}
                        {lead.phone && <div><strong>Phone:</strong> {lead.phone}</div>}
                        {lead.location && <div><strong>Location:</strong> {lead.location}</div>}
                      </div>
                      <div>
                        <div style={{ color: c.faint, fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>Details</div>
                        {lead.jobType && <div><strong>{jobTypeLabel}:</strong> {lead.jobType}</div>}
                        {lead.budget && <div><strong>Budget:</strong> {lead.budget}</div>}
                        {lead.description && <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{lead.description}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: `1px solid ${c.divider}`, flexWrap: 'wrap' }}>
                      {tel && (
                        <a href={`tel:${tel}`} onClick={(e) => { e.stopPropagation(); if (lead.status === 'new') updateStatus(lead.id, 'contacted') }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: '#2e7d32', color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                          <Phone size={14} /> Call
                        </a>
                      )}
                      {tel && (
                        <a href={`sms:${tel}`} onClick={(e) => { e.stopPropagation(); if (lead.status === 'new') updateStatus(lead.id, 'contacted') }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: '#1565c0', color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                          <MessageSquare size={14} /> Text
                        </a>
                      )}
                      {lead.status === 'converted' && lead.convertedContactId ? (
                        <Link to={`/crm/contacts/${lead.convertedContactId}`} onClick={(e) => e.stopPropagation()}
                          style={{ padding: '6px 14px', borderRadius: 6, background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                          <UserPlus size={14} /> Open contact
                        </Link>
                      ) : (
                        <button disabled={busy === `${lead.id}:convert`} onClick={(e) => { e.stopPropagation(); convertToContact(lead.id) }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <UserPlus size={14} /> {busy === `${lead.id}:convert` ? 'Converting…' : 'Convert to Contact'}
                        </button>
                      )}
                      {lead.status !== 'dismissed' && lead.status !== 'converted' && (
                        <button disabled={busy === `${lead.id}:dismissed`} onClick={(e) => { e.stopPropagation(); updateStatus(lead.id, 'dismissed') }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.mutedBtnBg, color: c.faint, border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <XCircle size={14} /> Dismiss
                        </button>
                      )}
                      {lead.status === 'dismissed' && (
                        <button disabled={busy === `${lead.id}:new`} onClick={(e) => { e.stopPropagation(); updateStatus(lead.id, 'new') }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.surface, color: '#1565c0', border: '1px solid #90caf9', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <RefreshCw size={14} /> Reopen
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={btn({ cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 })}>Prev</button>
          <span style={{ padding: '6px 14px', fontSize: 14 }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={btn({ cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 })}>Next</button>
        </div>
      )}
    </div>
  )
}
