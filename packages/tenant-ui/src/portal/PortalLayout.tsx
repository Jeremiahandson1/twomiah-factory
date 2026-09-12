// Portal chrome: company header, role-based tab nav (from the template's portal config ∩ what the backend mounts), footer.
import React from 'react'
import { useOutlet } from 'react-router-dom'
import { Home, FolderKanban, FileText, Receipt, ClipboardList, Palette, MessageSquare, Hammer, FileSignature, FileCheck2, FolderOpen, HelpCircle, CreditCard, Wrench, CalendarCheck, LifeBuoy } from 'lucide-react'
import { usePortal } from './PortalContext'
import { PortalTab } from './common'
import type { PortalSection } from './types'
import { SECTION_PATH, sectionAvailable } from './types'
import { useTheme } from '../shell/hooks'

export const SECTION_ICONS: Record<PortalSection, React.ComponentType<{ className?: string }>> = {
  projects: FolderKanban, quotes: FileText, invoices: Receipt, paymentMethods: CreditCard, changeOrders: ClipboardList, selections: Palette,
  messages: MessageSquare, myJobs: Hammer, lienWaivers: FileSignature, submittals: FileCheck2, rfis: HelpCircle, sharedDocuments: FolderOpen,
  equipment: Wrench, agreements: CalendarCheck, serviceRequest: LifeBuoy,
}

/** The sections this visitor gets, in nav order: the role's configured list, minus anything the backend did not mount. */
export function useVisibleSections(): PortalSection[] {
  const { role, config, sections } = usePortal()
  const list = role === 'collaborator' ? config.collaboratorNav : role === 'reviewer' ? config.reviewerNav : config.clientNav
  return list.filter((s) => sectionAvailable(s, sections))
}

export function PortalLayout() {
  const { token, company, contact, contactType, loading, error, config } = usePortal()
  const outlet = useOutlet()
  const visible = useVisibleSections()
  useTheme()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-3 text-gray-500 dark:text-slate-400">Loading your portal...</p>
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="max-w-md text-center p-8">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 dark:bg-red-900/40"><span className="text-2xl">⚠️</span></div>
          <h1 className="text-xl font-bold text-gray-900 mb-2 dark:text-slate-100">Portal Unavailable</h1>
          <p className="text-gray-600 dark:text-slate-400">{error}</p>
          <p className="mt-4 text-sm text-gray-500 dark:text-slate-400">Please contact the company for assistance.</p>
        </div>
      </div>
    )
  }

  const base = `/portal/${token}`
  const portalLabel = config.roleLabels[contactType] || 'Portal'
  const primary = (company?.primaryColor as string) || '#f97316'

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <header className="bg-white border-b shadow-sm dark:bg-slate-900 dark:border-slate-800" style={{ borderTopColor: primary, borderTopWidth: '4px' }}>
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {company?.logo ? (
                <img src={company.logo} alt={company.name || ''} className="h-10" />
              ) : (
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: primary }}>{company?.name?.charAt(0) || 'C'}</div>
              )}
              <div className="min-w-0">
                <h1 className="font-bold text-gray-900 truncate dark:text-slate-100">{company?.name}</h1>
                <p className="text-sm text-gray-500 dark:text-slate-400">{portalLabel}</p>
              </div>
            </div>
            <div className="text-right text-sm min-w-0">
              <p className="font-medium text-gray-900 truncate dark:text-slate-100">{contact?.name}</p>
              <p className="text-gray-500 truncate dark:text-slate-400">{contact?.email}</p>
            </div>
          </div>
        </div>
      </header>

      <nav aria-label="Portal" className="bg-white border-b dark:bg-slate-900 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            <PortalTab to={base} end icon={Home} label="Dashboard" />
            {visible.map((s) => <PortalTab key={s} to={`${base}/${SECTION_PATH[s]}`} icon={SECTION_ICONS[s]} label={config.labels[s]} />)}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl w-full mx-auto px-4 py-8 flex-1">{outlet}</main>

      <footer className="border-t bg-white dark:bg-slate-900 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center text-sm text-gray-500 dark:text-slate-400">
          <p>Need help? Contact us at {company?.email || company?.phone}</p>
        </div>
      </footer>
    </div>
  )
}
