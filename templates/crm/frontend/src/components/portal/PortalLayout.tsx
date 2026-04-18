import { Outlet, NavLink, useParams } from 'react-router-dom';
import { Home, FolderKanban, FileText, Receipt, ClipboardList, Palette, MessageSquare, Loader2, Hammer, FileSignature, FileCheck2, FolderOpen, HelpCircle } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

const ROLE_LABELS: Record<string, string> = {
  client: 'Customer Portal',
  lead: 'Customer Portal',
  vendor: 'Vendor Portal',
  subcontractor: 'Subcontractor Portal',
  architect: 'Architect Portal',
  consultant: 'Consultant Portal',
  inspector: 'Inspector Portal',
  supplier: 'Supplier Portal',
};

export default function PortalLayout() {
  const { token } = useParams();
  const { company, contact, contactType, loading, error } = usePortal();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
          <p className="mt-2 text-gray-500">Loading your portal...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md text-center p-8">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Portal Unavailable</h1>
          <p className="text-gray-600">{error}</p>
          <p className="mt-4 text-sm text-gray-500">
            Please contact the company for assistance.
          </p>
        </div>
      </div>
    );
  }

  type NavItem = { to: string; icon: typeof Home; label: string; end?: boolean };
  const dashboard: NavItem = { to: `/portal/${token}`, icon: Home, label: 'Dashboard', end: true };
  const messages: NavItem = { to: `/portal/${token}/messages`, icon: MessageSquare, label: 'Messages' };
  const documents: NavItem = { to: `/portal/${token}/shared-documents`, icon: FolderOpen, label: 'Documents' };

  const isSub = contactType === 'subcontractor' || contactType === 'vendor' || contactType === 'supplier';
  const isArchitect = contactType === 'architect' || contactType === 'consultant' || contactType === 'inspector';

  const navItems = isSub
    ? [
        dashboard,
        { to: `/portal/${token}/my-jobs`, icon: Hammer, label: 'My Jobs' },
        { to: `/portal/${token}/lien-waivers`, icon: FileSignature, label: 'Lien Waivers' },
        documents,
        messages,
      ]
    : isArchitect
      ? [
          dashboard,
          { to: `/portal/${token}/rfis-assigned`, icon: HelpCircle, label: 'RFIs' },
          { to: `/portal/${token}/submittal-review`, icon: FileCheck2, label: 'Submittals' },
          { to: `/portal/${token}/change-orders`, icon: ClipboardList, label: 'Change Orders' },
          documents,
          messages,
        ]
      : [
          dashboard,
          { to: `/portal/${token}/projects`, icon: FolderKanban, label: 'Projects' },
          { to: `/portal/${token}/quotes`, icon: FileText, label: 'Quotes' },
          { to: `/portal/${token}/invoices`, icon: Receipt, label: 'Invoices' },
          { to: `/portal/${token}/change-orders`, icon: ClipboardList, label: 'Change Orders' },
          { to: `/portal/${token}/selections`, icon: Palette, label: 'Selections' },
          messages,
        ];

  const portalLabel = ROLE_LABELS[contactType] || 'Portal';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header 
        className="bg-white border-b shadow-sm"
        style={{ borderTopColor: (company?.primaryColor as string) || '{{PRIMARY_COLOR}}', borderTopWidth: '4px' }}
      >
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {company?.logo ? (
                <img src={company.logo as string} alt={(company.name as string) || ''} className="h-10" />
              ) : (
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                  style={{ backgroundColor: (company?.primaryColor as string) || '{{PRIMARY_COLOR}}' }}
                >
                  {(company?.name as string)?.charAt(0) || 'C'}
                </div>
              )}
              <div>
                <h1 className="font-bold text-gray-900">{company?.name as string}</h1>
                <p className="text-sm text-gray-500">{portalLabel}</p>
              </div>
            </div>
            <div className="text-right text-sm">
              <p className="font-medium text-gray-900">{contact?.name as string}</p>
              <p className="text-gray-500">{contact?.email as string}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap
                  transition-colors
                  ${isActive 
                    ? 'border-orange-500 text-orange-600' 
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }
                `}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t bg-white mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center text-sm text-gray-500">
          <p>Need help? Contact us at {(company?.email as string) || (company?.phone as string)}</p>
        </div>
      </footer>
    </div>
  );
}
