import { FolderKanban, FileText, Receipt, DollarSign, Hammer, FileSignature, FileCheck2, HelpCircle, FolderOpen, ClipboardList } from 'lucide-react';
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

  const isSub = contactType === 'subcontractor' || contactType === 'vendor' || contactType === 'supplier';
  const isArchitect = contactType === 'architect' || contactType === 'consultant' || contactType === 'inspector';

  const clientStats: StatCard[] = [
    { label: 'Active Projects', value: (summary?.activeProjects as number) || 0, icon: FolderKanban, color: 'bg-purple-100 text-purple-600', link: `/portal/${token}/projects` },
    { label: 'Pending Quotes', value: (summary?.pendingQuotes as number) || 0, icon: FileText, color: 'bg-blue-100 text-blue-600', link: `/portal/${token}/quotes` },
    { label: 'Total Invoices', value: (summary?.totalInvoices as number) || 0, icon: Receipt, color: 'bg-green-100 text-green-600', link: `/portal/${token}/invoices` },
    {
      label: 'Outstanding Balance',
      value: `$${((summary?.outstandingBalance as number) || 0).toLocaleString()}`,
      icon: DollarSign,
      color: (summary?.outstandingBalance as number) > 0 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-600',
      link: `/portal/${token}/invoices`,
    },
  ];

  const subCards: StatCard[] = [
    { label: 'My Jobs', value: 'View', icon: Hammer, color: 'bg-orange-100 text-orange-600', link: `/portal/${token}/my-jobs` },
    { label: 'Lien Waivers', value: 'Review & Sign', icon: FileSignature, color: 'bg-blue-100 text-blue-600', link: `/portal/${token}/lien-waivers` },
    { label: 'Shared Documents', value: 'Browse', icon: FolderOpen, color: 'bg-gray-100 text-gray-600', link: `/portal/${token}/shared-documents` },
  ];

  const architectCards: StatCard[] = [
    { label: 'Submittals', value: 'Review', icon: FileCheck2, color: 'bg-purple-100 text-purple-600', link: `/portal/${token}/submittal-review` },
    { label: 'RFIs', value: 'Respond', icon: HelpCircle, color: 'bg-indigo-100 text-indigo-600', link: `/portal/${token}/rfis-assigned` },
    { label: 'Change Orders', value: 'Review', icon: ClipboardList, color: 'bg-yellow-100 text-yellow-600', link: `/portal/${token}/change-orders` },
    { label: 'Shared Documents', value: 'Browse', icon: FolderOpen, color: 'bg-gray-100 text-gray-600', link: `/portal/${token}/shared-documents` },
  ];

  const stats = isSub ? subCards : isArchitect ? architectCards : clientStats;

  const welcome = isSub
    ? 'Here are your jobs and paperwork.'
    : isArchitect
      ? 'Here are the items awaiting your review.'
      : `Here's an overview of your account with ${(company?.name as string) || ''}.`;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {contact?.name ? `Welcome, ${contact.name as string}!` : 'Welcome back!'}
        </h1>
        <p className="text-gray-600">{welcome}</p>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${stats.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-4`}>
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

      {!isSub && !isArchitect && (
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
      )}

      <div className="mt-8 bg-gray-100 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900 mb-2">Need Help?</h2>
        <p className="text-gray-600">
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
