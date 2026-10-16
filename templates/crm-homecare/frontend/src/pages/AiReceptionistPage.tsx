/**
 * AI Receptionist — the agency's rules for answering calls nobody picked up, its settings, and the call log.
 *
 * Ported from crm-roof's page (pages/roofing/AIReceptionistPage.tsx), the one screen in the fleet built
 * against this API's real shape. (10/16) The two home care screens it replaces were both dead:
 *   · pages/AiReceptionistPage.tsx (the one Admin › AI Receptionist mounted) called /api/ai-receptionist/config
 *     and /calls — neither route exists — and read localStorage 'token', which the api client deletes on sign-in;
 *   · components/admin/AIReceptionist.tsx (imported, never mounted) sent snake_case fields (message_template,
 *     delay_minutes, enabled, greeting_text …) that services/aiReceptionist.ts never reads, and treated
 *     GET /rules and GET /api/calltracking/calls as bare arrays when both answer { data } — rules always looked
 *     empty and nothing saved.
 *
 * The API is camelCase in and out: rules { name, trigger, channel, messageTemplate, delayMinutes, isActive,
 * keywordMatch }, settings { isEnabled, businessHoursStart, businessHoursEnd, timezone, greetingText,
 * forwardingNumber }. tests/homecare/ai-receptionist.test.ts holds this file's request bodies to that list.
 *
 * Who: the router is authenticate + requireAdmin, so this is the office's (admin / owner). A caregiver never
 * reaches Admin; the controls still ask isAdmin so the screen offers nothing the server would refuse.
 */
import { useState, useEffect, useCallback } from 'react';
import { Bot, Plus, X, Pencil, Trash2, Phone, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../components/Toast';
import { confirm } from '../components/ConfirmModal';
import { formatDateTime } from '../utils/datetime';

interface Rule {
  id: string
  name: string
  trigger: string
  channel: string
  keywordMatch?: string | null
  delayMinutes: number
  messageTemplate: string
  isActive: boolean
}

// /api/calltracking/calls is raw SQL, so rows carry the call_log column names verbatim.
interface CallRecord {
  id: string
  direction: string | null
  caller_number: string | null
  duration: number | null
  status: string
  ai_summary?: string | null
  start_time: string | null
  created_at: string
}

interface Settings {
  isEnabled: boolean
  businessHoursStart: string
  businessHoursEnd: string
  timezone: string
  greetingText: string
  forwardingNumber: string
}

const defaultSettings: Settings = {
  isEnabled: false,
  businessHoursStart: '08:00',
  businessHoursEnd: '17:00',
  timezone: 'America/Chicago',
  greetingText: '',
  forwardingNumber: '',
}

interface RuleForm {
  name: string
  trigger: string
  channel: string
  keywordMatch: string
  delayMinutes: string
  messageTemplate: string
  isActive: boolean
}
const defaultRule: RuleForm = {
  name: '',
  trigger: 'missed_call',
  channel: 'sms',
  keywordMatch: '',
  delayMinutes: '5',
  messageTemplate: '',
  isActive: true,
}

const TRIGGERS: Array<[string, string]> = [
  ['missed_call', 'Missed call'],
  ['voicemail', 'Voicemail'],
  ['after_hours', 'After hours'],
  ['keyword', 'Keyword match'],
]
const triggerLabel = (t: string) => TRIGGERS.find(([v]) => v === t)?.[1] || t.replace(/_/g, ' ')

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]

/** What a rule save sends — the service's own field list, nothing else. */
export const ruleBody = (f: RuleForm) => ({
  name: f.name.trim(),
  trigger: f.trigger,
  channel: f.channel,
  messageTemplate: f.messageTemplate.trim(),
  delayMinutes: Math.max(0, Number(f.delayMinutes) || 0),
  isActive: f.isActive,
  keywordMatch: f.trigger === 'keyword' ? f.keywordMatch.trim() : null,
})
/** What a settings save sends. */
export const settingsBody = (s: Settings) => ({
  isEnabled: s.isEnabled,
  businessHoursStart: s.businessHoursStart,
  businessHoursEnd: s.businessHoursEnd,
  timezone: s.timezone,
  greetingText: s.greetingText.trim() || null,
  forwardingNumber: s.forwardingNumber.trim() || null,
})

const inputCls = 'bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-gray-500 dark:placeholder-slate-400'
const cardCls = 'bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700'
const primaryBtn = 'bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition'

export default function AiReceptionistPage() {
  const { isAdmin } = useAuth()
  const mayEdit = !!isAdmin

  const [tab, setTab] = useState<'rules' | 'calls' | 'settings'>('rules')
  const [rules, setRules] = useState<Rule[]>([])
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [callsTotal, setCallsTotal] = useState(0)
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [form, setForm] = useState<RuleForm>(defaultRule)

  // Both lists answer the standard envelope: rules → { data }, calls → { data, pagination }.
  const loadRules = useCallback(async () => {
    try {
      const body = await api.get('/api/ai-receptionist/rules')
      setRules(Array.isArray(body?.data) ? body.data : [])
    } catch (e: any) { toast(e?.message || 'Could not load the rules', 'error') }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.get('/api/ai-receptionist/settings')
      // greetingText / forwardingNumber are nullable columns; keep the inputs controlled.
      if (data) setSettings({ ...defaultSettings, ...data, greetingText: data.greetingText ?? '', forwardingNumber: data.forwardingNumber ?? '' })
    } catch (e: any) { toast(e?.message || 'Could not load the settings', 'error') }
  }, [])

  const loadCalls = useCallback(async () => {
    try {
      const body = await api.get('/api/calltracking/calls')
      const list = Array.isArray(body?.data) ? body.data : []
      setCalls(list)
      setCallsTotal(Number(body?.pagination?.total ?? list.length))
    } catch { setCalls([]); setCallsTotal(0) }
  }, [])

  useEffect(() => {
    Promise.all([loadRules(), loadSettings(), loadCalls()]).finally(() => setLoading(false))
  }, [loadRules, loadSettings, loadCalls])

  async function saveRule() {
    setSaving(true)
    try {
      if (editingRule) await api.put(`/api/ai-receptionist/rules/${editingRule.id}`, ruleBody(form))
      else await api.post('/api/ai-receptionist/rules', ruleBody(form))
      toast(editingRule ? 'Rule updated' : 'Rule created')
      await loadRules()
      closeModal()
    } catch (e: any) { toast(e?.message || 'Could not save the rule', 'error') }
    finally { setSaving(false) }
  }

  async function deleteRule(rule: Rule) {
    if (!(await confirm(`Delete the rule "${rule.name}"?`, { danger: true }))) return
    try {
      await api.del(`/api/ai-receptionist/rules/${rule.id}`)
      toast('Rule deleted')
      await loadRules()
    } catch (e: any) { toast(e?.message || 'Could not delete the rule', 'error') }
  }

  async function toggleRule(rule: Rule) {
    try {
      await api.put(`/api/ai-receptionist/rules/${rule.id}`, { isActive: !rule.isActive })
      await loadRules()
    } catch (e: any) { toast(e?.message || 'Could not change the rule', 'error') }
  }

  async function saveSettings() {
    setSaving(true)
    try {
      await api.put('/api/ai-receptionist/settings', settingsBody(settings))
      toast('Settings saved')
      await loadSettings()
    } catch (e: any) { toast(e?.message || 'Could not save the settings', 'error') }
    finally { setSaving(false) }
  }

  function openCreate() {
    setEditingRule(null)
    setForm({ ...defaultRule })
    setShowModal(true)
  }

  function openEdit(rule: Rule) {
    setEditingRule(rule)
    setForm({
      name: rule.name,
      trigger: rule.trigger,
      channel: rule.channel,
      keywordMatch: rule.keywordMatch || '',
      delayMinutes: String(rule.delayMinutes ?? 0),
      messageTemplate: rule.messageTemplate,
      isActive: rule.isActive,
    })
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingRule(null)
  }

  const activeRulesCount = rules.filter(r => r.isActive).length
  const canSaveRule = !!form.name.trim() && !!form.messageTemplate.trim() && (form.trigger !== 'keyword' || !!form.keywordMatch.trim())

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="animate-spin text-primary-700 dark:text-primary-300" size={32} />
      </div>
    )
  }

  return (
    <div className="text-gray-900 dark:text-slate-100">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bot size={28} className="text-primary-700 dark:text-primary-300" />
          <div>
            <h1 className="text-2xl font-bold">AI Receptionist</h1>
            <p className="text-sm text-gray-600 dark:text-slate-400">Answers clients and families when the office can't pick up.</p>
          </div>
        </div>
        {tab === 'rules' && mayEdit && (
          <button onClick={openCreate} className={`flex items-center gap-2 ${primaryBtn}`}>
            <Plus size={16} /> New Rule
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className={`${cardCls} p-4`}>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Status</p>
          <p className={`text-lg font-bold ${settings.isEnabled ? 'text-green-800 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
            {settings.isEnabled ? 'Active' : 'Inactive'}
          </p>
        </div>
        <div className={`${cardCls} p-4`}>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Total Rules</p>
          <p className="text-lg font-bold">{rules.length}</p>
        </div>
        <div className={`${cardCls} p-4`}>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Active Rules</p>
          <p className="text-lg font-bold text-primary-700 dark:text-primary-300">{activeRulesCount}</p>
        </div>
        <div className={`${cardCls} p-4`}>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Recent Calls</p>
          <p className="text-lg font-bold">{callsTotal}</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-1 w-fit">
        {(['rules', 'calls', 'settings'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === t ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-800'
            }`}
          >
            {t === 'calls' ? 'Call Log' : t === 'rules' ? 'Rules' : 'Settings'}
          </button>
        ))}
      </div>

      {tab === 'rules' && (
        <div className={`${cardCls} overflow-hidden`}>
          {rules.length === 0 ? (
            <div className="text-center py-16 text-gray-600 dark:text-slate-400">
              <Bot size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No rules yet</p>
              <p className="text-sm mb-4">Create a rule to text or email a caller the office missed.</p>
              {mayEdit && (
                <button onClick={openCreate} className={`inline-flex items-center gap-2 ${primaryBtn}`}>
                  <Plus size={16} /> Create Rule
                </button>
              )}
            </div>
          ) : (
            // overflow-x-auto: the card clips (rounded corners), so a phone would lose Active and Actions without it (roof T51).
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700 text-left text-gray-600 dark:text-slate-400">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Trigger</th>
                    <th className="px-4 py-3 font-medium">Channel</th>
                    <th className="px-4 py-3 font-medium">Delay</th>
                    <th className="px-4 py-3 font-medium">Active</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(rule => (
                    <tr key={rule.id} className="border-b border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800">
                      <td className="px-4 py-3 font-medium">{rule.name}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300">{triggerLabel(rule.trigger)}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300 uppercase">{rule.channel}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300">{rule.delayMinutes}m</td>
                      <td className="px-4 py-3">
                        {mayEdit ? (
                          <button aria-label={rule.isActive ? 'Switch rule off' : 'Switch rule on'} onClick={() => toggleRule(rule)}>
                            {rule.isActive
                              ? <ToggleRight size={22} className="text-green-800 dark:text-green-300" />
                              : <ToggleLeft size={22} className="text-gray-500 dark:text-slate-400" />}
                          </button>
                        ) : (rule.isActive ? 'On' : 'Off')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {mayEdit && (
                          <div className="flex items-center justify-end gap-2">
                            <button aria-label="Edit rule" onClick={() => openEdit(rule)} className="p-1.5 rounded text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-slate-100">
                              <Pencil size={15} />
                            </button>
                            <button aria-label="Delete rule" onClick={() => deleteRule(rule)} className="p-1.5 rounded text-gray-600 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-700 dark:hover:text-red-300">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'calls' && (
        <div className={`${cardCls} overflow-hidden`}>
          {calls.length === 0 ? (
            <div className="text-center py-16 text-gray-600 dark:text-slate-400">
              <Phone size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No calls recorded yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700 text-left text-gray-600 dark:text-slate-400">
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Number</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">AI Summary</th>
                    <th className="px-4 py-3 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map(call => (
                    <tr key={call.id} className="border-b border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800">
                      <td className="px-4 py-3 capitalize">{call.direction || '--'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300 font-mono">{call.caller_number || '--'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300">
                        {call.duration ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, '0')}` : '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          call.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200' :
                          call.status === 'missed' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' :
                          call.status === 'voicemail' ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' :
                          'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}>
                          {call.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300 max-w-xs truncate">{call.ai_summary || '--'}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400 whitespace-nowrap">{formatDateTime(call.start_time || call.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className={`${cardCls} p-6 max-w-2xl space-y-6`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">AI Receptionist</p>
              <p className="text-sm text-gray-600 dark:text-slate-400">Switch the receptionist on or off for the agency</p>
            </div>
            {mayEdit && (
              <button aria-label={settings.isEnabled ? 'Switch the AI receptionist off' : 'Switch the AI receptionist on'} onClick={() => setSettings(s => ({ ...s, isEnabled: !s.isEnabled }))}>
                {settings.isEnabled
                  ? <ToggleRight size={32} className="text-green-800 dark:text-green-300" />
                  : <ToggleLeft size={32} className="text-gray-500 dark:text-slate-400" />}
              </button>
            )}
          </div>

          <hr className="border-gray-200 dark:border-slate-700" />

          <div>
            <label className="block text-sm font-medium mb-2">Office Hours</label>
            <div className="flex items-center gap-3">
              <input type="time" aria-label="Office hours start" value={settings.businessHoursStart} disabled={!mayEdit}
                onChange={e => setSettings(s => ({ ...s, businessHoursStart: e.target.value }))} className={inputCls} />
              <span className="text-gray-600 dark:text-slate-400">to</span>
              <input type="time" aria-label="Office hours end" value={settings.businessHoursEnd} disabled={!mayEdit}
                onChange={e => setSettings(s => ({ ...s, businessHoursEnd: e.target.value }))} className={inputCls} />
            </div>
          </div>

          <div>
            <label htmlFor="air-tz" className="block text-sm font-medium mb-2">Timezone</label>
            <select id="air-tz" value={settings.timezone} disabled={!mayEdit}
              onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))} className={`${inputCls} w-full max-w-xs`}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="air-greeting" className="block text-sm font-medium mb-2">Greeting</label>
            <textarea id="air-greeting" value={settings.greetingText} disabled={!mayEdit} rows={3}
              onChange={e => setSettings(s => ({ ...s, greetingText: e.target.value }))}
              placeholder="Thank you for calling. Our care team will get right back to you…" className={`${inputCls} w-full`} />
          </div>

          <div>
            <label htmlFor="air-forward" className="block text-sm font-medium mb-2">Forwarding Number</label>
            <input id="air-forward" type="tel" value={settings.forwardingNumber} disabled={!mayEdit}
              onChange={e => setSettings(s => ({ ...s, forwardingNumber: e.target.value }))}
              placeholder="+1 (555) 123-4567" className={`${inputCls} w-full max-w-xs`} />
          </div>

          {mayEdit && (
            <button onClick={saveSettings} disabled={saving} className={primaryBtn}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="air-rule-title">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl w-full max-w-lg mx-4 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 id="air-rule-title" className="text-lg font-bold">{editingRule ? 'Edit Rule' : 'New Rule'}</h2>
              <button aria-label="Close" onClick={closeModal} className="text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="air-name" className="block text-sm font-medium mb-1">Name</label>
                <input id="air-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={`${inputCls} w-full`} placeholder="e.g. Missed call — text back" />
              </div>

              <div>
                <label htmlFor="air-trigger" className="block text-sm font-medium mb-1">When</label>
                <select id="air-trigger" value={form.trigger} onChange={e => setForm(f => ({ ...f, trigger: e.target.value }))} className={`${inputCls} w-full`}>
                  {TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {form.trigger === 'keyword' && (
                <div>
                  <label htmlFor="air-keyword" className="block text-sm font-medium mb-1">Keyword</label>
                  <input id="air-keyword" value={form.keywordMatch} onChange={e => setForm(f => ({ ...f, keywordMatch: e.target.value }))} className={`${inputCls} w-full`} placeholder="e.g. fall, emergency, urgent" />
                </div>
              )}

              <div>
                <label htmlFor="air-channel" className="block text-sm font-medium mb-1">Send by</label>
                <select id="air-channel" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))} className={`${inputCls} w-full`}>
                  <option value="sms">Text (SMS)</option>
                  <option value="email">Email</option>
                  <option value="both">Both</option>
                </select>
              </div>

              <div>
                <label htmlFor="air-delay" className="block text-sm font-medium mb-1">Delay (minutes)</label>
                <input id="air-delay" type="number" min={0} value={form.delayMinutes} onChange={e => setForm(f => ({ ...f, delayMinutes: e.target.value }))} className={`${inputCls} w-32`} />
              </div>

              <div>
                <label htmlFor="air-message" className="block text-sm font-medium mb-1">Message</label>
                <textarea id="air-message" value={form.messageTemplate} onChange={e => setForm(f => ({ ...f, messageTemplate: e.target.value }))} rows={3}
                  placeholder="Hi {{name}}, sorry we missed your call — someone from our care team will call you back shortly."
                  className={`${inputCls} w-full`} />
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500" />
                Active
              </label>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={closeModal} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button onClick={saveRule} disabled={saving || !canSaveRule} className={primaryBtn}>
                {saving ? 'Saving…' : editingRule ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
