import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Shield, Wrench, Calendar, CheckCircle, AlertTriangle, X, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import portalApi from './portalApi';

const JOB_TYPE_LABELS: Record<string, string> = {
  install: 'Installation',
  repair: 'Repair',
  maintenance: 'Maintenance',
  emergency: 'Emergency',
};

export default function PortalEquipmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi.get(`/api/portal/equipment/${id}/history`)
      .then(setData)
      .catch(() => navigate('/portal/equipment'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  if (!data) return null;

  const eq = data.equipment;
  const warrantyActive = eq.warrantyExpiry ? new Date(eq.warrantyExpiry) > new Date() : null;

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/portal/equipment')} className="p-2 -ml-2 rounded-lg hover:bg-gray-100">
          <ChevronLeft className="w-6 h-6 text-gray-600" />
        </button>
        <h1 className="text-xl font-bold text-gray-900 truncate">{eq.name}</h1>
      </div>

      {/* Equipment Info Card */}
      <div className="bg-white rounded-xl p-5 shadow-sm">
        <div className="space-y-3">
          {(eq.manufacturer || eq.model) && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Model</p>
              <p className="font-medium text-gray-900">{[eq.manufacturer, eq.model].filter(Boolean).join(' ')}</p>
            </div>
          )}
          {eq.serialNumber && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Serial Number</p>
              <p className="font-mono text-gray-900">{eq.serialNumber}</p>
            </div>
          )}
          {eq.purchaseDate && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Install Date</p>
              <p className="text-gray-900">{new Date(eq.purchaseDate).toLocaleDateString()}</p>
            </div>
          )}
          {eq.location && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Location</p>
              <p className="text-gray-900">{eq.location}</p>
            </div>
          )}
        </div>

        {/* Warranty Badge */}
        {warrantyActive !== null && (
          <div className={`mt-4 flex items-center gap-2 px-3 py-2 rounded-lg ${warrantyActive ? 'bg-green-50' : 'bg-red-50'}`}>
            <Shield className={`w-4 h-4 ${warrantyActive ? 'text-green-600' : 'text-red-600'}`} />
            <span className={`text-sm font-medium ${warrantyActive ? 'text-green-700' : 'text-red-700'}`}>
              Warranty {warrantyActive ? 'active' : 'expired'}
              {eq.warrantyExpiry && ` — ${warrantyActive ? 'expires' : 'ended'} ${new Date(eq.warrantyExpiry).toLocaleDateString()}`}
            </span>
          </div>
        )}
      </div>

      {/* Service History */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Service History</h2>
        {data.history.length === 0 ? (
          <div className="bg-white rounded-xl p-6 shadow-sm text-center">
            <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500">No service visits yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.history.map((visit: any) => (
              <ServiceVisitCard key={visit.id} visit={visit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceVisitCard({ visit }: { visit: any }) {
  const [showChecklist, setShowChecklist] = useState(false);
  const checklist = visit.checklist?.[0];
  const items = checklist?.items || [];
  const flaggedCount = items.filter((i: any) => i.status !== 'pass').length;

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium text-gray-900">{visit.title}</p>
            <div className="flex items-center gap-2 mt-1 text-sm">
              <span className="text-gray-500">
                {visit.completedAt
                  ? new Date(visit.completedAt).toLocaleDateString()
                  : visit.scheduledDate
                    ? new Date(visit.scheduledDate).toLocaleDateString()
                    : ''}
              </span>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 capitalize">
                {JOB_TYPE_LABELS[visit.jobType] || visit.jobType}
              </span>
            </div>
          </div>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${visit.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
            {visit.status === 'completed' ? 'Completed' : 'Scheduled'}
          </span>
        </div>

        {visit.techName && (
          <p className="text-sm text-gray-500 mt-2">Technician: {visit.techName}</p>
        )}
        {visit.notes && (
          <p className="text-sm text-gray-600 mt-2">{visit.notes}</p>
        )}
      </div>

      {/* Inspection Checklist Summary */}
      {checklist && (
        <div className="border-t">
          <button
            onClick={() => setShowChecklist(!showChecklist)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-gray-700">
                All systems checked
                {flaggedCount > 0 && ` — ${flaggedCount} item${flaggedCount > 1 ? 's' : ''} flagged`}
              </span>
            </div>
            {showChecklist ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showChecklist && (
            <div className="px-4 pb-3 space-y-2">
              {items.map((item: any) => (
                <div key={item.id} className="flex items-start gap-2 text-sm">
                  {item.status === 'pass' && <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />}
                  {item.status === 'fail' && <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />}
                  {item.status === 'attention' && <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />}
                  <div>
                    <span className="text-gray-700">{item.label}</span>
                    {item.notes && <p className="text-xs text-gray-400 mt-0.5">{item.notes}</p>}
                  </div>
                </div>
              ))}
              {checklist.overallNotes && (
                <p className="text-xs text-gray-500 mt-2 pt-2 border-t">{checklist.overallNotes}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
