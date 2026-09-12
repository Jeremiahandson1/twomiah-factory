// Collaborator pages: jobs assigned to a sub, lien waivers to sign, submittals to review, RFIs to answer, shared documents.
import React, { useEffect, useState, useCallback } from 'react'
import { Hammer, MapPin, CalendarDays, CheckCircle2, Clock, FileSignature, FileCheck2, RotateCcw, HelpCircle, FolderOpen, Download } from 'lucide-react'
import { usePortal } from './PortalContext'
import { Spinner, PageTitle, Empty, Section, card, pill, btnSecondary, inputCls, labelCls, formatDate, moneyShort, PortalModal } from './common'

// ---------------------------------------------------------------- My Jobs
interface SubJob { id: string; number: string; title: string; description?: string | null; status: string; priority?: string; scheduledDate?: string | null; scheduledTime?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; notes?: string | null; completedAt?: string | null; projectName?: string | null; projectNumber?: string | null }
const JOB_STYLES: Record<string, string> = { scheduled: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700', completed: 'bg-green-100 text-green-700', cancelled: 'bg-gray-100 text-gray-700' }

export function PortalMyJobs() {
  const { fetch: portalFetch, config, role } = usePortal()
  const [jobs, setJobs] = useState<SubJob[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => portalFetch('/my-jobs').then((d) => setJobs(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)), [portalFetch])
  useEffect(() => { load().finally(() => setLoading(false)) }, [load])
  const complete = async (id: string) => {
    setBusyId(id); setError('')
    try { await portalFetch(`/my-jobs/${id}/complete`, { method: 'POST', body: '{}' }); await load() } catch (e) { setError((e as Error).message) } finally { setBusyId(null) }
  }
  if (loading) return <Spinner />
  const active = jobs.filter((j) => j.status !== 'completed' && j.status !== 'cancelled'), done = jobs.filter((j) => j.status === 'completed')
  const canComplete = role === 'collaborator'
  return (
    <div>
      <PageTitle title={config.labels.myJobs} subtitle={canComplete ? 'Jobs assigned to you.' : 'Your scheduled and completed work.'} />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {jobs.length === 0 ? <Empty icon={Hammer} text={canComplete ? 'No jobs assigned yet.' : 'No work scheduled yet.'} /> : (
        <div className="space-y-6">
          {active.length > 0 && <Section title={`Active (${active.length})`}>{active.map((j) => <JobCard key={j.id} job={j} busy={busyId === j.id} onComplete={canComplete ? () => complete(j.id) : null} />)}</Section>}
          {done.length > 0 && <Section title={`Completed (${done.length})`}>{done.map((j) => <JobCard key={j.id} job={j} busy={false} onComplete={null} />)}</Section>}
        </div>
      )}
    </div>
  )
}
function JobCard({ job, busy, onComplete }: { job: SubJob; busy: boolean; onComplete: (() => void) | null }) {
  const addr = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ')
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-orange-100 rounded-lg shrink-0"><Hammer className="w-5 h-5 text-orange-600" /></div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900 dark:text-slate-100">{job.number} — {job.title}</p>
            {job.projectName && <p className="text-sm text-gray-500 dark:text-slate-400">Project: {job.projectNumber ? `${job.projectNumber} · ` : ''}{job.projectName}</p>}
            {job.description && <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">{job.description}</p>}
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500 dark:text-slate-400">
              {job.scheduledDate && <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{formatDate(job.scheduledDate)}{job.scheduledTime ? ` · ${job.scheduledTime}` : ''}</span>}
              {addr && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{addr}</span>}
            </div>
            {job.notes && <p className="text-xs text-gray-500 mt-2 italic dark:text-slate-400">{job.notes}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className={pill(JOB_STYLES[job.status] || 'bg-gray-100 text-gray-700')}>{job.status.replace('_', ' ')}</span>
          {onComplete && <button onClick={onComplete} disabled={busy} className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"><CheckCircle2 className="w-3.5 h-3.5" />{busy ? 'Saving…' : 'Mark Complete'}</button>}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Lien waivers
interface Waiver { id: string; projectName?: string | null; projectNumber?: string | null; waiverType: string; throughDate?: string | null; amountTotal?: string | number | null; status: string; dueDate?: string | null; signedDate?: string | null; documentUrl?: string | null; notes?: string | null }
const WAIVER_STYLES: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', requested: 'bg-blue-100 text-blue-700', received: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' }
const WAIVER_LABELS: Record<string, string> = { conditional_progress: 'Conditional — Progress', unconditional_progress: 'Unconditional — Progress', conditional_final: 'Conditional — Final', unconditional_final: 'Unconditional — Final' }

export function PortalLienWaivers() {
  const { fetch: portalFetch } = usePortal()
  const [waivers, setWaivers] = useState<Waiver[]>([])
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState<Waiver | null>(null)
  const [documentUrl, setDocumentUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => portalFetch('/lien-waivers').then((d) => setWaivers(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)), [portalFetch])
  useEffect(() => { load().finally(() => setLoading(false)) }, [load])
  const submitSign = async () => {
    if (!signing) return
    setBusy(true); setError('')
    try { await portalFetch(`/lien-waivers/${signing.id}/sign`, { method: 'POST', body: JSON.stringify({ documentUrl: documentUrl || null, notes: notes || null }) }); setSigning(null); await load() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  if (loading) return <Spinner />
  const pending = waivers.filter((w) => w.status === 'draft' || w.status === 'requested'), done = waivers.filter((w) => w.status === 'received' || w.status === 'approved')
  const WaiverCard = ({ w, onSign }: { w: Waiver; onSign: (() => void) | null }) => (
    <div className={`${card} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-blue-100 rounded-lg shrink-0"><FileSignature className="w-5 h-5 text-blue-600" /></div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900 dark:text-slate-100">{WAIVER_LABELS[w.waiverType] || w.waiverType}</p>
            {w.projectName && <p className="text-sm text-gray-500 dark:text-slate-400">Project: {w.projectNumber ? `${w.projectNumber} · ` : ''}{w.projectName}</p>}
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500 dark:text-slate-400">{w.throughDate && <span>Through {formatDate(w.throughDate)}</span>}{w.dueDate && <span>Due {formatDate(w.dueDate)}</span>}{w.signedDate && <span>Signed {formatDate(w.signedDate)}</span>}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          {w.amountTotal !== undefined && w.amountTotal !== null && <p className="font-bold text-gray-900 dark:text-slate-100">{moneyShort(w.amountTotal)}</p>}
          <span className={`${pill(WAIVER_STYLES[w.status] || 'bg-gray-100 text-gray-700')} mt-1`}>{w.status}</span>
          {onSign && <div className="mt-2"><button onClick={onSign} className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">Sign</button></div>}
        </div>
      </div>
    </div>
  )
  return (
    <div>
      <PageTitle title="Lien Waivers" subtitle="Review and sign lien waivers for your work." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {waivers.length === 0 ? <Empty icon={FileSignature} text="No lien waivers yet." /> : (
        <div className="space-y-6">
          {pending.length > 0 && <Section title={<><Clock className="w-5 h-5 text-orange-500" /> Pending ({pending.length})</>}>{pending.map((w) => <WaiverCard key={w.id} w={w} onSign={() => { setSigning(w); setDocumentUrl(w.documentUrl || ''); setNotes('') }} />)}</Section>}
          {done.length > 0 && <Section title={<><CheckCircle2 className="w-5 h-5 text-green-500" /> Signed ({done.length})</>}>{done.map((w) => <WaiverCard key={w.id} w={w} onSign={null} />)}</Section>}
        </div>
      )}
      {signing && (
        <PortalModal title="Sign Lien Waiver" subtitle={<>{signing.projectName} · {WAIVER_LABELS[signing.waiverType] || signing.waiverType}{signing.amountTotal ? ` · ${moneyShort(signing.amountTotal)}` : ''}</>} onClose={() => setSigning(null)}>
          <div className="space-y-3">
            <div><label className={labelCls} htmlFor="lw-url">Signed Document URL (optional)</label><input id="lw-url" type="url" value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)} placeholder="https://..." className={inputCls} /><p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Paste a link to the signed PDF, or leave blank.</p></div>
            <div><label className={labelCls} htmlFor="lw-notes">Notes (optional)</label><textarea id="lw-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-6"><button onClick={() => setSigning(null)} disabled={busy} className={btnSecondary}>Cancel</button><button onClick={submitSign} disabled={busy} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">{busy ? 'Signing…' : 'Confirm Sign'}</button></div>
        </PortalModal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Submittals
interface Submittal { id: string; number: string; title: string; description?: string | null; status: string; specSection?: string | null; dueDate?: string | null; submittedDate?: string | null; approvedDate?: string | null; notes?: string | null; projectName?: string | null; projectNumber?: string | null }
const SUB_STYLES: Record<string, string> = { pending: 'bg-blue-100 text-blue-700', approved: 'bg-green-100 text-green-700', revise: 'bg-yellow-100 text-yellow-700', rejected: 'bg-red-100 text-red-700' }

export function PortalSubmittalReview() {
  const { fetch: portalFetch, contact, config } = usePortal()
  const [subs, setSubs] = useState<Submittal[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ kind: 'approve' | 'revise'; submittal: Submittal } | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => portalFetch('/submittals').then((d) => setSubs(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)), [portalFetch])
  useEffect(() => { load().finally(() => setLoading(false)) }, [load])
  const submit = async () => {
    if (!modal) return
    setBusy(true); setError('')
    try {
      const payload = modal.kind === 'approve' ? { signedBy: contact?.name || undefined, notes: notes || null } : { reason: notes || 'Revision requested' }
      await portalFetch(`/submittals/${modal.submittal.id}/${modal.kind}`, { method: 'POST', body: JSON.stringify(payload) })
      setModal(null); setNotes(''); await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  if (loading) return <Spinner />
  const pending = subs.filter((s) => s.status === 'pending'), reviewed = subs.filter((s) => s.status !== 'pending')
  const SubCard = ({ s, actions }: { s: Submittal; actions: boolean }) => (
    <div className={`${card} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-purple-100 rounded-lg shrink-0"><FileCheck2 className="w-5 h-5 text-purple-600" /></div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900 dark:text-slate-100">{s.number} — {s.title}</p>
            {s.projectName && <p className="text-sm text-gray-500 dark:text-slate-400">Project: {s.projectNumber ? `${s.projectNumber} · ` : ''}{s.projectName}</p>}
            {s.specSection && <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Spec: {s.specSection}</p>}
            {s.description && <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">{s.description}</p>}
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500 dark:text-slate-400">{s.dueDate && <span>Due {formatDate(s.dueDate)}</span>}{s.submittedDate && <span>Submitted {formatDate(s.submittedDate)}</span>}{s.approvedDate && <span>Approved {formatDate(s.approvedDate)}</span>}</div>
            {s.notes && <p className="text-xs text-gray-500 mt-2 italic whitespace-pre-wrap dark:text-slate-400">{s.notes}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className={pill(SUB_STYLES[s.status] || 'bg-gray-100 text-gray-700')}>{s.status}</span>
          {actions && <div className="mt-2 flex flex-col gap-1.5"><button onClick={() => { setModal({ kind: 'approve', submittal: s }); setNotes('') }} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> Approve</button><button onClick={() => { setModal({ kind: 'revise', submittal: s }); setNotes('') }} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"><RotateCcw className="w-3.5 h-3.5" /> Revise</button></div>}
        </div>
      </div>
    </div>
  )
  return (
    <div>
      <PageTitle title="Submittals" subtitle={`Review and approve submittals from the ${config.providerNoun}.`} />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {subs.length === 0 ? <Empty icon={FileCheck2} text="No submittals yet." /> : (
        <div className="space-y-6">
          {pending.length > 0 && <Section title={<><Clock className="w-5 h-5 text-orange-500" /> Pending Review ({pending.length})</>}>{pending.map((s) => <SubCard key={s.id} s={s} actions />)}</Section>}
          {reviewed.length > 0 && <Section title={<><CheckCircle2 className="w-5 h-5 text-green-500" /> Reviewed ({reviewed.length})</>}>{reviewed.map((s) => <SubCard key={s.id} s={s} actions={false} />)}</Section>}
        </div>
      )}
      {modal && (
        <PortalModal title={modal.kind === 'approve' ? 'Approve Submittal' : 'Request Revision'} subtitle={`${modal.submittal.number} — ${modal.submittal.title}`} onClose={() => setModal(null)}>
          <label className={labelCls} htmlFor="sub-notes">{modal.kind === 'approve' ? 'Notes (optional)' : 'Reason for revision'}</label>
          <textarea id="sub-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={inputCls} placeholder={modal.kind === 'revise' ? 'Explain what needs to change…' : ''} />
          <div className="flex justify-end gap-2 mt-6"><button onClick={() => setModal(null)} disabled={busy} className={btnSecondary}>Cancel</button><button onClick={submit} disabled={busy || (modal.kind === 'revise' && !notes.trim())} className={`px-4 py-2 text-white rounded-lg disabled:opacity-50 ${modal.kind === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}>{busy ? 'Saving…' : modal.kind === 'approve' ? 'Approve' : 'Request Revision'}</button></div>
        </PortalModal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- RFIs
interface AssignedRfi { id: string; number: string; subject: string; question: string; status: string; dueDate?: string | null; response?: string | null; respondedAt?: string | null; createdAt: string; projectName?: string | null; projectNumber?: string | null }
const RFI_STYLES: Record<string, string> = { open: 'bg-blue-100 text-blue-700', answered: 'bg-green-100 text-green-700', closed: 'bg-gray-100 text-gray-700' }

export function PortalAssignedRfis() {
  const { fetch: portalFetch } = usePortal()
  const [rfis, setRfis] = useState<AssignedRfi[]>([])
  const [loading, setLoading] = useState(true)
  const [responding, setResponding] = useState<AssignedRfi | null>(null)
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => portalFetch('/rfis-assigned').then((d) => setRfis(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)), [portalFetch])
  useEffect(() => { load().finally(() => setLoading(false)) }, [load])
  const submit = async () => {
    if (!responding || !response.trim()) return
    setBusy(true); setError('')
    try { await portalFetch(`/rfis-assigned/${responding.id}/respond`, { method: 'POST', body: JSON.stringify({ response: response.trim() }) }); setResponding(null); setResponse(''); await load() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  if (loading) return <Spinner />
  const open = rfis.filter((r) => r.status === 'open'), answered = rfis.filter((r) => r.status !== 'open')
  const RfiCard = ({ r, onRespond }: { r: AssignedRfi; onRespond: (() => void) | null }) => (
    <div className={`${card} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-indigo-100 rounded-lg shrink-0"><HelpCircle className="w-5 h-5 text-indigo-600" /></div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900 dark:text-slate-100">{r.number} — {r.subject}</p>
            {r.projectName && <p className="text-sm text-gray-500 dark:text-slate-400">Project: {r.projectNumber ? `${r.projectNumber} · ` : ''}{r.projectName}</p>}
            <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap dark:text-slate-200">{r.question}</p>
            {r.response && <div className="bg-green-50 rounded-lg p-2 mt-2 dark:bg-green-950/30"><p className="text-xs font-medium text-green-700 dark:text-green-300">Response</p><p className="text-sm text-gray-900 whitespace-pre-wrap dark:text-slate-100">{r.response}</p></div>}
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500 dark:text-slate-400">{r.dueDate && <span>Due {formatDate(r.dueDate)}</span>}<span>Opened {formatDate(r.createdAt)}</span>{r.respondedAt && <span>Answered {formatDate(r.respondedAt)}</span>}</div>
          </div>
        </div>
        <div className="text-right shrink-0"><span className={pill(RFI_STYLES[r.status] || 'bg-gray-100 text-gray-700')}>{r.status}</span>{onRespond && <div className="mt-2"><button onClick={onRespond} className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">Respond</button></div>}</div>
      </div>
    </div>
  )
  return (
    <div>
      <PageTitle title="RFIs" subtitle="Requests for information assigned to you." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {rfis.length === 0 ? <Empty icon={HelpCircle} text="No RFIs assigned to you yet." /> : (
        <div className="space-y-6">
          {open.length > 0 && <Section title={<><Clock className="w-5 h-5 text-orange-500" /> Awaiting Response ({open.length})</>}>{open.map((r) => <RfiCard key={r.id} r={r} onRespond={() => { setResponding(r); setResponse('') }} />)}</Section>}
          {answered.length > 0 && <Section title={<><CheckCircle2 className="w-5 h-5 text-green-500" /> Answered ({answered.length})</>}>{answered.map((r) => <RfiCard key={r.id} r={r} onRespond={null} />)}</Section>}
        </div>
      )}
      {responding && (
        <PortalModal title="Respond to RFI" subtitle={`${responding.number} — ${responding.subject}`} onClose={() => setResponding(null)}>
          <div className="bg-gray-50 rounded-lg p-3 mb-4 dark:bg-slate-800"><p className="text-xs font-medium text-gray-500 mb-1 dark:text-slate-400">Question</p><p className="text-sm text-gray-900 whitespace-pre-wrap dark:text-slate-100">{responding.question}</p></div>
          <label className={labelCls} htmlFor="rfi-response">Your Response</label>
          <textarea id="rfi-response" value={response} onChange={(e) => setResponse(e.target.value)} rows={5} className={inputCls} />
          <div className="flex justify-end gap-2 mt-6"><button onClick={() => setResponding(null)} disabled={busy} className={btnSecondary}>Cancel</button><button onClick={submit} disabled={busy || !response.trim()} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">{busy ? 'Sending…' : 'Send Response'}</button></div>
        </PortalModal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Shared documents
interface SharedDoc { id: string; name: string; type: string; originalName: string; size?: number | null; url: string; description?: string | null; projectName?: string | null; sharedAt: string }

export function PortalSharedDocuments() {
  const { fetch: portalFetch, config } = usePortal()
  const [docs, setDocs] = useState<SharedDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/shared-documents').then((d) => setDocs(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  if (loading) return <Spinner />
  const types = Array.from(new Set(docs.map((d) => d.type)))
  const filtered = filter === 'all' ? docs : docs.filter((d) => d.type === filter)
  const label = (t: string) => config.docTypeLabels[t] || t
  return (
    <div>
      <PageTitle title={config.labels.sharedDocuments} subtitle={`Documents shared with you by the ${config.providerNoun}.`} />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {docs.length === 0 ? <Empty icon={FolderOpen} text="No documents shared with you yet." /> : (
        <>
          {types.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-4">
              <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>All ({docs.length})</FilterBtn>
              {types.map((t) => <FilterBtn key={t} active={filter === t} onClick={() => setFilter(t)}>{label(t)} ({docs.filter((d) => d.type === t).length})</FilterBtn>)}
            </div>
          )}
          <div className="space-y-3">{filtered.map((d) => <DocRow key={d.id} name={d.name || d.originalName} typeLabel={label(d.type)} meta={[d.projectName ? `Project: ${d.projectName}` : '', d.size ? `${Math.round(d.size / 1024)} KB` : '', `Shared ${formatDate(d.sharedAt)}`]} description={d.description} url={d.url} />)}</div>
        </>
      )}
    </div>
  )
}

export function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${active ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700'}`}>{children}</button>
}

export function DocRow({ name, typeLabel, meta, description, url, thumbnailUrl }: { name: string; typeLabel: string; meta: string[]; description?: string | null; url: string; thumbnailUrl?: string | null }) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-gray-100 rounded-lg shrink-0 dark:bg-slate-800">{thumbnailUrl ? <img src={thumbnailUrl} alt="" className="w-8 h-8 object-cover rounded" /> : <FolderOpen className="w-5 h-5 text-gray-600 dark:text-slate-400" />}</div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900 truncate dark:text-slate-100">{name}</p>
            <div className="flex flex-wrap gap-2 mt-0.5 text-xs text-gray-500 dark:text-slate-400"><span className="px-1.5 py-0.5 bg-gray-100 rounded dark:bg-slate-800">{typeLabel}</span>{meta.filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}</div>
            {description && <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">{description}</p>}
          </div>
        </div>
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shrink-0 dark:text-slate-200 dark:bg-slate-900 dark:border-slate-700"><Download className="w-3.5 h-3.5" /> Download</a>
      </div>
    </div>
  )
}
