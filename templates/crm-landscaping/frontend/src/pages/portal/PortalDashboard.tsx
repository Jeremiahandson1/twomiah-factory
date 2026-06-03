import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, Calendar, Receipt, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import portalApi from './portalApi';

export default function PortalDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const [profile, equipmentList, agreements, invoices] = await Promise.all([
        portalApi.get('/api/portal/me'),
        portalApi.get('/api/portal/equipment'),
        portalApi.get('/api/portal/agreements'),
        portalApi.get('/api/portal/invoices'),
      ]);

      const unpaidInvoices = invoices.filter((i: any) => ['sent', 'partial', 'overdue'].includes(i.status));
      const unpaidTotal = unpaidInvoices.reduce((sum: number, i: any) => sum + (Number(i.total) - Number(i.amountPaid)), 0);

      // Find next scheduled service from agreements
      const nextVisit = agreements
        .filter((a: any) => a.nextVisitDate)
        .sort((a: any, b: any) => new Date(a.nextVisitDate).getTime() - new Date(b.nextVisitDate).getTime())[0];

      setData({
        contact: profile.contact,
        company: profile.company,
        equipmentCount: equipmentList.length,
        unpaidCount: unpaidInvoices.length,
        unpaidTotal,
        nextVisitDate: nextVisit?.nextVisitDate || null,
        agreementCount: agreements.filter((a: any) => a.status === 'active').length,
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

  const firstName = data.contact?.name?.split(' ')[0] || 'there';

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Welcome back, {firstName}</h1>
        <p className="text-gray-500 text-sm mt-0.5">Here's an overview of your account</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/portal/equipment" className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
          <Wrench className="w-6 h-6 text-blue-500 mb-2" />
          <p className="text-2xl font-bold text-gray-900">{data.equipmentCount}</p>
          <p className="text-sm text-gray-500">Equipment Units</p>
        </Link>

        <Link to="/portal/agreements" className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
          <Calendar className="w-6 h-6 text-green-500 mb-2" />
          {data.nextVisitDate ? (
            <>
              <p className="text-lg font-bold text-gray-900">{new Date(data.nextVisitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
              <p className="text-sm text-gray-500">Next Service</p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-gray-900">{data.agreementCount}</p>
              <p className="text-sm text-gray-500">Active Plans</p>
            </>
          )}
        </Link>
      </div>

      {/* Unpaid Invoices Alert */}
      {data.unpaidCount > 0 && (
        <Link to="/portal/invoices" className="block bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Receipt className="w-5 h-5 text-orange-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-orange-900">
                {data.unpaidCount} unpaid invoice{data.unpaidCount > 1 ? 's' : ''}
              </p>
              <p className="text-sm text-orange-700">${data.unpaidTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
            <ArrowRight className="w-5 h-5 text-orange-400" />
          </div>
        </Link>
      )}

      {/* Request Service */}
      <Link
        to="/portal/service-request"
        className="block w-full py-4 bg-blue-600 text-white text-center rounded-xl font-semibold text-base hover:bg-blue-700 transition-colors"
      >
        Request Service
      </Link>

      {/* Company Contact */}
      {data.company && (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Contact Us</h3>
          <p className="font-medium text-gray-900">{data.company.name}</p>
          {data.company.phone && (
            <a href={`tel:${data.company.phone}`} className="text-sm text-blue-600 hover:underline block mt-1">{data.company.phone}</a>
          )}
          {data.company.email && (
            <a href={`mailto:${data.company.email}`} className="text-sm text-blue-600 hover:underline block mt-0.5">{data.company.email}</a>
          )}
        </div>
      )}
    </div>
  );
}
