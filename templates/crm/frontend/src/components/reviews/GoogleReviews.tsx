import { useState, useEffect } from 'react';
import { 
  Star, Send, MessageSquare, Mail, Phone, Clock,
  CheckCircle, AlertCircle, Settings, BarChart3,
  ExternalLink, Loader2, TrendingUp, Users
} from 'lucide-react';
import api from '../../services/api';

/**
 * Review Request Button
 * 
 * Add to job detail page to request reviews
 */
export function ReviewRequestButton({ jobId, contactPhone, contactEmail, onSent }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [channel, setChannel] = useState('both');

  const handleSend = async () => {
    setSending(true);
    try {
      await api.post(`/reviews/request/${jobId}`, { channel });
      setSent(true);
      onSent?.();
    } catch (error) {
      alert(error.message || 'Failed to send review request');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-lg">
        <CheckCircle className="w-4 h-4" />
        Review request sent!
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        className="px-3 py-2 border rounded-lg text-sm"
        disabled={sending}
      >
        <option value="both">SMS & Email</option>
        <option value="sms" disabled={!contactPhone}>SMS Only</option>
        <option value="email" disabled={!contactEmail}>Email Only</option>
      </select>
      <button
        onClick={handleSend}
        disabled={sending}
        className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
      >
        {sending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Star className="w-4 h-4" />
        )}
        Request Review
      </button>
    </div>
  );
}

/**
 * Review Settings Page
 */
export function ReviewSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [settingsData, statsData] = await Promise.all([
        api.get('/reviews/settings'),
        api.get('/reviews/stats'),
      ]);
      setSettings(settingsData);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/reviews/settings', settings);
      alert('Settings saved!');
    } catch (error) {
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Google Reviews</h1>
        <p className="text-gray-500">Automate review requests after job completion</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard 
            label="Total Requests" 
            value={stats.total} 
            icon={Send}
          />
          <StatCard 
            label="Click Rate" 
            value={`${stats.clickRate}%`} 
            icon={TrendingUp}
            color="blue"
          />
          <StatCard 
            label="Reviews Received" 
            value={stats.completed} 
            icon={Star}
            color="yellow"
          />
          <StatCard 
            label="Conversion Rate" 
            value={`${stats.conversionRate}%`} 
            icon={BarChart3}
            color="green"
          />
        </div>
      )}

      {/* Google Business Connection */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-500" />
          Google Business Profile
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Google Place ID
            </label>
            <input
              type="text"
              value={settings?.googlePlaceId || ''}
              onChange={(e) => setSettings({ ...settings, googlePlaceId: e.target.value })}
              placeholder="ChIJ..."
              className="w-full px-3 py-2 border rounded-lg"
            />
            <p className="text-xs text-gray-500 mt-1">
              Find your Place ID at{' '}
              <a 
                href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-600 hover:underline"
              >
                Google's Place ID Finder
              </a>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Business Name (for messages)
            </label>
            <input
              type="text"
              value={settings?.googleBusinessName || ''}
              onChange={(e) => setSettings({ ...settings, googleBusinessName: e.target.value })}
              placeholder="Your Company Name"
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>

          {settings?.reviewLink && (
            <div className="p-3 bg-green-50 rounded-lg">
              <p className="text-sm text-green-700 mb-2">Your review link:</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={settings.reviewLink}
                  readOnly
                  className="flex-1 px-3 py-2 bg-white border rounded-lg text-sm"
                />
                <a
                  href={settings.reviewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 bg-white border rounded-lg hover:bg-gray-50"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Automation Settings */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-gray-500" />
          Automation Settings
        </h2>

        <div className="space-y-4">
          {/* Enable Toggle */}
          <label className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">Auto-Request Reviews</p>
              <p className="text-sm text-gray-500">Automatically request reviews after job completion</p>
            </div>
            <input
              type="checkbox"
              checked={settings?.reviewRequestEnabled ?? true}
              onChange={(e) => setSettings({ ...settings, reviewRequestEnabled: e.target.checked })}
              className="w-5 h-5 rounded text-orange-500"
            />
          </label>

          {/* Channels */}
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={settings?.reviewSmsEnabled ?? true}
                onChange={(e) => setSettings({ ...settings, reviewSmsEnabled: e.target.checked })}
                className="w-4 h-4 rounded text-orange-500"
              />
              <Phone className="w-5 h-5 text-gray-400" />
              <span className="text-gray-900">SMS</span>
            </label>
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={settings?.reviewEmailEnabled ?? true}
                onChange={(e) => setSettings({ ...settings, reviewEmailEnabled: e.target.checked })}
                className="w-4 h-4 rounded text-orange-500"
              />
              <Mail className="w-5 h-5 text-gray-400" />
              <span className="text-gray-900">Email</span>
            </label>
          </div>

          {/* Timing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Send Request After
              </label>
              <select
                value={settings?.reviewRequestDelay || 2}
                onChange={(e) => setSettings({ ...settings, reviewRequestDelay: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value={1}>1 hour</option>
                <option value={2}>2 hours</option>
                <option value={4}>4 hours</option>
                <option value={24}>1 day</option>
                <option value={48}>2 days</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Follow-up After
              </label>
              <select
                value={settings?.reviewFollowUpDelay || 3}
                onChange={(e) => setSettings({ ...settings, reviewFollowUpDelay: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value={0}>No follow-up</option>
                <option value={3}>3 days</option>
                <option value={5}>5 days</option>
                <option value={7}>1 week</option>
              </select>
            </div>
          </div>

          {/* Minimum Job Value */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Minimum Job Value (optional)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">$</span>
              <input
                type="number"
                value={settings?.reviewMinimumJobValue || ''}
                onChange={(e) => setSettings({ ...settings, reviewMinimumJobValue: parseInt(e.target.value) || 0 })}
                placeholder="0"
                className="w-32 px-3 py-2 border rounded-lg"
              />
              <span className="text-sm text-gray-500">Only request reviews for jobs above this value</span>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Settings
        </button>
      </div>

      {/* Recent Requests */}
      <ReviewRequestsList />
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600',
    blue: 'bg-blue-50 text-blue-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    green: 'bg-green-50 text-green-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2 opacity-75" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

/**
 * Review Requests List
 */
export function ReviewRequestsList() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    try {
      const data = await api.get('/reviews/requests?limit=20');
      setRequests(data.data || []);
    } catch (error) {
      console.error('Failed to load requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFollowUp = async (requestId) => {
    try {
      await api.post(`/reviews/follow-up/${requestId}`);
      loadRequests();
    } catch (error) {
      alert('Failed to send follow-up');
    }
  };

  if (loading) {
    return <div className="animate-pulse bg-gray-100 h-48 rounded-xl" />;
  }

  return (
    <div className="bg-white rounded-xl border">
      <div className="p-4 border-b">
        <h3 className="font-semibold text-gray-900">Recent Review Requests</h3>
      </div>
      
      {requests.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No review requests yet</p>
        </div>
      ) : (
        <div className="divide-y">
          {requests.map((request) => (
            <div key={request.id} className="p-4 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                request.status === 'completed' ? 'bg-green-100' :
                request.status === 'clicked' ? 'bg-blue-100' :
                request.status === 'sent' ? 'bg-yellow-100' :
                'bg-gray-100'
              }`}>
                {request.status === 'completed' ? (
                  <Star className="w-5 h-5 text-green-600" />
                ) : request.status === 'clicked' ? (
                  <CheckCircle className="w-5 h-5 text-blue-600" />
                ) : (
                  <Clock className="w-5 h-5 text-yellow-600" />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">
                  {request.contact?.name}
                </p>
                <p className="text-sm text-gray-500 truncate">
                  {request.job?.title}
                </p>
              </div>

              <div className="text-right">
                <p className="text-sm text-gray-500">
                  {new Date(request.sentAt || request.createdAt).toLocaleDateString()}
                </p>
                <p className={`text-xs capitalize ${
                  request.status === 'completed' ? 'text-green-600' :
                  request.status === 'clicked' ? 'text-blue-600' :
                  'text-gray-400'
                }`}>
                  {request.status}
                </p>
              </div>

              {request.status === 'sent' && !request.followUpSentAt && (
                <button
                  onClick={() => handleFollowUp(request.id)}
                  className="px-3 py-1 text-sm text-orange-600 hover:bg-orange-50 rounded-lg"
                >
                  Follow Up
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default {
  ReviewRequestButton,
  ReviewSettingsPage,
  ReviewRequestsList,
};
