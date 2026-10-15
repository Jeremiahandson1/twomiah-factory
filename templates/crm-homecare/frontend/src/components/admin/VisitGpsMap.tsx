// VisitGpsMap — Leaflet map of one visit's GPS trail. Ported from CVHC VisitGpsMap.jsx.
//
// Draws the trail of GPS pings, start (green) / last (red) markers and the client's home (blue ★) when known, with the
// tracked distance and duration and an "Open in Google Maps" link.
import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../config';

// Leaflet is already a dependency of this app; it is imported on first use so the map code and its
// stylesheet only load when someone opens a map. (CVHC loaded it from a CDN at runtime.)
let leafletLoadPromise: Promise<any> | null = null;
const ensureLeaflet = (): Promise<any> => {
  if (!leafletLoadPromise) {
    leafletLoadPromise = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([mod]) => (mod as any).default || mod)
      .catch((e) => { leafletLoadPromise = null; throw e; });
  }
  return leafletLoadPromise;
};

const haversineMi = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

interface Props { token: string | null; timeEntryId: string; clientLat?: any; clientLng?: any; clientName?: string }

export default function VisitGpsMap({ token, timeEntryId, clientLat, clientLng, clientName }: Props) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [points, setPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!timeEntryId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/time-entries/${timeEntryId}/gps`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error('Failed to load GPS trail');
        const data = await r.json();
        if (!cancelled) setPoints(Array.isArray(data) ? data : []);
      } catch (e: any) { if (!cancelled) setError(e.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [timeEntryId, token]);

  useEffect(() => {
    if (loading || error) return;
    let mapInstance: any = null;
    let cancelled = false;
    (async () => {
      try {
        const L = await ensureLeaflet();
        if (cancelled || !mapDivRef.current) return;
        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

        const trail = points
          .filter(p => p.latitude != null && p.longitude != null)
          .map(p => ({ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), t: p.timestamp }));
        const home = (clientLat != null && clientLng != null && clientLat !== '' && clientLng !== '')
          ? { lat: parseFloat(clientLat), lng: parseFloat(clientLng) }
          : null;

        if (trail.length === 0 && !home) {
          mapDivRef.current.innerHTML = '<div style="padding: 20px; color: #6B7280; text-align: center;">No GPS data recorded for this visit.</div>';
          return;
        }

        const center = trail[0] || home!;
        mapInstance = L.map(mapDivRef.current).setView([center.lat, center.lng], 15);
        mapRef.current = mapInstance;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapInstance);

        const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
        if (home) {
          L.marker([home.lat, home.lng], {
            title: `${clientName || 'Client'} home`,
            icon: L.divIcon({
              className: 'visit-gps-home-marker',
              html: '<div style="background:#2563EB;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">★</div>',
              iconSize: [28, 28], iconAnchor: [14, 14],
            }),
          }).addTo(mapInstance).bindPopup(`<strong>${esc(clientName || 'Client')}</strong><br/>Home location`);
        }

        if (trail.length > 0) {
          const latlngs = trail.map(p => [p.lat, p.lng]);
          L.polyline(latlngs, { color: '#0F766E', weight: 4, opacity: 0.85 }).addTo(mapInstance);
          L.marker(latlngs[0], {
            title: 'Clock in',
            icon: L.divIcon({
              className: 'visit-gps-start-marker',
              html: '<div style="background:#047857;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">▶</div>',
              iconSize: [24, 24], iconAnchor: [12, 12],
            }),
          }).addTo(mapInstance).bindPopup(`<strong>Clock-in</strong><br/>${new Date(trail[0].t).toLocaleString()}`);
          if (trail.length > 1) {
            const last = trail[trail.length - 1];
            L.marker([last.lat, last.lng], {
              title: 'Clock out',
              icon: L.divIcon({
                className: 'visit-gps-end-marker',
                html: '<div style="background:#DC2626;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">■</div>',
                iconSize: [24, 24], iconAnchor: [12, 12],
              }),
            }).addTo(mapInstance).bindPopup(`<strong>Last GPS ping</strong><br/>${new Date(last.t).toLocaleString()}`);
          }
          const all = home ? [...latlngs, [home.lat, home.lng]] : latlngs;
          mapInstance.fitBounds(all, { padding: [32, 32] });
        } else if (home) {
          mapInstance.setView([home.lat, home.lng], 16);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
      if (mapInstance) { try { mapInstance.remove(); } catch { /* already gone */ } }
      mapRef.current = null;
    };
  }, [loading, error, points, clientLat, clientLng, clientName]);

  const trail = points.filter(p => p.latitude != null && p.longitude != null);
  let distMi = 0;
  for (let i = 1; i < trail.length; i++) {
    distMi += haversineMi(
      { lat: parseFloat(trail[i - 1].latitude), lng: parseFloat(trail[i - 1].longitude) },
      { lat: parseFloat(trail[i].latitude), lng: parseFloat(trail[i].longitude) },
    );
  }
  const startT = trail[0]?.timestamp;
  const endT = trail[trail.length - 1]?.timestamp;
  const durMin = (startT && endT) ? Math.round((new Date(endT).getTime() - new Date(startT).getTime()) / 60000) : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: 8, fontSize: '0.85rem', color: '#374151' }}>
        <span><strong>{trail.length}</strong> GPS pings</span>
        {durMin != null && <span><strong>{durMin}</strong> min of tracking</span>}
        {distMi > 0 && <span><strong>{distMi.toFixed(2)}</strong> mi traveled (caregiver position drift)</span>}
        {trail.length > 0 && (
          <a target="_blank" rel="noopener noreferrer"
             href={`https://www.google.com/maps/dir/${trail.map(p => `${p.latitude},${p.longitude}`).join('/')}`}
             style={{ marginLeft: 'auto', color: '#1D4ED8' }}>
            Open in Google Maps ↗
          </a>
        )}
      </div>
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#6B7280' }}>Loading GPS trail…</div>
      ) : error ? (
        <div style={{ padding: 16, background: '#FEE2E2', color: '#991B1B', borderRadius: 6 }}>Error: {error}</div>
      ) : (
        <div ref={mapDivRef} style={{ width: '100%', height: 400, borderRadius: 8, border: '1px solid #E5E7EB', background: '#F3F4F6' }} />
      )}
    </div>
  );
}
