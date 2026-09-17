// Email marketing — campaigns, templates, drip sequences — ONE page for every CRM that offers email_marketing or
// follow_up_sequences (vendored into each template as ../shared). Talks to the shared /api/marketing routes.
// Before: two copies whose tables read fields the backend never sent (recipients / enrolled always 0, opens and clicks
// always "-"), no way to enroll a contact in a sequence, edit a sequence, duplicate or delete a template, alert()s for
// every failure, and a trigger picker offering automations nothing fires.
import React, { useState, useEffect, useCallback } from 'react'
import { Mail, Plus, Send, Users, Edit2, Copy, Trash2, Loader2, FileText, Zap, Clock, Play, Pause, UserPlus, Calendar, X } from 'lucide-react'
import { Button, Modal, ConfirmModal, Field, inputCls, errMsg } from '../invoicing/ui'
import { DEFAULT_CONTACT_TYPES } from '../contacts/types'
import type { MarketingApi, MarketingToast, MarketingConfig } from './types'

interface Stats { totalCampaigns: number; activeSequences: number; activeEnrollments?: number; emailsSent30Days: number; campaignSends30Days?: number; openRate?: number; clickRate?: number; totalOptOuts?: number }
interface Campaign { id: string; name: string; subject?: string; content?: string; status: string; audienceType?: string; audienceFilter?: any; recipientCount?: number; openCount?: number; clickCount?: number; unsubscribeCount?: number; lastError?: string | null; scheduledDate?: string | null; sentAt?: string | null }
interface Template { id: string; name: string; subject: string; body: string; category?: string; type?: string; active?: boolean }
interface Step { delayDays: number; delayHours: number; subject: string; body: string }
interface Sequence { id: string; name: string; description?: string | null; trigger?: string; active: boolean; steps: Step[]; enrollmentCount?: number; activeEnrollments?: number }
type Tab = 'campaigns' | 'templates' | 'sequences'
const TEMPLATE_CATEGORIES = ['general', 'followup', 'promotion', 'newsletter', 'reminder']
const statusCls: Record<string, string> = { sent: 'bg-green-100 text-green-700', scheduled: 'bg-blue-100 text-blue-700', sending: 'bg-yellow-100 text-yellow-700', failed: 'bg-red-100 text-red-700', draft: 'bg-gray-100 text-gray-700' }
const fmtWhen = (v?: string | null) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')

export function MarketingPage({ api, toast, config, showCampaigns = true }: { api: MarketingApi; toast: MarketingToast; config?: MarketingConfig; showCampaigns?: boolean }) {
  // Visibility is decided by the template's sidebar/route gates exactly as before this page was shared — the page
  // itself shows all three tabs. (The registry offers email_marketing only to contractor/fieldservice/landscaping while
  // the sidebar also shows Marketing on events/rv/salon/vet; that product decision is flagged, not changed here.)
  // A template whose page is also another product (RV Follow-Up) passes showCampaigns=false when email marketing is
  // off, leaving only the sequences tab. (RV T19 M6)
  const showSequences = true
  const seqLabel = config?.sequencesLabel || 'Drip Sequences'
  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    ...(showCampaigns ? [{ id: 'campaigns' as Tab, label: 'Campaigns', icon: Mail }, { id: 'templates' as Tab, label: 'Templates', icon: FileText }] : []),
    ...(showSequences ? [{ id: 'sequences' as Tab, label: seqLabel, icon: Zap }] : []),
  ]
  const [tab, setTab] = useState<Tab>(tabs[0]?.id || 'campaigns')
  const [stats, setStats] = useState<Stats | null>(null)
  const loadStats = useCallback(async () => { try { setStats(await api.get('/api/marketing/stats')) } catch { /* cards are decorative */ } }, [api])
  useEffect(() => { loadStats() }, [loadStats])
  const contactTypes = config?.contactTypes && config.contactTypes.length ? config.contactTypes : DEFAULT_CONTACT_TYPES.map((t: any) => ({ value: t.value, label: t.label }))

  return (
    <div className="space-y-6" data-testid="marketing-page-shared">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{config?.title || (showCampaigns ? 'Marketing' : seqLabel)}</h1>
        <p className="text-gray-500 dark:text-slate-400">{config?.subtitle || (showCampaigns ? 'Email campaigns and automated follow-ups' : 'Automated follow-up emails')}</p>
      </div>
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {showCampaigns && <Stat icon={Mail} label="Campaigns" value={stats.totalCampaigns} />}
          <Stat icon={Zap} label={`Active ${seqLabel.toLowerCase()}`} value={stats.activeSequences} tone="purple" />
          <Stat icon={Users} label="Enrolled now" value={stats.activeEnrollments ?? 0} tone="purple" />
          <Stat icon={Send} label="Emails (30d)" value={stats.emailsSent30Days} tone="green" />
          {showCampaigns && <Stat icon={Mail} label="Open rate (30d)" value={`${stats.openRate ?? 0}%`} tone="blue" />}
          <Stat icon={Users} label="Unsubscribed" value={stats.totalOptOuts ?? 0} />
        </div>
      )}
      {tabs.length > 1 && (
        <div className="flex gap-2 border-b dark:border-slate-800">
          {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 border-b-2 -mb-px ${tab === t.id ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400'}`}><t.icon className="w-4 h-4" />{t.label}</button>)}
        </div>
      )}
      {tab === 'campaigns' && showCampaigns && <CampaignsTab api={api} toast={toast} contactTypes={contactTypes} onChanged={loadStats} />}
      {tab === 'templates' && showCampaigns && <TemplatesTab api={api} toast={toast} />}
      {(tab === 'sequences' || tabs.length === 1) && showSequences && <SequencesTab api={api} toast={toast} label={seqLabel} onChanged={loadStats} />}
    </div>
  )
}

function Stat({ icon: Icon, label, value, tone = 'gray' }: { icon: any; label: string; value: string | number; tone?: 'gray' | 'purple' | 'green' | 'blue' }) {
  const cls: Record<string, string> = { gray: 'bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-300', purple: 'bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300', green: 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-300', blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' }
  return <div className={`p-4 rounded-xl ${cls[tone]}`}><Icon className="w-5 h-5 mb-2" /><p className="text-2xl font-bold">{value}</p><p className="text-sm opacity-75">{label}</p></div>
}
const ErrorBox = ({ msg }: { msg: string }) => (msg ? <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{msg}</div> : null)
const Spinner = () => <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

// ─── campaigns ────────────────────────────────────────────────────────────────
function CampaignsTab({ api, toast, contactTypes, onChanged }: { api: MarketingApi; toast: MarketingToast; contactTypes: Array<{ value: string; label: string }>; onChanged: () => void }) {
  const [rows, setRows] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<{ open: boolean; campaign: Campaign | null }>({ open: false, campaign: null })
  const [confirmSend, setConfirmSend] = useState<Campaign | null>(null)
  const [toDelete, setToDelete] = useState<Campaign | null>(null)
  const [schedule, setSchedule] = useState<{ campaign: Campaign; when: string } | null>(null)
  const load = useCallback(async () => { try { const d = await api.get('/api/marketing/campaigns'); setRows(d?.data || []) } catch (e) { toast.error(errMsg(e, 'Failed to load campaigns')) } finally { setLoading(false) } }, [api])
  useEffect(() => { load() }, [load])
  const refresh = () => { load(); onChanged() }
  const send = async () => { if (!confirmSend) return; try { const r = await api.post(`/api/marketing/campaigns/${confirmSend.id}/send`); toast.success(`Sent to ${r?.sent ?? 0} of ${r?.audience ?? 0} contacts${r?.failed ? ` (${r.failed} failed)` : ''}`) } catch (e) { toast.error(errMsg(e, 'Failed to send campaign')) } finally { setConfirmSend(null); refresh() } }
  const remove = async () => { if (!toDelete) return; try { await api.delete('/api/marketing/campaigns', toDelete.id); toast.success('Campaign deleted') } catch (e) { toast.error(errMsg(e, 'Failed to delete campaign')) } finally { setToDelete(null); refresh() } }
  const doSchedule = async () => { if (!schedule) return; try { await api.post(`/api/marketing/campaigns/${schedule.campaign.id}/schedule`, { scheduledFor: new Date(schedule.when).toISOString() }); toast.success('Campaign scheduled'); setSchedule(null); refresh() } catch (e) { toast.error(errMsg(e, 'Failed to schedule')) } }
  const unschedule = async (c: Campaign) => { try { await api.post(`/api/marketing/campaigns/${c.id}/unschedule`); toast.success('Back to draft'); refresh() } catch (e) { toast.error(errMsg(e, 'Failed to unschedule')) } }
  if (loading) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setForm({ open: true, campaign: null })}><Plus className="w-4 h-4 mr-2 inline" />New Campaign</Button></div>
      {rows.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl dark:bg-slate-900"><Mail className="w-12 h-12 mx-auto text-gray-400 mb-3" /><p className="text-gray-500 dark:text-slate-400">No campaigns yet</p></div>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto dark:bg-slate-900 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800/60"><tr>
              {['Campaign', 'Status', 'Recipients', 'Opens', 'Clicks', 'Unsubscribes', ''].map((h, i) => <th key={h || i} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 ${i >= 2 && i <= 5 ? 'text-right' : 'text-left'}`}>{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {rows.map((c) => (
                <tr key={c.id} className="text-gray-900 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-3"><p className="font-medium">{c.name}</p><p className="text-gray-500 dark:text-slate-400">{c.subject}</p></td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${statusCls[c.status] || statusCls.draft}`}>{c.status}</span>
                    {c.status === 'scheduled' && c.scheduledDate && <p className="text-xs text-gray-500 mt-1">{fmtWhen(c.scheduledDate)}</p>}
                    {c.status === 'sent' && c.sentAt && <p className="text-xs text-gray-500 mt-1">{fmtWhen(c.sentAt)}</p>}
                    {c.status === 'failed' && !!c.lastError && <p className="text-xs text-red-600 mt-1 max-w-xs">{c.lastError}</p>}
                  </td>
                  <td className="px-4 py-3 text-right">{c.recipientCount ?? 0}</td>
                  <td className="px-4 py-3 text-right">{c.openCount ?? 0}</td>
                  <td className="px-4 py-3 text-right">{c.clickCount ?? 0}</td>
                  <td className="px-4 py-3 text-right">{c.unsubscribeCount ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {(c.status === 'draft' || c.status === 'failed') && <>
                        <button onClick={() => setConfirmSend(c)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title={c.status === 'failed' ? 'Send again' : 'Send now'}><Send className="w-4 h-4" /></button>
                        <button onClick={() => setSchedule({ campaign: c, when: '' })} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Schedule"><Calendar className="w-4 h-4" /></button>
                      </>}
                      {c.status === 'scheduled' && <button onClick={() => unschedule(c)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Cancel schedule"><X className="w-4 h-4" /></button>}
                      {c.status !== 'sent' && c.status !== 'sending' && <button onClick={() => setForm({ open: true, campaign: c })} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100" title="Edit"><Edit2 className="w-4 h-4" /></button>}
                      {c.status !== 'sending' && <button onClick={() => setToDelete(c)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50" title="Delete"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form.open && <CampaignForm api={api} toast={toast} campaign={form.campaign} contactTypes={contactTypes} onSaved={() => { setForm({ open: false, campaign: null }); refresh() }} onClose={() => setForm({ open: false, campaign: null })} />}
      <ConfirmModal isOpen={!!confirmSend} onClose={() => setConfirmSend(null)} onConfirm={send} title="Send campaign" message={`Send "${confirmSend?.name || ''}" to its audience now? Contacts who unsubscribed are always excluded.`} confirmText="Send now" danger={false} />
      <ConfirmModal isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} title="Delete campaign" message={`Delete "${toDelete?.name || ''}"${toDelete?.status === 'sent' ? ' and its delivery history' : ''}?`} confirmText="Delete" />
      <Modal isOpen={!!schedule} onClose={() => setSchedule(null)} title="Schedule campaign" size="sm">
        <Field label="Send at"><input type="datetime-local" value={schedule?.when || ''} onChange={(e) => schedule && setSchedule({ ...schedule, when: e.target.value })} className={inputCls} /></Field>
        <p className="text-xs text-gray-500 mt-2 dark:text-slate-400">Scheduled campaigns go out within 15 minutes of the time you pick.</p>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setSchedule(null)}>Cancel</Button><Button onClick={doSchedule} disabled={!schedule?.when}>Schedule</Button></div>
      </Modal>
    </div>
  )
}

function CampaignForm({ api, toast, campaign, contactTypes, onSaved, onClose }: { api: MarketingApi; toast: MarketingToast; campaign: Campaign | null; contactTypes: Array<{ value: string; label: string }>; onSaved: () => void; onClose: () => void }) {
  const existing = (campaign?.audienceFilter as { type?: string; createdAfter?: string } | null) || null
  const [form, setForm] = useState({ name: campaign?.name || '', subject: campaign?.subject || '', body: campaign?.content || '', audienceType: campaign?.audienceType === 'segment' ? 'segment' : 'all', segmentType: existing?.type || '', segmentCreatedAfter: (existing?.createdAfter || '').slice(0, 10) })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [audience, setAudience] = useState<number | null>(null)
  const audienceFilter = form.audienceType === 'segment' ? { ...(form.segmentType ? { type: form.segmentType } : {}), ...(form.segmentCreatedAfter ? { createdAfter: form.segmentCreatedAfter } : {}) } : null
  useEffect(() => {
    let cancelled = false; setAudience(null)
    const t = setTimeout(async () => { try { const p = await api.post('/api/marketing/audience/preview', { audienceType: form.audienceType, audienceFilter }); if (!cancelled) setAudience(Number(p?.count ?? 0)) } catch { if (!cancelled) setAudience(0) } }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [form.audienceType, form.segmentType, form.segmentCreatedAfter])
  const save = async () => {
    if (!form.name.trim()) { setError('Campaign name is required'); return }
    if (!form.subject.trim()) { setError('Subject line is required'); return }
    setSaving(true); setError('')
    try {
      const payload = { name: form.name.trim(), subject: form.subject.trim(), body: form.body, audienceType: form.audienceType, audienceFilter }
      if (campaign) await api.put(`/api/marketing/campaigns/${campaign.id}`, payload); else await api.post('/api/marketing/campaigns', payload)
      toast.success(campaign ? 'Campaign updated' : 'Campaign created'); onSaved()
    } catch (e) { setError(errMsg(e, 'Failed to save campaign')) } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={campaign ? 'Edit Campaign' : 'New Campaign'} size="lg">
      <div className="space-y-4">
        <ErrorBox msg={error} />
        <Field label="Campaign name *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
        <Field label="Subject line *"><input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className={inputCls} /></Field>
        <Field label="Audience">
          <select value={form.audienceType} onChange={(e) => setForm({ ...form, audienceType: e.target.value })} className={inputCls}><option value="all">All contacts with an email</option><option value="segment">Segment</option></select>
          {form.audienceType === 'segment' && (
            <div className="mt-3 grid sm:grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg dark:bg-slate-800">
              <Field label="Contact type"><select value={form.segmentType} onChange={(e) => setForm({ ...form, segmentType: e.target.value })} className={inputCls}><option value="">Any type</option>{contactTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
              <Field label="Added on or after"><input type="date" value={form.segmentCreatedAfter} onChange={(e) => setForm({ ...form, segmentCreatedAfter: e.target.value })} className={inputCls} /></Field>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">{audience === null ? 'Counting recipients…' : `This campaign will go to ${audience} contact${audience === 1 ? '' : 's'}.`} Contacts who unsubscribed are always excluded.</p>
        </Field>
        <Field label="Email body (HTML)" hint="Variables: {{name}}, {{firstName}}, {{company}}"><textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className={`${inputCls} font-mono text-sm`} rows={10} /></Field>
      </div>
      <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
    </Modal>
  )
}

// ─── templates ────────────────────────────────────────────────────────────────
function TemplatesTab({ api, toast }: { api: MarketingApi; toast: MarketingToast }) {
  const [rows, setRows] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<{ open: boolean; template: Template | null }>({ open: false, template: null })
  const [toDelete, setToDelete] = useState<Template | null>(null)
  const load = useCallback(async () => { try { setRows((await api.get('/api/marketing/templates', { active: 'all' })) || []) } catch (e) { toast.error(errMsg(e, 'Failed to load templates')) } finally { setLoading(false) } }, [api])
  useEffect(() => { load() }, [load])
  const duplicate = async (t: Template) => { try { await api.post(`/api/marketing/templates/${t.id}/duplicate`); toast.success('Template duplicated'); load() } catch (e) { toast.error(errMsg(e, 'Failed to duplicate')) } }
  const remove = async () => { if (!toDelete) return; try { await api.delete('/api/marketing/templates', toDelete.id); toast.success('Template deleted') } catch (e) { toast.error(errMsg(e, 'Failed to delete template')) } finally { setToDelete(null); load() } }
  if (loading) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setForm({ open: true, template: null })}><Plus className="w-4 h-4 mr-2 inline" />New Template</Button></div>
      {rows.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl dark:bg-slate-900"><FileText className="w-12 h-12 mx-auto text-gray-400 mb-3" /><p className="text-gray-500 dark:text-slate-400">No templates yet</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border p-4 dark:bg-slate-900 dark:border-slate-800">
              <div className="flex items-start justify-between">
                <div><p className="font-medium text-gray-900 dark:text-slate-100">{t.name}{t.active === false && <span className="ml-2 text-xs text-gray-400">inactive</span>}</p><p className="text-sm text-gray-500 dark:text-slate-400 capitalize">{t.category || t.type}</p></div>
                <div className="flex gap-1">
                  <button onClick={() => setForm({ open: true, template: t })} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg" title="Edit"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => duplicate(t)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg" title="Duplicate"><Copy className="w-4 h-4" /></button>
                  <button onClick={() => setToDelete(t)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg" title="Delete"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-600 line-clamp-2 dark:text-slate-400">{t.subject}</p>
            </div>
          ))}
        </div>
      )}
      {form.open && <TemplateForm api={api} toast={toast} template={form.template} onSaved={() => { setForm({ open: false, template: null }); load() }} onClose={() => setForm({ open: false, template: null })} />}
      <ConfirmModal isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} title="Delete template" message={`Delete "${toDelete?.name || ''}"?`} confirmText="Delete" />
    </div>
  )
}
function TemplateForm({ api, toast, template, onSaved, onClose }: { api: MarketingApi; toast: MarketingToast; template: Template | null; onSaved: () => void; onClose: () => void }) {
  const [form, setForm] = useState({ name: template?.name || '', subject: template?.subject || '', body: template?.body || '', category: template?.category || template?.type || 'general', active: template?.active !== false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.subject.trim()) { setError('Subject is required'); return }
    setSaving(true); setError('')
    try { if (template) await api.put(`/api/marketing/templates/${template.id}`, form); else await api.post('/api/marketing/templates', form); toast.success(template ? 'Template updated' : 'Template created'); onSaved() }
    catch (e) { setError(errMsg(e, 'Failed to save template')) } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={template ? 'Edit Template' : 'New Template'} size="lg">
      <div className="space-y-4">
        <ErrorBox msg={error} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
          <Field label="Category"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>{TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{c === 'followup' ? 'Follow-up' : c.charAt(0).toUpperCase() + c.slice(1)}</option>)}</select></Field>
        </div>
        <Field label="Subject *"><input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className={inputCls} /></Field>
        <Field label="Body (HTML)" hint="Variables: {{name}}, {{firstName}}, {{company}}"><textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className={`${inputCls} font-mono text-sm`} rows={10} /></Field>
        {template && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="rounded" /> Active</label>}
      </div>
      <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
    </Modal>
  )
}

// ─── sequences ────────────────────────────────────────────────────────────────
function SequencesTab({ api, toast, label, onChanged }: { api: MarketingApi; toast: MarketingToast; label: string; onChanged: () => void }) {
  const [rows, setRows] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<{ open: boolean; sequence: Sequence | null }>({ open: false, sequence: null })
  const [enroll, setEnroll] = useState<Sequence | null>(null)
  const [toDelete, setToDelete] = useState<Sequence | null>(null)
  const load = useCallback(async () => { try { setRows((await api.get('/api/marketing/sequences')) || []) } catch (e) { toast.error(errMsg(e, 'Failed to load sequences')) } finally { setLoading(false) } }, [api])
  useEffect(() => { load() }, [load])
  const refresh = () => { load(); onChanged() }
  const toggle = async (s: Sequence) => { try { await api.put(`/api/marketing/sequences/${s.id}`, { active: !s.active }); toast.success(s.active ? 'Paused' : 'Resumed'); refresh() } catch (e) { toast.error(errMsg(e, 'Failed to update')) } }
  const remove = async () => { if (!toDelete) return; try { await api.delete('/api/marketing/sequences', toDelete.id); toast.success('Sequence deleted') } catch (e) { toast.error(errMsg(e, 'Failed to delete sequence')) } finally { setToDelete(null); refresh() } }
  if (loading) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setForm({ open: true, sequence: null })}><Plus className="w-4 h-4 mr-2 inline" />New Sequence</Button></div>
      {rows.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl dark:bg-slate-900"><Zap className="w-12 h-12 mx-auto text-gray-400 mb-3" /><p className="text-gray-500 dark:text-slate-400">No {label.toLowerCase()} yet</p><p className="text-sm text-gray-400 mt-1">A series of emails sent automatically, spaced out over days, to the contacts you enroll.</p></div>
      ) : rows.map((s) => (
        <div key={s.id} className="bg-white rounded-xl border p-4 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.active ? 'bg-green-100' : 'bg-gray-100 dark:bg-slate-800'}`}><Zap className={`w-5 h-5 ${s.active ? 'text-green-600' : 'text-gray-400'}`} /></div>
              <div>
                <p className="font-medium text-gray-900 dark:text-slate-100">{s.name}</p>
                <p className="text-sm text-gray-500 dark:text-slate-400">{s.steps?.length || 0} step{s.steps?.length === 1 ? '' : 's'} · {s.activeEnrollments ?? 0} in progress · {s.enrollmentCount ?? 0} enrolled total</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 text-xs rounded-full ${s.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{s.active ? 'Active' : 'Paused'}</span>
              <button onClick={() => setEnroll(s)} disabled={!s.active} className="flex items-center gap-1 px-2.5 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800" title={s.active ? 'Enroll a contact' : 'Resume the sequence to enroll'}><UserPlus className="w-4 h-4" /> Enroll</button>
              <button onClick={() => toggle(s)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg dark:hover:bg-slate-800" title={s.active ? 'Pause' : 'Resume'}>{s.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
              <button onClick={() => setForm({ open: true, sequence: s })} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg dark:hover:bg-slate-800" title="Edit"><Edit2 className="w-4 h-4" /></button>
              <button onClick={() => setToDelete(s)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50" title="Delete"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
          {(s.steps?.length || 0) > 0 && (
            <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-2">
              {s.steps.map((st, i) => (
                <div key={i} className="flex items-center">
                  <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm whitespace-nowrap dark:bg-slate-800"><p className="font-medium text-gray-900 dark:text-slate-100">Step {i + 1}</p><p className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" />{st.delayDays > 0 && `${st.delayDays}d `}{st.delayHours > 0 && `${st.delayHours}h`}{!st.delayDays && !st.delayHours && 'Immediately'}</p><p className="text-xs text-gray-500 dark:text-slate-400 max-w-[12rem] truncate">{st.subject}</p></div>
                  {i < s.steps.length - 1 && <div className="w-8 h-0.5 bg-gray-200 dark:bg-slate-700" />}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {form.open && <SequenceForm api={api} toast={toast} sequence={form.sequence} label={label} onSaved={() => { setForm({ open: false, sequence: null }); refresh() }} onClose={() => setForm({ open: false, sequence: null })} />}
      {enroll && <EnrollModal api={api} toast={toast} sequence={enroll} onDone={() => { setEnroll(null); refresh() }} onClose={() => setEnroll(null)} />}
      <ConfirmModal isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} title="Delete sequence" message={`Delete "${toDelete?.name || ''}"? Contacts currently enrolled stop receiving it.`} confirmText="Delete" />
    </div>
  )
}
function SequenceForm({ api, toast, sequence, label, onSaved, onClose }: { api: MarketingApi; toast: MarketingToast; sequence: Sequence | null; label: string; onSaved: () => void; onClose: () => void }) {
  const [form, setForm] = useState<{ name: string; active: boolean; steps: Step[] }>({ name: sequence?.name || '', active: sequence ? !!sequence.active : true, steps: sequence?.steps?.length ? sequence.steps.map((s) => ({ delayDays: Number(s.delayDays || 0), delayHours: Number(s.delayHours || 0), subject: s.subject || '', body: s.body || '' })) : [{ delayDays: 0, delayHours: 0, subject: '', body: '' }] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const setStep = (i: number, patch: Partial<Step>) => setForm({ ...form, steps: form.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const save = async () => {
    if (!form.name.trim()) { setError('Sequence name is required'); return }
    const bad = form.steps.findIndex((s) => !s.subject.trim())
    if (bad >= 0) { setError(`Step ${bad + 1} needs a subject line`); return }
    setSaving(true); setError('')
    try {
      // Only manual enrolment exists today — no trigger fires automatically, so none is offered.
      const payload = { name: form.name.trim(), trigger: 'manual', active: form.active, steps: form.steps }
      if (sequence) await api.put(`/api/marketing/sequences/${sequence.id}`, payload); else await api.post('/api/marketing/sequences', payload)
      toast.success(sequence ? 'Sequence updated' : 'Sequence created'); onSaved()
    } catch (e) { setError(errMsg(e, 'Failed to save sequence')) } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={sequence ? `Edit ${label.replace(/s$/, '')}` : `New ${label.replace(/s$/, '')}`} size="xl">
      <div className="space-y-4">
        <ErrorBox msg={error} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
          <Field label="Status"><select value={form.active ? 'active' : 'paused'} onChange={(e) => setForm({ ...form, active: e.target.value === 'active' })} className={inputCls}><option value="active">Active — contacts can be enrolled</option><option value="paused">Paused</option></select></Field>
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400">Contacts are enrolled by hand from the sequence card. Step 1 goes out within 15 minutes of enrolling; each later step waits its delay after the previous one.</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-medium text-gray-900 dark:text-slate-100">Steps</h3><button type="button" onClick={() => setForm({ ...form, steps: [...form.steps, { delayDays: 1, delayHours: 0, subject: '', body: '' }] })} className="text-sm text-orange-600 hover:text-orange-700">+ Add step</button></div>
          {form.steps.map((s, i) => (
            <div key={i} className="p-4 border rounded-lg space-y-3 dark:border-slate-700">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-medium text-gray-900 dark:text-slate-100">Step {i + 1}</span>
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
                  <span>{i === 0 ? 'Send' : 'Wait'}</span>
                  <input type="number" min={0} value={s.delayDays} onChange={(e) => setStep(i, { delayDays: Math.max(0, parseInt(e.target.value) || 0) })} className={`${inputCls} w-16 py-1`} /> days
                  <input type="number" min={0} max={23} value={s.delayHours} onChange={(e) => setStep(i, { delayHours: Math.max(0, parseInt(e.target.value) || 0) })} className={`${inputCls} w-16 py-1`} /> hours
                  <span>{i === 0 ? 'after enrolling' : 'after the previous step'}</span>
                  {form.steps.length > 1 && <button type="button" onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })} className="p-1 text-gray-400 hover:text-red-600" title="Remove step"><X className="w-4 h-4" /></button>}
                </div>
              </div>
              <input value={s.subject} onChange={(e) => setStep(i, { subject: e.target.value })} className={inputCls} placeholder="Subject line *" />
              <textarea value={s.body} onChange={(e) => setStep(i, { body: e.target.value })} className={`${inputCls} text-sm`} rows={3} placeholder="Email body (HTML) — {{name}}, {{firstName}}, {{company}} are filled in" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving...' : sequence ? 'Save' : 'Create sequence'}</Button></div>
    </Modal>
  )
}
function EnrollModal({ api, toast, sequence, onDone, onClose }: { api: MarketingApi; toast: MarketingToast; sequence: Sequence; onDone: () => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string; email?: string | null; emailOptOut?: boolean }>>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { const t = setTimeout(async () => { try { const d = await api.get('/api/contacts', { search: q || undefined, limit: 8 }); setResults(d?.data || []) } catch { setResults([]) } }, 250); return () => clearTimeout(t) }, [q, api])
  const go = async (id: string) => { setBusy(id); setError(''); try { await api.post(`/api/marketing/sequences/${sequence.id}/enroll`, { contactId: id }); toast.success('Enrolled — step 1 goes out within 15 minutes'); onDone() } catch (e) { setError(errMsg(e, 'Failed to enroll')) } finally { setBusy(null) } }
  return (
    <Modal isOpen onClose={onClose} title={`Enroll in “${sequence.name}”`} size="md">
      <div className="space-y-3">
        <ErrorBox msg={error} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts by name or email…" className={inputCls} />
        <div className="divide-y rounded-lg border dark:border-slate-700 dark:divide-slate-700 max-h-72 overflow-y-auto">
          {results.length === 0 && <p className="p-3 text-sm text-gray-500 dark:text-slate-400">No contacts found</p>}
          {results.map((c) => (
            <button key={c.id} type="button" disabled={!c.email || busy === c.id} onClick={() => go(c.id)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-slate-800">
              <span><span className="font-medium text-gray-900 dark:text-slate-100">{c.name}</span><span className="block text-xs text-gray-500 dark:text-slate-400">{c.email || 'no email address'}{c.emailOptOut ? ' · unsubscribed' : ''}</span></span>
              <span className="text-xs text-orange-600">{busy === c.id ? 'Enrolling…' : 'Enroll'}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end mt-4"><Button variant="secondary" onClick={onClose}>Close</Button></div>
    </Modal>
  )
}
