// Reviews — Google review-request dashboard + settings, ONE page for every CRM (vendored into each template as ../shared).
// Talks to the shared /api/reviews routes. Before: two copies differing only in job-vs-visit wording, with alert()s
// for save feedback.
import React, { useState, useEffect } from 'react'
import { Star, Send, Mail, Phone, CheckCircle, Settings, BarChart3, ExternalLink, Loader2, TrendingUp, MessageSquare } from 'lucide-react'
import type { SettingsApi, SettingsToast, ReviewsConfig } from '../settings/integrationsTypes'

type Tab = 'dashboard' | 'settings'
const fmt = (v: any) => { if (!v) return '—'; const d = new Date(v); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString() }

export function ReviewsPage({ api, toast, config }: { api: SettingsApi; toast?: SettingsToast; config?: ReviewsConfig }) {
  const copy = {
    subtitle: 'Automate Google review requests after job completion', subjectLabel: 'Job', autoRequestHelp: 'Automatically request reviews after job completion',
    emptyHelp: 'Requests are created automatically when jobs are completed', ...(config || {}),
  }
  const [tab, setTab] = useState<Tab>('dashboard')
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reviews</h1><p className="text-gray-500 dark:text-slate-400">{copy.subtitle}</p></div>
      <div className="border-b dark:border-slate-700">
        <nav className="flex gap-6">{([{ id: 'dashboard' as Tab, label: 'Dashboard', icon: BarChart3 }, { id: 'settings' as Tab, label: 'Settings', icon: Settings }]).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-slate-200 dark:text-slate-400'}`}><t.icon className="w-4 h-4" />{t.label}</button>
        ))}</nav>
      </div>
      {tab === 'dashboard' ? <DashboardTab api={api} toast={toast} copy={copy} /> : <SettingsTab api={api} toast={toast} copy={copy} />}
    </div>
  )
}

function DashboardTab({ api, toast, copy }: { api: SettingsApi; toast?: SettingsToast; copy: Required<ReviewsConfig> }) {
  const [stats, setStats] = useState<any>(null)
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const load = async () => {
    try { const [s, r] = await Promise.all([api.get('/api/reviews/stats'), api.get('/api/reviews', { limit: 20 })]); setStats(s); setRequests(r?.data || []) }
    catch (err) { console.error('Failed to load review data:', err) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const followUp = async (id: string) => {
    setBusy(id)
    try { await api.post(`/api/reviews/follow-up/${id}`); toast?.success('Follow-up sent'); await load() }
    catch (e: any) { toast ? toast.error(e?.message || 'Failed to send follow-up') : alert(e?.message || 'Failed to send follow-up') } finally { setBusy(null) }
  }
  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  const n = (v: any) => Number(v || 0)
  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Requests Sent" value={n(stats.sent) + n(stats.clicked) + n(stats.completed)} icon={Send} />
          <StatCard label="Click Rate" value={`${stats.clickRate ?? 0}%`} icon={TrendingUp} color="blue" />
          <StatCard label="Est. Reviews" value={n(stats.clicked) + n(stats.completed)} icon={Star} color="yellow" />
          <StatCard label="This Month" value={n(stats.thisMonth)} icon={BarChart3} color="green" />
        </div>
      )}
      <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800">
        <div className="p-4 border-b dark:border-slate-800"><h3 className="font-semibold text-gray-900 dark:text-white">Recent Review Requests</h3></div>
        {requests.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-slate-400"><MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" /><p className="font-medium">No review requests yet</p><p className="text-sm mt-1">{copy.emptyHelp}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="review-requests">
              <thead><tr className="text-left text-gray-500 dark:text-slate-400 border-b dark:border-slate-800"><th className="px-4 py-3 font-medium">Contact</th><th className="px-4 py-3 font-medium">{copy.subjectLabel}</th><th className="px-4 py-3 font-medium">Channel</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Sent</th><th className="px-4 py-3 font-medium"></th></tr></thead>
              <tbody className="divide-y dark:divide-slate-800">{requests.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3"><p className="font-medium text-gray-900 dark:text-white">{r.contact?.name || '—'}</p><p className="text-xs text-gray-500 dark:text-slate-400">{r.contact?.phone || r.contact?.email || ''}</p></td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{r.job?.title || '—'}</td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs">{(r.channel === 'sms' || r.channel === 'both') && <Phone className="w-3 h-3" />}{(r.channel === 'email' || r.channel === 'both') && <Mail className="w-3 h-3" />}<span className="capitalize">{r.channel}</span></span></td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs dark:text-slate-400">{fmt(r.sentAt || r.createdAt)}</td>
                  <td className="px-4 py-3">{r.status === 'sent' && !r.followUpSentAt && <button onClick={() => followUp(r.id)} disabled={busy === r.id} className="text-xs text-orange-600 hover:text-orange-700 dark:hover:text-orange-200 font-medium disabled:opacity-50">{busy === r.id ? 'Sending…' : 'Follow Up'}</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SettingsTab({ api, toast, copy }: { api: SettingsApi; toast?: SettingsToast; copy: Required<ReviewsConfig> }) {
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  useEffect(() => { api.get('/api/reviews/settings').then(setSettings).catch(console.error).finally(() => setLoading(false)) }, [])
  const save = async () => {
    setSaving(true); setMessage(null)
    try { const saved = await api.put('/api/reviews/settings', settings); if (saved && typeof saved === 'object' && 'reviewRequestEnabled' in saved) setSettings(saved); toast ? toast.success('Settings saved') : setMessage({ kind: 'ok', text: 'Settings saved' }) }
    catch (e: any) { const text = e?.message || 'Failed to save settings'; toast ? toast.error(text) : setMessage({ kind: 'err', text }) } finally { setSaving(false) }
  }
  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  const field = 'w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white'
  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800 p-6">
        <label className="flex items-center justify-between cursor-pointer"><div><p className="font-semibold text-gray-900 dark:text-white">Auto-Request Reviews</p><p className="text-sm text-gray-500 dark:text-slate-400">{copy.autoRequestHelp}</p></div>
          <input type="checkbox" checked={settings?.reviewRequestEnabled ?? false} onChange={(e) => setSettings({ ...settings, reviewRequestEnabled: e.target.checked })} className="w-5 h-5 rounded text-orange-500" /></label>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Star className="w-5 h-5 text-yellow-500" />Google Review Link</h2>
        <div><label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Google Review URL</label><input type="url" value={settings?.googleReviewUrl || ''} onChange={(e) => setSettings({ ...settings, googleReviewUrl: e.target.value })} placeholder="https://g.page/r/your-business/review" className={field} /><p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Paste your Google review link, or enter a Place ID below</p></div>
        <div><label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Google Place ID (alternative)</label><input type="text" value={settings?.googlePlaceId || ''} onChange={(e) => setSettings({ ...settings, googlePlaceId: e.target.value })} placeholder="ChIJ..." className={field} />
          <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Find your Place ID at <a href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder" target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">Google's Place ID Finder</a></p></div>
        {(settings?.reviewLink || settings?.googleReviewUrl) && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg"><p className="text-sm text-green-700 dark:text-green-400 mb-2 flex items-center gap-1"><CheckCircle className="w-4 h-4" />Review link active:</p>
            <div className="flex items-center gap-2"><input type="text" value={settings.reviewLink || settings.googleReviewUrl} readOnly className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border rounded-lg text-sm dark:border-slate-700 dark:text-white" /><a href={settings.reviewLink || settings.googleReviewUrl} target="_blank" rel="noopener noreferrer" aria-label="Open review link" className="p-2 bg-white dark:bg-slate-800 border rounded-lg hover:bg-gray-50 dark:border-slate-700"><ExternalLink className="w-4 h-4" /></a></div></div>
        )}
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Settings className="w-5 h-5 text-gray-500 dark:text-slate-400" />Channel &amp; Timing</h2>
        <div><label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Channel</label>
          <select value={settings?.reviewChannel || 'both'} onChange={(e) => setSettings({ ...settings, reviewChannel: e.target.value })} className={field}><option value="both">SMS &amp; Email</option><option value="sms">SMS Only</option><option value="email">Email Only</option></select></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Delay After Completion</label>
            <select value={settings?.reviewRequestDelay ?? 24} onChange={(e) => setSettings({ ...settings, reviewRequestDelay: parseInt(e.target.value) })} className={field}><option value={0}>Right away</option><option value={1}>1 hour</option><option value={2}>2 hours</option><option value={4}>4 hours</option><option value={24}>1 day</option><option value={48}>2 days</option><option value={72}>3 days</option></select></div>
          <div><label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Follow-up After</label>
            <select value={settings?.reviewFollowUpDelay ?? 5} onChange={(e) => setSettings({ ...settings, reviewFollowUpDelay: parseInt(e.target.value) })} className={field}><option value={0}>No follow-up</option><option value={3}>3 days</option><option value={5}>5 days</option><option value={7}>7 days</option></select></div>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><MessageSquare className="w-5 h-5 text-gray-500 dark:text-slate-400" />SMS Template</h2>
        <textarea value={settings?.reviewSmsTemplate || ''} onChange={(e) => setSettings({ ...settings, reviewSmsTemplate: e.target.value })} rows={3} placeholder="Hi {firstName}, thanks for choosing {companyName}! We'd love your feedback — could you leave us a quick Google review? {trackingUrl}" className={`${field} text-sm`} />
        <p className="text-xs text-gray-500 dark:text-slate-400">Variables: <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded">{'{firstName}'}</code> <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded">{'{companyName}'}</code> <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded">{'{trackingUrl}'}</code></p>
      </div>
      {message && <div role={message.kind === 'err' ? 'alert' : 'status'} className={`p-3 rounded-lg text-sm ${message.kind === 'err' ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'}`}>{message.text}</div>}
      <div className="flex justify-end"><button onClick={save} disabled={saving} className="flex items-center gap-2 px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Save Settings</button></div>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, color = 'gray' }: { label: string; value: any; icon: any; color?: string }) {
  const colors: Record<string, string> = { gray: 'bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-300', blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400', yellow: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400', green: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400' }
  return <div className={`p-4 rounded-xl ${colors[color]}`}><Icon className="w-5 h-5 mb-2 opacity-75" /><p className="text-2xl font-bold">{value}</p><p className="text-sm opacity-75">{label}</p></div>
}
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { pending: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300', sent: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', clicked: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
  return <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full capitalize ${styles[status] || styles.pending}`}>{status}</span>
}
