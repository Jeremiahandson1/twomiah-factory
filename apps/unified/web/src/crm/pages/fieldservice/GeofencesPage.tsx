// Moved from templates/crm-fieldservice/frontend/src/pages/settings/GeofencesPage.tsx.
import { useState, useEffect } from 'react'
import { 
  MapPin, Plus, Edit2, Trash2, Loader2, Target, 
  Navigation, Settings, CheckCircle, XCircle, Users, ExternalLink
} from 'lucide-react';
import type { FormEvent } from 'react'
import { api } from '../../../api'
import { useMayWrite, useKnownPermission, useToast, useConfirm } from '../../../shared'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'

/** The server's own words when it refused (the API client puts its `error` on `.message`), else the fallback. */
const serverMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** A row of GET /api/geofencing (server/crm/field/geofencingService.ts getGeofences): the fence and its job/project. */
interface Geofence {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  address?: string | null;
  active: boolean;
  jobId?: string | null;
  projectId?: string | null;
  job?: { id: string; title: string; number: string } | null;
  project?: { id: string; name: string; number?: string | null } | null;
}

/** What the form sends: POST /api/geofencing reads all of it; PUT /:id reads name, lat, lng, radius and active. */
interface GeofenceInput {
  name: string;
  lat: number;
  lng: number;
  radius: number;
  address: string;
  jobId: string | null;
}

/** A row of GET /api/jobs, for the job picker. */
interface JobOption {
  id: string;
  title: string;
  number: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

type Filter = 'active' | 'all' | 'false';

/**
 * Geofence Management Page
 *
 * Admin page to manage job site geofences
 */
export default function GeofencesPage() {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Geofence | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  // Adding, editing, switching off and deleting a fence are settings:update on the server (geofencing.ts); the
  // controls ask the same question, so a seat that would be refused is not offered them.
  const mayManage = useMayWrite('settings:update');
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    loadGeofences();
  }, [filter]);

  const loadGeofences = async () => {
    setLoading(true);
    try {
      // A list ({ data, pagination }) — the template's route answered a bare array.
      const res = await api.get('/api/geofencing', { active: filter });
      setGeofences(Array.isArray(res?.data) ? (res.data as Geofence[]) : []);
    } catch (error) {
      console.error('Failed to load geofences:', error);
      toast.error(serverMessage(error, 'Failed to load geofences'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm('Team members are no longer clocked in or out automatically at this site.', { title: 'Delete this geofence?', confirmText: 'Delete geofence' }))) return;
    try {
      await api.delete(`/api/geofencing/${id}`);
      toast.success('Geofence deleted');
      loadGeofences();
    } catch (error) {
      toast.error(serverMessage(error, 'Failed to delete geofence'));
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    try {
      await api.put(`/api/geofencing/${id}`, { active: !active });
      loadGeofences();
    } catch (error) {
      toast.error(serverMessage(error, 'Failed to update geofence'));
    }
  };

  const handleSave = async (data: GeofenceInput) => {
    try {
      if (editing) {
        await api.put(`/api/geofencing/${editing.id}`, data);
      } else {
        await api.post('/api/geofencing', data);
      }
      setShowForm(false);
      setEditing(null);
      loadGeofences();
    } catch (error) {
      toast.error(serverMessage(error, 'Failed to save geofence'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Service Site Geofences</h1>
          <p className="text-gray-500 dark:text-slate-400">Manage auto clock-in zones for job sites</p>
        </div>
        {mayManage && <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          Add Geofence
        </button>}
      </div>

      {/* Info Card */}
      <div className="bg-blue-50 rounded-xl p-4 dark:bg-blue-950/40">
        <h3 className="font-medium text-blue-900 mb-2 dark:text-blue-300">How Geofencing Works</h3>
        <p className="text-sm text-blue-700 dark:text-blue-300">
          Each team member chooses in their phone app whether to share their location while working, and whether to be
          clocked in and out automatically. Someone who turned auto clock on is clocked in to the job when they enter its
          geofence and out when they leave, and their phone tells them it happened.
        </p>
      </div>

      <CrewLocations />

      {/* Filters */}
      <div className="flex gap-2">
        {(['active', 'all', 'false'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm ${
              filter === f
                ? 'bg-orange-100 text-orange-700 dark:text-orange-200 dark:bg-orange-950/40'
                : 'text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {f === 'active' ? 'Active' : f === 'all' ? 'All' : 'Inactive'}
          </button>
        ))}
      </div>

      {/* Geofences List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : geofences.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl dark:bg-slate-900">
          <Target className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500 dark:text-slate-400">No geofences found</p>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Add geofences to enable auto clock-in at job sites
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {geofences.map((geofence) => (
            <GeofenceCard
              key={geofence.id}
              geofence={geofence}
              mayManage={mayManage}
              onEdit={() => { setEditing(geofence); setShowForm(true); }}
              onDelete={() => handleDelete(geofence.id)}
              onToggle={() => handleToggle(geofence.id, geofence.active)}
            />
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <GeofenceFormModal
          geofence={editing}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function GeofenceCard({ geofence, mayManage, onEdit, onDelete, onToggle }: {
  geofence: Geofence;
  mayManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-700 p-4${!geofence.active ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            geofence.active ? 'bg-green-100 dark:bg-green-950/40 dark:text-slate-100' : 'bg-gray-100 dark:bg-slate-800 dark:text-slate-100'
          }`}>
            <Target className={`w-5 h-5 ${geofence.active ? 'text-green-700 dark:text-green-300' : 'text-gray-400'}`} />
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-slate-100">{geofence.name}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">{geofence.radius}m radius</p>
          </div>
        </div>
        {mayManage ? (
          <button
            onClick={onToggle}
            className={`p-1 rounded ${geofence.active ? 'text-green-700 dark:text-green-300' : 'text-gray-400'}`}
            title={geofence.active ? 'Disable' : 'Enable'}
          >
            {geofence.active ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          </button>
        ) : (
          <span className={`p-1 ${geofence.active ? 'text-green-700 dark:text-green-300' : 'text-gray-400'}`} title={geofence.active ? 'Active' : 'Inactive'}>
            {geofence.active ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          </span>
        )}
      </div>

      {/* Location */}
      <div className="text-sm text-gray-500 mb-3 dark:text-slate-400">
        <div className="flex items-center gap-1">
          <MapPin className="w-4 h-4" />
          {geofence.address || `${geofence.lat.toFixed(4)}, ${geofence.lng.toFixed(4)}`}
        </div>
      </div>

      {/* Associated Job/Project */}
      {(geofence.job || geofence.project) && (
        <div className="text-sm mb-3">
          {geofence.job && (
            <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs mr-2 dark:text-blue-300 dark:bg-blue-950/40">
              Job: {geofence.job.title}
            </span>
          )}
          {geofence.project && (
            <span className="inline-block px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs dark:text-purple-300 dark:bg-purple-950/40">
              Project: {geofence.project.name}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      {mayManage && <div className="flex gap-2 pt-3 border-t dark:border-slate-700">
        <button
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg dark:text-slate-400"
        >
          <Edit2 className="w-4 h-4" />
          Edit
        </button>
        <button
          onClick={onDelete}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>}
    </div>
  );
}

function GeofenceFormModal({ geofence, onSave, onClose }: {
  geofence: Geofence | null;
  onSave: (data: GeofenceInput) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  // Coordinates and radius are held as the inputs' text and parsed on submit.
  const [form, setForm] = useState({
    name: geofence?.name || '',
    lat: geofence?.lat != null ? String(geofence.lat) : '',
    lng: geofence?.lng != null ? String(geofence.lng) : '',
    radius: String(geofence?.radius || 100),
    address: geofence?.address || '',
    jobId: geofence?.jobId || '',
  });
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [gettingLocation, setGettingLocation] = useState(false);

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      // Jobs only. This used to Promise.all a /api/projects fetch alongside it — `projects` is the
      // construction module and is not offered on this template, so once it was gated that rejection
      // would have taken the JOBS list down with it and left the picker permanently empty. (T18 M6)
      const jobsRes = await api.get('/api/jobs?status=scheduled&limit=100');
      setJobs(Array.isArray(jobsRes?.data) ? (jobsRes.data as JobOption[]) : []);
    } catch (error) {
      console.error('Failed to load options:', error);
    }
  };

  const getCurrentLocation = () => {
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm({
          ...form,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        });
        setGettingLocation(false);
      },
      (err) => {
        toast.error('Could not get location: ' + err.message);
        setGettingLocation(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleJobSelect = async (jobId: string) => {
    setForm({ ...form, jobId });
    
    if (jobId) {
      const job = jobs.find(j => j.id === jobId);
      if (job) {
        setForm(f => ({
          ...f,
          jobId,
          name: f.name || job.title,
          address: f.address || job.address || '',
          lat: job.lat != null ? String(job.lat) : f.lat,
          lng: job.lng != null ? String(job.lng) : f.lng,
        }));
      }
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.lat || !form.lng) {
      toast.error('Location coordinates are required');
      return;
    }
    onSave({
      ...form,
      lat: parseFloat(form.lat),
      lng: parseFloat(form.lng),
      radius: parseInt(form.radius, 10),
      jobId: form.jobId || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <h2 className="text-lg font-bold text-gray-900 mb-4 dark:text-slate-100">
            {geofence ? 'Edit Geofence' : 'Add Geofence'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="label">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input"
                placeholder="Job Site Name"
                required
              />
            </div>

            {/* Link to Job */}
            <div>
              <label className="label">Link to Job (optional)</label>
              <select
                value={form.jobId}
                onChange={(e) => handleJobSelect(e.target.value)}
                className="input"
              >
                <option value="">No job</option>
                {jobs.map(job => (
                  <option key={job.id} value={job.id}>{job.title} ({job.number})</option>
                ))}
              </select>
            </div>

            {/* No project picker: `projects` is the CONSTRUCTION module (draw schedules, AIA pay
                applications, lien waivers) and the registry offers it to `crm` only. Field service
                models the same work as a JOB, which the picker above already links. This dropdown
                was contractor residue and fetched /api/projects, which is gated now. (T18 M6) */}

            {/* Address */}
            <div>
              <label className="label">Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="input"
                placeholder="123 Main St, City, ST"
              />
            </div>

            {/* Coordinates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                  className="input"
                  placeholder="41.8781"
                  required
                />
              </div>
              <div>
                <label className="label">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={form.lng}
                  onChange={(e) => setForm({ ...form, lng: e.target.value })}
                  className="input"
                  placeholder="-87.6298"
                  required
                />
              </div>
            </div>

            {/* Get Current Location Button */}
            <button
              type="button"
              onClick={getCurrentLocation}
              disabled={gettingLocation}
              className="flex items-center gap-2 px-4 py-2 text-sm text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/40 rounded-lg dark:text-orange-200"
            >
              {gettingLocation ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Navigation className="w-4 h-4" />
              )}
              Use Current Location
            </button>

            {/* Radius */}
            <div>
              <label className="label">
                Radius: {form.radius}m
              </label>
              <input
                type="range"
                min="25"
                max="500"
                step="25"
                value={form.radius}
                onChange={(e) => setForm({ ...form, radius: e.target.value })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400">
                <span>25m (small site)</span>
                <span>500m (large site)</span>
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
              >
                {geofence ? 'Save Changes' : 'Create Geofence'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

type CrewMember = { userId: string; name: string; role: string; lat: number | null; lng: number | null; accuracy: number | null; seenAt: string | null; onTheClock: boolean }

/** "5 min ago", "2 h ago", or the date — how long since the phone last reported. */
function ago(iso: string | null): string {
  if (!iso) return 'No location yet'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`
  return momentDate(iso)
}

/**
 * Where's the crew (GET /api/geofencing/crew, team:read): everyone sharing their location from the phone app — their own
 * switch — with when it last reported, whether they're on the clock, and a link that opens the spot in a map.
 */
function CrewLocations() {
  const mayRead = useKnownPermission('team:read')
  const [crew, setCrew] = useState<CrewMember[] | null>(null)
  useEffect(() => {
    if (!mayRead) return
    let gone = false
    const load = () => api.get('/api/geofencing/crew').then((r: any) => { if (!gone) setCrew(Array.isArray(r?.data) ? r.data : []) }).catch(() => { if (!gone) setCrew([]) })
    load()
    const iv = setInterval(load, 60_000)
    return () => { gone = true; clearInterval(iv) }
  }, [mayRead])
  if (!mayRead) return null
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 dark:bg-slate-900 dark:border-slate-700">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-5 h-5 text-gray-700 dark:text-slate-300" />
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Where's the crew</h2>
      </div>
      {crew === null ? (
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      ) : crew.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-slate-400">Nobody is sharing their location. Each person turns it on in the phone app (Alerts › Location).</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {crew.map((m) => (
            <li key={m.userId} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate dark:text-slate-100">{m.name}</p>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  {ago(m.seenAt)}{m.onTheClock ? ' · on the clock' : ''}
                </p>
              </div>
              {m.lat != null && m.lng != null && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-orange-700 hover:underline shrink-0 dark:text-orange-300">
                  <MapPin className="w-4 h-4" /> Map <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
