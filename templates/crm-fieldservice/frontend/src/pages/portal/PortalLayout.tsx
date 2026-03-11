import { useEffect, useState } from 'react';
import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { Home, Wrench, FileText, Receipt, LogOut } from 'lucide-react';
import portalApi from './portalApi';

export default function PortalLayout() {
  const navigate = useNavigate();
  const [company, setCompany] = useState<any>(null);
  const [contact, setContact] = useState<any>(null);

  useEffect(() => {
    if (!portalApi.getToken()) {
      navigate('/portal/login');
      return;
    }

    // Load from cache first
    try {
      const cached = localStorage.getItem('portalCompany');
      if (cached) setCompany(JSON.parse(cached));
      const cachedContact = localStorage.getItem('portalContact');
      if (cachedContact) setContact(JSON.parse(cachedContact));
    } catch {}

    // Refresh
    portalApi.get('/api/portal/me').then((data) => {
      setCompany(data.company);
      setContact(data.contact);
      localStorage.setItem('portalCompany', JSON.stringify(data.company));
      localStorage.setItem('portalContact', JSON.stringify(data.contact));
    }).catch(() => {
      navigate('/portal/login');
    });
  }, []);

  const handleLogout = () => {
    portalApi.clearToken();
    localStorage.removeItem('portalCompany');
    localStorage.removeItem('portalContact');
    navigate('/portal/login');
  };

  const firstName = contact?.name?.split(' ')[0] || '';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          {company?.logo ? (
            <img src={company.logo} alt="" className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: company?.primaryColor || '#3b82f6' }}>
              {company?.name?.[0] || 'P'}
            </div>
          )}
          <span className="font-semibold text-gray-900 text-sm truncate">{company?.name || 'Customer Portal'}</span>
        </div>
        <div className="flex items-center gap-3">
          {firstName && <span className="text-sm text-gray-500 hidden sm:block">Hi, {firstName}</span>}
          <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 pb-20">
        <Outlet />
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex z-50">
        <BottomTab to="/portal" icon={Home} label="Home" end />
        <BottomTab to="/portal/equipment" icon={Wrench} label="Equipment" />
        <BottomTab to="/portal/agreements" icon={FileText} label="Plans" />
        <BottomTab to="/portal/invoices" icon={Receipt} label="Invoices" />
      </nav>
    </div>
  );
}

function BottomTab({ to, icon: Icon, label, end }: { to: string; icon: any; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${isActive ? 'text-blue-600' : 'text-gray-400'}`
      }
    >
      <Icon className="w-5 h-5 mb-0.5" />
      {label}
    </NavLink>
  );
}
