import { useState, useEffect } from 'react';
import { 
  MapPin, Plus, Edit2, Trash2, Loader2, Target, 
  Navigation, Settings, CheckCircle, XCircle
} from 'lucide-react';
import api from '../../services/api';

/**
 * Geofence Management Page
 * 
 * Admin page to manage job site geofences
 */
export default function GeofencesPage() {
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('active');

  useEffect(() => {
    loadGeofences();
  }, [filter]);

  const loadGeofences = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/geofencing?active=${filter}`);
      setGeofences(data);
    } catch (error) {
      console.error('Failed to load geofences:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this geofence?')) return;
    try {
      await api.delete(`/api/geofencing/${id}`);
      loadGeofences();
    } catch (error) {
      alert('Failed to delete geofence');
    }
  };

  const handleToggle = async (id, active) => {
    try {
      await api.put(`/api/geofencing/${id}`, { active: !active });
      loadGeofences();
    } catch (error) {
      alert('Failed to update geofence');
    }
  };

  const handleSave = async (data) => {
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
      alert('Failed to save geofence');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Site Geofences</h1>
          <p className="text-gray-500">Manage auto clock-in zones for job sites</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          Add Geofence
        </button>
      </div>

      {/* Info Card */}
      <div className="bg-blue-50 rounded-xl p-4">
        <h3 className="font-medium text-blue-900 mb-2">How Geofencing Works</h3>
        <p className="text-sm text-blue-700">
          When team members enter a geofenced area, they're automatically clocked in to the associated job.
          When they leave, they're automatically clocked out. This creates accurate timesheets without manual entry.
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['active', 'all', 'false'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm ${
              filter === f
                ? 'bg-orange-100 text-orange-700'
                : 'text-gray-600 hover:bg-gray-100'
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
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <Target className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500">No geofences found</p>
          <p className="text-sm text-gray-400 mt-1">
            Add geofences to enable auto clock-in at job sites
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {geofences.map((geofence) => (
            <GeofenceCard
              key={geofence.id}
              geofence={geofence}
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

function GeofenceCard({ geofence, onEdit, onDelete, onToggle }) {
  return (
    <div className={`bg-white rounded-xl border p-4 ${!geofence.active ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            geofence.active ? 'bg-green-100' : 'bg-gray-100'
          }`}>
            <Target className={`w-5 h-5 ${geofence.active ? 'text-green-600' : 'text-gray-400'}`} />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">{geofence.name}</h3>
            <p className="text-sm text-gray-500">{geofence.radius}m radius</p>
          </div>
        </div>
        <button
          onClick={onToggle}
          className={`p-1 rounded ${geofence.active ? 'text-green-600' : 'text-gray-400'}`}
          title={geofence.active ? 'Disable' : 'Enable'}
        >
          {geofence.active ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
        </button>
      </div>

      {/* Location */}
      <div className="text-sm text-gray-500 mb-3">
        <div className="flex items-center gap-1">
          <MapPin className="w-4 h-4" />
          {geofence.address || `${geofence.lat.toFixed(4)}, ${geofence.lng.toFixed(4)}`}
        </div>
      </div>

      {/* Associated Job/Project */}
      {(geofence.job || geofence.project) && (
        <div className="text-sm mb-3">
          {geofence.job && (
            <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs mr-2">
              Job: {geofence.job.title}
            </span>
          )}
          {geofence.project && (
            <span className="inline-block px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
              Project: {geofence.project.name}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t">
        <button
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
        >
          <Edit2 className="w-4 h-4" />
          Edit
        </button>
        <button
          onClick={onDelete}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>
    </div>
  );
}

function GeofenceFormModal({ geofence, onSave, onClose }) {
  const [form, setForm] = useState({
    name: geofence?.name || '',
    lat: geofence?.lat || '',
    lng: geofence?.lng || '',
    radius: geofence?.radius || 100,
    address: geofence?.address || '',
    jobId: geofence?.jobId || '',
    projectId: geofence?.projectId || '',
  });
  const [jobs, setJobs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [gettingLocation, setGettingLocation] = useState(false);

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      const [jobsRes, projectsRes] = await Promise.all([
        api.get('/api/jobs?status=scheduled&limit=100'),
        api.get('/api/projects?status=active&limit=100'),
      ]);
      setJobs(jobsRes.data || jobsRes || []);
      setProjects(projectsRes.data || []);
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
        alert('Could not get location: ' + err.message);
        setGettingLocation(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleJobSelect = async (jobId) => {
    setForm({ ...form, jobId });
    
    if (jobId) {
      const job = jobs.find(j => j.id === jobId);
      if (job) {
        setForm(f => ({
          ...f,
          jobId,
          name: f.name || job.title,
          address: f.address || job.address || '',
          lat: job.lat || f.lat,
          lng: job.lng || f.lng,
        }));
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.lat || !form.lng) {
      alert('Location coordinates are required');
      return;
    }
    onSave({
      ...form,
      lat: parseFloat(form.lat),
      lng: parseFloat(form.lng),
      radius: parseInt(form.radius),
      jobId: form.jobId || null,
      projectId: form.projectId || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            {geofence ? 'Edit Geofence' : 'Add Geofence'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Job Site Name"
                required
              />
            </div>

            {/* Link to Job */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Link to Job (optional)</label>
              <select
                value={form.jobId}
                onChange={(e) => handleJobSelect(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">No job</option>
                {jobs.map(job => (
                  <option key={job.id} value={job.id}>{job.title} ({job.number})</option>
                ))}
              </select>
            </div>

            {/* Link to Project */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Link to Project (optional)</label>
              <select
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">No project</option>
                {projects.map(proj => (
                  <option key={proj.id} value={proj.id}>{proj.name} ({proj.number})</option>
                ))}
              </select>
            </div>

            {/* Address */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="123 Main St, City, ST"
              />
            </div>

            {/* Coordinates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="41.8781"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={form.lng}
                  onChange={(e) => setForm({ ...form, lng: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
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
              className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
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
              <div className="flex justify-between text-xs text-gray-500">
                <span>25m (small site)</span>
                <span>500m (large site)</span>
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
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
