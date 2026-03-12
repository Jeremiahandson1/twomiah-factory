import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Filter, GripVertical, User, Users, Ruler, Clock, DollarSign, AlertTriangle, MapPin, Zap } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

const STAGES = [
  'lead',
  'inspection_scheduled',
  'inspected',
  'measurement_ordered',
  'proposal_sent',
  'signed',
  'material_ordered',
  'in_production',
  'final_inspection',
  'invoiced',
  'collected',
];

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  inspection_scheduled: 'Inspection Scheduled',
  inspected: 'Inspected',
  measurement_ordered: 'Measurement Ordered',
  proposal_sent: 'Proposal Sent',
  signed: 'Signed',
  material_ordered: 'Material Ordered',
  in_production: 'In Production',
  final_inspection: 'Final Inspection',
  invoiced: 'Invoiced',
  collected: 'Collected',
};

const STAGE_THRESHOLDS: Record<string, number> = {
  proposal_sent: 7,
  signed: 3,
  material_ordered: 5,
};

const JOB_TYPE_COLORS: Record<string, string> = {
  insurance: 'bg-orange-100 text-orange-700',
  retail: 'bg-blue-100 text-blue-700',
  commercial: 'bg-gray-100 text-gray-700',
  new_construction: 'bg-green-100 text-green-700',
  emergency: 'bg-red-100 text-red-700',
};

function daysInStage(job: any): number {
  const stageDate = job.stageEnteredAt || job.updatedAt || job.createdAt;
  if (!stageDate) return 0;
  const diff = Date.now() - new Date(stageDate).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getInitials(name: string): string {
  if (!name) return '';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function PipelineBoard() {
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [crews, setCrews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterRep, setFilterRep] = useState('');
  const [filterCrew, setFilterCrew] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterCanvassing, setFilterCanvassing] = useState(false);

  const [dragJobId, setDragJobId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [jobsRes, usersRes, crewsRes] = await Promise.all([
        fetch('/api/jobs?limit=500', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/crews', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const jobsData = await jobsRes.json();
      const usersData = await usersRes.json();
      const crewsData = await crewsRes.json();
      setJobs(Array.isArray(jobsData) ? jobsData : jobsData.data || []);
      setUsers(Array.isArray(usersData) ? usersData : usersData.data || []);
      setCrews(Array.isArray(crewsData) ? crewsData : crewsData.data || []);
    } catch {
      toast.error('Failed to load pipeline data');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredJobs = jobs.filter((j) => {
    if (filterRep && j.salesRepId !== filterRep) return false;
    if (filterCrew && j.crewId !== filterCrew) return false;
    if (filterType && j.jobType !== filterType) return false;
    if (filterPriority && j.priority !== filterPriority) return false;
    if (filterCanvassing && j.source !== 'canvassing') return false;
    return true;
  });

  const grouped: Record<string, any[]> = {};
  STAGES.forEach((s) => (grouped[s] = []));
  filteredJobs.forEach((j) => {
    const stage = j.status || 'lead';
    if (grouped[stage]) grouped[stage].push(j);
    else grouped['lead'].push(j);
  });

  const handleDragStart = (e: React.DragEvent, jobId: string) => {
    setDragJobId(jobId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', jobId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    const jobId = e.dataTransfer.getData('text/plain') || dragJobId;
    if (!jobId) return;
    setDragJobId(null);

    const job = jobs.find((j) => String(j.id) === String(jobId));
    if (!job || job.status === targetStage) return;

    // Optimistic update
    setJobs((prev) =>
      prev.map((j) => (String(j.id) === String(jobId) ? { ...j, status: targetStage, stageEnteredAt: new Date().toISOString() } : j))
    );

    try {
      const res = await fetch(`/api/jobs/${jobId}/advance`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStage }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Moved to ${STAGE_LABELS[targetStage]}`);
    } catch {
      toast.error('Failed to advance job');
      load();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const repMap: Record<string, string> = {};
  users.forEach((u: any) => (repMap[u.id] = u.name || u.email));
  const crewMap: Record<string, string> = {};
  crews.forEach((c: any) => (crewMap[c.id] = c.name));

  return (
    <div className="h-full flex flex-col">
      {/* Filter Bar */}
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b flex-shrink-0 overflow-x-auto">
        <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <select
          value={filterRep}
          onChange={(e) => setFilterRep(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="">All Sales Reps</option>
          {users.map((u: any) => (
            <option key={u.id} value={u.id}>{u.name || u.email}</option>
          ))}
        </select>
        <select
          value={filterCrew}
          onChange={(e) => setFilterCrew(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="">All Crews</option>
          {crews.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="">All Types</option>
          <option value="insurance">Insurance</option>
          <option value="retail">Retail</option>
          <option value="commercial">Commercial</option>
          <option value="new_construction">New Construction</option>
          <option value="emergency">Emergency</option>
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="">All Priorities</option>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <button
          onClick={() => setFilterCanvassing(!filterCanvassing)}
          className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border font-medium transition ${
            filterCanvassing ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          Canvassing
        </button>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 p-4 h-full" style={{ minWidth: STAGES.length * 280 }}>
          {STAGES.map((stage) => {
            const stageJobs = grouped[stage] || [];
            return (
              <div
                key={stage}
                className="flex flex-col bg-gray-100 rounded-xl min-w-[260px] w-[260px] flex-shrink-0"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                {/* Column Header */}
                <div className="px-3 py-3 flex items-center justify-between flex-shrink-0">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider truncate">
                    {STAGE_LABELS[stage]}
                  </h3>
                  <span className="text-xs font-bold bg-gray-200 text-gray-600 rounded-full px-2 py-0.5 ml-2 flex-shrink-0">
                    {stageJobs.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                  {stageJobs.map((job) => {
                    const days = daysInStage(job);
                    const threshold = STAGE_THRESHOLDS[stage];
                    const overdue = threshold && days > threshold;
                    const typeColor = JOB_TYPE_COLORS[job.jobType] || 'bg-gray-100 text-gray-700';

                    return (
                      <div
                        key={job.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, String(job.id))}
                        onClick={() => navigate(`/crm/jobs/${job.id}`)}
                        className="bg-white rounded-lg p-3 shadow-sm border border-gray-200 cursor-pointer hover:shadow-md transition-shadow group"
                      >
                        <div className="flex items-start justify-between mb-1.5">
                          <span className="text-xs font-mono font-semibold text-gray-500">
                            {job.jobNumber || `ROOF-${String(job.id).padStart(4, '0')}`}
                          </span>
                          <GripVertical className="w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>

                        {job.contactName && (
                          <p className="text-sm font-medium text-gray-900 truncate">{job.contactName}</p>
                        )}
                        {(job.address || job.propertyAddress) && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {(job.address || job.propertyAddress || '').slice(0, 40)}
                          </p>
                        )}

                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {job.jobType === 'insurance' ? (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                              INS
                            </span>
                          ) : (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${typeColor}`}>
                              {(job.jobType || 'retail').replace('_', ' ')}
                            </span>
                          )}

                          {/* Insurance claim status dot */}
                          {job.jobType === 'insurance' && job.claimStatus && (
                            <span className={`w-2 h-2 rounded-full ${
                              job.claimStatus === 'approved' || job.claimStatus === 'closed' ? 'bg-green-500' :
                              job.claimStatus === 'denied' ? 'bg-red-500' :
                              job.claimStatus === 'filed' ? 'bg-gray-400' :
                              'bg-yellow-500'
                            }`} title={`Claim: ${job.claimStatus}`} />
                          )}

                          {job.salesRepId && repMap[job.salesRepId] && (
                            <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
                              <User className="w-3 h-3" />
                              {getInitials(repMap[job.salesRepId])}
                            </span>
                          )}

                          {job.crewId && crewMap[job.crewId] && (
                            <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
                              <Users className="w-3 h-3" />
                              {crewMap[job.crewId]}
                            </span>
                          )}

                          {job.totalSquares && (
                            <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
                              <Ruler className="w-3 h-3" />
                              {job.totalSquares} sq
                            </span>
                          )}

                          {job.source === 'canvassing' && (
                            <span className="flex items-center gap-0.5 text-[10px] text-blue-600 font-medium">
                              <MapPin className="w-3 h-3" />
                              canvass
                            </span>
                          )}

                          {job.source === 'storm' && (
                            <span className="flex items-center gap-0.5 text-[10px] text-amber-600 font-medium">
                              <Zap className="w-3 h-3" />
                              storm
                            </span>
                          )}
                        </div>

                        {/* Canvassing storm event name from notes */}
                        {job.source === 'canvassing' && job.notes && job.notes.startsWith('Canvassing lead') && (
                          <p className="text-[10px] text-blue-500 truncate mt-0.5">
                            {job.notes.split('—')[1]?.trim() || ''}
                          </p>
                        )}

                        {/* Insurance-specific: RCV + days since loss */}
                        {job.jobType === 'insurance' && (
                          <div className="flex items-center gap-2 mt-1">
                            {job.rcv && (
                              <span className="flex items-center gap-0.5 text-[10px] text-green-700 font-medium">
                                <DollarSign className="w-3 h-3" />
                                {Number(job.rcv).toLocaleString()} RCV
                              </span>
                            )}
                            {job.dateOfLoss && (() => {
                              const daysSinceLoss = Math.floor((Date.now() - new Date(job.dateOfLoss).getTime()) / (1000 * 60 * 60 * 24));
                              return daysSinceLoss > 45 ? (
                                <span className="flex items-center gap-0.5 text-[10px] text-red-600 font-semibold">
                                  <AlertTriangle className="w-3 h-3" />
                                  {daysSinceLoss}d loss
                                </span>
                              ) : null;
                            })()}
                          </div>
                        )}

                        <div className="flex items-center gap-1 mt-1.5">
                          <Clock className="w-3 h-3 text-gray-400" />
                          <span className={`text-[10px] ${overdue ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                            {days}d in stage
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
