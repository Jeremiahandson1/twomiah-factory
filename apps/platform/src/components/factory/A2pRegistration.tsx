import { useState, useEffect } from 'react'
import { supabase, API_URL as API } from '../../supabase'
import { MessageSquare, CheckCircle, XCircle, Clock, RefreshCw, AlertCircle, ChevronDown, ChevronUp, Send } from 'lucide-react'

// A business's own texting registration (A2P 10DLC), from the staff side. The business normally registers itself
// from its CRM (Settings › Texting); this panel shows where it stands and lets staff submit or resume for it.
// Routes (routes/factory/a2p.ts):
//   GET  /customers/:id/a2p          — where it stands
//   POST /customers/:id/a2p/submit   — save the details and submit (empty body: resume what is saved)
//   POST /customers/:id/a2p/refresh  — ask Twilio and move it on
// The allowed values are Twilio's (services/a2p.ts BUSINESS_TYPES / JOB_POSITIONS / INDUSTRIES); the server checks them.

type A2pStatus = {
  status: string
  stage: 'not_started' | 'not_submitted' | 'brand' | 'campaign' | 'live'
  kind: 'standard' | 'sole_proprietor' | null
  businessName: string | null
  einTail: string
  rejectionReason: string | null
  submittedAt: string | null
  approvedAt: string | null
  messagingEnabled: boolean
  walletCents: number
  brandSid: string | null
  campaignSid: string | null
  messagingServiceSid: string | null
  phoneNumberSid: string | null
}

type Props = { tenantId: string; showToast: (msg: string, type?: 'success' | 'error') => void }

const BUSINESS_TYPES = ['Limited Liability Corporation', 'Corporation', 'Partnership', 'Co-operative', 'Non-profit Corporation']
const JOB_POSITIONS = ['CEO', 'GM', 'Director', 'VP', 'CFO', 'General Counsel', 'Other']
const INDUSTRIES = ['CONSTRUCTION', 'PROFESSIONAL_SERVICES', 'HEALTHCARE', 'CONSUMER', 'FOOD_AND_BEVERAGE', 'HOSPITALITY', 'AUTOMOTIVE', 'RETAIL',
  'REAL_ESTATE', 'AGRICULTURE', 'EDUCATION', 'ENERGY', 'ENGINEERING', 'FINANCIAL', 'INSURANCE', 'LEGAL', 'MANUFACTURING', 'MEDIA',
  'NOT_FOR_PROFIT', 'ONLINE', 'TECHNOLOGY', 'TRANSPORTATION', 'TRAVEL']

const STAGE: Record<string, string> = {
  not_started: 'Not started',
  not_submitted: 'Details saved, not submitted',
  brand: 'Carriers reviewing the business',
  campaign: 'Carriers reviewing what it texts',
  live: 'Live — texting from its own number',
}
const BADGE: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  not_started:  { color: 'text-gray-400 bg-gray-400/10 border-gray-400/30',    icon: <Clock size={12} />,                          label: 'Not started' },
  collected:    { color: 'text-blue-400 bg-blue-400/10 border-blue-400/30',    icon: <CheckCircle size={12} />,                    label: 'Details saved' },
  provisioning: { color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', icon: <RefreshCw size={12} className="animate-spin" />, label: 'Submitting' },
  pending:      { color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', icon: <Clock size={12} />,                       label: 'In review' },
  approved:     { color: 'text-green-400 bg-green-400/10 border-green-400/30',  icon: <CheckCircle size={12} />,                    label: 'Approved' },
  rejected:     { color: 'text-red-400 bg-red-400/10 border-red-400/30',        icon: <XCircle size={12} />,                        label: 'Rejected' },
  error:        { color: 'text-red-400 bg-red-400/10 border-red-400/30',        icon: <AlertCircle size={12} />,                    label: 'Stopped' },
}

const INPUT = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500'
const LABEL = 'block text-xs text-gray-400 mb-1'

const EMPTY_FORM = {
  kind: 'standard' as 'standard' | 'sole_proprietor',
  legalName: '', businessType: BUSINESS_TYPES[0], ein: '', industry: INDUSTRIES[0],
  brandName: '', mobilePhone: '',
  street: '', city: '', region: '', postalCode: '',
  repFirstName: '', repLastName: '', repEmail: '', repPhone: '', repTitle: 'Owner', repJobPosition: 'CEO',
}

async function token(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

export default function A2pRegistration({ tenantId, showToast }: Props) {
  const [state, setState] = useState<A2pStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })

  useEffect(() => { load() }, [tenantId])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/a2p', { headers: { Authorization: 'Bearer ' + (await token()) } })
      if (res.ok) setState(await res.json())
    } catch { /* leave state null; the panel still renders */ }
    setLoading(false)
  }

  function up<K extends keyof typeof form>(k: K, v: (typeof form)[K]) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(withDetails: boolean) {
    setSubmitting(true)
    try {
      const body = !withDetails ? {} : form.kind === 'standard'
        ? { kind: 'standard', legalName: form.legalName, businessType: form.businessType, ein: form.ein, industry: form.industry,
            street: form.street, city: form.city, region: form.region, postalCode: form.postalCode,
            repFirstName: form.repFirstName, repLastName: form.repLastName, repEmail: form.repEmail, repPhone: form.repPhone, repTitle: form.repTitle, repJobPosition: form.repJobPosition }
        : { kind: 'sole_proprietor', brandName: form.brandName, mobilePhone: form.mobilePhone,
            street: form.street, city: form.city, region: form.region, postalCode: form.postalCode,
            repFirstName: form.repFirstName, repLastName: form.repLastName, repEmail: form.repEmail, repPhone: form.repPhone }
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/a2p/submit', {
        method: 'POST', headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) { showToast('Submitted — the carriers review it next'); setShowForm(false) }
      else showToast(data.rejectionReason || data.error || 'Submit failed', 'error')
      load()
    } catch { showToast('Submit failed', 'error') }
    setSubmitting(false)
  }

  async function refresh() {
    setRefreshing(true)
    try {
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/a2p/refresh', { method: 'POST', headers: { Authorization: 'Bearer ' + (await token()) } })
      const data = await res.json()
      if (res.ok) showToast(STAGE[data.stage] || data.status)
      else showToast(data.error || 'Refresh failed', 'error')
      load()
    } catch { showToast('Refresh failed', 'error') }
    setRefreshing(false)
  }

  const status = state?.status || 'not_started'
  const badge = BADGE[status] || BADGE.not_started
  const canEdit = !['provisioning', 'pending', 'approved'].includes(status)
  const canResume = ['collected', 'error', 'rejected'].includes(status)
  const inReview = ['provisioning', 'pending', 'approved'].includes(status)
  const sp = form.kind === 'sole_proprietor'

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-semibold flex items-center gap-2"><MessageSquare size={16} className="text-orange-400" /> Texting registration (A2P 10DLC)</h2>
        <span className={'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ' + badge.color}>{badge.icon}{badge.label}</span>
      </div>

      {loading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <>
          <div className="mb-4 p-4 bg-gray-800/60 rounded-lg border border-gray-700 text-sm space-y-1.5">
            <Row label="Stage" value={STAGE[state?.stage || 'not_started']} />
            {state?.businessName && <Row label={state.kind === 'sole_proprietor' ? 'Sole proprietor' : 'Business'} value={state.businessName} />}
            {state?.einTail && <Row label="EIN" value={state.einTail} />}
            <Row label="Texting add-on" value={state?.messagingEnabled ? 'On' : 'Off'} />
            <Row label="Messaging wallet" value={'$' + ((state?.walletCents ?? 0) / 100).toFixed(2)} />
            {state?.brandSid && <Row label="Brand" value={state.brandSid} mono />}
            {state?.messagingServiceSid && <Row label="Messaging Service" value={state.messagingServiceSid} mono />}
            {state?.campaignSid && <Row label="Campaign" value={state.campaignSid} mono />}
            {state?.submittedAt && <Row label="Submitted" value={new Date(state.submittedAt).toLocaleString()} />}
            {state?.approvedAt && <Row label="Approved" value={new Date(state.approvedAt).toLocaleString()} />}
            {state?.rejectionReason && (
              <div className="mt-2 flex items-start gap-2 text-red-400"><AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{state.rejectionReason}</span></div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mb-2">
            {canEdit && (
              <button onClick={() => setShowForm(v => !v)} className="px-4 py-2 text-sm font-semibold bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors flex items-center gap-1.5">
                {showForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Enter business details
              </button>
            )}
            {canResume && (
              <button onClick={() => submit(false)} disabled={submitting} className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-1.5">
                <Send size={14} />{submitting ? 'Submitting…' : 'Submit saved details'}
              </button>
            )}
            {inReview && (
              <button onClick={refresh} disabled={refreshing} className="px-4 py-2 text-sm font-semibold bg-gray-800 hover:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-1.5">
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />Check now
              </button>
            )}
          </div>

          {showForm && canEdit && (
            <div className="mt-4 p-4 bg-gray-800/40 rounded-lg border border-gray-700 space-y-4">
              <Group title="Does the business have an EIN?">
                <div className="grid grid-cols-2 gap-2">
                  {([['standard', 'Yes — registered business', 'Low-Volume Standard brand.'], ['sole_proprietor', 'No — sole proprietor', 'Twilio texts the owner\'s mobile; they reply YES. One number.']] as const).map(([val, label, hint]) => (
                    <button key={val} type="button" onClick={() => up('kind', val)}
                      className={'text-left p-3 rounded-lg border transition-colors ' + (form.kind === val ? 'border-orange-500 bg-orange-500/10' : 'border-gray-700 bg-gray-800 hover:border-gray-600')}>
                      <div className="text-sm font-medium text-white">{label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{hint}</div>
                    </button>
                  ))}
                </div>
              </Group>

              {sp ? (
                <Group title="The business">
                  <Field label="Name customers know it by"><input className={INPUT} value={form.brandName} onChange={e => up('brandName', e.target.value)} /></Field>
                  <Field label="Owner's mobile (Twilio texts it to confirm)"><input className={INPUT} value={form.mobilePhone} onChange={e => up('mobilePhone', e.target.value)} placeholder="715-555-0100" /></Field>
                </Group>
              ) : (
                <Group title="The business">
                  <Field label="Legal business name (exactly as on the EIN letter)"><input className={INPUT} value={form.legalName} onChange={e => up('legalName', e.target.value)} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Business type"><select className={INPUT} value={form.businessType} onChange={e => up('businessType', e.target.value)}>{BUSINESS_TYPES.map(b => <option key={b} value={b}>{b}</option>)}</select></Field>
                    <Field label="EIN"><input className={INPUT} value={form.ein} onChange={e => up('ein', e.target.value)} placeholder="12-3456789" /></Field>
                  </div>
                  <Field label="Industry"><select className={INPUT} value={form.industry} onChange={e => up('industry', e.target.value)}>{INDUSTRIES.map(i => <option key={i} value={i}>{i.replace(/_/g, ' ')}</option>)}</select></Field>
                </Group>
              )}

              <Group title="Business address">
                <Field label="Street"><input className={INPUT} value={form.street} onChange={e => up('street', e.target.value)} /></Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="City"><input className={INPUT} value={form.city} onChange={e => up('city', e.target.value)} /></Field>
                  <Field label="State"><input className={INPUT} value={form.region} onChange={e => up('region', e.target.value)} placeholder="WI" /></Field>
                  <Field label="ZIP"><input className={INPUT} value={form.postalCode} onChange={e => up('postalCode', e.target.value)} /></Field>
                </div>
              </Group>

              <Group title={sp ? 'The owner' : 'Authorized representative'}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name"><input className={INPUT} value={form.repFirstName} onChange={e => up('repFirstName', e.target.value)} /></Field>
                  <Field label="Last name"><input className={INPUT} value={form.repLastName} onChange={e => up('repLastName', e.target.value)} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Email"><input className={INPUT} value={form.repEmail} onChange={e => up('repEmail', e.target.value)} /></Field>
                  <Field label="Phone"><input className={INPUT} value={form.repPhone} onChange={e => up('repPhone', e.target.value)} placeholder="715-555-0100" /></Field>
                </div>
                {!sp && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Title"><input className={INPUT} value={form.repTitle} onChange={e => up('repTitle', e.target.value)} /></Field>
                    <Field label="Position"><select className={INPUT} value={form.repJobPosition} onChange={e => up('repJobPosition', e.target.value)}>{JOB_POSITIONS.map(j => <option key={j} value={j}>{j}</option>)}</select></Field>
                  </div>
                )}
              </Group>

              <p className="text-xs text-gray-500">What the business texts (the campaign) is written by the Factory from what the system sends — confirmations, reminders, replies, review requests — with the business's own privacy and terms pages.</p>
              <button onClick={() => submit(true)} disabled={submitting} className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-1.5">
                <Send size={14} />{submitting ? 'Submitting…' : 'Save and submit'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex justify-between gap-4"><span className="text-gray-500">{label}</span><span className={'text-gray-200 ' + (mono ? 'font-mono text-xs' : '')}>{value}</span></div>
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-3"><h3 className="text-sm font-semibold text-gray-200">{title}</h3>{children}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={LABEL}>{label}</label>{children}</div>
}
