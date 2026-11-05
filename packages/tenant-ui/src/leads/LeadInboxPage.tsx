// Lead Inbox — ONE page for every CRM (vendored into each template as ../shared). Talks to the shared /api/leads routes.
// Before: three copies; the crm-family one bypassed the api client with a raw fetch + localStorage token, so an access
// token that expired while the page was open turned every load into a silent "No leads yet" and every action into a
// no-op. Now every call goes through the api client (refresh + retry), errors are shown, and the inbox refreshes live
// on lead:created / lead:updated when the template passes its socket subscribe.
import React, { useState, useEffect, useCallback } from 'react'
import { Inbox, Phone, UserPlus, XCircle, Search, RefreshCw, Clock, TrendingUp, ChevronDown, AlertCircle, ExternalLink, ShieldAlert, ArrowRight, Flag, CalendarPlus, CalendarX } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import type { LeadsApi, LeadsConfig, LeadsSubscribe, LeadsToast, LeadRow, LeadPlatform } from './types'
import { TextButton } from '../text/TextButton'
import { TRADES_LEAD_PLATFORMS, BUILT_IN_LEAD_PLATFORMS } from './types'
import { useLeadPalette, chipColors } from './theme'
import type { LeadPalette } from './theme'
import { useMayWrite } from '../auth/PermissionsContext'
import { codeLabel } from '../labels/codes'
import { companyLocalInput, companyFromLocalInput, whenDateTime } from '../time/companyClock'

interface LeadStats {
  stats: { platform: string; leadsReceived: number; conversionRate: number; avgResponseTimeMin: number | null }[]
  totals: { total: number; new: number; contacted: number; converted: number; dismissed: number; spam?: number }
  /** All-time number of enquiries in each status (the server sends it with the Spam status). */
  counts?: Record<string, number>
  /** The dashboard's New leads number and what it is made of: enquiries here, and contacts added as leads nobody has acted on. */
  waiting?: { total: number; inbox: number; contacts: number }
}
/**
 * THE STATUS CHIPS COME FROM THE PALETTE. (T58d)
 *
 * This was a module-level map of four hardcoded pairs, chosen for a white card — so in dark mode all
 * four were pale lozenges, which is the owner's "Lead Inbox text contrast". Two of those pairs were
 * below AA even in LIGHT mode: "contacted" at 4.0:1 and "dismissed" at 2.6:1, the least readable
 * chip on the page.
 *
 * A module-level constant cannot read the theme — it is evaluated once, before any hook runs — which
 * is most of why it stayed hardcoded. So it is a function of the palette now, called inside the
 * component. See `chip` in ./theme.
 */
const statusChip = (c: LeadPalette, status: string): { bg: string; text: string } =>
  c.chip[(status as keyof LeadPalette['chip'])] ?? { bg: c.mutedBtnBg, text: c.faint }
const errMsg = (e: unknown, fallback: string) => (e as Error)?.message || fallback
// The chip's colours are worked out against the card it is ACTUALLY on — see chipColors in ./theme.

export function LeadInboxPage({ api, toast, config, subscribe }: { api: LeadsApi; toast?: LeadsToast; config?: LeadsConfig; subscribe?: LeadsSubscribe }) {
  const c = useLeadPalette()
  const navigate = useNavigate()
  /**
   * Convert raises a CONTACT (POST /api/leads/:id/convert → `contacts:create`); Dismiss and Reopen
   * move the lead's own status (PUT /:id/status → `contacts:update`). A seat holding neither still
   * reads the inbox, which is how a lead gets looked at before anybody acts on it. (T42)
   */
  const mayMakeContact = useMayWrite('contacts:create')
  const mayWorkContacts = useMayWrite('contacts:update')
  // …or, where the inbox asks its own permission (config.ownPermission — the unified app; live role check 2026-10-23),
  // leads:update to triage, and leads:update with contacts:create to convert: the server's gates (leads.ts).
  const mayWorkLeads = useMayWrite('leads:update')
  const mayConvert = config?.ownPermission ? mayWorkLeads && mayMakeContact : mayMakeContact
  const mayTriage = config?.ownPermission ? mayWorkLeads : mayWorkContacts
  // Setting up a lead source is POST /api/leads/sources — leads:create. The empty inbox sent every seat there. (T68)
  const maySetUpSources = useMayWrite('leads:create')
  // A site visit is a lead AND a calendar entry: it asks leads:update with schedule:create (book, move) or schedule:update (cancel).
  const maySchedule = useMayWrite('schedule:create')
  const mayReschedule = useMayWrite('schedule:update')
  const mayBookVisit = config?.ownPermission === true && config?.siteVisit === true && mayWorkLeads && maySchedule
  const mayCancelVisit = config?.ownPermission === true && config?.siteVisit === true && mayWorkLeads && mayReschedule
  const mayMarkLost = config?.ownPermission === true && config?.lost === true && mayWorkLeads
  const offered: LeadPlatform[] = config?.platforms || TRADES_LEAD_PLATFORMS
  // The website form and call tracking post here on every vertical, so the inbox can always name them —
  // see BUILT_IN_LEAD_PLATFORMS. A vertical's own entry for the same id wins. A phone call arrives only through call
  // tracking, so it is named only where that can happen (config.phoneCalls): a shop has none, and its filter offered
  // "Phone call" (store final check, 2026-10-26). Absent — the templates — as before.
  const builtIn = BUILT_IN_LEAD_PLATFORMS.filter((b) => b.value !== 'phone' || config?.phoneCalls !== false)
  const platforms: LeadPlatform[] = [...offered, ...builtIn.filter((b) => !offered.some((p) => p.value === b.value))]
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
  // The small form open under one enquiry: why it was lost, or when the site visit is.
  const [panel, setPanel] = useState<{ id: string; kind: 'lost' | 'visit' } | null>(null)
  const [reasons, setReasons] = useState<Array<{ id: string; label: string }>>([])
  const [lostForm, setLostForm] = useState({ reason: '', note: '' })
  const [visitForm, setVisitForm] = useState({ when: '', minutes: '60', notes: '' })

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
  useEffect(() => {
    if (!config?.lost) return
    api.get('/api/lead-lost/reasons').then((r: any) => setReasons((r?.data || []).map((x: any) => ({ id: x.id, label: x.label })))).catch(() => setReasons([]))
  }, [api, config?.lost])
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
  const reasonLabel = (id?: string | null) => reasons.find((r) => r.id === id)?.label || (id ? codeLabel(id) : '')
  const openPanel = (lead: LeadRow, kind: 'lost' | 'visit') => {
    setPanel({ id: lead.id, kind })
    if (kind === 'lost') setLostForm({ reason: '', note: '' })
    else setVisitForm({ when: lead.siteVisitAt ? companyLocalInput(lead.siteVisitAt) : '', minutes: '60', notes: '' })
  }
  const markLost = (id: string) => act(`${id}:lost`, async () => {
    if (!lostForm.reason) throw new Error('Pick a reason')
    await api.post(`/api/lead-lost/${id}`, { reason: lostForm.reason, ...(lostForm.note.trim() ? { note: lostForm.note.trim() } : {}) })
    setPanel(null)
    toast?.success('Marked lost')
  }, 'Failed to mark the enquiry lost')
  const reopenLost = (id: string) => act(`${id}:reopen`, async () => { await api.delete('/api/lead-lost', id); toast?.success('Enquiry reopened') }, 'Failed to reopen the enquiry')
  const bookVisit = (id: string) => act(`${id}:visit`, async () => {
    const at = companyFromLocalInput(visitForm.when)
    if (!visitForm.when || Number.isNaN(at.getTime())) throw new Error('Pick the day and time of the visit')
    await api.post(`/api/lead-site-visit/${id}`, { start: at.toISOString(), minutes: Number(visitForm.minutes) || 60, ...(visitForm.notes.trim() ? { notes: visitForm.notes.trim() } : {}) })
    setPanel(null)
    toast?.success('Site visit booked')
  }, 'Failed to book the site visit')
  const cancelVisit = (id: string) => act(`${id}:cancelvisit`, async () => { await api.delete('/api/lead-site-visit', id); toast?.success('Site visit cancelled') }, 'Failed to cancel the site visit')
  const convertToContact = (id: string) => act(`${id}:convert`, async () => {
    const res = await api.post(`/api/leads/${id}/convert`)
    if (toast) toast.success(res?.matched ? `Linked to existing contact ${res.contact?.name || ''}`.trim() : `Contact ${res?.contact?.name || ''} created`.trim())
  }, 'Failed to convert lead')
  // Convert and start the work in one step: the enquiry becomes a contact (or is linked to the one already there), and the
  // screen for the job, quote or project opens with that person chosen. An enquiry already converted goes straight there.
  const startAfterConvert = config?.startAfterConvert || []
  const convertAndStart = (lead: LeadRow, opt: { id: string; label: string; to: (contactId: string) => string }) => act(`${lead.id}:start:${opt.id}`, async () => {
    let contactId = lead.status === 'converted' ? lead.convertedContactId || '' : ''
    if (!contactId) {
      const res = await api.post(`/api/leads/${lead.id}/convert`)
      contactId = res?.contact?.id || ''
    }
    if (!contactId) throw new Error('Could not find the contact for this enquiry')
    navigate(opt.to(contactId))
  }, 'Failed to start from this lead')

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
  const statusStyle = (status: string) => statusChip(c, status)
  const countOf = (status: string) => (stats?.counts && typeof stats.counts[status] === 'number' ? ` (${stats.counts[status]})` : '')
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

      {stats?.waiting && stats.waiting.total > 0 && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: c.muted }} data-testid="lead-waiting">
          <strong style={{ color: c.text }}>{stats.waiting.total} new {stats.waiting.total === 1 ? 'lead' : 'leads'}</strong>
          {' — '}{stats.waiting.inbox} {stats.waiting.inbox === 1 ? 'enquiry' : 'enquiries'} in this inbox
          {stats.waiting.contacts > 0 && <> and {stats.waiting.contacts} {stats.waiting.contacts === 1 ? 'contact' : 'contacts'} added as leads that nobody has quoted, booked or billed yet. <Link to="/crm/new-leads" style={{ color: c.link }}>See them all</Link></>}
        </p>
      )}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: c.faint }} />
          <input type="text" placeholder="Search leads..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            style={{ width: '100%', padding: '8px 12px 8px 34px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, fontSize: 14, background: c.surface, color: c.text }} />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} style={{ padding: '8px 12px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, fontSize: 14, background: c.surface, color: c.text }}>
          <option value="">All Statuses</option>
          <option value="new">New{countOf('new')}</option>
          <option value="contacted">Contacted{countOf('contacted')}</option>
          <option value="converted">Converted{countOf('converted')}</option>
          <option value="dismissed">Dismissed{countOf('dismissed')}</option>
          {config?.spam && <option value="spam">Spam{countOf('spam')}</option>}
          {config?.lost && <option value="lost">Lost{countOf('lost')}</option>}
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
            {!error && !(statusFilter || sourceFilter || search) && maySetUpSources && (
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
                      {lead.jobType && <span style={{ fontSize: 12, color: c.muted }}>- {codeLabel(lead.jobType)}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: c.faint, marginTop: 2, flexWrap: 'wrap' }}>
                      {lead.location && <span>{lead.location}</span>}
                      {lead.budget && <span>Budget: {lead.budget}</span>}
                      {lead.phone && <span>{lead.phone}</span>}
                    </div>
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: st.bg, color: st.text, textTransform: 'capitalize' }}>{codeLabel(lead.status)}</span>
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
                        {lead.jobType && <div><strong>{jobTypeLabel}:</strong> {codeLabel(lead.jobType)}</div>}
                        {lead.budget && <div><strong>Budget:</strong> {lead.budget}</div>}
                        {config?.siteVisit && lead.siteVisitAt && <div data-testid="lead-site-visit"><strong>Site visit:</strong> {whenDateTime(lead.siteVisitAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>}
                        {config?.lost && lead.status === 'lost' && <div data-testid="lead-lost-reason"><strong>Lost because:</strong> {reasonLabel(lead.lostReason)}{lead.lostNote ? ` — ${lead.lostNote}` : ''}</div>}
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
                        <span onClick={(e) => e.stopPropagation()}>
                          <TextButton phone={lead.phone} name={lead.homeownerName} record={{ entity: 'lead', id: lead.id }} onTexted={() => { if (lead.status === 'new') updateStatus(lead.id, 'contacted') }} />
                        </span>
                      )}
                      {/* Convert raises a CONTACT, so it asks contacts:create; Dismiss and Reopen
                          move the lead's own status and ask contacts:update. A seat with neither
                          still reads the inbox, which is how a lead gets looked at. (T42) */}
                      {lead.status === 'converted' && lead.convertedContactId ? (
                        <Link to={`/crm/contacts/${lead.convertedContactId}`} onClick={(e) => e.stopPropagation()}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.chip.converted.bg, color: c.chip.converted.text, border: `1px solid ${c.chip.converted.text}44`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                          <UserPlus size={14} /> Open contact
                        </Link>
                      ) : (
                        mayConvert && lead.status !== 'spam' && lead.status !== 'lost' && <button disabled={busy === `${lead.id}:convert`} onClick={(e) => { e.stopPropagation(); convertToContact(lead.id) }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.chip.converted.bg, color: c.chip.converted.text, border: `1px solid ${c.chip.converted.text}44`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <UserPlus size={14} /> {busy === `${lead.id}:convert` ? 'Converting…' : 'Convert to Contact'}
                        </button>
                      )}
                      {mayConvert && lead.status !== 'spam' && lead.status !== 'lost' && startAfterConvert.map((opt) => (
                        <button key={opt.id} disabled={busy === `${lead.id}:start:${opt.id}`} onClick={(e) => { e.stopPropagation(); convertAndStart(lead, opt) }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.surface, color: c.link, border: `1px solid ${c.link}66`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <ArrowRight size={14} /> {busy === `${lead.id}:start:${opt.id}` ? 'Working…' : lead.status === 'converted' ? opt.label : `Convert and ${opt.label.charAt(0).toLowerCase()}${opt.label.slice(1)}`}
                        </button>
                      ))}
                      {config?.spam && mayTriage && lead.status !== 'spam' && lead.status !== 'converted' && (
                        <button disabled={busy === `${lead.id}:spam`} onClick={(e) => { e.stopPropagation(); updateStatus(lead.id, 'spam') }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.mutedBtnBg, color: c.faint, border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <ShieldAlert size={14} /> Spam
                        </button>
                      )}
                      {config?.spam && mayTriage && lead.status === 'spam' && (
                        <button disabled={busy === `${lead.id}:new`} onClick={(e) => { e.stopPropagation(); updateStatus(lead.id, 'new') }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.surface, color: c.statNew, border: `1px solid ${c.statNew}66`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <RefreshCw size={14} /> Not spam
                        </button>
                      )}
                      {mayBookVisit && ['new', 'contacted', 'converted'].includes(lead.status) && (
                        <button disabled={busy === `${lead.id}:visit`} onClick={(e) => { e.stopPropagation(); openPanel(lead, 'visit') }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.surface, color: c.link, border: `1px solid ${c.link}66`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <CalendarPlus size={14} /> {lead.siteVisitAt ? 'Move site visit' : 'Book site visit'}
                        </button>
                      )}
                      {mayCancelVisit && lead.siteVisitAt && (
                        <button disabled={busy === `${lead.id}:cancelvisit`} onClick={(e) => { e.stopPropagation(); cancelVisit(lead.id) }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.mutedBtnBg, color: c.faint, border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <CalendarX size={14} /> Cancel site visit
                        </button>
                      )}
                      {mayMarkLost && ['new', 'contacted'].includes(lead.status) && (
                        <button disabled={busy === `${lead.id}:lost`} onClick={(e) => { e.stopPropagation(); openPanel(lead, 'lost') }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.mutedBtnBg, color: c.faint, border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <Flag size={14} /> Lost
                        </button>
                      )}
                      {mayMarkLost && lead.status === 'lost' && (
                        <button disabled={busy === `${lead.id}:reopen`} onClick={(e) => { e.stopPropagation(); reopenLost(lead.id) }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.surface, color: c.statNew, border: `1px solid ${c.statNew}66`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <RefreshCw size={14} /> Reopen
                        </button>
                      )}
                      {mayTriage && lead.status !== 'dismissed' && lead.status !== 'converted' && lead.status !== 'spam' && lead.status !== 'lost' && (
                        <button disabled={busy === `${lead.id}:dismissed`} onClick={(e) => { e.stopPropagation(); updateStatus(lead.id, 'dismissed') }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.mutedBtnBg, color: c.faint, border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <XCircle size={14} /> Dismiss
                        </button>
                      )}
                      {mayTriage && lead.status === 'dismissed' && (
                        <button disabled={busy === `${lead.id}:new`} onClick={(e) => { e.stopPropagation(); updateStatus(lead.id, 'new') }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: c.surface, color: c.statNew, border: `1px solid ${c.statNew}66`, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <RefreshCw size={14} /> Reopen
                        </button>
                      )}
                    </div>
                    {panel?.id === lead.id && panel.kind === 'lost' && (
                      <div onClick={(e) => e.stopPropagation()} data-testid="lead-lost-form" style={{ marginTop: 12, padding: 12, border: `1px solid ${c.border}`, borderRadius: 8, display: 'grid', gap: 8 }}>
                        <label style={{ fontSize: 12, color: c.muted }}>Why was it lost?
                          <select aria-label="Reason" value={lostForm.reason} onChange={(e) => setLostForm((f) => ({ ...f, reason: e.target.value }))}
                            style={{ display: 'block', marginTop: 4, padding: '8px 12px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, fontSize: 14, background: c.surface, color: c.text, width: '100%' }}>
                            <option value="">Pick a reason</option>
                            {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                          </select>
                        </label>
                        <label style={{ fontSize: 12, color: c.muted }}>Note {lostForm.reason === 'other' ? '(needed)' : '(optional)'}
                          <input aria-label="Note" type="text" maxLength={500} value={lostForm.note} onChange={(e) => setLostForm((f) => ({ ...f, note: e.target.value }))}
                            style={{ display: 'block', marginTop: 4, padding: '8px 12px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, fontSize: 14, background: c.surface, color: c.text, width: '100%' }} />
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button disabled={!lostForm.reason || (lostForm.reason === 'other' && !lostForm.note.trim()) || busy === `${lead.id}:lost`} onClick={() => markLost(lead.id)}
                            style={{ padding: '6px 14px', borderRadius: 6, background: c.activeBtn, color: c.text, border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Mark lost</button>
                          <button onClick={() => setPanel(null)} style={{ padding: '6px 14px', borderRadius: 6, background: c.surface, color: c.muted, border: `1px solid ${c.border}`, fontSize: 12, cursor: 'pointer' }}>Never mind</button>
                        </div>
                      </div>
                    )}
                    {panel?.id === lead.id && panel.kind === 'visit' && (
                      <div onClick={(e) => e.stopPropagation()} data-testid="lead-visit-form" style={{ marginTop: 12, padding: 12, border: `1px solid ${c.border}`, borderRadius: 8, display: 'grid', gap: 8 }}>
                        <label style={{ fontSize: 12, color: c.muted }}>Day and time
                          <input aria-label="Day and time" type="datetime-local" value={visitForm.when} onChange={(e) => setVisitForm((f) => ({ ...f, when: e.target.value }))}
                            style={{ display: 'block', marginTop: 4, padding: '8px 12px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, fontSize: 14, background: c.surface, color: c.text }} />
                        </label>
                        <label style={{ fontSize: 12, color: c.muted }}>Length (minutes)
                          <input aria-label="Length in minutes" type="number" min={15} max={480} step={15} value={visitForm.minutes} onChange={(e) => setVisitForm((f) => ({ ...f, minutes: e.target.value }))}
                            style={{ display: 'block', marginTop: 4, padding: '8px 12px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, fontSize: 14, background: c.surface, color: c.text, width: 120 }} />
                        </label>
                        <label style={{ fontSize: 12, color: c.muted }}>Notes for whoever goes (optional)
                          <input aria-label="Visit notes" type="text" maxLength={500} value={visitForm.notes} onChange={(e) => setVisitForm((f) => ({ ...f, notes: e.target.value }))}
                            style={{ display: 'block', marginTop: 4, padding: '8px 12px', border: `1px solid ${c.inputBorder}`, borderRadius: 6, fontSize: 14, background: c.surface, color: c.text, width: '100%' }} />
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button disabled={!visitForm.when || busy === `${lead.id}:visit`} onClick={() => bookVisit(lead.id)}
                            style={{ padding: '6px 14px', borderRadius: 6, background: c.activeBtn, color: c.text, border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{lead.siteVisitAt ? 'Move visit' : 'Book visit'}</button>
                          <button onClick={() => setPanel(null)} style={{ padding: '6px 14px', borderRadius: 6, background: c.surface, color: c.muted, border: `1px solid ${c.border}`, fontSize: 12, cursor: 'pointer' }}>Never mind</button>
                        </div>
                      </div>
                    )}
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
