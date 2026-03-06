import { Outlet, NavLink, useParams } from 'react-router-dom';
import { Home, FolderKanban, FileText, Receipt, ClipboardList, Loader2 } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

export default function PortalLayout() {
  const { token } = useParams();
  const { company, contact, loading, error } = usePortal();

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

  const navItems = [
    { to: `/portal/${token}`, icon: Home, label: 'Dashboard', end: true },
    { to: `/portal/${token}/projects`, icon: FolderKanban, label: 'Projects' },
    { to: `/portal/${token}/quotes`, icon: FileText, label: 'Quotes' },
    { to: `/portal/${token}/invoices`, icon: Receipt, label: 'Invoices' },
    { to: `/portal/${token}/change-orders`, icon: ClipboardList, label: 'Change Orders' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header 
        className="bg-white border-b shadow-sm"
        style={{ borderTopColor: company?.primaryColor || '#f97316', borderTopWidth: '4px' }}
      >
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {company?.logo ? (
                <img src={company.logo} alt={company.name} className="h-10" />
              ) : (
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                  style={{ backgroundColor: company?.primaryColor || '#f97316' }}
                >
                  {company?.name?.charAt(0) || 'C'}
                </div>
              )}
              <div>
                <h1 className="font-bold text-gray-900">{company?.name}</h1>
                <p className="text-sm text-gray-500">Customer Portal</p>
              </div>
            </div>
            <div className="text-right text-sm">
              <p className="font-medium text-gray-900">{contact?.name}</p>
              <p className="text-gray-500">{contact?.email}</p>
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
          <p>Need help? Contact us at {company?.email || company?.phone}</p>
        </div>
      </footer>
    </div>
  );
}
