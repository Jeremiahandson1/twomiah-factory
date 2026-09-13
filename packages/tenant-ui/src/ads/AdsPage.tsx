// Twomiah Ads — ONE page for every CRM that offers paid_ads (vendored into each template as ../shared). Talks to the
// shared /api/ads routes, which pass through to the Twomiah Ads service with the tenant's key.
// Before: three different copies. Performance / My Ads / Ad Approval read hard-coded empty mock data; Settings and the
// campaign wizard called routes that did not exist (every button 404'd, "Save as Draft" called launch); the connect
// button put the session token in a URL; landscaping had no A/B tests and the contractor page had none either.
// Now: real connection state, dashboard, campaigns (pause, resume and launch — resume and launch ask for an explicit
// spend confirmation), AI recommendations, A/B landing-page tests, settings with the business profile and billing.
import React, { useState, useEffect, useCallback } from 'react'
import { BarChart3, Target, Lightbulb, Beaker, Settings, Loader2, Pause, Play, Plus, Trophy, Trash2, Archive, ExternalLink, Link, Unlink, RefreshCw, AlertCircle, Check } from 'lucide-react'
import { Button, Modal, ConfirmModal, Field, inputCls, errMsg } from '../invoicing/ui'
import { useAuth } from '../auth/AuthContext'
import type { AdsApi, AdsToast, AdsConfig, AdsOverview, AdsPlatformState, AdsProfile } from './types'

type Tab = 'overview' | 'campaigns' | 'recommendations' | 'experiments' | 'settings'
interface Can { update: boolean; admin: boolean }

const usd = (cents: unknown) => '$' + (Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: unknown) => Number(v || 0).toLocaleString()
const pct = (a: unknown, b: unknown) => (Number(b) > 0 ? ((Number(a) / Number(b)) * 100).toFixed(2) + '%' : '-')
const when = (v?: string | null) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-')
const human = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '-')
const PLATFORM_LABEL: Record<string, string> = { google: 'Google Ads', meta: 'Meta (Facebook / Instagram)', tiktok: 'TikTok Ads', lsa: 'Google Local Services' }
const card = 'bg-white rounded-xl border border-gray-200 dark:bg-slate-900 dark:border-slate-800'
const th = 'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400'
const statusCls: Record<string, string> = {
  active: 'bg-green-100 text-green-700', running: 'bg-blue-100 text-blue-700', paused: 'bg-gray-100 text-gray-700', budget_paused: 'bg-amber-100 text-amber-800',
  balance_paused: 'bg-amber-100 text-amber-800', completed: 'bg-green-100 text-green-700', archived: 'bg-gray-100 text-gray-600', draft: 'bg-gray-100 text-gray-600', failed: 'bg-red-100 text-red-700',
}
const Badge = ({ s }: { s?: string | null }) => <span className={`px-2 py-0.5 text-xs rounded-full ${statusCls[String(s)] || 'bg-gray-100 text-gray-700'}`}>{human(s)}</span>
const Spinner = () => <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
const ErrorBox = ({ msg, onRetry }: { msg: string; onRetry?: () => void }) => (msg ? <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"><span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{msg}</span>{onRetry && <button onClick={onRetry} className="underline">Retry</button>}</div> : null)
const Empty = ({ icon: Icon, text, hint }: { icon: any; text: string; hint?: string }) => <div className="text-center py-12 bg-gray-50 rounded-xl dark:bg-slate-900"><Icon className="w-10 h-10 mx-auto text-gray-400 mb-3" /><p className="text-gray-600 dark:text-slate-300">{text}</p>{hint && <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 max-w-md mx-auto">{hint}</p>}</div>

export function AdsPage({ api, toast, config }: { api: AdsApi; toast: AdsToast; config?: AdsConfig }) {
  const auth = useAuth()
  const role = String(auth.user?.role || '')
  const can: Can = { update: ['owner', 'admin', 'manager'].includes(role), admin: ['owner', 'admin'].includes(role) }
  const [overview, setOverview] = useState<AdsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const loadOverview = useCallback(async () => {
    setLoadErr('')
    try { setOverview(await api.get('/api/ads/overview')) } catch (e) { setLoadErr(errMsg(e, 'Could not load Ads')) } finally { setLoading(false) }
  }, [api])
  useEffect(() => { loadOverview() }, [loadOverview])
  const connected = !!overview?.configured
  useEffect(() => { if (!loading && !connected && tab !== 'experiments') setTab('experiments') }, [loading, connected, tab])

  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    ...(connected ? [{ id: 'overview' as Tab, label: 'Overview', icon: BarChart3 }, { id: 'campaigns' as Tab, label: 'Campaigns', icon: Target }, { id: 'recommendations' as Tab, label: 'Recommendations', icon: Lightbulb }] : []),
    { id: 'experiments', label: 'A/B Tests', icon: Beaker },
    ...(connected ? [{ id: 'settings' as Tab, label: 'Settings', icon: Settings }] : []),
  ]

  return (
    <div className="space-y-6" data-testid="ads-page-shared">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{config?.title || 'Ads'}</h1>
        <p className="text-gray-500 dark:text-slate-400">{config?.subtitle || 'Google, Meta and TikTok campaigns run by Twomiah Ads, plus A/B tests on your website'}</p>
      </div>
      {loading ? <Spinner /> : (
        <>
          <ErrorBox msg={loadErr} onRetry={loadOverview} />
          {!loadErr && !connected && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">Twomiah Ads isn't connected for this account yet.</p>
              <p className="mt-1">Campaigns, performance and recommendations show up here once your account is registered with Twomiah Ads. Contact Twomiah support to get set up. A/B tests on your website work now.</p>
            </div>
          )}
          <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800 overflow-x-auto">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === t.id ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400'}`}>
                <t.icon className="w-4 h-4" />{t.label}
              </button>
            ))}
          </div>
          {tab === 'overview' && connected && <OverviewTab api={api} overview={overview!} />}
          {tab === 'campaigns' && connected && <CampaignsTab api={api} toast={toast} can={can} profile={overview?.profile || null} />}
          {tab === 'recommendations' && connected && <RecommendationsTab api={api} toast={toast} can={can} />}
          {tab === 'experiments' && <ExperimentsTab api={api} toast={toast} can={can} />}
          {tab === 'settings' && connected && <SettingsTab api={api} toast={toast} can={can} overview={overview!} config={config} onChanged={loadOverview} />}
        </>
      )}
    </div>
  )
}

// ─── overview ──────────────────────────────────────────────────────────────────
function OverviewTab({ api, overview }: { api: AdsApi; overview: AdsOverview }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => { setLoading(true); setErr(''); try { setData(await api.get('/api/ads/dashboard', { days })) } catch (e) { setErr(errMsg(e, 'Could not load performance')) } finally { setLoading(false) } }, [api, days])
  useEffect(() => { load() }, [load])
  const s = data?.summary || {}
  const byDay = new Map<string, number>()
  for (const r of data?.trend || []) { const d = String(r.date).slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + Number(r.spend_cents || 0)) }
  const trend = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b))
  const maxDay = Math.max(1, ...trend.map(([, v]) => v))
  const platforms = overview.platforms || []
  return (
    <div className="space-y-6">
      <div className={`${card} p-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm`}>
        <span><span className="text-gray-500 dark:text-slate-400">Mode:</span> <b>{overview.mode === 'connected' ? 'Your own ad accounts' : 'Managed by Twomiah'}</b></span>
        <span><span className="text-gray-500 dark:text-slate-400">Prepaid balance:</span> <b>{usd(overview.balanceCents)}</b></span>
        <span><span className="text-gray-500 dark:text-slate-400">Connected:</span> <b>{platforms.filter((p) => p.connected).map((p) => PLATFORM_LABEL[p.platform] || p.platform).join(', ') || 'none yet'}</b></span>
        <span><span className="text-gray-500 dark:text-slate-400">Monthly budget:</span> <b>{overview.profile?.monthly_budget_cents ? usd(overview.profile.monthly_budget_cents) : 'not set'}</b></span>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Performance</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputCls} w-auto`} aria-label="Date range">
          {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>
      <ErrorBox msg={err} onRetry={load} />
      {loading ? <Spinner /> : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[['Spend', usd(s.total_spend_cents)], ['Impressions', num(s.total_impressions)], ['Clicks', num(s.total_clicks)], ['CTR', pct(s.total_clicks, s.total_impressions)], ['Leads', num(s.total_leads)], ['Cost / click', Number(s.total_clicks) > 0 ? usd(Number(s.total_spend_cents) / Number(s.total_clicks)) : '-']].map(([label, value]) => (
              <div key={label} className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800"><p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{value}</p><p className="text-sm text-gray-500 dark:text-slate-400">{label}</p></div>
            ))}
          </div>
          {trend.length === 0 && !(data.topCampaigns || []).length ? (
            <Empty icon={BarChart3} text={`No ad activity in the last ${days} days.`} hint="Numbers appear here once a campaign is live and the platforms report back (usually within a day)." />
          ) : (
            <div className="grid lg:grid-cols-2 gap-6">
              <div className={`${card} p-4`}>
                <h3 className="font-medium mb-3 text-gray-900 dark:text-slate-100">Daily spend</h3>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {trend.map(([d, v]) => <div key={d} className="flex items-center gap-2 text-xs"><span className="w-20 text-gray-500 dark:text-slate-400">{d}</span><div className="flex-1 h-3 bg-gray-100 rounded dark:bg-slate-800"><div className="h-3 bg-orange-400 rounded" style={{ width: `${(v / maxDay) * 100}%` }} /></div><span className="w-20 text-right">{usd(v)}</span></div>)}
                </div>
              </div>
              <div className={`${card} overflow-x-auto`}>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/60"><tr>{['Platform', 'Spend', 'Clicks', 'Impr.', 'Conv.'].map((h, i) => <th key={h} className={`${th} ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {(data.byPlatform || []).map((p: any) => <tr key={p.platform}><td className="px-4 py-2">{PLATFORM_LABEL[p.platform] || p.platform}</td><td className="px-4 py-2 text-right">{usd(p.spend_cents)}</td><td className="px-4 py-2 text-right">{num(p.clicks)}</td><td className="px-4 py-2 text-right">{num(p.impressions)}</td><td className="px-4 py-2 text-right">{num(p.conversions)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {(data.topCampaigns || []).length > 0 && (
            <div className={`${card} overflow-x-auto`}>
              <h3 className="font-medium px-4 pt-4 text-gray-900 dark:text-slate-100">Top campaigns</h3>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/60"><tr>{['Campaign', 'Platform', 'Status', 'Spend', 'Clicks', 'Conv.', 'Conv. rate'].map((h, i) => <th key={h} className={`${th} ${i >= 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {data.topCampaigns.map((c: any, i: number) => <tr key={i}><td className="px-4 py-2">{c.name}</td><td className="px-4 py-2">{PLATFORM_LABEL[c.platform] || c.platform}</td><td className="px-4 py-2"><Badge s={c.status} /></td><td className="px-4 py-2 text-right">{usd(c.spend_cents)}</td><td className="px-4 py-2 text-right">{num(c.clicks)}</td><td className="px-4 py-2 text-right">{num(c.conversions)}</td><td className="px-4 py-2 text-right">{c.conversion_rate != null ? `${c.conversion_rate}%` : '-'}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
          {(data.healthScores || []).length > 0 && (
            <div className={`${card} p-4`}>
              <h3 className="font-medium mb-3 text-gray-900 dark:text-slate-100">Campaign health (last 7 days)</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {data.healthScores.map((h: any) => <div key={h.campaign_id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 text-sm"><span>{h.name} <span className="text-gray-500 dark:text-slate-400">· {PLATFORM_LABEL[h.platform] || h.platform}</span></span><span className={`font-semibold ${h.status === 'healthy' ? 'text-green-600' : h.status === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>{h.score}/100</span></div>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── campaigns ─────────────────────────────────────────────────────────────────
function CampaignsTab({ api, toast, can, profile }: { api: AdsApi; toast: AdsToast; can: Can; profile: AdsProfile | null }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState<{ kind: 'pause' | 'resume'; row: any } | null>(null)
  const [launchOpen, setLaunchOpen] = useState(false)
  const load = useCallback(async () => { setErr(''); try { setRows((await api.get('/api/ads/campaigns'))?.campaigns || []) } catch (e) { setErr(errMsg(e, 'Could not load campaigns')) } finally { setLoading(false) } }, [api])
  useEffect(() => { load() }, [load])
  const act = async () => {
    if (!confirm) return
    try {
      if (confirm.kind === 'pause') { await api.post(`/api/ads/campaigns/${confirm.row.id}/pause`); toast.success('Campaign paused') }
      else { await api.post(`/api/ads/campaigns/${confirm.row.id}/resume`, { confirmSpend: true }); toast.success('Campaign resumed') }
    } catch (e) { toast.error(errMsg(e, `Could not ${confirm.kind} the campaign`)) } finally { setConfirm(null); load() }
  }
  if (loading) return <Spinner />
  return (
    <div className="space-y-4">
      <ErrorBox msg={err} onRetry={load} />
      {can.admin && <div className="flex justify-end"><Button onClick={() => setLaunchOpen(true)}><Plus className="w-4 h-4" />New campaign</Button></div>}
      {rows.length === 0 ? (
        <Empty icon={Target} text="No campaigns yet." hint={can.admin ? 'Save your business profile in Settings, then launch your first campaign.' : 'An owner or admin launches campaigns.'} />
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800/60"><tr>{['Campaign', 'Platform', 'Status', 'Budget', 'Spend (30d)', 'Clicks', 'Impr.', 'Conv.', ''].map((h, i) => <th key={h || i} className={`${th} ${i >= 3 && i <= 7 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {rows.map((c) => (
                <tr key={c.id} className="text-gray-900 dark:text-slate-100">
                  <td className="px-4 py-3"><p className="font-medium">{c.name}</p><p className="text-xs text-gray-500 dark:text-slate-400">{when(c.created_at)}</p></td>
                  <td className="px-4 py-3">{PLATFORM_LABEL[c.platform] || c.platform}</td>
                  <td className="px-4 py-3"><Badge s={c.status} />{c.status === 'balance_paused' && <p className="text-xs text-amber-700 mt-1">Paused: prepaid balance ran out</p>}</td>
                  <td className="px-4 py-3 text-right">{c.budget_cents != null ? usd(c.budget_cents) : '-'}</td>
                  <td className="px-4 py-3 text-right">{usd(c.total_spend_cents)}</td>
                  <td className="px-4 py-3 text-right">{num(c.total_clicks)}</td>
                  <td className="px-4 py-3 text-right">{num(c.total_impressions)}</td>
                  <td className="px-4 py-3 text-right">{num(c.total_conversions)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {c.status === 'active' && can.update && <Button variant="secondary" onClick={() => setConfirm({ kind: 'pause', row: c })}><Pause className="w-4 h-4" />Pause</Button>}
                    {(c.status === 'paused' || c.status === 'budget_paused') && can.admin && <Button variant="warn" onClick={() => setConfirm({ kind: 'resume', row: c })}><Play className="w-4 h-4" />Resume</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmModal isOpen={confirm?.kind === 'pause'} onClose={() => setConfirm(null)} onConfirm={act} title="Pause campaign" message={`Pause "${confirm?.row?.name}"? Its ads stop showing on ${PLATFORM_LABEL[confirm?.row?.platform] || confirm?.row?.platform} until it is resumed.`} confirmText="Pause" />
      <ConfirmModal isOpen={confirm?.kind === 'resume'} onClose={() => setConfirm(null)} onConfirm={act} title="Resume campaign" message={`Resume "${confirm?.row?.name}"? Ads start showing and spending again on ${PLATFORM_LABEL[confirm?.row?.platform] || confirm?.row?.platform} at this campaign's budget${confirm?.row?.budget_cents != null ? ` (${usd(confirm.row.budget_cents)})` : ''}.`} confirmText="Resume and spend" />
      {launchOpen && <LaunchModal api={api} toast={toast} profile={profile} onClose={() => setLaunchOpen(false)} onLaunched={() => { setLaunchOpen(false); load() }} />}
    </div>
  )
}

function LaunchModal({ api, toast, profile, onClose, onLaunched }: { api: AdsApi; toast: AdsToast; profile: AdsProfile | null; onClose: () => void; onLaunched: () => void }) {
  const [platforms, setPlatforms] = useState<string[]>(['google'])
  const [objective, setObjective] = useState('leads')
  const [name, setName] = useState('')
  const [googleType, setGoogleType] = useState('SEARCH')
  const [ack, setAck] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState<'' | 'preview' | 'launch'>('')
  const [err, setErr] = useState('')
  const budget = Number(profile?.monthly_budget_cents || 0)
  const toggle = (p: string) => { setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p])); setPreview(null); setAck(false) }
  const doPreview = async () => { setBusy('preview'); setErr(''); try { setPreview((await api.post('/api/ads/campaigns/preview', { platforms, objective }))?.preview ?? null) } catch (e) { setErr(errMsg(e, 'Could not generate a preview')) } finally { setBusy('') } }
  const launch = async () => {
    setBusy('launch'); setErr('')
    try {
      await api.post('/api/ads/campaigns/launch', { platforms, objective, campaignName: name.trim() || undefined, google_campaign_type: platforms.includes('google') ? googleType : undefined, confirmSpend: true })
      toast.success('Campaign launched'); onLaunched()
    } catch (e) { setErr(errMsg(e, 'Launch failed')) } finally { setBusy('') }
  }
  return (
    <Modal isOpen onClose={onClose} title="New campaign" size="lg">
      {!budget ? (
        <div className="space-y-4"><p className="text-sm">Save the business profile with a monthly budget in the Settings tab first. Twomiah Ads uses it to write the ads and set the spend.</p><div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div></div>
      ) : (
        <div className="space-y-4">
          <Field label="Platforms">
            <div className="flex flex-wrap gap-3">{['google', 'meta', 'tiktok'].map((p) => <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(p)} />{PLATFORM_LABEL[p]}</label>)}</div>
          </Field>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Goal"><select className={inputCls} value={objective} onChange={(e) => { setObjective(e.target.value); setPreview(null) }}><option value="leads">Leads (calls and forms)</option><option value="traffic">Website visits</option><option value="awareness">Awareness</option></select></Field>
            {platforms.includes('google') && <Field label="Google campaign type"><select className={inputCls} value={googleType} onChange={(e) => setGoogleType(e.target.value)}><option value="SEARCH">Search</option><option value="PERFORMANCE_MAX">Performance Max</option></select></Field>}
          </div>
          <Field label="Campaign name (optional)"><input className={inputCls} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring promotion" /></Field>
          <div className="flex items-center gap-3">
            <Button variant="secondary" disabled={!platforms.length || !!busy} onClick={doPreview}>{busy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Preview ad copy</Button>
            <span className="text-xs text-gray-500 dark:text-slate-400">Writes sample ads with AI. Nothing is published.</span>
          </div>
          {preview != null && <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-slate-800">{JSON.stringify(preview, null, 2)}</pre>}
          <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>I understand launching publishes live ads on {platforms.map((p) => PLATFORM_LABEL[p]).join(', ') || 'the selected platforms'} and starts real spend, up to the monthly budget of <b>{usd(budget)}</b>.</span>
          </label>
          <ErrorBox msg={err} />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={!ack || !platforms.length || !!busy} onClick={launch}>{busy === 'launch' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Launch and start spending</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── recommendations ───────────────────────────────────────────────────────────
function RecommendationsTab({ api, toast, can }: { api: AdsApi; toast: AdsToast; can: Can }) {
  const [status, setStatus] = useState('pending')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [applying, setApplying] = useState<any>(null)
  const load = useCallback(async () => { setLoading(true); setErr(''); try { setRows((await api.get('/api/ads/recommendations', { status }))?.recommendations || []) } catch (e) { setErr(errMsg(e, 'Could not load recommendations')) } finally { setLoading(false) } }, [api, status])
  useEffect(() => { load() }, [load])
  const dismiss = async (r: any) => { try { await api.post(`/api/ads/recommendations/${r.id}/dismiss`); toast.success('Dismissed') } catch (e) { toast.error(errMsg(e, 'Could not dismiss')) } finally { load() } }
  const apply = async () => { if (!applying) return; try { await api.post(`/api/ads/recommendations/${applying.id}/execute`, { confirmSpend: true }); toast.success('Recommendation applied') } catch (e) { toast.error(errMsg(e, 'Could not apply')) } finally { setApplying(null); load() } }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-slate-400">Twomiah Ads reviews your campaigns and suggests changes. Nothing changes until someone applies a suggestion.</p>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-auto`} aria-label="Show"><option value="pending">Pending</option><option value="executed">Applied or dismissed</option><option value="all">All</option></select>
      </div>
      <ErrorBox msg={err} onRetry={load} />
      {loading ? <Spinner /> : rows.length === 0 ? <Empty icon={Lightbulb} text="No recommendations." hint="Suggestions appear after your campaigns have run for a few days." /> : (
        <div className="space-y-3">
          {rows.map((r) => {
            const urgency = r.data_snapshot?.urgency
            return (
              <div key={r.id} className={`${card} p-4`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-slate-100">{human(r.action_type)} {urgency && <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${urgency === 'high' ? 'bg-red-100 text-red-700' : urgency === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>{urgency}</span>}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{r.campaign_name || 'Account-wide'}{r.platform ? ` · ${PLATFORM_LABEL[r.platform] || r.platform}` : ''} · {when(r.created_at)}</p>
                    <p className="text-sm mt-2 text-gray-700 dark:text-slate-300">{r.reasoning}</p>
                    {r.executed && <p className="text-xs text-gray-500 mt-1"><Check className="w-3 h-3 inline" /> {String(r.reasoning || '').includes('[DISMISSED]') ? 'Dismissed' : 'Applied'} {when(r.executed_at)}</p>}
                  </div>
                  {!r.executed && (
                    <div className="flex gap-2 shrink-0">
                      {can.update && <Button variant="secondary" onClick={() => dismiss(r)}>Dismiss</Button>}
                      {can.admin && <Button variant="warn" onClick={() => setApplying(r)}>Apply</Button>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ConfirmModal isOpen={!!applying} onClose={() => setApplying(null)} onConfirm={apply} title="Apply recommendation" message={`Apply "${human(applying?.action_type)}"${applying?.campaign_name ? ` to "${applying.campaign_name}"` : ''}? This changes the live campaign (budget, bids or status) and can change how much you spend.`} confirmText="Apply to live campaign" />
    </div>
  )
}

// ─── A/B tests ─────────────────────────────────────────────────────────────────
interface Variant { key: string; label: string; trafficPercent: number; assignments: number; conversions: number }
interface Experiment { id: string; name: string; path: string; status: string; startedAt: string | null; endedAt: string | null; winnerKey: string | null; variants: Variant[] }

function ExperimentsTab({ api, toast, can }: { api: AdsApi; toast: AdsToast; can: Can }) {
  const [rows, setRows] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [completing, setCompleting] = useState<Experiment | null>(null)
  const [deleting, setDeleting] = useState<Experiment | null>(null)
  const load = useCallback(async () => { setErr(''); try { setRows((await api.get('/api/ads/experiments'))?.experiments || []) } catch (e) { setErr(errMsg(e, 'Could not load A/B tests')) } finally { setLoading(false) } }, [api])
  useEffect(() => { load() }, [load])
  const patch = async (e: Experiment, body: any, done: string) => { try { await api.patch(`/api/ads/experiments/${e.id}`, body); toast.success(done) } catch (x) { toast.error(errMsg(x, 'Could not update the test')) } finally { load() } }
  const remove = async () => { if (!deleting) return; try { await api.delete('/api/ads/experiments', deleting.id); toast.success('Test deleted') } catch (x) { toast.error(errMsg(x, 'Could not delete the test')) } finally { setDeleting(null); load() } }
  const cvr = (v: Variant) => (v.assignments > 0 ? (v.conversions / v.assignments) * 100 : 0)
  if (loading) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-gray-500 dark:text-slate-400">Show visitors of one website page two versions and count which one brings more leads and bookings. Your Twomiah website assigns visitors and records form submissions automatically.</p>
        {can.update && <Button className="shrink-0" onClick={() => setNewOpen(true)}><Beaker className="w-4 h-4" />New test</Button>}
      </div>
      <ErrorBox msg={err} onRetry={load} />
      {rows.length === 0 ? <Empty icon={Beaker} text="No A/B tests yet." hint="Pick a page, name two versions and split the traffic. Style version B on the site with html[data-ab-variant=&quot;b&quot;]." /> : (
        <div className="space-y-3">
          {rows.map((e) => {
            const base = e.variants[0]
            return (
              <div key={e.id} className={`${card} p-4`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div><h3 className="font-semibold text-gray-900 dark:text-slate-100">{e.name}</h3><p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 font-mono">{e.path}</p></div>
                  <div className="flex items-center gap-2">
                    <Badge s={e.status} />
                    {can.update && e.status === 'running' && <><Button variant="secondary" onClick={() => setCompleting(e)}><Trophy className="w-4 h-4" />Finish</Button><Button variant="secondary" onClick={() => patch(e, { status: 'archived' }, 'Test archived')}><Archive className="w-4 h-4" />Archive</Button></>}
                    {can.update && e.status !== 'running' && <Button variant="secondary" onClick={() => patch(e, { status: 'running' }, 'Test running')}><Play className="w-4 h-4" />Run</Button>}
                    {can.update && <button onClick={() => setDeleting(e)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" title="Delete test" aria-label="Delete test"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </div>
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, e.variants.length)}, minmax(0, 1fr))` }}>
                  {e.variants.map((v, i) => {
                    const lift = i > 0 && cvr(base) > 0 ? ((cvr(v) - cvr(base)) / cvr(base)) * 100 : null
                    return (
                      <div key={v.key} className={`p-3 rounded-lg border ${e.winnerKey === v.key ? 'border-orange-500 bg-orange-50/40 dark:bg-orange-900/10' : 'border-gray-200 dark:border-slate-800'}`}>
                        <div className="flex items-center justify-between mb-1"><span className="text-xs font-medium text-gray-600 dark:text-slate-400">{v.label} <span className="font-mono">({v.key}, {v.trafficPercent}%)</span></span>{e.winnerKey === v.key && <Trophy className="w-3.5 h-3.5 text-orange-500" />}</div>
                        <div className="text-xl font-bold text-gray-900 dark:text-slate-100">{cvr(v).toFixed(1)}%</div>
                        <div className="text-xs text-gray-500 dark:text-slate-400">{v.conversions} conversions / {v.assignments} visitors</div>
                        {lift != null && <div className={`text-xs font-medium mt-1 ${lift >= 0 ? 'text-green-600' : 'text-red-600'}`}>{lift >= 0 ? '+' : ''}{lift.toFixed(1)}% vs {base.label}</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {newOpen && <NewExperimentModal api={api} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); toast.success('Test running'); load() }} />}
      {completing && <FinishExperimentModal experiment={completing} onClose={() => setCompleting(null)} onFinish={async (winnerKey) => { await patch(completing, { status: 'completed', winnerKey }, 'Test finished'); setCompleting(null) }} />}
      <ConfirmModal isOpen={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} title="Delete test" message={`Delete "${deleting?.name}" and its visitor and conversion counts? This cannot be undone.`} confirmText="Delete" />
    </div>
  )
}

function NewExperimentModal({ api, onClose, onCreated }: { api: AdsApi; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('/')
  const [a, setA] = useState('Original')
  const [b, setB] = useState('New version')
  const [split, setSplit] = useState(50)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(''); setBusy(true)
    try {
      await api.post('/api/ads/experiments', { name, path: path.trim(), variants: [{ key: 'a', label: a, trafficPercent: split }, { key: 'b', label: b, trafficPercent: 100 - split }] })
      onCreated()
    } catch (x) { setErr(errMsg(x, 'Could not create the test')) } finally { setBusy(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title="New A/B test">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Test name"><input className={inputCls} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Homepage headline" autoFocus /></Field>
        <Field label="Website page" hint="The path on your Twomiah website, e.g. / or /services"><input className={inputCls} required maxLength={300} value={path} onChange={(e) => setPath(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Version A"><input className={inputCls} required maxLength={60} value={a} onChange={(e) => setA(e.target.value)} /></Field>
          <Field label="Version B"><input className={inputCls} required maxLength={60} value={b} onChange={(e) => setB(e.target.value)} /></Field>
        </div>
        <Field label={`Traffic split: A ${split}% / B ${100 - split}%`}><input type="range" min={10} max={90} step={5} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="w-full" /></Field>
        <p className="text-xs text-gray-500 dark:text-slate-400">The site marks each visitor with <code>html[data-ab-variant="a"]</code> or <code>"b"</code>; style the page's version B with that selector.</p>
        <ErrorBox msg={err} />
        <div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Start test'}</Button></div>
      </form>
    </Modal>
  )
}

function FinishExperimentModal({ experiment, onClose, onFinish }: { experiment: Experiment; onClose: () => void; onFinish: (winnerKey: string | null) => Promise<void> }) {
  const [winner, setWinner] = useState<string>(experiment.winnerKey || '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal isOpen onClose={onClose} title={`Finish "${experiment.name}"`} size="sm">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-slate-300">Visitors stop being split once the test is finished. Pick the version to keep, or none.</p>
        {experiment.variants.map((v) => <label key={v.key} className="flex items-center gap-2 text-sm"><input type="radio" name="winner" checked={winner === v.key} onChange={() => setWinner(v.key)} />{v.label} <span className="text-gray-500">({v.conversions}/{v.assignments})</span></label>)}
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="winner" checked={winner === ''} onChange={() => setWinner('')} />No winner</label>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={async () => { setBusy(true); try { await onFinish(winner || null) } finally { setBusy(false) } }}>Finish test</Button></div>
      </div>
    </Modal>
  )
}

// ─── settings ──────────────────────────────────────────────────────────────────
const ACTION_TEXT: Record<string, string> = {
  launch_first_campaign_to_provision: 'Your Google Ads account is created on your first launch',
  link_billing_in_google_ads_ui: 'Billing needs to be linked in Google Ads',
  connect_via_oauth: 'Not connected',
  set_account_id: 'Connected, needs the ad account ID',
  set_facebook_page_id: 'Connected, needs the Facebook Page ID',
  refresh_oauth: 'Connection expired, reconnect',
}

function SettingsTab({ api, toast, can, overview, config, onChanged }: { api: AdsApi; toast: AdsToast; can: Can; overview: AdsOverview; config?: AdsConfig; onChanged: () => void }) {
  const [modeBusy, setModeBusy] = useState(false)
  const [idModal, setIdModal] = useState<{ platform: string; kind: 'account' | 'page' } | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const setMode = async (mode: 'managed' | 'connected') => { setModeBusy(true); try { await api.put('/api/ads/mode', { mode }); toast.success('Ads mode saved'); onChanged() } catch (e) { toast.error(errMsg(e, 'Could not change the mode')) } finally { setModeBusy(false) } }
  const connect = async (p: string) => {
    try {
      const r = await api.get(`/api/ads/platforms/${p}/connect-url`)
      if (!r?.url) throw new Error('No connect link came back')
      window.open(r.url, '_blank', 'noopener')
      toast.success('Finish connecting in the new tab, then press Refresh here')
    } catch (e) { toast.error(errMsg(e, 'Could not start the connection')) }
  }
  const disconnect = async () => { if (!disconnecting) return; try { await api.delete(`/api/ads/platforms/${disconnecting}`); toast.success('Disconnected') } catch (e) { toast.error(errMsg(e, 'Could not disconnect')) } finally { setDisconnecting(null); onChanged() } }
  const platforms = overview.platforms || []
  return (
    <div className="space-y-6">
      <div className={`${card} p-5`}>
        <h3 className="font-semibold text-gray-900 dark:text-slate-100">How your ads run</h3>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          {([['managed', 'Managed by Twomiah', 'Ads run in accounts Twomiah creates for you. No Google Ads experience needed.'], ['connected', 'Your own ad accounts', 'Link your existing Meta, TikTok or Local Services account and keep its history.']] as const).map(([id, title, text]) => (
            <button key={id} disabled={!can.admin || modeBusy || overview.mode === id} onClick={() => setMode(id)} className={`p-4 rounded-lg border-2 text-left ${overview.mode === id ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10' : 'border-gray-200 dark:border-slate-700'} ${can.admin && overview.mode !== id ? 'hover:border-gray-300' : 'cursor-default'}`}>
              <div className="font-semibold">{title}{overview.mode === id && <span className="ml-2 text-xs text-orange-600">CURRENT</span>}</div>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{text}</p>
            </button>
          ))}
        </div>
      </div>

      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between"><h3 className="font-semibold text-gray-900 dark:text-slate-100">Ad platforms</h3><Button variant="secondary" onClick={onChanged}><RefreshCw className="w-4 h-4" />Refresh</Button></div>
        <div className="divide-y divide-gray-100 dark:divide-slate-800 mt-2">
          {platforms.map((p: AdsPlatformState) => (
            <div key={p.platform} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full ${p.connected && !p.requiresAction ? 'bg-green-500' : p.connected ? 'bg-amber-500' : 'bg-gray-300'}`} />
                <div>
                  <p className="font-medium">{PLATFORM_LABEL[p.platform] || p.platform}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{p.platform === 'google' ? 'Managed by Twomiah · ' : ''}{p.requiresAction ? ACTION_TEXT[p.requiresAction] || human(p.requiresAction) : p.connected ? `Connected${p.accountId ? ` · account ${p.accountId}` : ''}` : 'Not connected'}</p>
                </div>
              </div>
              {can.admin && p.platform !== 'google' && (
                <div className="flex flex-wrap gap-2">
                  {(!p.connected || p.requiresAction === 'refresh_oauth' || p.requiresAction === 'connect_via_oauth') && <Button variant="secondary" onClick={() => connect(p.platform)}><Link className="w-4 h-4" />{p.tokenExpired ? 'Reconnect' : 'Connect'}<ExternalLink className="w-3 h-3" /></Button>}
                  {p.requiresAction === 'set_account_id' && <Button variant="secondary" onClick={() => setIdModal({ platform: p.platform, kind: 'account' })}>Set account ID</Button>}
                  {p.requiresAction === 'set_facebook_page_id' && <Button variant="secondary" onClick={() => setIdModal({ platform: p.platform, kind: 'page' })}>Set Page ID</Button>}
                  {p.connected && <Button variant="danger" onClick={() => setDisconnecting(p.platform)}><Unlink className="w-4 h-4" />Disconnect</Button>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <ProfileForm api={api} toast={toast} can={can} profile={overview.profile || null} industry={config?.industry} onSaved={onChanged} />
      <Billing api={api} balanceCents={overview.balanceCents || 0} />

      {idModal && <IdModal api={api} toast={toast} target={idModal} onClose={() => setIdModal(null)} onSaved={() => { setIdModal(null); onChanged() }} />}
      <ConfirmModal isOpen={!!disconnecting} onClose={() => setDisconnecting(null)} onConfirm={disconnect} title="Disconnect platform" message={`Disconnect ${PLATFORM_LABEL[disconnecting || ''] || disconnecting}? Twomiah Ads stops managing campaigns in that account.`} confirmText="Disconnect" />
    </div>
  )
}

function IdModal({ api, toast, target, onClose, onSaved }: { api: AdsApi; toast: AdsToast; target: { platform: string; kind: 'account' | 'page' }; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault(); setBusy(true)
    try {
      if (target.kind === 'page') await api.post('/api/ads/platforms/meta/page', { pageId: value.trim() })
      else await api.post(`/api/ads/platforms/${target.platform}/account`, { accountId: value.trim() })
      toast.success('Saved'); onSaved()
    } catch (e) { toast.error(errMsg(e, 'Could not save')) } finally { setBusy(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={target.kind === 'page' ? 'Facebook Page ID' : `${PLATFORM_LABEL[target.platform] || target.platform} account ID`} size="sm">
      <form onSubmit={save} className="space-y-4">
        <Field label={target.kind === 'page' ? 'Page ID' : 'Ad account ID'}><input className={inputCls} required maxLength={100} value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></Field>
        <div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !value.trim()}>Save</Button></div>
      </form>
    </Modal>
  )
}

const listText = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : '')).filter(Boolean).join(', ') : '')
const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

function ProfileForm({ api, toast, can, profile, industry, onSaved }: { api: AdsApi; toast: AdsToast; can: Can; profile: AdsProfile | null; industry?: string; onSaved: () => void }) {
  const init = () => ({
    business_name: profile?.business_name || '', industry: profile?.industry || industry || '', services: listText(profile?.services), geo_targets: listText(profile?.geo_targets),
    budget: profile?.monthly_budget_cents ? String(Number(profile.monthly_budget_cents) / 100) : '', website_url: profile?.website_url || '', phone: profile?.phone || '',
    unique_value_prop: profile?.unique_value_prop || '', brand_voice: profile?.brand_voice || '',
  })
  const [f, setF] = useState(init)
  useEffect(() => { setF(init()) }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof ReturnType<typeof init>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((cur) => ({ ...cur, [k]: e.target.value }))
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr('')
    const cents = Math.round(Number(f.budget) * 100)
    if (!Number.isFinite(cents) || cents < 1000) { setErr('Monthly budget must be at least $10'); return }
    setBusy(true)
    try {
      await api.put('/api/ads/profile', {
        business_name: f.business_name.trim(), industry: f.industry.trim(), services: splitList(f.services), geo_targets: splitList(f.geo_targets), monthly_budget_cents: cents,
        website_url: f.website_url.trim(), phone: f.phone.trim() || undefined, unique_value_prop: f.unique_value_prop.trim() || undefined, brand_voice: f.brand_voice.trim() || undefined,
      })
      toast.success('Business profile saved'); onSaved()
    } catch (e) { setErr(errMsg(e, 'Could not save the profile')) } finally { setBusy(false) }
  }
  const ro = !can.admin
  return (
    <form onSubmit={save} className={`${card} p-5 space-y-4`}>
      <div><h3 className="font-semibold text-gray-900 dark:text-slate-100">Business profile</h3><p className="text-sm text-gray-500 dark:text-slate-400">Twomiah Ads writes your ads from this and never spends more than the monthly budget.{ro ? ' Only an owner or admin can change it.' : ''}</p></div>
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Business name"><input className={inputCls} disabled={ro} required maxLength={200} value={f.business_name} onChange={set('business_name')} /></Field>
        <Field label="Industry"><input className={inputCls} disabled={ro} required maxLength={100} value={f.industry} onChange={set('industry')} placeholder="e.g. hvac" /></Field>
        <Field label="Services" hint="Comma separated"><input className={inputCls} disabled={ro} value={f.services} onChange={set('services')} placeholder="AC repair, furnace install" /></Field>
        <Field label="Areas served" hint="Cities or ZIP codes, comma separated"><input className={inputCls} disabled={ro} value={f.geo_targets} onChange={set('geo_targets')} placeholder="Madison WI, 53703" /></Field>
        <Field label="Monthly budget (USD)" hint="Minimum $10"><input className={inputCls} disabled={ro} required type="number" min={10} step="1" value={f.budget} onChange={set('budget')} /></Field>
        <Field label="Website"><input className={inputCls} disabled={ro} type="url" maxLength={500} value={f.website_url} onChange={set('website_url')} placeholder="https://" /></Field>
        <Field label="Phone"><input className={inputCls} disabled={ro} maxLength={30} value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Brand voice"><input className={inputCls} disabled={ro} maxLength={50} value={f.brand_voice} onChange={set('brand_voice')} placeholder="friendly, professional" /></Field>
      </div>
      <Field label="What makes you different"><textarea className={inputCls} disabled={ro} rows={2} maxLength={500} value={f.unique_value_prop} onChange={set('unique_value_prop')} /></Field>
      <ErrorBox msg={err} />
      {!ro && <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button></div>}
    </form>
  )
}

function Billing({ api, balanceCents }: { api: AdsApi; balanceCents: number }) {
  const [entries, setEntries] = useState<any[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get('/api/ads/billing/ledger', { limit: 20 }).then((r) => setEntries(r?.entries || [])).catch((e) => setErr(errMsg(e, 'Could not load billing history'))) }, [api])
  return (
    <div className={`${card} p-5`}>
      <h3 className="font-semibold text-gray-900 dark:text-slate-100">Prepaid ad balance</h3>
      <p className="text-3xl font-bold mt-2">{usd(balanceCents)}</p>
      <ErrorBox msg={err} />
      {entries && entries.length > 0 && (
        <table className="w-full text-sm mt-4">
          <thead><tr>{['Date', 'Type', 'Amount', 'Note'].map((h, i) => <th key={h} className={`${th} ${i === 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{entries.map((e) => <tr key={e.id}><td className="px-4 py-2">{when(e.created_at)}</td><td className="px-4 py-2">{human(e.kind)}</td><td className={`px-4 py-2 text-right ${Number(e.delta_cents) < 0 ? 'text-red-600' : 'text-green-600'}`}>{usd(e.delta_cents)}</td><td className="px-4 py-2">{e.note || '-'}</td></tr>)}</tbody>
        </table>
      )}
      {entries && entries.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">No top-ups or charges yet.</p>}
    </div>
  )
}
