import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Home, Camera, Loader2, CheckCircle } from 'lucide-react';
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

const STAGE_ORDER = [
  'lead', 'inspection_scheduled', 'inspected', 'measurement_ordered', 'proposal_sent',
  'signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected',
];

const STAGE_SHORT: Record<string, string> = {
  lead: 'Lead',
  inspection_scheduled: 'Inspection',
  inspected: 'Inspected',
  measurement_ordered: 'Measure',
  proposal_sent: 'Proposal',
  signed: 'Signed',
  material_ordered: 'Materials',
  in_production: 'Install',
  final_inspection: 'Final',
  invoiced: 'Invoiced',
  collected: 'Done',
};

export default function PortalJobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadJob();
  }, [id]);

  const loadJob = async () => {
    try {
      const res = await fetch(`/api/portal/jobs/${id}`, { headers: portalHeaders() });
      const data = await res.json();
      setJob(data);
    } catch (err) {
      console.error('Failed to load job:', err);
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

  if (!job) {
    return <div className="text-center py-20 text-gray-400">Job not found</div>;
  }

  const currentStageIdx = STAGE_ORDER.indexOf(job.status);
  const beforePhotos = (job.photos || []).filter((p: any) => p.category === 'before');
  const afterPhotos = (job.photos || []).filter((p: any) => p.category === 'after');

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
      <Link to="/portal/jobs" className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-300">
        <ArrowLeft className="w-4 h-4" /> Back to Jobs
      </Link>

      {/* Header */}
      <div>
        <p className="text-xs font-mono text-gray-500">
          {job.jobNumber || `ROOF-${String(job.id).padStart(4, '0')}`}
        </p>
        <h1 className="text-xl font-bold text-white mt-1">
          {STATUS_DESCRIPTIONS[job.status] || 'In progress'}
        </h1>
      </div>

      {/* Progress Bar */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Progress</h3>
        <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
          {STAGE_ORDER.map((stage, idx) => {
            const isComplete = idx <= currentStageIdx;
            const isCurrent = idx === currentStageIdx;
            return (
              <div key={stage} className="flex items-center flex-shrink-0">
                <div className={`flex flex-col items-center ${isCurrent ? 'scale-110' : ''}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold ${
                    isComplete ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-500'
                  }`}>
                    {isComplete ? <CheckCircle className="w-3.5 h-3.5" /> : idx + 1}
                  </div>
                  <span className={`text-[8px] mt-1 w-12 text-center leading-tight ${
                    isCurrent ? 'text-blue-400 font-semibold' : isComplete ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {STAGE_SHORT[stage]}
                  </span>
                </div>
                {idx < STAGE_ORDER.length - 1 && (
                  <div className={`w-3 h-0.5 mx-0.5 ${idx < currentStageIdx ? 'bg-blue-600' : 'bg-gray-700'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Property */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Home className="w-3.5 h-3.5" /> Property
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {job.address && (
            <div className="col-span-2">
              <p className="text-gray-500 text-xs">Address</p>
              <p className="text-white">{job.address}</p>
            </div>
          )}
          {job.roofType && (
            <div>
              <p className="text-gray-500 text-xs">Roof Type</p>
              <p className="text-white">{job.roofType}</p>
            </div>
          )}
          {job.stories && (
            <div>
              <p className="text-gray-500 text-xs">Stories</p>
              <p className="text-white">{job.stories}</p>
            </div>
          )}
          {job.totalSquares && (
            <div>
              <p className="text-gray-500 text-xs">Total Squares</p>
              <p className="text-white">{job.totalSquares}</p>
            </div>
          )}
        </div>
      </div>

      {/* Before Photos */}
      {beforePhotos.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5" /> Before Photos
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {beforePhotos.map((photo: any, i: number) => (
              <div key={photo.id || i} className="aspect-square rounded-lg overflow-hidden bg-gray-700">
                <img src={photo.url || photo.thumbnailUrl} alt={`Before ${i + 1}`} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* After Photos */}
      {afterPhotos.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5" /> After Photos
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {afterPhotos.map((photo: any, i: number) => (
              <div key={photo.id || i} className="aspect-square rounded-lg overflow-hidden bg-gray-700">
                <img src={photo.url || photo.thumbnailUrl} alt={`After ${i + 1}`} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
