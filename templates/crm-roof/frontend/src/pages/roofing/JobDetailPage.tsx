import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, Phone, Mail, Upload, Plus, Send, Clock,
  User, Users, Ruler, Truck, Camera, FileText, MessageSquare, Activity,
  Receipt, Shield, Calendar, Home, AlertTriangle, CheckCircle,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

const STATUS_COLORS: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700',
  inspection_scheduled: 'bg-blue-100 text-blue-700',
  inspected: 'bg-indigo-100 text-indigo-700',
  measurement_ordered: 'bg-purple-100 text-purple-700',
  proposal_sent: 'bg-yellow-100 text-yellow-700',
  signed: 'bg-green-100 text-green-700',
  material_ordered: 'bg-orange-100 text-orange-700',
  in_production: 'bg-cyan-100 text-cyan-700',
  final_inspection: 'bg-teal-100 text-teal-700',
  invoiced: 'bg-pink-100 text-pink-700',
  collected: 'bg-emerald-100 text-emerald-700',
};

const JOB_TYPE_COLORS: Record<string, string> = {
  insurance: 'bg-orange-100 text-orange-700',
  retail: 'bg-blue-100 text-blue-700',
  commercial: 'bg-gray-100 text-gray-700',
  new_construction: 'bg-green-100 text-green-700',
  emergency: 'bg-red-100 text-red-700',
};

const PHOTO_TABS = ['before', 'damage', 'during', 'after'] as const;

const MEASUREMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  complete: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function formatStatus(status: string): string {
  return (status || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysSince(date: string): number {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [job, setJob] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [crews, setCrews] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [photoTab, setPhotoTab] = useState<string>('before');
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [uploading, setUploading] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const [jobRes, usersRes, crewsRes, timelineRes] = await Promise.all([
        fetch(`/api/jobs/${id}`, { headers }),
        fetch('/api/users', { headers }),
        fetch('/api/crews', { headers }),
        fetch(`/api/jobs/${id}/timeline`, { headers }).catch(() => null),
      ]);
      const jobData = await jobRes.json();
      const usersData = await usersRes.json();
      const crewsData = await crewsRes.json();
      const timelineData = timelineRes ? await timelineRes.json() : [];

      setJob(jobData);
      setUsers(Array.isArray(usersData) ? usersData : usersData.data || []);
      setCrews(Array.isArray(crewsData) ? crewsData : crewsData.data || []);
      setTimeline(Array.isArray(timelineData) ? timelineData : timelineData.data || []);
      setPhotos(jobData.photos || []);
      setNotes(jobData.notes || []);
      setQuotes(jobData.quotes || []);
      setInvoices(jobData.invoices || []);
    } catch {
      toast.error('Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    load();
  }, [load]);

  const advanceStage = async () => {
    setAdvancing(true);
    try {
      const res = await fetch(`/api/jobs/${id}/advance`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setJob((prev: any) => ({ ...prev, ...updated }));
      toast.success('Stage advanced');
    } catch {
      toast.error('Failed to advance stage');
    } finally {
      setAdvancing(false);
    }
  };

  const updateAssignment = async (field: string, value: string) => {
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value || null }),
      });
      if (!res.ok) throw new Error();
      setJob((prev: any) => ({ ...prev, [field]: value || null }));
      toast.success('Assignment updated');
    } catch {
      toast.error('Failed to update');
    }
  };

  const [measurement, setMeasurement] = useState<any>(null);

  // Load measurement report for this job
  useEffect(() => {
    if (!id || !token) return;
    fetch(`/api/measurements/job/${id}`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(d => setMeasurement(d))
      .catch(() => {});
  }, [id, token]);

  const orderMeasurement = async () => {
    if (!job) return;
    try {
      const res = await fetch('/api/measurements/order', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: id,
          address: job.propertyAddress || job.address,
          city: job.city,
          state: job.state,
          zip: job.zip,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Failed to order measurement');
        return;
      }
      toast.success('Measurement report ordered! Processing...');
      load();
      // Reload measurement
      const mRes = await fetch(`/api/measurements/job/${id}`, { headers });
      if (mRes.ok) setMeasurement(await mRes.json());
    } catch {
      toast.error('Failed to order measurement');
    }
  };

  const uploadPhotos = async (files: FileList) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('category', photoTab);
      Array.from(files).forEach((f) => formData.append('photos', f));
      const res = await fetch(`/api/jobs/${id}/photos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error();
      const newPhotos = await res.json();
      setPhotos((prev) => [...prev, ...(Array.isArray(newPhotos) ? newPhotos : [newPhotos])]);
      toast.success('Photos uploaded');
    } catch {
      toast.error('Failed to upload photos');
    } finally {
      setUploading(false);
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/jobs/${id}/notes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: noteText }),
      });
      if (!res.ok) throw new Error();
      const note = await res.json();
      setNotes((prev) => [...prev, note]);
      setNoteText('');
      toast.success('Note added');
    } catch {
      toast.error('Failed to add note');
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-6 text-center text-gray-500">Job not found</div>
    );
  }

  const daysOpen = daysSince(job.createdAt);
  const statusColor = STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-700';
  const typeColor = JOB_TYPE_COLORS[job.jobType] || 'bg-gray-100 text-gray-700';
  const filteredPhotos = photos.filter((p) => p.category === photoTab);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Bar */}
      <div className="bg-white border-b px-6 py-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900">
              {job.jobNumber || `ROOF-${String(job.id).padStart(4, '0')}`}
            </h1>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor}`}>
              {formatStatus(job.status)}
            </span>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${typeColor}`}>
              {(job.jobType || 'retail').replace('_', ' ')}
            </span>
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {daysOpen} days open
            </span>
          </div>
          <button
            onClick={advanceStage}
            disabled={advancing || job.status === 'collected'}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            <ChevronRight className="w-4 h-4" />
            {advancing ? 'Advancing...' : 'Advance Stage'}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Two column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Property */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <Home className="w-4 h-4 text-gray-400" /> Property
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Address</p>
                  <p className="font-medium text-gray-900">{job.address || job.propertyAddress || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500">Roof Age</p>
                  <p className="font-medium text-gray-900">{job.roofAge ? `${job.roofAge} years` : '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500">Roof Type</p>
                  <p className="font-medium text-gray-900">{job.roofType || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500">Stories</p>
                  <p className="font-medium text-gray-900">{job.stories || '—'}</p>
                </div>
              </div>
            </div>

            {/* Insurance Claim Link - ONLY for insurance jobs */}
            {job.jobType === 'insurance' && (
              <Link
                to={`/crm/jobs/${id}/insurance`}
                className="block bg-orange-50 rounded-xl shadow-sm border border-orange-200 p-4 hover:border-orange-400 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                      <Shield className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Insurance Claim</h2>
                      <p className="text-xs text-gray-500">View claim details, supplements, Xactimate export</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-orange-400" />
                </div>
              </Link>
            )}

            {/* Insurance Details - ONLY for insurance jobs */}
            {job.jobType === 'insurance' && (
              <div className="bg-white rounded-xl shadow-sm border border-yellow-300 p-6">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                  <Shield className="w-4 h-4 text-yellow-500" /> Insurance
                </h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Claim Number</p>
                    <p className="font-medium text-gray-900">{job.claimNumber || '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Insurance Company</p>
                    <p className="font-medium text-gray-900">{job.insuranceCompany || '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Adjuster Name</p>
                    <p className="font-medium text-gray-900">{job.adjusterName || '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Adjuster Phone</p>
                    <p className="font-medium text-gray-900">
                      {job.adjusterPhone ? (
                        <a href={`tel:${job.adjusterPhone}`} className="text-blue-600 hover:underline">{job.adjusterPhone}</a>
                      ) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Date of Loss</p>
                    <p className="font-medium text-gray-900">
                      {job.dateOfLoss ? new Date(job.dateOfLoss).toLocaleDateString() : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Deductible</p>
                    <p className="font-medium text-gray-900">
                      {job.deductible != null ? `$${Number(job.deductible).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">RCV</p>
                    <p className="font-medium text-gray-900">
                      {job.rcv != null ? `$${Number(job.rcv).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">ACV</p>
                    <p className="font-medium text-gray-900">
                      {job.acv != null ? `$${Number(job.acv).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                    </p>
                  </div>
                </div>
                {job.approvedScope !== undefined && (
                  <div className="mt-4">
                    <p className="text-gray-500 text-sm mb-1">Approved Scope</p>
                    <p className="text-sm text-gray-900 whitespace-pre-wrap bg-yellow-50 rounded-lg p-3 border border-yellow-200">
                      {job.approvedScope || 'Not yet defined'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Measurement */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <Ruler className="w-4 h-4 text-gray-400" /> Measurement
              </h2>
              {measurement ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${MEASUREMENT_STATUS_COLORS[measurement.status] || 'bg-gray-100 text-gray-700'}`}>
                      {formatStatus(measurement.status)}
                    </span>
                    {measurement.imageryQuality && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        measurement.imageryQuality === 'HIGH' ? 'bg-green-100 text-green-700' :
                        measurement.imageryQuality === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {measurement.imageryQuality}
                      </span>
                    )}
                  </div>
                  {measurement.status === 'complete' && (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-purple-50 rounded-lg p-2.5 text-center">
                          <p className="text-lg font-bold text-purple-700">{measurement.totalSquares}</p>
                          <p className="text-[10px] text-purple-600">Squares</p>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-2.5 text-center">
                          <p className="text-lg font-bold text-blue-700">{measurement.totalArea ? Number(measurement.totalArea).toLocaleString() : '—'}</p>
                          <p className="text-[10px] text-blue-600">Sqft</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                          <p className="text-lg font-bold text-gray-700">{Array.isArray(measurement.segments) ? measurement.segments.length : '—'}</p>
                          <p className="text-[10px] text-gray-600">Segments</p>
                        </div>
                      </div>
                      {Array.isArray(measurement.segments) && measurement.segments.length > 0 && (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-gray-500">
                              <th className="text-left pb-1 font-medium">Segment</th>
                              <th className="text-right pb-1 font-medium">Sqft</th>
                              <th className="text-right pb-1 font-medium">Pitch</th>
                            </tr>
                          </thead>
                          <tbody>
                            {measurement.segments.map((s: any, i: number) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-1 text-gray-900">{s.name}</td>
                                <td className="py-1 text-right text-gray-600">{Number(s.area).toLocaleString()}</td>
                                <td className="py-1 text-right text-gray-600">{s.pitch}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {job.totalSquares && (
                      <span className="text-sm text-gray-700">
                        <span className="font-semibold">{job.totalSquares}</span> total squares
                      </span>
                    )}
                    {!job.totalSquares && <p className="text-sm text-gray-400">No measurement report</p>}
                  </div>
                  <button
                    onClick={orderMeasurement}
                    className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  >
                    Order Report
                  </button>
                </div>
              )}
            </div>

            {/* Material Order */}
            {(job.materialOrder || job.materialOrders?.length > 0) && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                  <Truck className="w-4 h-4 text-gray-400" /> Material Order
                </h2>
                {(() => {
                  const order = job.materialOrder || job.materialOrders?.[0];
                  if (!order) return <p className="text-sm text-gray-500">No material orders yet</p>;
                  return (
                    <div>
                      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                        <div>
                          <p className="text-gray-500">Supplier</p>
                          <p className="font-medium">{order.supplier || '—'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Status</p>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                            order.status === 'ordered' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {formatStatus(order.status)}
                          </span>
                        </div>
                        <div>
                          <p className="text-gray-500">Delivery Date</p>
                          <p className="font-medium">{order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : '—'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Total Cost</p>
                          <p className="font-medium">
                            {order.totalCost != null ? `$${Number(order.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                          </p>
                        </div>
                      </div>
                      {order.lineItems?.length > 0 && (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-gray-500">
                              <th className="pb-2 font-medium">Item</th>
                              <th className="pb-2 font-medium">Qty</th>
                              <th className="pb-2 font-medium text-right">Cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {order.lineItems.map((li: any, i: number) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-2">{li.description}</td>
                                <td className="py-2">{li.quantity}</td>
                                <td className="py-2 text-right">${Number(li.cost || li.unitPrice || 0).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Photos */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <Camera className="w-4 h-4 text-gray-400" /> Photos
              </h2>
              <div className="flex items-center gap-1 mb-4 border-b">
                {PHOTO_TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setPhotoTab(tab)}
                    className={`px-3 py-2 text-sm font-medium border-b-2 capitalize ${
                      photoTab === tab
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
                {filteredPhotos.map((photo, i) => (
                  <div key={photo.id || i} className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                    <img
                      src={photo.url || photo.thumbnailUrl}
                      alt={photo.caption || `Photo ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
                {filteredPhotos.length === 0 && (
                  <p className="text-sm text-gray-400 col-span-full">No {photoTab} photos yet</p>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && uploadPhotos(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                <Upload className="w-4 h-4" />
                {uploading ? 'Uploading...' : 'Upload Photos'}
              </button>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <MessageSquare className="w-4 h-4 text-gray-400" /> Notes
              </h2>
              <div className="space-y-3 mb-4">
                {notes.length === 0 && <p className="text-sm text-gray-400">No notes yet</p>}
                {notes.map((note, i) => (
                  <div key={note.id || i} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm text-gray-900">{note.text || note.content}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                      {note.authorName && <span>{note.authorName}</span>}
                      {note.createdAt && <span>{new Date(note.createdAt).toLocaleString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addNote()}
                  placeholder="Add a note..."
                  className="flex-1 text-sm border rounded-lg px-3 py-2"
                />
                <button
                  onClick={addNote}
                  disabled={savingNote || !noteText.trim()}
                  className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingNote ? '...' : 'Add'}
                </button>
              </div>
            </div>

            {/* Timeline */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-gray-400" /> Timeline
              </h2>
              {timeline.length === 0 ? (
                <p className="text-sm text-gray-400">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {timeline.map((event, i) => (
                    <div key={event.id || i} className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-gray-900">{event.description || event.message}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {event.createdAt ? new Date(event.createdAt).toLocaleString() : ''}
                          {event.userName && ` — ${event.userName}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Contact */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-gray-400" /> Contact
              </h2>
              <p className="font-medium text-gray-900">
                {[job.contactFirstName || job.contact?.firstName, job.contactLastName || job.contact?.lastName].filter(Boolean).join(' ') || job.contactName || '—'}
              </p>
              {(job.contactPhone || job.contact?.phone) && (
                <a href={`tel:${job.contactPhone || job.contact?.phone}`} className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline mt-1.5">
                  <Phone className="w-3.5 h-3.5" /> {job.contactPhone || job.contact?.phone}
                </a>
              )}
              {(job.contactEmail || job.contact?.email) && (
                <a href={`mailto:${job.contactEmail || job.contact?.email}`} className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline mt-1">
                  <Mail className="w-3.5 h-3.5" /> {job.contactEmail || job.contact?.email}
                </a>
              )}
              {(job.leadSource || job.contact?.leadSource) && (
                <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {job.leadSource || job.contact?.leadSource}
                </span>
              )}
            </div>

            {/* Assignment */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-gray-400" /> Assignment
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Sales Rep</label>
                  <select
                    value={job.salesRepId || ''}
                    onChange={(e) => updateAssignment('salesRepId', e.target.value)}
                    className="w-full text-sm border rounded-lg px-3 py-2"
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name || u.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Crew</label>
                  <select
                    value={job.crewId || ''}
                    onChange={(e) => updateAssignment('crewId', e.target.value)}
                    className="w-full text-sm border rounded-lg px-3 py-2"
                  >
                    <option value="">Unassigned</option>
                    {crews.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Quotes */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <FileText className="w-4 h-4 text-gray-400" /> Quotes
              </h2>
              {quotes.length === 0 ? (
                <p className="text-sm text-gray-400">No quotes</p>
              ) : (
                <div className="space-y-2">
                  {quotes.map((q) => (
                    <Link
                      key={q.id}
                      to={`/crm/quotes/${q.id}`}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50"
                    >
                      <div>
                        <p className="text-sm font-medium">Quote #{q.quoteNumber || q.id}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          q.status === 'approved' ? 'bg-green-100 text-green-700' :
                          q.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                          q.status === 'declined' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {formatStatus(q.status)}
                        </span>
                      </div>
                      <span className="text-sm font-medium">
                        ${Number(q.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Invoice */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <Receipt className="w-4 h-4 text-gray-400" /> Invoice
              </h2>
              {invoices.length === 0 ? (
                <p className="text-sm text-gray-400">No invoices</p>
              ) : (
                <div className="space-y-2">
                  {invoices.map((inv) => (
                    <Link
                      key={inv.id}
                      to={`/crm/invoices/${inv.id}`}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50"
                    >
                      <div>
                        <p className="text-sm font-medium">Invoice #{inv.invoiceNumber || inv.id}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                          inv.status === 'overdue' ? 'bg-red-100 text-red-700' :
                          inv.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {formatStatus(inv.status)}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">${Number(inv.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        {inv.balance > 0 && (
                          <p className="text-xs text-red-600">Bal: ${Number(inv.balance).toFixed(2)}</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
