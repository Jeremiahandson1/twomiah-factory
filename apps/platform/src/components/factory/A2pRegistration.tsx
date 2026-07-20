import { useState, useEffect } from 'react'
import { supabase, API_URL as API } from '../../supabase'
import {
  MessageSquare, CheckCircle, XCircle, Clock, RefreshCw, AlertCircle,
  ChevronDown, ChevronUp, Send, Save,
} from 'lucide-react'

// Per-tenant A2P 10DLC registration panel. Talks to the factory A2P routes:
//   GET  /customers/:id/a2p          — status
//   POST /customers/:id/a2p/intake   — collect + encrypt EIN/legal data
//   POST /customers/:id/a2p/submit   — provision Twilio brand/campaign
//   POST /customers/:id/a2p/refresh  — re-poll vetting status
// See services/a2p.ts + routes/factory/a2p.ts.

type A2pStatus = {
  status: string
  collected: boolean
  einTail: string
  brandSid: string | null
  campaignSid: string | null
  messagingServiceSid: string | null
  phoneNumberSid: string | null
  rejectionReason: string | null
  submittedAt: string | null
  approvedAt: string | null
}

type Props = {
  tenantId: string
  showToast: (msg: string, type?: 'success' | 'error') => void
}

const BUSINESS_TYPES = ['Sole Proprietorship', 'Partnership', 'Limited Liability Company', 'Corporation', 'Non-profit Corporation']
// Twilio business_industry enum (subset covering Twomiah's verticals).
const INDUSTRIES = [
  'AUTOMOTIVE', 'AGRICULTURE', 'CONSTRUCTION', 'ENERGY', 'FINANCIAL', 'HEALTHCARE',
  'HOSPITALITY', 'INSURANCE', 'LEGAL', 'MANUFACTURING', 'PROFESSIONAL_SERVICES',
  'REAL_ESTATE', 'RETAIL', 'TECHNOLOGY', 'TRANSPORTATION', 'NOT_FOR_PROFIT',
]
const USECASES = ['MIXED', 'LOW_VOLUME']

const BADGE: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  not_started:  { color: 'text-gray-400 bg-gray-400/10 border-gray-400/30',    icon: <Clock size={12} />,                          label: 'Not started' },
  collected:    { color: 'text-blue-400 bg-blue-400/10 border-blue-400/30',    icon: <CheckCircle size={12} />,                    label: 'Data collected' },
  provisioning: { color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', icon: <RefreshCw size={12} className="animate-spin" />, label: 'Provisioning' },
  pending:      { color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', icon: <Clock size={12} />,                       label: 'Pending vetting' },
  approved:     { color: 'text-green-400 bg-green-400/10 border-green-400/30',  icon: <CheckCircle size={12} />,                    label: 'Approved' },
  rejected:     { color: 'text-red-400 bg-red-400/10 border-red-400/30',        icon: <XCircle size={12} />,                        label: 'Rejected' },
  error:        { color: 'text-red-400 bg-red-400/10 border-red-400/30',        icon: <AlertCircle size={12} />,                    label: 'Error' },
}

const INPUT = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500'
const LABEL = 'block text-xs text-gray-400 mb-1'

const EMPTY_FORM = {
  legalName: '', businessType: BUSINESS_TYPES[2], ein: '', industry: INDUSTRIES[10], website: '',
  street: '', city: '', region: '', postalCode: '',
  repFirstName: '', repLastName: '', repEmail: '', repPhone: '', repTitle: 'Owner',
  usecase: 'MIXED', campaignDescription: '', messageSamplesText: '', soleProprietor: false,
}

async function token(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

export default function A2pRegistration({ tenantId, showToast }: Props) {
  const [state, setState] = useState<A2pStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })

  useEffect(() => { load() }, [tenantId])

  async function load() {
    setLoading(true)
    try {
      const t = await token()
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/a2p', {
        headers: { Authorization: 'Bearer ' + t },
      })
      if (res.ok) setState(await res.json())
    } catch { /* leave state null; panel still renders intake */ }
    setLoading(false)
  }

  function up<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function saveIntake() {
    const samples = form.messageSamplesText.split('\n').map(s => s.trim()).filter(Boolean)
    if (samples.length < 1 || samples.length > 5) { showToast('Provide 1–5 sample messages (one per line)', 'error'); return }
    setSaving(true)
    try {
      const t = await token()
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/a2p/intake', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: form.legalName, businessType: form.businessType, ein: form.ein,
          industry: form.industry, website: form.website,
          street: form.street, city: form.city, region: form.region, postalCode: form.postalCode,
          repFirstName: form.repFirstName, repLastName: form.repLastName, repEmail: form.repEmail,
          repPhone: form.repPhone, repTitle: form.repTitle,
          usecase: form.usecase, campaignDescription: form.campaignDescription,
          messageSamples: samples, soleProprietor: form.soleProprietor,
        }),
      })
      const data = await res.json()
      if (res.ok) { showToast('A2P data saved'); setShowForm(false); load() }
      else showToast(data.error || 'Failed to save', 'error')
    } catch { showToast('Failed to save A2P data', 'error') }
    setSaving(false)
  }

  async function submit() {
    setSubmitting(true)
    try {
      const t = await token()
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/a2p/submit', {
        method: 'POST', headers: { Authorization: 'Bearer ' + t },
      })
      const data = await res.json()
      if (res.ok) showToast('Submitted for vetting')
      else {
        const failed = Array.isArray(data.steps) ? data.steps.find((s: any) => s.status === 'error') : null
        showToast(failed ? `Failed at ${failed.step}: ${failed.detail}` : (data.error || 'Submit failed'), 'error')
      }
      load()
    } catch { showToast('Submit failed', 'error') }
    setSubmitting(false)
  }

  async function refresh() {
    setRefreshing(true)
    try {
      const t = await token()
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/a2p/refresh', {
        method: 'POST', headers: { Authorization: 'Bearer ' + t },
      })
      const data = await res.json()
      if (res.ok) showToast('Status: ' + data.status)
      else showToast(data.error || 'Refresh failed', 'error')
      load()
    } catch { showToast('Refresh failed', 'error') }
    setRefreshing(false)
  }

  const status = state?.status || 'not_started'
  const badge = BADGE[status] || BADGE.not_started
  const canEdit = !['provisioning', 'pending', 'approved'].includes(status)
  const canSubmit = state?.collected && ['collected', 'error', 'rejected'].includes(status)
  const midVetting = ['provisioning', 'pending'].includes(status)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <MessageSquare size={16} className="text-orange-400" /> SMS Registration (A2P 10DLC)
        </h2>
        <span className={'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ' + badge.color}>
          {badge.icon}{badge.label}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {/* Status details */}
          <div className="mb-4 p-4 bg-gray-800/60 rounded-lg border border-gray-700 text-sm space-y-1.5">
            {state?.einTail && <Row label="EIN" value={state.einTail} />}
            {state?.brandSid && <Row label="Brand" value={state.brandSid} mono />}
            {state?.campaignSid && <Row label="Campaign" value={state.campaignSid} mono />}
            {state?.messagingServiceSid && <Row label="Messaging Service" value={state.messagingServiceSid} mono />}
            {state?.submittedAt && <Row label="Submitted" value={new Date(state.submittedAt).toLocaleString()} />}
            {state?.approvedAt && <Row label="Approved" value={new Date(state.approvedAt).toLocaleString()} />}
            {!state?.collected && !state?.brandSid && (
              <p className="text-gray-500">No registration data yet. Collect the tenant's business details to begin.</p>
            )}
            {state?.rejectionReason && (
              <div className="mt-2 flex items-start gap-2 text-red-400">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{state.rejectionReason}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 mb-2">
            {canEdit && (
              <button onClick={() => setShowForm(v => !v)}
                className="px-4 py-2 text-sm font-semibold bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors flex items-center gap-1.5">
                {showForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {state?.collected ? 'Edit business details' : 'Collect business details'}
              </button>
            )}
            {canSubmit && (
              <button onClick={submit} disabled={submitting}
                className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-1.5">
                <Send size={14} />{submitting ? 'Submitting…' : (status === 'rejected' || status === 'error' ? 'Resubmit' : 'Submit for registration')}
              </button>
            )}
            {(midVetting || status === 'approved') && (
              <button onClick={refresh} disabled={refreshing}
                className="px-4 py-2 text-sm font-semibold bg-gray-800 hover:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-1.5">
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />Refresh status
              </button>
            )}
          </div>

          {/* Intake form */}
          {showForm && canEdit && (
            <div className="mt-4 p-4 bg-gray-800/40 rounded-lg border border-gray-700 space-y-4">
              <Group title="Business">
                <Field label="Legal business name"><input className={INPUT} value={form.legalName} onChange={e => up('legalName', e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Business type">
                    <select className={INPUT} value={form.businessType} onChange={e => up('businessType', e.target.value)}>
                      {BUSINESS_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </Field>
                  <Field label="EIN / Tax ID"><input className={INPUT} value={form.ein} onChange={e => up('ein', e.target.value)} placeholder="12-3456789" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Industry">
                    <select className={INPUT} value={form.industry} onChange={e => up('industry', e.target.value)}>
                      {INDUSTRIES.map(i => <option key={i} value={i}>{i.replace(/_/g, ' ')}</option>)}
                    </select>
                  </Field>
                  <Field label="Website"><input className={INPUT} value={form.website} onChange={e => up('website', e.target.value)} placeholder="https://…" /></Field>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input type="checkbox" checked={form.soleProprietor} onChange={e => up('soleProprietor', e.target.checked)} />
                  Sole proprietor (lower-throughput brand, no EIN required)
                </label>
              </Group>

              <Group title="Business address">
                <Field label="Street"><input className={INPUT} value={form.street} onChange={e => up('street', e.target.value)} /></Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="City"><input className={INPUT} value={form.city} onChange={e => up('city', e.target.value)} /></Field>
                  <Field label="State"><input className={INPUT} value={form.region} onChange={e => up('region', e.target.value)} placeholder="WI" /></Field>
                  <Field label="ZIP"><input className={INPUT} value={form.postalCode} onChange={e => up('postalCode', e.target.value)} /></Field>
                </div>
              </Group>

              <Group title="Authorized representative">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name"><input className={INPUT} value={form.repFirstName} onChange={e => up('repFirstName', e.target.value)} /></Field>
                  <Field label="Last name"><input className={INPUT} value={form.repLastName} onChange={e => up('repLastName', e.target.value)} /></Field>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Email"><input className={INPUT} value={form.repEmail} onChange={e => up('repEmail', e.target.value)} /></Field>
                  <Field label="Phone"><input className={INPUT} value={form.repPhone} onChange={e => up('repPhone', e.target.value)} placeholder="+1…" /></Field>
                  <Field label="Title"><input className={INPUT} value={form.repTitle} onChange={e => up('repTitle', e.target.value)} /></Field>
                </div>
              </Group>

              <Group title="Campaign">
                <Field label="Use case">
                  <select className={INPUT} value={form.usecase} onChange={e => up('usecase', e.target.value)}>
                    {USECASES.map(u => <option key={u} value={u}>{u === 'MIXED' ? 'Mixed' : 'Low Volume Mixed'}</option>)}
                  </select>
                </Field>
                <Field label="Campaign description">
                  <textarea className={INPUT} rows={2} value={form.campaignDescription} onChange={e => up('campaignDescription', e.target.value)}
                    placeholder="e.g. Appointment reminders, service updates, and occasional offers for customers who opted in." />
                </Field>
                <Field label="Sample messages (one per line, 1–5)">
                  <textarea className={INPUT} rows={4} value={form.messageSamplesText} onChange={e => up('messageSamplesText', e.target.value)}
                    placeholder={"Hi [Name], your appointment with Acme is confirmed for Tue 2pm. Reply STOP to opt out.\nAcme: your quote is ready — reply YES to schedule. Msg&data rates may apply."} />
                </Field>
              </Group>

              <button onClick={saveIntake} disabled={saving}
                className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-1.5">
                <Save size={14} />{saving ? 'Saving…' : 'Save details'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className={'text-gray-200 ' + (mono ? 'font-mono text-xs' : '')}>{value}</span>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {children}
    </div>
  )
}
