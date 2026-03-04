import { FolderKanban, FileText, Receipt, DollarSign } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { usePortal } from '../../contexts/PortalContext';

export default function PortalDashboard() {
  const { token } = useParams();
  const { summary, company } = usePortal();

  const stats = [
    {
      label: 'Active Projects',
      value: summary?.activeProjects || 0,
      icon: FolderKanban,
      color: 'bg-purple-100 text-purple-600',
      link: `/portal/${token}/projects`,
    },
    {
      label: 'Pending Quotes',
      value: summary?.pendingQuotes || 0,
      icon: FileText,
      color: 'bg-blue-100 text-blue-600',
      link: `/portal/${token}/quotes`,
    },
    {
      label: 'Total Invoices',
      value: summary?.totalInvoices || 0,
      icon: Receipt,
      color: 'bg-green-100 text-green-600',
      link: `/portal/${token}/invoices`,
    },
    {
      label: 'Outstanding Balance',
      value: `$${(summary?.outstandingBalance || 0).toLocaleString()}`,
      icon: DollarSign,
      color: summary?.outstandingBalance > 0 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-600',
      link: `/portal/${token}/invoices`,
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Welcome back!</h1>
        <p className="text-gray-600">Here's an overview of your account with {company?.name}.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            to={stat.link}
            className="bg-white rounded-xl p-6 border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all text-gray-900"
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-sm text-gray-500">{stat.label}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            to={`/portal/${token}/quotes`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Review Quotes
          </Link>
          <Link
            to={`/portal/${token}/invoices`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Receipt className="w-4 h-4" />
            View Invoices
          </Link>
        </div>
      </div>

      {/* Contact info */}
      <div className="mt-8 bg-gray-100 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900 mb-2">Need Help?</h2>
        <p className="text-gray-600">
          Contact us at{' '}
          {company?.email && (
            <a href={`mailto:${company.email}`} className="text-orange-600 hover:underline">
              {company.email}
            </a>
          )}
          {company?.email && company?.phone && ' or '}
          {company?.phone && (
            <a href={`tel:${company.phone}`} className="text-orange-600 hover:underline">
              {company.phone}
            </a>
          )}
        </p>
      </div>
    </div>
  );
}
