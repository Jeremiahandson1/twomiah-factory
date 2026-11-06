// The cosigner's own page (/c/<token>): the insurance carrier or spouse a proposal asks to sign after the customer. No portal and
// no sign-in — the link opens this one proposal and nothing else. They read what the customer signed (the option chosen, the
// price, the terms the customer initialed) and sign; the proposal is approved when that signature is in.
import React, { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle, Clock, Download, PenTool } from 'lucide-react'
import { API_URL } from './PortalContext'
import { SignatureModal, SignatureDisplay, type SignatureData } from './SignaturePad'
import { Spinner, btnSuccess, btnSecondary, formatWhen, moneyShort } from './common'
import { AttachmentLinks, ProposalSections, type PortalQuoteData } from './PortalQuotes'

interface CosignView {
  quote: PortalQuoteData
  company: { name: string; logo?: string | null; primaryColor?: string | null; email?: string | null; phone?: string | null; timeZone?: string | null }
  cosigner: { name: string; role: string | null; state: 'signed' | 'closed' | 'not_yet' | 'ready'; customerName: string | null; customerSignedAt: string | null; signedAt: string | null }
}

const readError = async (r: Response, fallback: string) => { try { const b = await r.json(); return b?.error || fallback } catch { return fallback } }

export function PortalCosign() {
  const { token } = useParams<{ token: string }>()
  const base = `${API_URL}/api/portal/c/${token}`
  const [view, setView] = useState<CosignView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSign, setShowSign] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(base)
      if (!r.ok) throw new Error(await readError(r, 'This link could not be opened.'))
      setView(await r.json()); setError('')
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [base])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (view?.company?.name) document.title = `${view.company.name} — Cosign` }, [view?.company?.name])

  const sign = async (sig: SignatureData) => {
    setShowSign(false); setBusy(true); setError('')
    try {
      const r = await fetch(`${base}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig.signature, signedBy: sig.signedBy, consent: sig.consent }) })
      if (!r.ok) throw new Error(await readError(r, 'Could not sign'))
      await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (loading) return <div className="min-h-screen bg-gray-50 dark:bg-slate-900"><Spinner className="py-24" /></div>
  if (!view) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="max-w-md text-center p-8"><h1 className="text-xl font-bold text-gray-900 mb-2 dark:text-slate-100">This link can’t be opened</h1><p className="text-gray-600 dark:text-slate-400">{error || 'This link is not valid.'}</p></div>
      </div>
    )
  }
  const { quote, company, cosigner } = view
  const primary = company.primaryColor || '#f97316'
  const chosen = quote.proposal?.options.find((o) => o.chosen)
  const doc = quote.document
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <header className="bg-white border-b shadow-sm dark:bg-slate-900 dark:border-slate-800" style={{ borderTopColor: primary, borderTopWidth: '4px' }}>
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3 min-w-0">
          {company.logo ? <img src={company.logo} alt={company.name} className="h-10" /> : <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: primary }}>{company.name?.charAt(0) || 'C'}</div>}
          <h1 className="font-bold text-gray-900 truncate dark:text-slate-100">{company.name}</h1>
        </div>
      </header>
      <main className="max-w-4xl w-full mx-auto px-4 py-8 flex-1 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{quote.name || quote.number}</h2><p className="text-gray-500 dark:text-slate-400">Quote {quote.number} · for {cosigner.customerName || 'the customer'}</p></div>
          <a href={`${base}/pdf`} target="_blank" rel="noreferrer" className={btnSecondary}><Download className="w-4 h-4" /> Download PDF</a>
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <section className="rounded-xl border bg-white p-6 dark:bg-slate-900 dark:border-slate-800">
          <p className="text-gray-700 dark:text-slate-300">Hello {cosigner.name}. {cosigner.customerName || 'The customer'} has signed this quote{cosigner.customerSignedAt ? ` on ${formatWhen(cosigner.customerSignedAt, company.timeZone)}` : ''} and asks for your signature{cosigner.role ? ` as ${cosigner.role}` : ''}.</p>
          {chosen && <p className="mt-3 text-sm text-gray-700 dark:text-slate-300"><span className="font-medium">Option chosen:</span> {chosen.name}{chosen.brand ? ` — ${chosen.brand}` : ''}</p>}
          <table className="mt-3 w-full text-sm">
            <tbody>
              {[...(quote.lineItems || []), ...(chosen?.lines || []), ...((chosen?.upgrades || []).filter((u) => u.selected))].map((l, i) => <tr key={i} className="border-b last:border-0 dark:border-slate-800"><td className="py-2 text-gray-900 dark:text-slate-100">{l.description}</td><td className="py-2 text-right text-gray-900 dark:text-slate-100">{moneyShort(l.total)}</td></tr>)}
            </tbody>
          </table>
          <div className="mt-3 flex justify-between text-lg font-bold text-gray-900 dark:text-slate-100"><span>Total</span><span>{moneyShort(quote.total)}</span></div>
          {Number(quote.discount || 0) > 0 && <p className="text-sm text-gray-600 dark:text-slate-400">After a discount of {moneyShort(quote.discount)}.</p>}
        </section>
        <ProposalSections document={doc} placement="before_terms" />
        {doc && <AttachmentLinks items={doc.attachments} title="Files with this proposal" />}
        {(quote.terms || (doc?.termsClauses?.length ?? 0) > 0) && (
          <section className="rounded-xl border bg-white p-6 dark:bg-slate-900 dark:border-slate-800" data-testid="cosign-terms">
            <h3 className="font-medium text-gray-900 mb-1 dark:text-slate-100">Terms</h3>
            {quote.terms && <p className="text-sm text-gray-700 whitespace-pre-wrap dark:text-slate-300">{quote.terms}</p>}
            {(doc?.termsClauses || []).length > 0 && <ol className="mt-2 space-y-1 text-sm text-gray-800 dark:text-slate-200">{doc!.termsClauses!.map((cl, i) => <li key={cl.id} className="flex justify-between gap-3"><span>{i + 1}. {cl.text}</span>{cl.initials && <span className="font-semibold tracking-wider">Initialed {cl.initials}</span>}</li>)}</ol>}
          </section>
        )}
        {cosigner.state === 'ready' && (
          <section className="rounded-xl bg-orange-50 p-6 dark:bg-orange-950/20">
            <p className="text-sm text-gray-700 mb-3 dark:text-slate-300">Review the quote above, then sign. It is approved once you have signed.</p>
            <button type="button" onClick={() => setShowSign(true)} disabled={busy} className={btnSuccess}><PenTool className="w-4 h-4" /> Sign</button>
          </section>
        )}
        {cosigner.state === 'signed' && <section className="rounded-xl bg-green-50 p-6 dark:bg-green-950/20" data-testid="cosigned"><div className="flex items-center gap-2 font-medium text-green-800 dark:text-green-300"><CheckCircle className="w-5 h-5" /> You signed{cosigner.signedAt ? ` on ${formatWhen(cosigner.signedAt, company.timeZone)}` : ''}. Thank you.</div></section>}
        {cosigner.state === 'not_yet' && <section className="rounded-xl bg-gray-100 p-6 text-gray-700 dark:bg-slate-800 dark:text-slate-200"><div className="flex items-center gap-2"><Clock className="w-5 h-5 shrink-0" /> {cosigner.customerName || 'The customer'} has not signed yet. You will be emailed when they have.</div></section>}
        {cosigner.state === 'closed' && <section className="rounded-xl bg-gray-100 p-6 text-gray-700 dark:bg-slate-800 dark:text-slate-200"><div className="flex items-center gap-2"><Clock className="w-5 h-5 shrink-0" /> This quote can no longer be signed ({quote.status === 'approved' ? 'it is already approved' : quote.status}). Please contact {company.name}{company.phone ? ` on ${company.phone}` : ''}.</div></section>}
        {quote.signature && <SignatureDisplay signature={quote.signature as string} signedBy={quote.signedBy ?? undefined} signedAt={quote.approvedAt ?? undefined} timeZone={company.timeZone} />}
      </main>
      <SignatureModal isOpen={showSign} onClose={() => setShowSign(false)} onSave={sign} title="Cosign this quote" signerName={cosigner.name} />
    </div>
  )
}
