import { Receipt, DollarSign, FolderOpen, CreditCard } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { usePortal } from '../../contexts/PortalContext';

interface StatCard {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  link: string;
}

export default function PortalDashboard() {
  const { token } = useParams();
  const { summary, company, contactType, contact } = usePortal();

  // Salon clients: what they owe and where to pay it. Suppliers: the documents shared with them.
  const isSupplier = contactType === 'supplier' || contactType === 'vendor' || contactType === 'subcontractor';
  const clientStats: StatCard[] = [
    { label: 'Invoices', value: (summary?.totalInvoices as number) || 0, icon: Receipt, color: 'bg-green-100 text-green-600', link: `/portal/${token}/invoices` },
    {
      label: 'Outstanding Balance',
      value: `$${((summary?.outstandingBalance as number) || 0).toLocaleString()}`,
      icon: DollarSign,
      color: (summary?.outstandingBalance as number) > 0 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-600',
      link: `/portal/${token}/invoices`,
    },
    { label: 'Payment Method', value: 'Manage', icon: CreditCard, color: 'bg-blue-100 text-blue-600', link: `/portal/${token}/payment-methods` },
  ];
  const supplierCards: StatCard[] = [
    { label: 'Shared Documents', value: 'Browse', icon: FolderOpen, color: 'bg-gray-100 text-gray-600', link: `/portal/${token}/shared-documents` },
  ];
  const stats = isSupplier ? supplierCards : clientStats;
  const welcome = isSupplier ? 'Here are the documents shared with you.' : `Here's an overview of your account with ${(company?.name as string) || ''}.`;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
          {contact?.name ? `Welcome, ${contact.name as string}!` : 'Welcome back!'}
        </h1>
        <p className="text-gray-600 dark:text-slate-400">{welcome}</p>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${stats.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-4`}>
        {stats.map((stat) => (
          <Link
            key={stat.label}
            to={stat.link}
            className="bg-white rounded-xl p-6 border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all text-gray-900 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{stat.value}</p>
                <p className="text-sm text-gray-500 dark:text-slate-400">{stat.label}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {!isSupplier && (
        <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6 dark:bg-slate-900 dark:border-slate-700">
          <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              to={`/portal/${token}/invoices`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700"
            >
              <Receipt className="w-4 h-4" />
              View Invoices
            </Link>
          </div>
        </div>
      )}

      <div className="mt-8 bg-gray-100 rounded-xl p-6 dark:bg-slate-800">
        <h2 className="font-semibold text-gray-900 mb-2 dark:text-slate-100">Need Help?</h2>
        <p className="text-gray-600 dark:text-slate-400">
          Contact us at{' '}
          {!!company?.email && (
            <a href={`mailto:${company.email as string}`} className="text-orange-600 hover:underline">
              {company.email as string}
            </a>
          )}
          {!!company?.email && !!company?.phone && ' or '}
          {!!company?.phone && (
            <a href={`tel:${company.phone as string}`} className="text-orange-600 hover:underline">
              {company.phone as string}
            </a>
          )}
        </p>
      </div>
    </div>
  );
}
