// Service-customer pages: equipment (+ service history), service plans, request service.
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Wrench, Shield, ChevronRight, ChevronDown, ChevronUp, Calendar, CheckCircle, AlertTriangle, X, CalendarCheck, ArrowRight, LifeBuoy, Loader2 } from 'lucide-react'
import { usePortal } from './PortalContext'
import { PLink, Spinner, PageTitle, Empty, card, pill, btnPrimary, inputCls, labelCls, formatDate, moneyShort } from './common'

// ---------------------------------------------------------------- Equipment
interface Unit { id: string; name: string; model?: string | null; manufacturer?: string | null; serialNumber?: string | null; status?: string | null; location?: string | null; purchaseDate?: string | null; warrantyExpiry?: string | null; lastServiceDate?: string | null }
const warranty = (expiry?: string | null) => !expiry ? null : new Date(expiry) > new Date()

export function PortalEquipment() {
  const { token, fetch: portalFetch, config } = usePortal()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/equipment').then((d) => setUnits(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  if (loading) return <Spinner />
  return (
    <div>
      <PageTitle title={config.labels.equipment} subtitle="The systems we look after for you, with their service history." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {units.length === 0 ? <Empty icon={Wrench} text="No equipment registered yet."><p className="text-sm text-gray-400 mt-1">Contact us to add your systems.</p></Empty> : (
        <div className="space-y-3">
          {units.map((u) => {
            const w = warranty(u.warrantyExpiry)
            return (
              <PLink key={u.id} to={`/portal/${token}/equipment/${u.id}`} className={`block ${card} p-4 hover:shadow-md transition-shadow`}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center shrink-0"><Wrench className="w-5 h-5 text-blue-600" /></div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 dark:text-slate-100">{u.name}</h3>
                    <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">{[u.manufacturer, u.model].filter(Boolean).join(' ') || 'No model info'}</p>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 ${pill(w === null ? 'bg-gray-100 text-gray-500' : w ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}`}><Shield className="w-3 h-3" />{w === null ? 'Warranty unknown' : w ? 'Warranty active' : 'Warranty expired'}</span>
                      {u.purchaseDate && <span className="text-xs text-gray-400">Installed {formatDate(u.purchaseDate)}</span>}
                    </div>
                    {u.lastServiceDate && <p className="text-xs text-gray-400 mt-1">Last serviced {formatDate(u.lastServiceDate)}</p>}
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-300 shrink-0 mt-1" />
                </div>
              </PLink>
            )
          })}
        </div>
      )}
    </div>
  )
}

const JOB_TYPE_LABELS: Record<string, string> = { install: 'Installation', repair: 'Repair', maintenance: 'Maintenance', emergency: 'Emergency' }

export function PortalEquipmentDetail() {
  const { equipmentId } = useParams<{ equipmentId: string }>()
  const { token, fetch: portalFetch } = usePortal()
  const [data, setData] = useState<{ equipment: Unit; history: any[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch(`/equipment/${equipmentId}/history`).then(setData).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch, equipmentId])
  if (loading) return <Spinner />
  if (!data) return <div className="text-center py-12 text-gray-500 dark:text-slate-400">{error || 'Equipment not found.'}</div>
  const eq = data.equipment, w = warranty(eq.warrantyExpiry)
  return (
    <div className="space-y-5">
      <PLink to={`/portal/${token}/equipment`} className="text-orange-600 hover:underline text-sm inline-block">{'<-'} Back to Equipment</PLink>
      <div className={`${card} p-5`}>
        <h1 className="text-xl font-bold text-gray-900 mb-4 dark:text-slate-100">{eq.name}</h1>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(eq.manufacturer || eq.model) && <div><dt className="text-xs text-gray-400 uppercase tracking-wider">Model</dt><dd className="font-medium text-gray-900 dark:text-slate-100">{[eq.manufacturer, eq.model].filter(Boolean).join(' ')}</dd></div>}
          {eq.serialNumber && <div><dt className="text-xs text-gray-400 uppercase tracking-wider">Serial Number</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{eq.serialNumber}</dd></div>}
          {eq.purchaseDate && <div><dt className="text-xs text-gray-400 uppercase tracking-wider">Install Date</dt><dd className="text-gray-900 dark:text-slate-100">{formatDate(eq.purchaseDate)}</dd></div>}
          {eq.location && <div><dt className="text-xs text-gray-400 uppercase tracking-wider">Location</dt><dd className="text-gray-900 dark:text-slate-100">{eq.location}</dd></div>}
        </dl>
        {w !== null && <div className={`mt-4 flex items-center gap-2 px-3 py-2 rounded-lg ${w ? 'bg-green-50 dark:bg-green-950/30' : 'bg-red-50 dark:bg-red-950/30'}`}><Shield className={`w-4 h-4 ${w ? 'text-green-600' : 'text-red-600'}`} /><span className={`text-sm font-medium ${w ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>Warranty {w ? 'active' : 'expired'}{eq.warrantyExpiry && ` — ${w ? 'expires' : 'ended'} ${formatDate(eq.warrantyExpiry)}`}</span></div>}
      </div>
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3 dark:text-slate-100">Service History</h2>
        {data.history.length === 0 ? <Empty icon={Calendar} text="No service visits yet." /> : <div className="space-y-3">{data.history.map((v: any) => <VisitCard key={v.id} visit={v} />)}</div>}
      </div>
    </div>
  )
}

function VisitCard({ visit }: { visit: any }) {
  const [open, setOpen] = useState(false)
  const checklist = visit.checklist?.[0]
  const items: any[] = checklist?.items || []
  const flagged = items.filter((i) => i.status !== 'pass').length
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-gray-900 dark:text-slate-100">{visit.title}</p>
            <div className="flex items-center gap-2 mt-1 text-sm"><span className="text-gray-500 dark:text-slate-400">{formatDate(visit.completedAt || visit.scheduledDate)}</span>{visit.jobType && <span className={pill('bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-200')}>{JOB_TYPE_LABELS[visit.jobType] || visit.jobType}</span>}</div>
          </div>
          <span className={pill(visit.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}>{visit.status === 'completed' ? 'Completed' : 'Scheduled'}</span>
        </div>
        {visit.techName && <p className="text-sm text-gray-500 mt-2 dark:text-slate-400">Technician: {visit.techName}</p>}
        {visit.notes && <p className="text-sm text-gray-600 mt-2 dark:text-slate-400">{visit.notes}</p>}
      </div>
      {checklist && (
        <div className="border-t dark:border-slate-700">
          <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-slate-800">
            <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-600" /><span className="text-gray-700 dark:text-slate-200">Inspection checklist{flagged > 0 && ` — ${flagged} item${flagged > 1 ? 's' : ''} flagged`}</span></div>
            {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {open && (
            <div className="px-4 pb-3 space-y-2">
              {items.map((item, i) => (
                <div key={item.id || i} className="flex items-start gap-2 text-sm">
                  {item.status === 'pass' && <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />}{item.status === 'fail' && <X className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}{item.status === 'attention' && <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />}
                  <div><span className="text-gray-700 dark:text-slate-200">{item.label}</span>{item.notes && <p className="text-xs text-gray-400 mt-0.5">{item.notes}</p>}</div>
                </div>
              ))}
              {checklist.overallNotes && <p className="text-xs text-gray-500 mt-2 pt-2 border-t dark:text-slate-400 dark:border-slate-700">{checklist.overallNotes}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Service plans
interface Agreement { id: string; name: string; status: string; startDate?: string | null; endDate?: string | null; renewalType?: string | null; billingFrequency?: string | null; amount?: string | number | null; terms?: string | null; nextVisitDate?: string | null }

export function PortalAgreements() {
  const { token, fetch: portalFetch, config, sections } = usePortal()
  const [rows, setRows] = useState<Agreement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/agreements').then((d) => setRows(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  if (loading) return <Spinner />
  const active = rows.filter((a) => a.status === 'active'), inactive = rows.filter((a) => a.status !== 'active')
  const freq = (f?: string | null) => f === 'monthly' ? 'Monthly' : f === 'annual' ? 'Annual' : f || ''
  return (
    <div className="space-y-5">
      <PageTitle title={config.labels.agreements} subtitle="Your recurring service plans and upcoming visits." />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {rows.length === 0 ? (
        <Empty icon={CalendarCheck} text={`No ${config.labels.agreements.toLowerCase()} yet.`}>
          <p className="text-sm text-gray-400 mt-1 mb-6">Regular maintenance keeps your systems running efficiently.</p>
          {sections.serviceRequest && <PLink to={`/portal/${token}/service-request`} className={btnPrimary}>Ask about a plan <ArrowRight className="w-4 h-4" /></PLink>}
        </Empty>
      ) : (
        <>
          {active.map((a) => (
            <div key={a.id} className={`${card} p-5`}>
              <div className="flex items-start justify-between gap-4">
                <div><h3 className="font-semibold text-gray-900 text-lg dark:text-slate-100">{a.name}</h3><p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">{freq(a.billingFrequency)}{a.amount ? ` — ${moneyShort(a.amount)}` : ''}</p></div>
                <span className={pill('bg-green-100 text-green-700 capitalize')}>{a.status}</span>
              </div>
              {a.nextVisitDate && <div className="mt-4 flex items-center gap-3 bg-blue-50 rounded-lg px-4 py-3 dark:bg-blue-950/30"><Calendar className="w-5 h-5 text-blue-600" /><div><p className="text-sm font-medium text-blue-900 dark:text-blue-200">Next Scheduled Visit</p><p className="text-sm text-blue-700 dark:text-blue-300">{formatDate(a.nextVisitDate)}</p></div></div>}
              <dl className="mt-4 space-y-2 text-sm">
                {a.startDate && <div className="flex justify-between"><dt className="text-gray-500 dark:text-slate-400">Start Date</dt><dd className="text-gray-900 dark:text-slate-100">{formatDate(a.startDate)}</dd></div>}
                {a.endDate && <div className="flex justify-between"><dt className="text-gray-500 dark:text-slate-400">Renewal Date</dt><dd className="text-gray-900 dark:text-slate-100">{formatDate(a.endDate)}</dd></div>}
                {a.renewalType && <div className="flex justify-between"><dt className="text-gray-500 dark:text-slate-400">Renewal</dt><dd className="text-gray-900 capitalize dark:text-slate-100">{a.renewalType}</dd></div>}
              </dl>
              {a.terms && <div className="mt-4 pt-4 border-t dark:border-slate-700"><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Included Services</p><p className="text-sm text-gray-600 whitespace-pre-wrap dark:text-slate-400">{a.terms}</p></div>}
            </div>
          ))}
          {inactive.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Past Plans</h2>
              <div className="space-y-2">{inactive.map((a) => <div key={a.id} className={`${card} p-4 opacity-60`}><div className="flex items-center justify-between"><h3 className="font-medium text-gray-700 dark:text-slate-200">{a.name}</h3><span className={pill('bg-gray-100 text-gray-500 capitalize dark:bg-slate-800 dark:text-slate-400')}>{a.status}</span></div></div>)}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Request service
export function PortalServiceRequest() {
  const { token, fetch: portalFetch, sections, config } = usePortal()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ jobNumber: string; responseHours: number } | null>(null)
  const [form, setForm] = useState({ equipmentId: '', description: '', urgency: 'routine' as 'routine' | 'urgent', preferredContact: 'call' as 'call' | 'text' | 'email' })

  useEffect(() => {
    if (!sections.equipment) { setLoading(false); return }
    portalFetch('/equipment').then((d) => setUnits(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false))
  }, [portalFetch, sections.equipment])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.description.trim()) return
    setSubmitting(true); setError('')
    try { setDone(await portalFetch('/service-request', { method: 'POST', body: JSON.stringify({ equipmentId: form.equipmentId || null, description: form.description.trim(), urgency: form.urgency, preferredContact: form.preferredContact }) })) }
    catch (err) { setError((err as Error).message || 'Failed to submit request') } finally { setSubmitting(false) }
  }

  if (loading) return <Spinner />
  if (done) {
    return (
      <div className="py-12 max-w-lg mx-auto text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle className="w-8 h-8 text-green-600" /></div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-slate-100">Request Received</h1>
        <p className="text-gray-600 mb-1 dark:text-slate-400">We'll be in touch within <strong>{done.responseHours} hours</strong>.</p>
        <p className="text-sm text-gray-400 mb-8">Reference: {done.jobNumber}</p>
        <PLink to={`/portal/${token}`} className={btnPrimary}>Back to Dashboard</PLink>
      </div>
    )
  }
  const choice = (active: boolean, tone: 'blue' | 'orange') => `p-4 rounded-xl border-2 text-center transition-colors ${active ? (tone === 'orange' ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30' : 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30') : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-slate-700 dark:text-slate-300'}`
  return (
    <div className="max-w-lg">
      <PageTitle title={config.labels.serviceRequest} subtitle="Tell us what you need help with." />
      <form onSubmit={submit} className="space-y-5">
        {sections.equipment && (
          <div><label htmlFor="sr-equipment" className={labelCls}>{config.labels.equipment}</label><select id="sr-equipment" value={form.equipmentId} onChange={(e) => setForm((f) => ({ ...f, equipmentId: e.target.value }))} className={inputCls}><option value="">Other / Not sure</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}{u.manufacturer ? ` (${u.manufacturer})` : ''}</option>)}</select></div>
        )}
        <div><label htmlFor="sr-description" className={labelCls}>What's the issue?</label><textarea id="sr-description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Describe what's happening..." rows={4} required className={`${inputCls} resize-none`} /></div>
        <div>
          <p className={labelCls}>How urgent is this?</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setForm((f) => ({ ...f, urgency: 'routine' }))} className={choice(form.urgency === 'routine', 'blue')}><Wrench className="w-5 h-5 mx-auto mb-1" /><p className="font-semibold text-sm">Routine</p><p className="text-xs mt-0.5 opacity-70">Within a few days</p></button>
            <button type="button" onClick={() => setForm((f) => ({ ...f, urgency: 'urgent' }))} className={choice(form.urgency === 'urgent', 'orange')}><AlertTriangle className="w-5 h-5 mx-auto mb-1" /><p className="font-semibold text-sm">Urgent</p><p className="text-xs mt-0.5 opacity-70">Need help today</p></button>
          </div>
        </div>
        <div>
          <p className={labelCls}>How should we reach you?</p>
          <div className="flex gap-2">{(['call', 'text', 'email'] as const).map((m) => <button key={m} type="button" onClick={() => setForm((f) => ({ ...f, preferredContact: m }))} className={`flex-1 py-2.5 rounded-lg border text-sm font-medium capitalize transition-colors ${form.preferredContact === m ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30' : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-slate-700 dark:text-slate-300'}`}>{m}</button>)}</div>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={submitting || !form.description.trim()} className={`w-full justify-center py-3 font-bold ${btnPrimary}`}>{submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <LifeBuoy className="w-5 h-5" />} Submit Request</button>
      </form>
    </div>
  )
}
