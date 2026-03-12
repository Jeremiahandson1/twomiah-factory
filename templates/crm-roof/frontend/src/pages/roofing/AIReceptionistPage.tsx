import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { format } from 'date-fns'
import {
  Bot, Plus, X, Pencil, Trash2, Phone, Clock,
  ToggleLeft, ToggleRight, RefreshCw,
} from 'lucide-react'

interface Rule {
  id: string
  name: string
  trigger: string
  channel: string
  keyword_match?: string
  delay_minutes: number
  message_template: string
  active: boolean
  created_at: string
}

interface CallRecord {
  id: string
  type: string
  from_number: string
  to_number: string
  duration: number
  status: string
  ai_summary?: string
  created_at: string
}

interface Settings {
  enabled: boolean
  business_hours_start: string
  business_hours_end: string
  timezone: string
  greeting_text: string
  forwarding_number: string
}

const defaultSettings: Settings = {
  enabled: false,
  business_hours_start: '08:00',
  business_hours_end: '17:00',
  timezone: 'America/Chicago',
  greeting_text: '',
  forwarding_number: '',
}

const defaultRule: Omit<Rule, 'id' | 'created_at'> = {
  name: '',
  trigger: 'missed_call',
  channel: 'sms',
  keyword_match: '',
  delay_minutes: 5,
  message_template: '',
  active: true,
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]

export default function AIReceptionistPage() {
  const { token } = useAuth()

  const [tab, setTab] = useState<'rules' | 'calls' | 'settings'>('rules')
  const [rules, setRules] = useState<Rule[]>([])
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [form, setForm] = useState(defaultRule)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-receptionist/rules', { headers })
      const data = await res.json()
      setRules(Array.isArray(data) ? data : data.rules || [])
    } catch { /* ignore */ }
  }, [token])

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-receptionist/settings', { headers })
      const data = await res.json()
      if (data) setSettings({ ...defaultSettings, ...data })
    } catch { /* ignore */ }
  }, [token])

  const loadCalls = useCallback(async () => {
    try {
      const res = await fetch('/api/calltracking/calls', { headers })
      const data = await res.json()
      setCalls(Array.isArray(data) ? data : data.calls || [])
    } catch { /* ignore */ }
  }, [token])

  useEffect(() => {
    Promise.all([loadRules(), loadSettings(), loadCalls()]).finally(() => setLoading(false))
  }, [loadRules, loadSettings, loadCalls])

  // Rule CRUD
  async function saveRule() {
    setSaving(true)
    try {
      const url = editingRule
        ? `/api/ai-receptionist/rules/${editingRule.id}`
        : '/api/ai-receptionist/rules'
      const method = editingRule ? 'PUT' : 'POST'
      await fetch(url, { method, headers, body: JSON.stringify(form) })
      await loadRules()
      closeModal()
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  async function deleteRule(id: string) {
    if (!confirm('Delete this rule?')) return
    await fetch(`/api/ai-receptionist/rules/${id}`, { method: 'DELETE', headers })
    await loadRules()
  }

  async function toggleRule(rule: Rule) {
    await fetch(`/api/ai-receptionist/rules/${rule.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...rule, active: !rule.active }),
    })
    await loadRules()
  }

  async function saveSettings() {
    setSaving(true)
    try {
      await fetch('/api/ai-receptionist/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify(settings),
      })
    } catch { /* ignore */ }
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
      keyword_match: rule.keyword_match || '',
      delay_minutes: rule.delay_minutes,
      message_template: rule.message_template,
      active: rule.active,
    })
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingRule(null)
  }

  // Stats
  const activeRulesCount = rules.filter(r => r.active).length
  const recentCallsCount = calls.length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-900">
        <RefreshCw className="animate-spin text-blue-400" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-900 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bot size={28} className="text-blue-400" />
          <h1 className="text-2xl font-bold">AI Receptionist</h1>
        </div>
        {tab === 'rules' && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            <Plus size={16} /> New Rule
          </button>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <p className="text-sm text-slate-400 mb-1">Status</p>
          <p className={`text-lg font-bold ${settings.enabled ? 'text-green-400' : 'text-red-400'}`}>
            {settings.enabled ? 'Active' : 'Inactive'}
          </p>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <p className="text-sm text-slate-400 mb-1">Total Rules</p>
          <p className="text-lg font-bold">{rules.length}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <p className="text-sm text-slate-400 mb-1">Active Rules</p>
          <p className="text-lg font-bold text-blue-400">{activeRulesCount}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <p className="text-sm text-slate-400 mb-1">Recent Calls</p>
          <p className="text-lg font-bold">{recentCallsCount}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-800 rounded-lg p-1 w-fit">
        {(['rules', 'calls', 'settings'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition capitalize ${
              tab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {t === 'calls' ? 'Call Log' : t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'rules' && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          {rules.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Bot size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No rules yet</p>
              <p className="text-sm mb-4">Create your first AI receptionist rule to get started.</p>
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
              >
                <Plus size={16} /> Create Rule
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
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
                  <tr key={rule.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="px-4 py-3 font-medium">{rule.name}</td>
                    <td className="px-4 py-3 text-slate-300 capitalize">{rule.trigger.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-slate-300 uppercase">{rule.channel}</td>
                    <td className="px-4 py-3 text-slate-300">{rule.delay_minutes}m</td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleRule(rule)} className="text-slate-300 hover:text-white">
                        {rule.active ? (
                          <ToggleRight size={22} className="text-green-400" />
                        ) : (
                          <ToggleLeft size={22} className="text-slate-500" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(rule)}
                          className="p-1.5 rounded hover:bg-slate-600 text-slate-400 hover:text-white transition"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => deleteRule(rule.id)}
                          className="p-1.5 rounded hover:bg-red-600/20 text-slate-400 hover:text-red-400 transition"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'calls' && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          {calls.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Phone size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No calls recorded yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-slate-400">
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Number</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">AI Summary</th>
                    <th className="px-4 py-3 font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map(call => (
                    <tr key={call.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                      <td className="px-4 py-3 capitalize">{call.type}</td>
                      <td className="px-4 py-3 text-slate-300 font-mono">{call.from_number}</td>
                      <td className="px-4 py-3 text-slate-300">
                        {call.duration ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, '0')}` : '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          call.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                          call.status === 'missed' ? 'bg-red-500/20 text-red-400' :
                          call.status === 'voicemail' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-slate-600 text-slate-300'
                        }`}>
                          {call.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 max-w-xs truncate">{call.ai_summary || '--'}</td>
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        {format(new Date(call.created_at), 'MMM d, yyyy h:mm a')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 max-w-2xl space-y-6">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">AI Receptionist</p>
              <p className="text-sm text-slate-400">Enable or disable the AI receptionist for your business</p>
            </div>
            <button
              onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
              className="text-slate-300 hover:text-white"
            >
              {settings.enabled ? (
                <ToggleRight size={32} className="text-green-400" />
              ) : (
                <ToggleLeft size={32} className="text-slate-500" />
              )}
            </button>
          </div>

          <hr className="border-slate-700" />

          {/* Business hours */}
          <div>
            <label className="block text-sm font-medium mb-2">Business Hours</label>
            <div className="flex items-center gap-3">
              <input
                type="time"
                value={settings.business_hours_start}
                onChange={e => setSettings(s => ({ ...s, business_hours_start: e.target.value }))}
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-slate-400">to</span>
              <input
                type="time"
                value={settings.business_hours_end}
                onChange={e => setSettings(s => ({ ...s, business_hours_end: e.target.value }))}
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-medium mb-2">Timezone</label>
            <select
              value={settings.timezone}
              onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {/* Greeting text */}
          <div>
            <label className="block text-sm font-medium mb-2">Greeting Text</label>
            <textarea
              value={settings.greeting_text}
              onChange={e => setSettings(s => ({ ...s, greeting_text: e.target.value }))}
              rows={3}
              placeholder="Hello! Thank you for calling..."
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
            />
          </div>

          {/* Forwarding number */}
          <div>
            <label className="block text-sm font-medium mb-2">Forwarding Number</label>
            <input
              type="tel"
              value={settings.forwarding_number}
              onChange={e => setSettings(s => ({ ...s, forwarding_number: e.target.value }))}
              placeholder="+1 (555) 123-4567"
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
            />
          </div>

          <button
            onClick={saveSettings}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {/* Create/Edit Rule Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className="relative bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg mx-4 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">{editingRule ? 'Edit Rule' : 'New Rule'}</h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Rule name"
                />
              </div>

              {/* Trigger */}
              <div>
                <label className="block text-sm font-medium mb-1">Trigger</label>
                <select
                  value={form.trigger}
                  onChange={e => setForm(f => ({ ...f, trigger: e.target.value }))}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="missed_call">Missed Call</option>
                  <option value="voicemail">Voicemail</option>
                  <option value="after_hours">After Hours</option>
                  <option value="keyword">Keyword Match</option>
                </select>
              </div>

              {/* Keyword match (conditional) */}
              {form.trigger === 'keyword' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Keyword Match</label>
                  <input
                    value={form.keyword_match}
                    onChange={e => setForm(f => ({ ...f, keyword_match: e.target.value }))}
                    className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. emergency, leak, urgent"
                  />
                </div>
              )}

              {/* Channel */}
              <div>
                <label className="block text-sm font-medium mb-1">Channel</label>
                <select
                  value={form.channel}
                  onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="both">Both</option>
                </select>
              </div>

              {/* Delay */}
              <div>
                <label className="block text-sm font-medium mb-1">Delay (minutes)</label>
                <input
                  type="number"
                  min={0}
                  value={form.delay_minutes}
                  onChange={e => setForm(f => ({ ...f, delay_minutes: parseInt(e.target.value) || 0 }))}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Message template */}
              <div>
                <label className="block text-sm font-medium mb-1">Message Template</label>
                <textarea
                  value={form.message_template}
                  onChange={e => setForm(f => ({ ...f, message_template: e.target.value }))}
                  rows={3}
                  placeholder="Hi {{name}}, we noticed we missed your call..."
                  className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
                />
              </div>

              {/* Active checkbox */}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                  className="rounded bg-slate-700 border-slate-600 text-blue-600 focus:ring-blue-500"
                />
                Active
              </label>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeModal}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                onClick={saveRule}
                disabled={saving || !form.name.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
              >
                {saving ? 'Saving...' : editingRule ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
