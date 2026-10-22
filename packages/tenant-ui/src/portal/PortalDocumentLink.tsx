// A quote's or an invoice's own page, opened from the link in its email (/d/<token>, 2026-10-22). The customer needs
// no portal and no sign-in: the business's name and colour on top, then the portal's own quote or invoice page —
// approve or decline a quote, pay an invoice (or be told how) — for that one document and nothing else.
import React from 'react'
import { useParams } from 'react-router-dom'
import { PortalLinkProvider, usePortal } from './PortalContext'
import { PortalQuoteDetail } from './PortalQuotes'
import { PortalInvoiceDetail } from './PortalInvoices'
import { Spinner } from './common'
import { useTheme } from '../shell/hooks'

function DocumentPage() {
  const { company, loading, error, link } = usePortal()
  useTheme()
  if (loading) return <div className="min-h-screen bg-gray-50 dark:bg-slate-900"><Spinner className="py-24" /></div>
  if (error || !link) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="max-w-md text-center p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-2 dark:text-slate-100">This link can’t be opened</h1>
          <p className="text-gray-600 dark:text-slate-400">{error || 'This link is not valid.'}</p>
        </div>
      </div>
    )
  }
  const primary = (company?.primaryColor as string) || '#f97316'
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <header className="bg-white border-b shadow-sm dark:bg-slate-900 dark:border-slate-800" style={{ borderTopColor: primary, borderTopWidth: '4px' }}>
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3 min-w-0">
          {company?.logo ? (
            <img src={company.logo} alt={company.name || ''} className="h-10" />
          ) : (
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: primary }}>{company?.name?.charAt(0) || 'C'}</div>
          )}
          <h1 className="font-bold text-gray-900 truncate dark:text-slate-100">{company?.name}</h1>
        </div>
      </header>
      <main className="max-w-4xl w-full mx-auto px-4 py-8 flex-1">
        {link.kind === 'quote' ? <PortalQuoteDetail quoteId={link.id} /> : <PortalInvoiceDetail invoiceId={link.id} />}
      </main>
      {(company?.email || company?.phone) && (
        <footer className="border-t bg-white dark:bg-slate-900 dark:border-slate-800">
          <div className="max-w-4xl mx-auto px-4 py-6 text-center text-sm text-gray-500 dark:text-slate-400">Questions? Contact {company?.name} at {[company?.phone, company?.email].filter(Boolean).join(' or ')}</div>
        </footer>
      )}
    </div>
  )
}

/** Mounted at /d/:token. */
export function PortalDocumentLink() {
  const { token } = useParams<{ token: string }>()
  return <PortalLinkProvider token={token}><DocumentPage /></PortalLinkProvider>
}
