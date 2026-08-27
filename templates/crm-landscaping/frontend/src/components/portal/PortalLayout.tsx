import { Outlet, NavLink, useParams } from 'react-router-dom';
import { Home, FolderKanban, FileText, Receipt, ClipboardList, Palette, MessageSquare, Loader2 , CreditCard } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

export default function PortalLayout() {
  const { token } = useParams();
  const { company, contact, loading, error } = usePortal();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
          <p className="mt-2 text-gray-500 dark:text-slate-400">Loading your portal...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="max-w-md text-center p-8">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2 dark:text-slate-100">Portal Unavailable</h1>
          <p className="text-gray-600 dark:text-slate-400">{error}</p>
          <p className="mt-4 text-sm text-gray-500 dark:text-slate-400">
            Please contact the company for assistance.
          </p>
        </div>
      </div>
    );
  }

  const navItems = [
    { to: `/portal/${token}`, icon: Home, label: 'Dashboard', end: true },
    { to: `/portal/${token}/projects`, icon: FolderKanban, label: 'Projects' },
    { to: `/portal/${token}/quotes`, icon: FileText, label: 'Quotes' },
    { to: `/portal/${token}/invoices`, icon: Receipt, label: 'Invoices' },
          { to: `/portal/${token}/payment-methods`, icon: CreditCard, label: 'Payment Method' },
    { to: `/portal/${token}/change-orders`, icon: ClipboardList, label: 'Change Orders' },
    { to: `/portal/${token}/selections`, icon: Palette, label: 'Selections' },
    { to: `/portal/${token}/messages`, icon: MessageSquare, label: 'Messages' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <header 
        className="bg-white border-b shadow-sm dark:bg-slate-900"
        style={{ borderTopColor: company?.primaryColor || '{{PRIMARY_COLOR}}', borderTopWidth: '4px' }}
      >
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {company?.logo ? (
                <img src={company.logo} alt={company.name} className="h-10" />
              ) : (
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                  style={{ backgroundColor: company?.primaryColor || '{{PRIMARY_COLOR}}' }}
                >
                  {company?.name?.charAt(0) || 'C'}
                </div>
              )}
              <div>
                <h1 className="font-bold text-gray-900 dark:text-slate-100">{company?.name}</h1>
                <p className="text-sm text-gray-500 dark:text-slate-400">Customer Portal</p>
              </div>
            </div>
            <div className="text-right text-sm">
              <p className="font-medium text-gray-900 dark:text-slate-100">{contact?.name}</p>
              <p className="text-gray-500 dark:text-slate-400">{contact?.email}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b dark:bg-slate-900">
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
      <footer className="border-t bg-white mt-auto dark:bg-slate-900">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center text-sm text-gray-500 dark:text-slate-400">
          <p>Need help? Contact us at {company?.email || company?.phone}</p>
        </div>
      </footer>
    </div>
  );
}
