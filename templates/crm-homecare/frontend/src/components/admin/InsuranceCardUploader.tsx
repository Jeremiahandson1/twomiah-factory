// InsuranceCardUploader — front and back photos of the client's insurance card. Saved through
// their own endpoint (not the client save, so a 5 MB image is not resent on every edit); a phone
// opens the camera. Photos are shrunk to 1600px JPEG before upload.
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { confirm } from '../ConfirmModal';
import { toast } from '../Toast';

const compress = async (file: File): Promise<string> => {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale); const h = Math.round(img.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.85);
};

export default function InsuranceCardUploader({ clientId }: { clientId: string }) {
  const { token } = useAuth();
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    const hdr = { Authorization: `Bearer ${token}` };
    Promise.all(['front', 'back'].map(side =>
      fetch(`${API_BASE_URL}/api/insurance-cards/${clientId}?side=${side}`, { headers: hdr }).then(r => (r.ok ? r.json() : null)).catch(() => null)))
      .then(([f, b]) => { setFront(f?.image || null); setBack(b?.image || null); })
      .finally(() => setLoading(false));
  }, [clientId, token]);

  const save = async (side: string, imageBase64: string | null) => {
    const r = await fetch(`${API_BASE_URL}/api/insurance-cards/${clientId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ side, imageBase64 }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'upload failed');
  };

  const upload = async (side: string, file: File) => {
    if (!file?.type?.startsWith('image/')) { toast('Pick an image', 'error'); return; }
    setBusy(side);
    try {
      const dataUri = await compress(file);
      await save(side, dataUri);
      if (side === 'front') setFront(dataUri); else setBack(dataUri);
    } catch (e: any) { toast('Upload failed: ' + e.message, 'error'); }
    finally { setBusy(null); }
  };

  const clear = async (side: string) => {
    if (!(await confirm(`Remove ${side} of insurance card?`, { danger: true }))) return;
    setBusy(side);
    try {
      await save(side, null);
      if (side === 'front') setFront(null); else setBack(null);
    } catch (e: any) { toast('Not removed: ' + e.message, 'error'); }
    finally { setBusy(null); }
  };

  const sideBlock = (label: string, img: string | null, sideKey: string) => (
    <div className="flex-1 min-w-[220px]">
      <div className="mb-1 text-xs font-bold text-gray-700 dark:text-slate-200">{label}</div>
      <div className="h-40 flex items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-slate-700 dark:bg-slate-900">
        {img ? <img src={img} alt={`Insurance card ${label.toLowerCase()}`} className="max-w-full max-h-full object-contain" />
          : <span className="text-sm text-gray-400 dark:text-slate-500">No image</span>}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        <label className="btn btn-sm btn-secondary" style={{ cursor: busy === sideKey ? 'wait' : 'pointer', opacity: busy === sideKey ? 0.6 : 1 }}>
          {busy === sideKey ? 'Uploading…' : img ? 'Replace' : '+ Upload'}
          <input type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(sideKey, f); }} />
        </label>
        {img && (
          <button type="button" disabled={busy === sideKey} onClick={() => clear(sideKey)}
            className="px-2.5 py-1 rounded-md text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">Remove</button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <h4 style={{ borderBottom: '2px solid #007bff', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '0.75rem' }}>Insurance Card Images</h4>
      {loading ? (
        <div className="text-sm text-gray-400 dark:text-slate-500">Loading…</div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {sideBlock('Front', front, 'front')}
          {sideBlock('Back', back, 'back')}
        </div>
      )}
    </>
  );
}
