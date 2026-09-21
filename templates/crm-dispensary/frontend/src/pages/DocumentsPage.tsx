// Documents — the licence, the COAs, the manifests.
//
// The API behind this page has existed and worked for a long time: /api/documents, authenticated and
// company-scoped, with list/filter/upload/bulk/edit/delete and a private file stream. Nothing in the
// product ever reached it — no page, no route, no nav entry — so it was only usable by hand. This is
// the way in. (found by check-document-types-match-the-picker.ts, T18 D4)
//
// It is deliberately NOT the shared documents page: this template's `document` table is its own shape
// (an `orderId` link and `tags`, and no filename/mimeType/path or version history), so the shared
// component would render half-empty columns and call endpoints that are not here. The duplication is
// noted as a consolidation candidate rather than papered over.
import { useState, useEffect, useCallback, useRef } from 'react';
import { formatDate } from '../utils/date';
import { FileText, Upload, Search, Trash2, Download, Pencil } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { DOCUMENTS, DOCUMENT_TYPE_LABELS } from '../docsConfig';

const label = (t: string) => DOCUMENT_TYPE_LABELS[t] || t;

const fmtSize = (n: any) => {
  const b = Number(n);
  if (!Number.isFinite(b) || b <= 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

export default function DocumentsPage() {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  // the fields hold text while they are being filled in — see the L7 note in the other forms
  const [uploadForm, setUploadForm] = useState({ name: '', type: 'general' });
  const [uploading, setUploading] = useState(false);

  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', type: 'general' });
  const [savingEdit, setSavingEdit] = useState(false);

  const [toDelete, setToDelete] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search.trim()) params.search = search.trim();
      if (typeFilter) params.type = typeFilter;
      const res = await api.get('/api/documents', params);
      setRows(Array.isArray(res) ? res : res?.data || []);
      setPagination(res?.pagination || null);
    } catch {
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, typeFilter]);

  const upload = async () => {
    if (!uploadFile) { toast.error('Choose a file'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      if (uploadForm.name.trim()) fd.append('name', uploadForm.name.trim());
      fd.append('type', uploadForm.type);
      // request() skips the JSON content-type for a FormData body and lets the browser set the boundary
      await api.request('/api/documents', { method: 'POST', body: fd });
      toast.success('Document uploaded');
      setUploadOpen(false);
      setUploadFile(null);
      setUploadForm({ name: '', type: 'general' });
      if (fileInput.current) fileInput.current.value = '';
      load();
    } catch (e: any) {
      // say what the server refused — an unknown type names the ones it will take
      toast.error(e?.data?.error || e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editForm.name.trim()) { toast.error('Name cannot be empty'); return; }
    setSavingEdit(true);
    try {
      await api.put(`/api/documents/${editing.id}`, { name: editForm.name.trim(), type: editForm.type });
      toast.success('Document updated');
      setEditing(null);
      load();
    } catch (e: any) {
      toast.error(e?.data?.error || e?.message || 'Could not update');
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await api.delete('/api/documents', toDelete.id);
      toast.success('Document deleted');
      setToDelete(null);
      load();
    } catch (e: any) {
      toast.error(e?.data?.error || e?.message || 'Could not delete');
    }
  };

  // doc.url points at the authenticated, company-scoped file route, so opening it in a tab would
  // arrive without the session and 401. Fetch it with the token and hand the blob over — the same
  // shape CompliancePage already uses for its CSV export. api.request() is not usable here because it
  // always parses the response as JSON, which a PDF is not.
  const download = async (doc: any) => {
    try {
      const res = await fetch(`${(api as any).baseUrl || ''}${doc.url}`, {
        headers: { Authorization: `Bearer ${(api as any).accessToken || localStorage.getItem('accessToken') || ''}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = href;
      a.download = doc.name || 'document';
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 5000);
    } catch {
      toast.error('This file is no longer in storage.');
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (v: any, r: any) => (
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-gray-400 dark:text-slate-400 shrink-0" />
          <span className="truncate font-medium">{v || '—'}</span>
        </div>
      ),
    },
    { key: 'type', label: 'Type', render: (v: any) => <span className="text-sm">{label(v || 'general')}</span> },
    { key: 'size', label: 'Size', render: (v: any) => <span className="text-sm text-gray-500 dark:text-slate-400">{fmtSize(v)}</span> },
    {
      key: 'uploadedBy',
      label: 'Uploaded by',
      render: (v: any) => (
        <span className="text-sm text-gray-500 dark:text-slate-400">
          {v?.firstName || v?.lastName ? `${v.firstName || ''} ${v.lastName || ''}`.trim() : '—'}
        </span>
      ),
    },
    { key: 'createdAt', label: 'Added', render: (v: any) => <span className="text-sm text-gray-500 dark:text-slate-400">{v ? formatDate(v) : '—'}</span> },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Documents</h1>
          <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">
            Licences, lab COAs, transport manifests and SOPs
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)}><Upload className="w-4 h-4 mr-2 inline" />Upload</Button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents"
            className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 text-sm border rounded-lg"
        >
          <option value="">All types</option>
          {DOCUMENTS.types.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        loading={loading}
        pagination={pagination}
        onPageChange={setPage}
        emptyMessage="No documents yet. Upload the state licence, a lab COA or a transport manifest to start."
        actions={[
          { label: 'Download', icon: Download, onClick: download },
          {
            label: 'Edit',
            icon: Pencil,
            onClick: (r: any) => { setEditing(r); setEditForm({ name: r.name || '', type: r.type || 'general' }); },
          },
          { label: 'Delete', icon: Trash2, onClick: (r: any) => setToDelete(r), className: 'text-red-600' },
        ]}
      />

      <Modal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload document">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">File</label>
            <input
              ref={fileInput}
              type="file"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Name <span className="text-gray-500 dark:text-slate-400 font-normal">(optional)</span></label>
            <input
              value={uploadForm.name}
              onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
              placeholder={uploadFile?.name || 'Defaults to the file name'}
              className="w-full px-3 py-2 text-sm border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              value={uploadForm.type}
              onChange={(e) => setUploadForm({ ...uploadForm, type: e.target.value })}
              className="w-full px-3 py-2 text-sm border rounded-lg"
            >
              {DOCUMENTS.types.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setUploadOpen(false)} className="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button>
            <Button onClick={upload} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title="Edit document">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              value={editForm.type}
              onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
              className="w-full px-3 py-2 text-sm border rounded-lg"
            >
              {DOCUMENTS.types.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button>
            <Button onClick={saveEdit} disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        title="Delete document"
        message={`Delete "${toDelete?.name || ''}"? This cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
