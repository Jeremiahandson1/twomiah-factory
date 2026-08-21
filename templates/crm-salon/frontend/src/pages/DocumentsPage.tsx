import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Upload, File, Image, FileText, Download, Trash2, Eye, X, FolderOpen } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { EmptyState } from '../components/common/EmptyState';

interface UploadForm {
  name: string;
  type: string;
  projectId: string;
  description: string;
}

interface FilterState {
  type: string;
  projectId: string;
  search: string;
  [key: string]: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function DocumentsPage() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterState>({ type: '', projectId: '', search: '' });
  const [uploading, setUploading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState<UploadForm>({ name: '', type: 'general', projectId: '', description: '' });
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewDoc, setPreviewDoc] = useState<Record<string, unknown> | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 25, ...filter };
      Object.keys(params).forEach(k => !params[k] && delete params[k]);
      const [resRaw, projResRaw] = await Promise.all([
        api.documents.list(params),
        api.projects.list({ limit: 100 })
      ]);
      const res = resRaw as Record<string, unknown>; const projRes = projResRaw as Record<string, unknown>;
      setDocuments(res.data as Record<string, unknown>[]);
      setPagination(res.pagination as PaginationData | null);
      setProjects(projRes.data as Record<string, unknown>[]);
    } catch (err) {
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    if (files.length > 0) {
      setUploadForm(prev => ({ ...prev, name: files[0].name }));
      setUploadModalOpen(true);
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      toast.error('No files selected');
      return;
    }

    setUploading(true);
    try {
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('name', uploadForm.name || file.name);
        formData.append('type', uploadForm.type);
        if (uploadForm.projectId) formData.append('projectId', uploadForm.projectId);
        if (uploadForm.description) formData.append('description', uploadForm.description);

        await api.documents.upload(formData);
      }
      toast.success(`${selectedFiles.length} file(s) uploaded`);
      setUploadModalOpen(false);
      setSelectedFiles([]);
      setUploadForm({ name: '', type: 'general', projectId: '', description: '' });
      load();
    } catch (err) {
      toast.error((err as Error).message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.documents.delete((toDelete as Record<string, unknown>).id as string);
      toast.success('Document deleted');
      setDeleteOpen(false);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDownload = async (doc: Record<string, unknown>) => {
    try {
      window.open(`${(api as unknown as Record<string, string>).baseUrl || ''}/api/documents/${doc.id}/download`, '_blank');
    } catch (err) {
      toast.error('Download failed');
    }
  };

  const getFileIcon = (mimeType: unknown): React.ComponentType<{ className?: string }> => {
    if ((mimeType as string)?.startsWith('image/')) return Image;
    if ((mimeType as string)?.includes('pdf')) return FileText;
    return File;
  };

  const formatSize = (bytes: unknown): string => {
    if (!bytes) return '-';
    const b = bytes as number;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const documentTypes = ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other'];

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (v: unknown, row: Record<string, unknown>) => {
        const Icon = getFileIcon(row.mimeType);
        return (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
              {row.thumbnailUrl ? (
                <img src={row.thumbnailUrl as string} alt="" className="w-10 h-10 rounded-lg object-cover" />
              ) : (
                <Icon className="w-5 h-5 text-gray-500" />
              )}
            </div>
            <div>
              <p className="font-medium text-gray-900">{v as string}</p>
              <p className="text-xs text-gray-500">{row.originalName as string}</p>
            </div>
          </div>
        );
      }
    },
    { key: 'type', label: 'Type', render: (v: unknown) => <span className="capitalize">{v as string}</span> },
    { key: 'project', label: 'Project', render: (v: unknown) => (v as Record<string, unknown>)?.name as string || '-' },
    { key: 'size', label: 'Size', render: (v: unknown) => formatSize(v) },
    { key: 'createdAt', label: 'Uploaded', render: (v: unknown) => new Date(v as string).toLocaleDateString() },
  ];

  return (
    <div>
      <PageHeader
        title="Documents"
        action={
          <Button onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-4 h-4 mr-2 inline" />
            Upload
          </Button>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
      />

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="grid md:grid-cols-4 gap-4">
          <input
            type="text"
            placeholder="Search documents..."
            value={filter.search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter({ ...filter, search: e.target.value })}
            className="px-3 py-2 border rounded-lg"
          />
          <select
            value={filter.type}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter({ ...filter, type: e.target.value })}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="">All Types</option>
            {documentTypes.map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
          <select
            value={filter.projectId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter({ ...filter, projectId: e.target.value })}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="">All Projects</option>
            {projects.map((p: Record<string, unknown>) => (
              <option key={p.id as string} value={p.id as string}>{p.name as string}</option>
            ))}
          </select>
          <button
            onClick={() => setFilter({ type: '', projectId: '', search: '' })}
            className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {documents.length === 0 && !loading ? (
        <EmptyState
          icon={FolderOpen}
          title="No documents yet"
          description="Upload your first document to get started."
          actionLabel="Upload Document"
          onAction={() => fileInputRef.current?.click()}
        />
      ) : (
        <DataTable
          data={documents}
          columns={columns}
          loading={loading}
          pagination={pagination}
          onPageChange={setPage}
          actions={[
            {
              label: 'Preview',
              icon: Eye,
              onClick: (doc: Record<string, unknown>) => setPreviewDoc(doc),
              show: (doc: Record<string, unknown>) => (doc.mimeType as string)?.startsWith('image/') || (doc.mimeType as string)?.includes('pdf')
            },
            { label: 'Download', icon: Download, onClick: handleDownload },
            { label: 'Delete', icon: Trash2, onClick: (doc: Record<string, unknown>) => { setToDelete(doc); setDeleteOpen(true); }, className: 'text-red-600' },
          ]}
        />
      )}

      {/* Upload Modal */}
      <Modal isOpen={uploadModalOpen} onClose={() => { setUploadModalOpen(false); setSelectedFiles([]); }} title="Upload Document" size="md">
        <div className="space-y-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              {selectedFiles.length} file(s) selected
            </p>
            <div className="mt-2 space-y-1">
              {selectedFiles.map((f: File, i: number) => (
                <p key={i} className="text-sm font-medium truncate">{f.name}</p>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              value={uploadForm.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUploadForm({ ...uploadForm, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              value={uploadForm.type}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setUploadForm({ ...uploadForm, type: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              {documentTypes.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Project (Optional)</label>
            <select
              value={uploadForm.projectId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setUploadForm({ ...uploadForm, projectId: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">No project</option>
              {projects.map((p: Record<string, unknown>) => (
                <option key={p.id as string} value={p.id as string}>{p.name as string}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description (Optional)</label>
            <textarea
              value={uploadForm.description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setUploadForm({ ...uploadForm, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => { setUploadModalOpen(false); setSelectedFiles([]); }} className="px-4 py-2 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          <Button onClick={handleUpload} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
      </Modal>

      {/* Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPreviewDoc(null)}>
          <div className="relative max-w-4xl max-h-[90vh] overflow-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewDoc(null)}
              className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-lg z-10"
            >
              <X className="w-5 h-5" />
            </button>
            {(previewDoc.mimeType as string)?.startsWith('image/') ? (
              <img src={previewDoc.url as string} alt={previewDoc.name as string} className="max-w-full max-h-[90vh] rounded-lg" />
            ) : (
              <iframe src={previewDoc.url as string} className="w-[800px] h-[90vh] bg-white rounded-lg" />
            )}
          </div>
        </div>
      )}

      {/* Delete Modal */}
      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Document"
        message={`Delete "${toDelete?.name as string}"? This cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  );
}
