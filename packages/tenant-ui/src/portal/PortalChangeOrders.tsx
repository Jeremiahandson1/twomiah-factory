// Portal change orders: list (pending first) + detail with sign-to-approve / decline.
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { ClipboardList, CheckCircle, XCircle, Clock, PenTool, AlertTriangle } from 'lucide-react'
import { usePortal } from './PortalContext'
import { SignatureModal, SignatureDisplay, type SignatureData } from './SignaturePad'
import { PLink, Spinner, PageTitle, Empty, Section, card, pill, btnSuccess, btnSecondary, formatDate, moneyShort, PortalModal, inputCls, labelCls } from './common'

const STATUS_STYLES: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' }

interface ChangeOrderData {
  id: string; title?: string | null; number: string; status: string; amount: string | number; description?: string | null; reason?: string | null
  daysAdded?: number | null; signature?: string | null; signedBy?: string | null; approvedBy?: string | null; approvedDate?: string | null; approvedAt?: string | null
  project?: { name: string; number?: string } | null; projectName?: string | null
  [key: string]: unknown
}

export function PortalChangeOrders() {
  const { token, fetch: portalFetch } = usePortal()
  const [rows, setRows] = useState<ChangeOrderData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/change-orders').then((d) => setRows(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  if (loading) return <Spinner />
  const pending = rows.filter((co) => co.status === 'pending'), others = rows.filter((co) => co.status !== 'pending')
  return (
    <div>
      <PageTitle title="Change Orders" subtitle="Review and approve change orders for your projects." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {rows.length === 0 ? <Empty icon={ClipboardList} text="No change orders." /> : (
        <div className="space-y-6">
          {pending.length > 0 && <Section title={<><Clock className="w-5 h-5 text-orange-500" /> Awaiting Your Approval ({pending.length})</>}>{pending.map((co) => <ChangeOrderCard key={co.id} co={co} token={token} highlight />)}</Section>}
          {others.length > 0 && <Section title="All Change Orders">{others.map((co) => <ChangeOrderCard key={co.id} co={co} token={token} />)}</Section>}
        </div>
      )}
    </div>
  )
}

function ChangeOrderCard({ co, token, highlight }: { co: ChangeOrderData; token?: string; highlight?: boolean }) {
  const isAddition = Number(co.amount) > 0
  const projectName = co.project?.name || co.projectName
  return (
    <PLink to={`/portal/${token}/change-orders/${co.id}`} className={`block bg-white rounded-xl border p-4 hover:shadow-md transition-all dark:bg-slate-900 ${highlight ? 'border-orange-300 ring-2 ring-orange-100 dark:ring-orange-900/40' : 'border-gray-200 dark:border-slate-700'}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-lg shrink-0 ${isAddition ? 'bg-red-100' : 'bg-green-100'}`}><ClipboardList className={`w-5 h-5 ${isAddition ? 'text-red-600' : 'text-green-600'}`} /></div>
          <div className="min-w-0"><p className="font-medium text-gray-900 truncate dark:text-slate-100">{co.title || co.number}</p><p className="text-sm text-gray-500 dark:text-slate-400">{co.number}{projectName ? ` - ${projectName}` : ''}</p></div>
        </div>
        <div className="text-right shrink-0"><p className={`text-lg font-bold ${isAddition ? 'text-red-600' : 'text-green-600'}`}>{isAddition ? '+' : '-'}{moneyShort(Math.abs(Number(co.amount)))}</p><span className={pill(STATUS_STYLES[co.status] || 'bg-gray-100 text-gray-700')}>{co.status}</span></div>
      </div>
    </PLink>
  )
}

export function PortalChangeOrderDetail() {
  const { changeOrderId } = useParams<{ changeOrderId: string }>()
  const { token, fetch: portalFetch, contact } = usePortal()
  const [co, setCo] = useState<ChangeOrderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showSign, setShowSign] = useState(false)
  const [showDecline, setShowDecline] = useState(false)
  const [reason, setReason] = useState('')
  useEffect(() => { portalFetch(`/change-orders/${changeOrderId}`).then(setCo).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch, changeOrderId])

  const approve = async (sig: SignatureData) => {
    setBusy(true); setShowSign(false); setError('')
    try { const res = await portalFetch(`/change-orders/${changeOrderId}/approve`, { method: 'POST', body: JSON.stringify({ signature: sig.signature, signedBy: sig.signedBy, consent: sig.consent }) }); setCo((c) => ({ ...(c as ChangeOrderData), ...(res?.changeOrder || { status: 'approved', signature: sig.signature, signedBy: sig.signedBy, approvedDate: sig.signedAt }) })) }
    catch (e) { setError('Failed to approve: ' + (e as Error).message) } finally { setBusy(false) }
  }
  const decline = async () => {
    setBusy(true); setError('')
    try { await portalFetch(`/change-orders/${changeOrderId}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason || null }) }); setCo((c) => ({ ...(c as ChangeOrderData), status: 'rejected' })); setShowDecline(false) }
    catch (e) { setError('Failed to decline: ' + (e as Error).message) } finally { setBusy(false) }
  }

  if (loading) return <Spinner />
  if (!co) return <div className="text-center py-12 text-gray-500 dark:text-slate-400">{error || 'Change order not found.'}</div>
  const canRespond = co.status === 'pending', isAddition = Number(co.amount) > 0
  const approvedOn = co.approvedDate || co.approvedAt

  return (
    <div>
      <PLink to={`/portal/${token}/change-orders`} className="text-orange-600 hover:underline text-sm mb-4 inline-block">{'<-'} Back to Change Orders</PLink>
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      <div className={`${card} overflow-hidden`}>
        <div className="p-6 border-b dark:border-slate-700">
          <div className="flex items-start justify-between gap-4">
            <div><h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{co.title || co.number}</h1><p className="text-gray-500 dark:text-slate-400">{co.number}</p>{co.project?.name && <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Project: {co.project.name}</p>}</div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[co.status] || 'bg-gray-100 text-gray-700'}`}>{co.status}</span>
          </div>
        </div>
        <div className={`p-6 ${isAddition ? 'bg-red-50 dark:bg-red-950/20' : 'bg-green-50 dark:bg-green-950/20'}`}>
          <div className="flex items-center gap-3">
            <AlertTriangle className={`w-6 h-6 ${isAddition ? 'text-red-600' : 'text-green-600'}`} />
            <div><p className="text-sm text-gray-600 dark:text-slate-400">{isAddition ? 'This change order will ADD to your project cost' : 'This change order will REDUCE your project cost'}</p><p className={`text-2xl font-bold ${isAddition ? 'text-red-600' : 'text-green-600'}`}>{isAddition ? '+' : '-'}{moneyShort(Math.abs(Number(co.amount)))}</p>{!!co.daysAdded && <p className="text-sm text-gray-600 dark:text-slate-400">Schedule impact: {co.daysAdded} day{co.daysAdded === 1 ? '' : 's'}</p>}</div>
          </div>
        </div>
        <div className="p-6 border-b dark:border-slate-700"><h3 className="font-medium text-gray-900 mb-2 dark:text-slate-100">Description</h3><p className="text-gray-700 whitespace-pre-wrap dark:text-slate-200">{co.description || 'No description provided.'}</p></div>
        {co.reason && <div className="p-6 border-b dark:border-slate-700"><h3 className="font-medium text-gray-900 mb-2 dark:text-slate-100">Reason for Change</h3><p className="text-gray-700 dark:text-slate-200">{co.reason}</p></div>}
        {canRespond && (
          <div className="p-6 bg-orange-50 border-t dark:bg-orange-950/20 dark:border-slate-700">
            <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">Please review this change order carefully. Your signature is required to approve.</p>
            <div className="flex flex-wrap gap-3"><button onClick={() => setShowSign(true)} disabled={busy} className={btnSuccess}><PenTool className="w-4 h-4" /> Sign & Approve</button><button onClick={() => setShowDecline(true)} disabled={busy} className={btnSecondary}><XCircle className="w-4 h-4" /> Decline</button></div>
          </div>
        )}
        {co.status === 'approved' && (
          <div className="p-6 bg-green-50 border-t dark:bg-green-950/20 dark:border-slate-700"><div className="flex items-start gap-4"><CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-1" /><div className="flex-1"><p className="font-medium text-green-800 dark:text-green-300">Approved{approvedOn ? ` on ${formatDate(approvedOn)}` : ''}</p>{co.signature && <SignatureDisplay className="mt-3" signature={co.signature} signedBy={(co.signedBy || co.approvedBy) ?? undefined} signedAt={approvedOn ?? undefined} />}</div></div></div>
        )}
        {co.status === 'rejected' && <div className="p-6 bg-red-50 border-t dark:bg-red-950/20 dark:border-slate-700"><div className="flex items-center gap-2 text-red-700 dark:text-red-300"><XCircle className="w-5 h-5" /><span className="font-medium">Declined</span></div></div>}
      </div>
      <SignatureModal isOpen={showSign} onClose={() => setShowSign(false)} onSave={approve} title="Approve Change Order" signerName={contact?.name || ''} />
      {showDecline && (
        <PortalModal title="Decline this change order?" subtitle={`${co.number} · ${moneyShort(Math.abs(Number(co.amount)))}`} onClose={() => setShowDecline(false)}>
          <label className={labelCls} htmlFor="co-decline-reason">Reason (optional)</label>
          <textarea id="co-decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputCls} />
          <div className="flex justify-end gap-2 mt-6"><button onClick={() => setShowDecline(false)} disabled={busy} className={btnSecondary}>Cancel</button><button onClick={decline} disabled={busy} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">{busy ? 'Declining…' : 'Decline'}</button></div>
        </PortalModal>
      )}
    </div>
  )
}
