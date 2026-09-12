// Portal home: one card per visible section (counts where the summary has them), quick actions, contact block.
import React from 'react'
import { DollarSign, FileText, Receipt, LifeBuoy } from 'lucide-react'
import { usePortal } from './PortalContext'
import { useVisibleSections, SECTION_ICONS } from './PortalLayout'
import { PLink, moneyShort, card } from './common'
import type { PortalSection } from './types'
import { SECTION_PATH } from './types'

interface StatCard { key: string; label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; color: string; link: string }

const CARD_STYLE: Record<PortalSection, { color: string; value: string }> = {
  projects: { color: 'bg-purple-100 text-purple-600', value: 'View' },
  quotes: { color: 'bg-blue-100 text-blue-600', value: 'Review' },
  invoices: { color: 'bg-green-100 text-green-600', value: 'View' },
  paymentMethods: { color: 'bg-blue-100 text-blue-600', value: 'Manage' },
  changeOrders: { color: 'bg-yellow-100 text-yellow-600', value: 'Review' },
  selections: { color: 'bg-purple-100 text-purple-600', value: 'Choose' },
  messages: { color: 'bg-gray-100 text-gray-600', value: 'Open' },
  myJobs: { color: 'bg-orange-100 text-orange-600', value: 'View' },
  lienWaivers: { color: 'bg-blue-100 text-blue-600', value: 'Review & Sign' },
  submittals: { color: 'bg-purple-100 text-purple-600', value: 'Review' },
  rfis: { color: 'bg-indigo-100 text-indigo-600', value: 'Respond' },
  sharedDocuments: { color: 'bg-gray-100 text-gray-600', value: 'Browse' },
  equipment: { color: 'bg-blue-100 text-blue-600', value: 'View' },
  agreements: { color: 'bg-emerald-100 text-emerald-600', value: 'View' },
  serviceRequest: { color: 'bg-orange-100 text-orange-600', value: 'Request' },
}

export function PortalDashboard() {
  const { token, summary, company, contact, role, config } = usePortal()
  const visible = useVisibleSections()
  const base = `/portal/${token}`
  const link = (s: PortalSection) => `${base}/${SECTION_PATH[s]}`

  const stats: StatCard[] = []
  for (const s of visible) {
    if (s === 'messages') continue
    const style = CARD_STYLE[s]
    let value: string | number = style.value
    let label = config.labels[s]
    if (s === 'projects') { value = summary?.activeProjects ?? 0; label = 'Active Projects' }
    if (s === 'quotes') { value = summary?.pendingQuotes ?? 0; label = 'Pending Quotes' }
    if (s === 'invoices') { value = summary?.totalInvoices ?? 0; label = 'Total Invoices' }
    stats.push({ key: s, label, value, icon: SECTION_ICONS[s], color: style.color, link: link(s) })
    if (s === 'invoices') {
      const balance = summary?.outstandingBalance ?? 0
      stats.push({ key: 'balance', label: 'Outstanding Balance', value: moneyShort(balance), icon: DollarSign, color: balance > 0 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-600', link: link('invoices') })
    }
  }

  const welcome = role === 'collaborator' ? 'Here are your jobs and paperwork.'
    : role === 'reviewer' ? 'Here are the items awaiting your review.'
    : `Here's an overview of your account with ${company?.name || ''}.`
  const hasQuotes = visible.includes('quotes'), hasInvoices = visible.includes('invoices'), hasRequest = visible.includes('serviceRequest')

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{contact?.name ? `Welcome, ${contact.name}!` : 'Welcome back!'}</h1>
        <p className="text-gray-600 dark:text-slate-400">{welcome}</p>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${stats.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-4`}>
        {stats.map((stat) => (
          <PLink key={stat.key} to={stat.link} className={`${card} p-6 hover:border-gray-300 hover:shadow-md transition-all text-gray-900 dark:text-slate-100`}>
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${stat.color}`}><stat.icon className="w-6 h-6" /></div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{stat.value}</p>
                <p className="text-sm text-gray-500 dark:text-slate-400">{stat.label}</p>
              </div>
            </div>
          </PLink>
        ))}
      </div>

      {role === 'client' && (hasQuotes || hasInvoices || hasRequest) && (
        <div className={`mt-8 ${card} p-6`}>
          <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            {hasQuotes && <PLink to={link('quotes')} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"><FileText className="w-4 h-4" /> Review Quotes</PLink>}
            {hasInvoices && <PLink to={link('invoices')} className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700"><Receipt className="w-4 h-4" /> View Invoices</PLink>}
            {hasRequest && <PLink to={link('serviceRequest')} className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700"><LifeBuoy className="w-4 h-4" /> {config.labels.serviceRequest}</PLink>}
          </div>
        </div>
      )}

      <div className="mt-8 bg-gray-100 rounded-xl p-6 dark:bg-slate-800">
        <h2 className="font-semibold text-gray-900 mb-2 dark:text-slate-100">Need Help?</h2>
        <p className="text-gray-600 dark:text-slate-400">
          Contact us at{' '}
          {!!company?.email && <a href={`mailto:${company.email}`} className="text-orange-600 hover:underline">{company.email}</a>}
          {!!company?.email && !!company?.phone && ' or '}
          {!!company?.phone && <a href={`tel:${company.phone}`} className="text-orange-600 hover:underline">{company.phone}</a>}
        </p>
      </div>
    </div>
  )
}
