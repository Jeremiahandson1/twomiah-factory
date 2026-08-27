import { useState, useEffect, useCallback, useRef } from 'react';
import { formatDate } from '../../utils/date';
import { UploadCloud, RotateCcw, Download, Trash2, Square, PenLine, MapPin, X } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/DataTable';

/**
 * Version history + plan markup for a document. Split from DocumentsPage so
 * the page stays a list; these carry their own state and load lazily.
 */

// ─── Version history ─────────────────────────────────────────────────────────

export function DocumentHistoryModal({ doc, onClose, onChanged }: {
  doc: Record<string, unknown>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [versions, setVersions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.documents.versions(doc.id as string) as Record<string, unknown>;
      setVersions((res.data as Record<string, unknown>[]) || []);
    } catch { toast.error('Could not load version history'); }
    finally { setLoading(false); }
  }, [doc.id]);

  useEffect(() => { load(); }, [load]);

  const uploadVersion = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (note.trim()) fd.append('note', note.trim());
      await api.documents.uploadVersion(doc.id as string, fd);
      toast.success('New version uploaded — the previous file is preserved below');
      setNote('');
      load(); onChanged();
    } catch (err) { toast.error((err as Error).message); }
    finally { setUploading(false); }
  };

  const restore = async (versionId: string, versionNumber: number) => {
    try {
      await api.documents.restoreVersion(doc.id as string, versionId);
      toast.success(`Restored v${versionNumber} — the replaced file was kept as a version`);
      load(); onChanged();
    } catch (err) { toast.error((err as Error).message); }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Versions — ${doc.name as string}`} size="md">
      <div className="space-y-4">
        <div className="bg-gray-50 border rounded-lg p-3">
          <div className="text-sm font-medium text-gray-900 mb-2">Current: {doc.originalName as string}</div>
          <div className="flex gap-2 items-center">
            <input value={note} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)} placeholder="What changed? (optional)" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
            <input ref={fileRef} type="file" className="hidden" onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) uploadVersion(f); e.target.value = ''; }} />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
              <UploadCloud className="w-4 h-4 mr-2 inline" />{uploading ? 'Uploading…' : 'Upload new version'}
            </Button>
          </div>
        </div>

        {loading ? <div className="text-center text-gray-400 py-6">Loading…</div> : (
          versions.length === 0
            ? <p className="text-sm text-gray-400">No previous versions — uploads land here when the file is replaced.</p>
            : (
              <div className="space-y-2">
                {versions.map(v => (
                  <div key={v.id as string} className="border rounded-lg px-3 py-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">v{v.versionNumber as number} — {v.originalName as string}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(v.createdAt as string).toLocaleString()}{v.note ? ` — ${v.note as string}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <a href={`${api.baseUrl}/api/documents/${doc.id as string}/versions/${v.id as string}/download`} target="_blank" rel="noreferrer" className="p-2 text-gray-500 hover:text-gray-900" title="Download"><Download className="w-4 h-4" /></a>
                      <button onClick={() => restore(v.id as string, v.versionNumber as number)} className="p-2 text-gray-500 hover:text-gray-900" title="Restore this version"><RotateCcw className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )
        )}
      </div>
    </Modal>
  );
}

// ─── Plan markup ─────────────────────────────────────────────────────────────
// Coordinates are stored NORMALIZED (0..1 of the image), so a markup drawn on
// a laptop lines up on a phone and survives image resizing.

type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'pen'; points: Array<[number, number]> }
  | { kind: 'pin'; x: number; y: number; note: string };

export function PlanMarkupModal({ doc, onClose }: { doc: Record<string, unknown>; onClose: () => void }) {
  const toast = useToast();
  const [markups, setMarkups] = useState<Record<string, unknown>[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<'rect' | 'pen' | 'pin'>('rect');
  const [drawing, setDrawing] = useState<Shape | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const isImage = ((doc.mimeType as string) || '').startsWith('image/');

  const load = useCallback(async () => {
    try {
      const res = await api.documents.markups(doc.id as string) as Record<string, unknown>;
      const list = (res.data as Record<string, unknown>[]) || [];
      setMarkups(list);
      if (list.length) selectMarkup(list[0]);
    } catch { toast.error('Could not load markups'); }
  }, [doc.id]);

  useEffect(() => { load(); }, [load]);

  const selectMarkup = (m: Record<string, unknown>) => {
    setActiveId(m.id as string);
    try { setShapes(JSON.parse(m.data as string)); } catch { setShapes([]); }
    setDirty(false);
  };

  const norm = (e: React.PointerEvent): [number, number] => {
    const r = boxRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const onDown = (e: React.PointerEvent) => {
    if (!isImage) return;
    const [x, y] = norm(e);
    if (tool === 'pin') {
      const note = window.prompt('Pin note:') || '';
      if (!note.trim()) return;
      setShapes(s => [...s, { kind: 'pin', x, y, note: note.trim() }]);
      setDirty(true);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrawing(tool === 'rect' ? { kind: 'rect', x, y, w: 0, h: 0 } : { kind: 'pen', points: [[x, y]] });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawing) return;
    const [x, y] = norm(e);
    setDrawing(d => d!.kind === 'rect'
      ? { ...(d as Extract<Shape, { kind: 'rect' }>), w: x - (d as Extract<Shape, { kind: 'rect' }>).x, h: y - (d as Extract<Shape, { kind: 'rect' }>).y }
      : { kind: 'pen', points: [...(d as Extract<Shape, { kind: 'pen' }>).points, [x, y]] });
  };
  const onUp = () => {
    if (!drawing) return;
    const done = drawing;
    setDrawing(null);
    const tooSmall = done.kind === 'rect' && Math.abs(done.w) < 0.005 && Math.abs(done.h) < 0.005;
    if (!tooSmall) { setShapes(s => [...s, done]); setDirty(true); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = JSON.stringify(shapes);
      if (activeId) await api.documents.updateMarkup(doc.id as string, activeId, { data });
      else {
        const created = await api.documents.createMarkup(doc.id as string, { name: 'Markup', data }) as Record<string, unknown>;
        setActiveId(created.id as string);
        setMarkups(m => [created, ...m]);
      }
      setDirty(false);
      toast.success('Markup saved');
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const newLayer = () => { setActiveId(null); setShapes([]); setDirty(false); };
  const deleteLayer = async () => {
    if (!activeId) return;
    try {
      await api.documents.deleteMarkup(doc.id as string, activeId);
      setMarkups(m => m.filter(x => (x.id as string) !== activeId));
      newLayer();
      toast.success('Markup deleted');
    } catch (err) { toast.error((err as Error).message); }
  };

  const R = 800; // viewBox scale for normalized coords

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-5xl w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b flex-wrap gap-2">
          <div className="font-semibold text-gray-900">Markup — {doc.name as string}</div>
          <div className="flex items-center gap-2">
            <select value={activeId || ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { const m = markups.find(x => (x.id as string) === e.target.value); if (m) selectMarkup(m); else newLayer(); }} className="px-2 py-1.5 border rounded-lg text-sm">
              <option value="">New layer…</option>
              {markups.map(m => <option key={m.id as string} value={m.id as string}>{m.name as string} ({formatDate(m.updatedAt as string)})</option>)}
            </select>
            {([['rect', Square], ['pen', PenLine], ['pin', MapPin]] as const).map(([t, Icon]) => (
              <button key={t} onClick={() => setTool(t)} className={`p-2 rounded-lg border ${tool === t ? 'bg-blue-50 border-blue-400 text-blue-700' : 'text-gray-500'}`} title={t}><Icon className="w-4 h-4" /></button>
            ))}
            <button onClick={() => { setShapes(s => s.slice(0, -1)); setDirty(true); }} className="px-2 py-1.5 border rounded-lg text-sm text-gray-600" disabled={!shapes.length}>Undo</button>
            <Button onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</Button>
            {activeId && <button onClick={deleteLayer} className="p-2 text-red-500 hover:bg-red-50 rounded-lg" title="Delete layer"><Trash2 className="w-4 h-4" /></button>}
            <button onClick={onClose} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-gray-100">
          {!isImage ? (
            <div className="text-center text-gray-500 py-16">
              Markup drawing works on image files (plan sheets exported as PNG/JPG).<br />
              This file is {(doc.mimeType as string) || 'not an image'} — use pins in a future revision or export the sheet as an image.
            </div>
          ) : (
            <div ref={boxRef} className="relative inline-block select-none touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
              <img src={doc.url as string} alt={doc.name as string} className="max-w-full block rounded-lg" draggable={false} />
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${R} ${R}`} preserveAspectRatio="none">
                {[...shapes, ...(drawing ? [drawing] : [])].map((s, i) => {
                  if (s.kind === 'rect') {
                    const x = (s.w < 0 ? s.x + s.w : s.x) * R, y = (s.h < 0 ? s.y + s.h : s.y) * R;
                    return <rect key={i} x={x} y={y} width={Math.abs(s.w) * R} height={Math.abs(s.h) * R} fill="rgba(220,38,38,0.12)" stroke="#dc2626" strokeWidth="3" vectorEffect="non-scaling-stroke" />;
                  }
                  if (s.kind === 'pen') {
                    return <polyline key={i} points={s.points.map(([px, py]) => `${px * R},${py * R}`).join(' ')} fill="none" stroke="#dc2626" strokeWidth="3" vectorEffect="non-scaling-stroke" />;
                  }
                  return (
                    <g key={i}>
                      <circle cx={s.x * R} cy={s.y * R} r="8" fill="#dc2626" />
                      <text x={s.x * R + 12} y={s.y * R + 4} fill="#dc2626" fontSize="16" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{s.note}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
