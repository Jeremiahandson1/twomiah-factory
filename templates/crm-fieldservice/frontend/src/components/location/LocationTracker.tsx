import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  MapPin, Navigation, Clock, Settings, Play, Square,
  Loader2, CheckCircle, AlertCircle, Wifi, WifiOff,
  Target, Circle, Map
} from 'lucide-react';
import api from '../../services/api';

/**
 * Location Tracking Component
 * 
 * Features:
 * - Real-time GPS tracking
 * - Auto clock in/out at geofenced job sites
 * - Visual indicator of tracking status
 * - Settings for accuracy and frequency
 */
export default function LocationTracker() {
  const [tracking, setTracking] = useState(false);
  const [settings, setSettings] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [nearestSite, setNearestSite] = useState(null);
  const [insideGeofences, setInsideGeofences] = useState([]);
  const [lastAction, setLastAction] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  
  const watchIdRef = useRef(null);
  const intervalRef = useRef(null);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    return () => {
      stopTracking();
    };
  }, []);

  // Start/stop tracking based on settings
  useEffect(() => {
    if (settings?.locationTrackingEnabled && settings?.autoClockEnabled) {
      startTracking();
    } else {
      stopTracking();
    }
  }, [settings?.locationTrackingEnabled, settings?.autoClockEnabled]);

  const loadSettings = async () => {
    try {
      const data = await api.get('/geofencing/settings');
      setSettings(data);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (newSettings) => {
    try {
      const updated = await api.put('/geofencing/settings', newSettings);
      setSettings(updated);
      setShowSettings(false);
    } catch (err) {
      alert('Failed to save settings');
    }
  };

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      return;
    }

    setTracking(true);
    setError(null);

    const options = {
      enableHighAccuracy: settings?.locationAccuracy === 'high',
      timeout: 10000,
      maximumAge: 0,
    };

    // Watch position for real-time updates
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleLocationUpdate,
      handleLocationError,
      options
    );

    // Also poll at intervals for background sync
    const interval = (settings?.trackingInterval || 30) * 1000;
    intervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(handleLocationUpdate, handleLocationError, options);
    }, interval);

  }, [settings]);

  const stopTracking = useCallback(() => {
    setTracking(false);

    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const handleLocationUpdate = async (position) => {
    const { latitude, longitude, accuracy } = position.coords;
    
    setCurrentLocation({
      lat: latitude,
      lng: longitude,
      accuracy,
      timestamp: new Date(),
    });

    // Send to server for geofence processing
    try {
      const result = await api.post('/geofencing/location', {
        lat: latitude,
        lng: longitude,
        accuracy,
      });

      // Handle any auto clock actions
      if (result.actions?.length > 0) {
        const action = result.actions[0];
        setLastAction(action);
        
        // Show notification
        if (Notification.permission === 'granted') {
          new Notification(
            action.type === 'clock_in' ? '🟢 Clocked In' : '🔴 Clocked Out',
            { body: `Auto ${action.type.replace('_', ' ')} at ${action.geofence}` }
          );
        }
      }

      // Check what geofences we're inside
      const checkResult = await api.get(`/geofencing/check?lat=${latitude}&lng=${longitude}`);
      setInsideGeofences(checkResult.inside || []);

      // Find nearest site
      const nearest = await api.get(`/geofencing/nearest?lat=${latitude}&lng=${longitude}`);
      setNearestSite(nearest);

    } catch (err) {
      console.error('Failed to process location:', err);
    }
  };

  const handleLocationError = (error) => {
    console.error('Location error:', error);
    
    switch (error.code) {
      case error.PERMISSION_DENIED:
        setError('Location permission denied. Please enable in browser settings.');
        break;
      case error.POSITION_UNAVAILABLE:
        setError('Location unavailable');
        break;
      case error.TIMEOUT:
        setError('Location request timed out');
        break;
      default:
        setError('Unknown location error');
    }
  };

  const requestPermission = async () => {
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      if (result.state === 'prompt') {
        navigator.geolocation.getCurrentPosition(() => {}, () => {});
      }
    } catch (err) {
      // Permissions API not supported, try getting position directly
      navigator.geolocation.getCurrentPosition(() => {}, () => {});
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Navigation className="w-5 h-5 text-orange-500" />
            Location Tracking
          </h3>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {/* Tracking Status */}
        <div className="flex items-center gap-4 mb-4">
          <div className={`w-3 h-3 rounded-full ${tracking ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          <span className="text-sm text-gray-600">
            {tracking ? 'Tracking active' : 'Tracking inactive'}
          </span>
          {!settings?.locationTrackingEnabled && (
            <span className="text-xs text-gray-400">(Enable in settings)</span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg mb-4">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
            <button
              onClick={requestPermission}
              className="ml-auto text-sm underline"
            >
              Enable
            </button>
          </div>
        )}

        {/* Current Location */}
        {currentLocation && (
          <div className="bg-gray-50 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
              <MapPin className="w-4 h-4" />
              Current Location
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
              <div>Lat: {currentLocation.lat.toFixed(6)}</div>
              <div>Lng: {currentLocation.lng.toFixed(6)}</div>
              <div>Accuracy: ±{Math.round(currentLocation.accuracy)}m</div>
              <div>Updated: {currentLocation.timestamp.toLocaleTimeString()}</div>
            </div>
          </div>
        )}

        {/* Inside Geofences */}
        {insideGeofences.length > 0 && (
          <div className="bg-green-50 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 text-sm text-green-700 mb-2">
              <Target className="w-4 h-4" />
              Currently at job site
            </div>
            {insideGeofences.map((gf) => (
              <div key={gf.id} className="text-sm font-medium text-green-800">
                {gf.name}
              </div>
            ))}
          </div>
        )}

        {/* Nearest Site */}
        {nearestSite && insideGeofences.length === 0 && (
          <div className="bg-blue-50 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 text-sm text-blue-700 mb-1">
              <Map className="w-4 h-4" />
              Nearest job site
            </div>
            <div className="text-sm font-medium text-blue-800">
              {nearestSite.name}
            </div>
            <div className="text-xs text-blue-600">
              {Math.round(nearestSite.distance)}m away
            </div>
          </div>
        )}

        {/* Last Action */}
        {lastAction && (
          <div className={`rounded-lg p-3 ${
            lastAction.type === 'clock_in' ? 'bg-green-100' : 'bg-orange-100'
          }`}>
            <div className="flex items-center gap-2">
              {lastAction.type === 'clock_in' ? (
                <Play className="w-4 h-4 text-green-600" />
              ) : (
                <Square className="w-4 h-4 text-orange-600" />
              )}
              <span className={`text-sm font-medium ${
                lastAction.type === 'clock_in' ? 'text-green-700' : 'text-orange-700'
              }`}>
                Auto {lastAction.type.replace('_', ' ')} at {lastAction.geofence}
              </span>
            </div>
            {lastAction.duration && (
              <div className="text-xs text-gray-600 mt-1">
                Duration: {Math.floor(lastAction.duration / 60)}h {lastAction.duration % 60}m
              </div>
            )}
          </div>
        )}

        {/* Manual Toggle */}
        {settings?.locationTrackingEnabled && (
          <div className="flex justify-center mt-4">
            <button
              onClick={tracking ? stopTracking : startTracking}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                tracking
                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                  : 'bg-green-100 text-green-700 hover:bg-green-200'
              }`}
            >
              {tracking ? (
                <>
                  <WifiOff className="w-4 h-4" />
                  Pause Tracking
                </>
              ) : (
                <>
                  <Wifi className="w-4 h-4" />
                  Resume Tracking
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <LocationSettingsModal
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function LocationSettingsModal({ settings, onSave, onClose }) {
  const [form, setForm] = useState({
    locationTrackingEnabled: settings?.locationTrackingEnabled || false,
    autoClockEnabled: settings?.autoClockEnabled || false,
    locationAccuracy: settings?.locationAccuracy || 'high',
    trackingInterval: settings?.trackingInterval || 30,
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Location Settings</h2>

          <div className="space-y-4">
            {/* Enable Tracking */}
            <label className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">Enable Location Tracking</p>
                <p className="text-sm text-gray-500">Track your location in background</p>
              </div>
              <input
                type="checkbox"
                checked={form.locationTrackingEnabled}
                onChange={(e) => setForm({ ...form, locationTrackingEnabled: e.target.checked })}
                className="w-5 h-5 rounded text-orange-500"
              />
            </label>

            {/* Auto Clock */}
            <label className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">Auto Clock In/Out</p>
                <p className="text-sm text-gray-500">Automatically clock when entering/leaving job sites</p>
              </div>
              <input
                type="checkbox"
                checked={form.autoClockEnabled}
                onChange={(e) => setForm({ ...form, autoClockEnabled: e.target.checked })}
                className="w-5 h-5 rounded text-orange-500"
                disabled={!form.locationTrackingEnabled}
              />
            </label>

            {/* Accuracy */}
            <div>
              <label className="block font-medium text-gray-900 mb-1">Location Accuracy</label>
              <select
                value={form.locationAccuracy}
                onChange={(e) => setForm({ ...form, locationAccuracy: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                disabled={!form.locationTrackingEnabled}
              >
                <option value="high">High (GPS) - Most accurate, uses more battery</option>
                <option value="balanced">Balanced - Good accuracy, moderate battery</option>
                <option value="low">Low Power - Less accurate, saves battery</option>
              </select>
            </div>

            {/* Update Interval */}
            <div>
              <label className="block font-medium text-gray-900 mb-1">
                Update Interval: {form.trackingInterval}s
              </label>
              <input
                type="range"
                min="10"
                max="120"
                step="10"
                value={form.trackingInterval}
                onChange={(e) => setForm({ ...form, trackingInterval: parseInt(e.target.value) })}
                className="w-full"
                disabled={!form.locationTrackingEnabled}
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>10s (more accurate)</span>
                <span>120s (saves battery)</span>
              </div>
            </div>

            {/* Privacy Notice */}
            <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
              <p className="font-medium mb-1">Privacy Notice</p>
              <p>Your location is only tracked while the app is active and you're near job sites. Location data is used solely for time tracking and is not shared.</p>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(form)}
              className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact location indicator for header/sidebar
 */
export function LocationIndicator() {
  const [status, setStatus] = useState('inactive'); // inactive, tracking, at_site
  const [siteName, setSiteName] = useState(null);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    try {
      const settings = await api.get('/geofencing/settings');
      if (!settings.locationTrackingEnabled) {
        setStatus('inactive');
        return;
      }

      // Get current position
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        const result = await api.get(`/geofencing/check?lat=${latitude}&lng=${longitude}`);
        
        if (result.inside?.length > 0) {
          setStatus('at_site');
          setSiteName(result.inside[0].name);
        } else {
          setStatus('tracking');
          setSiteName(null);
        }
      }, () => {
        setStatus('inactive');
      });
    } catch (err) {
      setStatus('inactive');
    }
  };

  if (status === 'inactive') return null;

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs ${
      status === 'at_site' 
        ? 'bg-green-100 text-green-700' 
        : 'bg-blue-100 text-blue-700'
    }`}>
      <div className={`w-2 h-2 rounded-full ${
        status === 'at_site' ? 'bg-green-500' : 'bg-blue-500'
      } animate-pulse`} />
      {status === 'at_site' ? (
        <span>At {siteName}</span>
      ) : (
        <span>Tracking</span>
      )}
    </div>
  );
}
