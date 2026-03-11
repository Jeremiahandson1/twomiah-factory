import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Calendar, CheckCircle, Loader2, ArrowRight } from 'lucide-react';
import portalApi from './portalApi';

export default function PortalAgreements() {
  const [agreements, setAgreements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi.get('/api/portal/agreements').then(setAgreements).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  const active = agreements.filter(a => a.status === 'active');
  const inactive = agreements.filter(a => a.status !== 'active');

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
      <h1 className="text-xl font-bold text-gray-900">Maintenance Plans</h1>

      {agreements.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No maintenance plans yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-6">Regular maintenance keeps your systems running efficiently</p>
          <Link
            to="/portal/service-request"
            className="inline-flex items-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Ask About Maintenance Plans
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <>
          {active.map(a => (
            <div key={a.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-lg">{a.name}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {a.billingFrequency === 'monthly' ? 'Monthly' : a.billingFrequency === 'annual' ? 'Annual' : a.billingFrequency}
                      {a.amount && ` — $${Number(a.amount).toLocaleString()}`}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-green-100 text-green-700 capitalize">
                    {a.status}
                  </span>
                </div>

                {/* Next Service */}
                {a.nextVisitDate && (
                  <div className="mt-4 flex items-center gap-3 bg-blue-50 rounded-lg px-4 py-3">
                    <Calendar className="w-5 h-5 text-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-blue-900">Next Scheduled Visit</p>
                      <p className="text-sm text-blue-700">
                        {new Date(a.nextVisitDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                )}

                {/* Details */}
                <div className="mt-4 space-y-2 text-sm">
                  {a.startDate && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Start Date</span>
                      <span className="text-gray-900">{new Date(a.startDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  {a.endDate && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Renewal Date</span>
                      <span className="text-gray-900">{new Date(a.endDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  {a.renewalType && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Renewal</span>
                      <span className="text-gray-900 capitalize">{a.renewalType}</span>
                    </div>
                  )}
                </div>

                {a.terms && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Included Services</p>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{a.terms}</p>
                  </div>
                )}
              </div>
            </div>
          ))}

          {inactive.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Past Plans</h2>
              {inactive.map(a => (
                <div key={a.id} className="bg-white rounded-xl p-4 shadow-sm opacity-60">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-gray-700">{a.name}</h3>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 capitalize">{a.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
