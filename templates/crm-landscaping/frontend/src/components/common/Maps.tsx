import { useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, Maximize2, List, Map as MapIcon, ExternalLink } from 'lucide-react';

/**
 * Map Component using Leaflet (free, no API key required)
 * 
 * Usage:
 *   <LocationMap lat={43.123} lng={-91.456} />
 *   <LocationMap address="123 Main St, City, ST" />
 *   <JobsMap jobs={[{ id, title, lat, lng }]} />
 */

// Load Leaflet CSS and JS dynamically
let leafletLoaded = false;
const loadLeaflet = () => {
  return new Promise((resolve) => {
    if (leafletLoaded && window.L) {
      resolve(window.L);
      return;
    }

    // Load CSS
    if (!document.querySelector('link[href*="leaflet"]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
    }

    // Load JS
    if (!document.querySelector('script[src*="leaflet"]')) {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => {
        leafletLoaded = true;
        resolve(window.L);
      };
      document.head.appendChild(script);
    } else if (window.L) {
      leafletLoaded = true;
      resolve(window.L);
    }
  });
};

/**
 * Single location map
 */
export default function LocationMap({ 
  lat, 
  lng, 
  address,
  zoom = 15,
  height = 300,
  showOpenIn = true,
  className = '',
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [coords, setCoords] = useState({ lat, lng });

  // Geocode address if no coordinates provided
  useEffect(() => {
    if (lat && lng) {
      setCoords({ lat, lng });
      setLoading(false);
      return;
    }

    if (address) {
      geocodeAddress(address)
        .then(result => {
          if (result) {
            setCoords(result);
          } else {
            setError('Could not find location');
          }
        })
        .catch(() => setError('Geocoding failed'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
      setError('No location provided');
    }
  }, [lat, lng, address]);

  // Initialize map
  useEffect(() => {
    if (!coords.lat || !coords.lng || !mapRef.current) return;

    loadLeaflet().then((L) => {
      // Clean up existing map
      if (mapInstance.current) {
        mapInstance.current.remove();
      }

      // Create map
      const map = L.map(mapRef.current).setView([coords.lat, coords.lng], zoom);
      
      // Add tile layer (OpenStreetMap)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      // Add marker
      L.marker([coords.lat, coords.lng]).addTo(map);

      mapInstance.current = map;

      // Fix map size issues
      setTimeout(() => map.invalidateSize(), 100);
    });

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [coords, zoom]);

  const openInMaps = () => {
    const query = address || `${coords.lat},${coords.lng}`;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, '_blank');
  };

  const openDirections = () => {
    const dest = address || `${coords.lat},${coords.lng}`;
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`, '_blank');
  };

  if (loading) {
    return (
      <div className={`bg-gray-100 rounded-lg flex items-center justify-center ${className}`} style={{ height }}>
        <div className="text-gray-400">Loading map...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-gray-100 rounded-lg flex items-center justify-center ${className}`} style={{ height }}>
        <div className="text-center text-gray-500">
          <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{error}</p>
          {address && (
            <button onClick={openInMaps} className="mt-2 text-orange-600 hover:underline text-sm">
              Search in Google Maps
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative rounded-lg overflow-hidden ${className}`}>
      <div ref={mapRef} style={{ height, width: '100%' }} />
      
      {showOpenIn && (
        <div className="absolute top-2 right-2 flex gap-1">
          <button
            onClick={openDirections}
            className="p-2 bg-white rounded-lg shadow hover:bg-gray-50"
            title="Get directions"
          >
            <Navigation className="w-4 h-4 text-gray-700" />
          </button>
          <button
            onClick={openInMaps}
            className="p-2 bg-white rounded-lg shadow hover:bg-gray-50"
            title="Open in Google Maps"
          >
            <ExternalLink className="w-4 h-4 text-gray-700" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Multiple locations map (for jobs/projects)
 */
export function MultiLocationMap({ 
  locations = [], // [{ id, title, lat, lng, address, status }]
  height = 400,
  onMarkerClick,
  className = '',
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [view, setView] = useState('map'); // 'map' or 'list'

  useEffect(() => {
    if (locations.length === 0 || !mapRef.current) return;

    loadLeaflet().then((L) => {
      if (mapInstance.current) {
        mapInstance.current.remove();
      }

      // Calculate bounds
      const validLocations = locations.filter(l => l.lat && l.lng);
      if (validLocations.length === 0) return;

      const bounds = L.latLngBounds(validLocations.map(l => [l.lat, l.lng]));
      
      // Create map
      const map = L.map(mapRef.current).fitBounds(bounds, { padding: [50, 50] });
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      // Add markers
      validLocations.forEach((loc, index) => {
        const marker = L.marker([loc.lat, loc.lng])
          .addTo(map)
          .bindPopup(`
            <div style="min-width: 150px">
              <strong>${loc.title || `Location ${index + 1}`}</strong>
              ${loc.address ? `<br><small>${loc.address}</small>` : ''}
              ${loc.status ? `<br><span style="color: #666">${loc.status}</span>` : ''}
            </div>
          `);

        if (onMarkerClick) {
          marker.on('click', () => onMarkerClick(loc));
        }
      });

      mapInstance.current = map;
      setTimeout(() => map.invalidateSize(), 100);
    });

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [locations]);

  const validLocations = locations.filter(l => l.lat && l.lng);

  return (
    <div className={className}>
      {/* View toggle */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">{validLocations.length} locations</span>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setView('map')}
            className={`p-1.5 rounded ${view === 'map' ? 'bg-white shadow' : ''}`}
          >
            <MapIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-1.5 rounded ${view === 'list' ? 'bg-white shadow' : ''}`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {view === 'map' ? (
        <div ref={mapRef} style={{ height }} className="rounded-lg" />
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {locations.map((loc, i) => (
            <div
              key={loc.id || i}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
              onClick={() => onMarkerClick?.(loc)}
            >
              <div className="p-2 bg-orange-100 rounded-lg">
                <MapPin className="w-4 h-4 text-orange-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{loc.title}</p>
                <p className="text-sm text-gray-500 truncate">{loc.address}</p>
              </div>
              {loc.status && (
                <span className="text-xs text-gray-500">{loc.status}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Jobs Map - specifically for displaying scheduled jobs
 */
export function JobsMap({ jobs = [], onJobClick, height = 400 }) {
  const locations = jobs
    .filter(job => job.lat && job.lng)
    .map(job => ({
      id: job.id,
      title: job.title || job.number,
      lat: job.lat,
      lng: job.lng,
      address: formatAddress(job),
      status: job.status,
    }));

  return (
    <MultiLocationMap
      locations={locations}
      height={height}
      onMarkerClick={onJobClick}
    />
  );
}

/**
 * Address autocomplete input
 */
export function AddressInput({ 
  value, 
  onChange, 
  onSelect,
  placeholder = 'Enter address...',
  className = '',
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef(null);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);

    // Debounce search
    clearTimeout(debounceRef.current);
    if (val.length >= 3) {
      debounceRef.current = setTimeout(() => searchAddress(val), 300);
    } else {
      setSuggestions([]);
    }
  };

  const searchAddress = async (query) => {
    setLoading(true);
    try {
      // Using Nominatim (free, no API key)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=5`,
        { headers: { 'User-Agent': '{{COMPANY_NAME}} CRM' } }
      );
      const data = await response.json();
      setSuggestions(data.map(item => ({
        display: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
      })));
      setShowSuggestions(true);
    } catch (error) {
      console.error('Address search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (suggestion) => {
    onChange(suggestion.display);
    setShowSuggestions(false);
    if (onSelect) {
      onSelect({
        address: suggestion.display,
        lat: suggestion.lat,
        lng: suggestion.lng,
      });
    }
  };

  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
      />
      
      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => handleSelect(s)}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 border-b last:border-0"
            >
              <MapPin className="w-3 h-3 inline-block mr-2 text-gray-400" />
              {s.display}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Static map image (for emails, PDFs)
 */
export function StaticMapUrl({ lat, lng, zoom = 15, width = 600, height = 300 }) {
  // Using OpenStreetMap static tiles
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&markers=${lat},${lng},red`;
}

/**
 * Geocode address to coordinates
 */
export async function geocodeAddress(address) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      { headers: { 'User-Agent': '{{COMPANY_NAME}} CRM' } }
    );
    const data = await response.json();
    if (data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
    }
    return null;
  } catch (error) {
    console.error('Geocoding failed:', error);
    return null;
  }
}

/**
 * Format address from object
 */
function formatAddress(obj) {
  const parts = [obj.address, obj.city, obj.state, obj.zip].filter(Boolean);
  return parts.join(', ');
}

/**
 * Calculate distance between two points (in miles)
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}
