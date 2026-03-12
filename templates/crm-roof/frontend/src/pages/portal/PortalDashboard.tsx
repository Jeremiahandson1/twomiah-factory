import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, Receipt, ArrowRight, Phone, Mail, Loader2, PenTool, Camera, Sparkles, BookOpen } from 'lucide-react';
import { useFeature } from '../../data/features';
import { portalHeaders } from './PortalLayout';

const STATUS_DESCRIPTIONS: Record<string, string> = {
  lead: "We've received your inquiry",
  inspection_scheduled: 'Your roof inspection is scheduled',
  inspected: "Inspection complete \u2014 we're preparing your proposal",
  measurement_ordered: "We're getting precise measurements of your roof",
  proposal_sent: 'Your proposal is ready for review',
  signed: 'Contract signed \u2014 scheduling installation',
  material_ordered: 'Materials have been ordered',
  in_production: 'Your roof installation is underway!',
  final_inspection: 'Final inspection scheduled',
  invoiced: 'Your invoice is ready',
  collected: 'Complete \u2014 thank you!',
};

const STATUS_COLORS: Record<string, string> = {
  lead: 'bg-gray-700',
  inspection_scheduled: 'bg-blue-700',
  inspected: 'bg-indigo-700',
  measurement_ordered: 'bg-purple-700',
  proposal_sent: 'bg-yellow-600',
  signed: 'bg-green-700',
  material_ordered: 'bg-orange-700',
  in_production: 'bg-cyan-700',
  final_inspection: 'bg-teal-700',
  invoiced: 'bg-pink-700',
  collected: 'bg-emerald-700',
};

export default function PortalDashboard() {
  const navigate = useNavigate();
  const hasVisualizer = useFeature('visualizer');
  const hasPricebook = useFeature('pricebook');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const headers = portalHeaders();
      const [profileRes, jobsRes, invoicesRes] = await Promise.all([
        fetch('/api/portal/me', { headers }),
        fetch('/api/portal/jobs', { headers }),
        fetch('/api/portal/invoices', { headers }),
      ]);
      const profile = await profileRes.json();
      const jobs = await jobsRes.json();
      const invoices = await invoicesRes.json();

      const jobsList = Array.isArray(jobs) ? jobs : jobs.data || [];
      const invoicesList = Array.isArray(invoices) ? invoices : invoices.data || [];
      const unpaid = invoicesList.filter((i: any) => ['sent', 'partial', 'overdue'].includes(i.status));
      const unpaidTotal = unpaid.reduce((sum: number, i: any) => sum + (Number(i.total) - Number(i.amountPaid || 0)), 0);

      setData({
        contact: profile.contact || profile,
        company: profile.company,
        jobs: jobsList,
        activeJobs: jobsList.filter((j: any) => j.status !== 'collected'),
        unpaidCount: unpaid.length,
        unpaidTotal,
      });
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!data) return null;

  const firstName = data.contact?.name?.split(' ')[0] || data.contact?.firstName || 'there';

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-white">Welcome back, {firstName}</h1>
        <p className="text-gray-400 text-sm mt-0.5">Here's an overview of your roofing project</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/portal/jobs" className="bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-gray-600 transition-colors">
          <Briefcase className="w-6 h-6 text-blue-400 mb-2" />
          <p className="text-2xl font-bold text-white">{data.activeJobs.length}</p>
          <p className="text-sm text-gray-400">Active Jobs</p>
        </Link>

        <Link to="/portal/invoices" className="bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-gray-600 transition-colors">
          <Receipt className="w-6 h-6 text-green-400 mb-2" />
          <p className="text-2xl font-bold text-white">{data.unpaidCount}</p>
          <p className="text-sm text-gray-400">Unpaid Invoices</p>
        </Link>
      </div>

      {/* Unpaid Alert */}
      {data.unpaidCount > 0 && (
        <Link to="/portal/invoices" className="block bg-orange-900/30 border border-orange-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-800 rounded-lg flex items-center justify-center flex-shrink-0">
              <Receipt className="w-5 h-5 text-orange-300" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-orange-200">
                {data.unpaidCount} unpaid invoice{data.unpaidCount > 1 ? 's' : ''}
              </p>
              <p className="text-sm text-orange-300">${data.unpaidTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
            <ArrowRight className="w-5 h-5 text-orange-500" />
          </div>
        </Link>
      )}

      {/* Active Jobs with Status Descriptions */}
      {data.activeJobs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Your Projects</h2>
          {data.activeJobs.map((job: any) => (
            <Link
              key={job.id}
              to={`/portal/jobs/${job.id}`}
              className="block bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-gray-600 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <p className="text-sm font-mono text-gray-400">
                  {job.jobNumber || `ROOF-${String(job.id).padStart(4, '0')}`}
                </p>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded text-white ${STATUS_COLORS[job.status] || 'bg-gray-700'}`}>
                  {(job.status || '').replace(/_/g, ' ')}
                </span>
              </div>
              {job.address && <p className="text-sm text-gray-300 mb-2">{job.address}</p>}
              <p className="text-sm text-blue-400">
                {STATUS_DESCRIPTIONS[job.status] || 'In progress'}
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* Request Service */}
      <Link
        to="/portal/service-request"
        className="flex items-center justify-center gap-2 w-full py-4 bg-blue-600 text-white text-center rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors"
      >
        <PenTool className="w-4 h-4" /> Request Service
      </Link>

      {/* Visualizer Promo — show if they don't have the feature yet */}
      {!hasVisualizer && (
        <div
          onClick={() => navigate('/crm/visualizer-trial')}
          className="bg-white rounded-xl border border-violet-200 border-dashed p-6 cursor-pointer hover:border-violet-300 hover:shadow-md transition-all group relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 to-purple-500" />
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center">
              <Camera className="w-6 h-6 text-violet-600" />
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-bold bg-violet-100 text-violet-700 px-2 py-1 rounded-full">
              <Sparkles className="w-3 h-3" />
              FREE TRIAL
            </span>
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">Exterior Visualizer</h3>
          <p className="text-sm text-slate-500">
            Show customers what their home will look like — AI-powered exterior renderings
          </p>
        </div>
      )}

      {/* Pricebook Promo */}
          {!hasPricebook && (
            <div
              onClick={() => navigate('/crm/pricebook-trial')}
              className="bg-white rounded-xl border border-amber-200 border-dashed p-6 cursor-pointer hover:border-amber-300 hover:shadow-md transition-all group relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-amber-600" />
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-bold bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                  <Sparkles className="w-3 h-3" />
                  FREE TRIAL
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Pricebook</h3>
              <p className="text-sm text-slate-500">
                Standardized pricing catalog — consistent quotes, faster estimates
              </p>
            </div>
          )}

      {/* Company Contact */}
      {data.company && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Contact Us</h3>
          <p className="font-medium text-white">{data.company.name}</p>
          {data.company.phone && (
            <a href={`tel:${data.company.phone}`} className="flex items-center gap-1.5 text-sm text-blue-400 hover:underline mt-1.5">
              <Phone className="w-3.5 h-3.5" /> {data.company.phone}
            </a>
          )}
          {data.company.email && (
            <a href={`mailto:${data.company.email}`} className="flex items-center gap-1.5 text-sm text-blue-400 hover:underline mt-1">
              <Mail className="w-3.5 h-3.5" /> {data.company.email}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
