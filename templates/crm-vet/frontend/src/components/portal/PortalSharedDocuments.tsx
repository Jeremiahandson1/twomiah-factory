import { useEffect, useState } from 'react';
import { FolderOpen, Loader2, Download } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

interface SharedDoc {
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
  projectName?: string | null;
  sharedAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  general: 'General',
  plans: 'Plans & Drawings',
  permit: 'Permit',
  contract: 'Contract',
  insurance: 'Insurance Cert',
  lien_waiver: 'Lien Waiver',
  photo: 'Photo',
  submittal: 'Submittal',
  change_order: 'Change Order',
  inspection: 'Inspection',
};

export default function PortalSharedDocuments() {
  const { fetch: portalFetch } = usePortal();
  const [docs, setDocs] = useState<SharedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    portalFetch('/shared-documents')
      .then((data) => setDocs(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Failed to load documents:', err))
      .finally(() => setLoading(false));
  }, [portalFetch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const types = Array.from(new Set(docs.map((d) => d.type)));
  const filtered = filter === 'all' ? docs : docs.filter((d) => d.type === filter);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Shared Documents</h1>
        <p className="text-gray-600">Documents shared with you by the contractor.</p>
      </div>

      {docs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No documents shared with you yet.</p>
        </div>
      ) : (
        <>
          {types.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-4">
              <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>
                All ({docs.length})
              </FilterBtn>
              {types.map((t) => (
                <FilterBtn key={t} active={filter === t} onClick={() => setFilter(t)}>
                  {TYPE_LABELS[t] || t} ({docs.filter((d) => d.type === t).length})
                </FilterBtn>
              ))}
            </div>
          )}
          <div className="space-y-3">
            {filtered.map((d) => (
              <DocCard key={d.id} doc={d} />
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

function DocCard({ doc }: { doc: SharedDoc }) {
  const sizeKb = doc.size ? Math.round(doc.size / 1024) : 0;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-gray-100 rounded-lg shrink-0">
            <FolderOpen className="w-5 h-5 text-gray-600" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900 truncate">{doc.name || doc.originalName}</p>
            <div className="flex flex-wrap gap-2 mt-0.5 text-xs text-gray-500">
              <span className="px-1.5 py-0.5 bg-gray-100 rounded">{TYPE_LABELS[doc.type] || doc.type}</span>
              {doc.projectName && <span>Project: {doc.projectName}</span>}
              {sizeKb > 0 && <span>{sizeKb} KB</span>}
              <span>Shared {new Date(doc.sharedAt).toLocaleDateString()}</span>
            </div>
            {doc.description && <p className="text-xs text-gray-500 mt-1">{doc.description}</p>}
          </div>
        </div>
        <a
          href={doc.url}
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
