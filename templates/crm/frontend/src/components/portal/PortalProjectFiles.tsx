import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FolderOpen, Loader2, Download, Upload, FileUp } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

const API_URL: string = import.meta.env.VITE_API_URL || '';

interface ProjectFile {
  id: string;
  name: string;
  type: string;
  originalName: string;
  mimeType?: string | null;
  size?: number | null;
  url: string;
  thumbnailUrl?: string | null;
  description?: string | null;
  createdAt: string;
  sharedAt?: string | null;
}

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'plans', label: 'Plans & Drawings' },
  { key: 'permit', label: 'Permits' },
  { key: 'contract', label: 'Contracts' },
  { key: 'insurance', label: 'Insurance Certs' },
  { key: 'lien_waiver', label: 'Lien Waivers' },
  { key: 'photo', label: 'Photos' },
  { key: 'submittal', label: 'Submittals' },
  { key: 'change_order', label: 'Change Orders' },
  { key: 'inspection', label: 'Inspections' },
  { key: 'general', label: 'Other' },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

export default function PortalProjectFiles() {
  const { token, projectId } = useParams<{ token: string; projectId: string }>();
  const { fetch: portalFetch } = usePortal();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState<string>('general');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    portalFetch(`/projects/${projectId}/files`)
      .then((data) => setFiles(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Failed to load files:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', uploadType);
      form.append('name', file.name);
      const res = await fetch(`${API_URL}/api/portal/p/${token}/projects/${projectId}/files`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Upload failed');
      }
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const filtered = filter === 'all' ? files : files.filter((f) => f.type === filter);
  const typesPresent = Array.from(new Set(files.map((f) => f.type)));
  const groupedCats = CATEGORIES.filter((c) => typesPresent.includes(c.key));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Link to={`/portal/${token}/projects/${projectId}`} className="text-orange-600 hover:underline text-sm">
          {'<-'} Back to Project
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Project Files</h1>
        <p className="text-gray-600">Shared files for this project — organized by category.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <FileUp className="w-5 h-5 text-gray-500" />
          <p className="font-medium text-gray-900">Upload a file</p>
          <select
            value={uploadType}
            onChange={(e) => setUploadType(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <input ref={fileInput} type="file" onChange={handleUpload} disabled={uploading} className="hidden" id="portal-file-upload" />
          <label
            htmlFor="portal-file-upload"
            className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg cursor-pointer ${uploading ? 'bg-gray-300 text-gray-500' : 'bg-orange-500 text-white hover:bg-orange-600'}`}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading…' : 'Choose File'}
          </label>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No files in this project yet.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>
              All ({files.length})
            </FilterBtn>
            {groupedCats.map((c) => (
              <FilterBtn key={c.key} active={filter === c.key} onClick={() => setFilter(c.key)}>
                {c.label} ({files.filter((f) => f.type === c.key).length})
              </FilterBtn>
            ))}
          </div>
          <div className="space-y-3">
            {filtered.map((f) => (
              <FileCard key={f.id} file={f} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
        active ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function FileCard({ file }: { file: ProjectFile }) {
  const sizeKb = file.size ? Math.round(file.size / 1024) : 0;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-gray-100 rounded-lg shrink-0">
            {file.thumbnailUrl ? (
              <img src={file.thumbnailUrl} alt="" className="w-8 h-8 object-cover rounded" />
            ) : (
              <FolderOpen className="w-5 h-5 text-gray-600" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900 truncate">{file.name || file.originalName}</p>
            <div className="flex flex-wrap gap-2 mt-0.5 text-xs text-gray-500">
              <span className="px-1.5 py-0.5 bg-gray-100 rounded">{CATEGORY_LABEL[file.type] || file.type}</span>
              {sizeKb > 0 && <span>{sizeKb} KB</span>}
              <span>Added {new Date(file.createdAt).toLocaleDateString()}</span>
            </div>
            {file.description && <p className="text-xs text-gray-500 mt-1">{file.description}</p>}
          </div>
        </div>
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shrink-0"
        >
          <Download className="w-3.5 h-3.5" /> Download
        </a>
      </div>
    </div>
  );
}
