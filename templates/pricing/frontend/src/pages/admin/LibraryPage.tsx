import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';

interface Resource {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'pdf' | 'video';
  mimeType: string;
  size: number;
  category?: string;
  sortOrder: number;
  uploadedAt: string;
}

interface Category {
  id: string;
  name: string;
}

export default function LibraryPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState('');
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const [resData, catData] = await Promise.all([
          api.get('/api/library'),
          api.get('/api/pricebook/categories'),
        ]);
        setResources(resData);
        setCategories(catData);
      } catch {
        // handle
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filteredResources = selectedFilter
    ? resources.filter((r) => r.category === selectedFilter)
    : resources;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        if (selectedFilter) formData.append('category', selectedFilter);

        const resource = await api.upload('/api/library/upload', formData);
        setResources((prev) => [...prev, resource]);
      }
    } catch {
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/library/${id}`);
      setResources(resources.filter((r) => r.id !== id));
      setDeleteConfirm(null);
      if (previewResource?.id === id) setPreviewResource(null);
    } catch {
      // handle
    }
  }

  function moveResource(index: number, direction: 'up' | 'down') {
    const filtered = [...filteredResources];
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= filtered.length) return;
    [filtered[index], filtered[swapIdx]] = [filtered[swapIdx], filtered[index]];

    // Update sort order
    const reordered = filtered.map((r, i) => ({ ...r, sortOrder: i }));
    // Merge back
    const newResources = resources.map((r) => {
      const updated = reordered.find((u) => u.id === r.id);
      return updated || r;
    });
    setResources(newResources);

    api.post('/api/library/reorder', {
      order: reordered.map((r) => r.id),
    });
  }

  function getResourceIcon(type: Resource['type']) {
    switch (type) {
      case 'image':
        return (
          <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        );
      case 'pdf':
        return (
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        );
      case 'video':
        return (
          <svg className="w-8 h-8 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        );
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Resource Library</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 transition-colors min-h-[48px]"
            >
              {uploading ? 'Uploading...' : '+ Upload'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,video/*"
              onChange={handleUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedFilter('')}
            className={`px-4 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap min-h-[44px] transition-colors ${
              !selectedFilter
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedFilter(cat.id)}
              className={`px-4 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap min-h-[44px] transition-colors ${
                selectedFilter === cat.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Resource Grid */}
        {filteredResources.length === 0 ? (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-gray-500 text-lg">No resources yet. Upload files to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredResources.map((resource, i) => (
              <div
                key={resource.id}
                className="bg-white rounded-xl shadow-lg overflow-hidden group relative"
              >
                {/* Preview Area */}
                <button
                  onClick={() => setPreviewResource(resource)}
                  className="w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden"
                >
                  {resource.type === 'image' ? (
                    <img
                      src={resource.url}
                      alt={resource.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      {getResourceIcon(resource.type)}
                      <p className="text-xs text-gray-400 mt-2 uppercase font-bold">{resource.type}</p>
                    </div>
                  )}
                </button>

                {/* Reorder / Delete overlay */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => moveResource(i, 'up')}
                    disabled={i === 0}
                    className="w-8 h-8 bg-white/90 backdrop-blur rounded-lg shadow flex items-center justify-center text-gray-600 hover:bg-white disabled:opacity-30"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => moveResource(i, 'down')}
                    disabled={i === filteredResources.length - 1}
                    className="w-8 h-8 bg-white/90 backdrop-blur rounded-lg shadow flex items-center justify-center text-gray-600 hover:bg-white disabled:opacity-30"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(resource.id)}
                    className="w-8 h-8 bg-red-500/90 backdrop-blur rounded-lg shadow flex items-center justify-center text-white hover:bg-red-600"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>

                {/* Info */}
                <div className="p-3">
                  <p className="font-semibold text-gray-900 text-sm truncate">{resource.name}</p>
                  <p className="text-xs text-gray-500">{formatSize(resource.size)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Preview Modal */}
        {previewResource && (
          <div
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
            onClick={() => setPreviewResource(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-bold text-gray-900">{previewResource.name}</h3>
                <button
                  onClick={() => setPreviewResource(null)}
                  className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4 flex items-center justify-center max-h-[70vh] overflow-auto">
                {previewResource.type === 'image' && (
                  <img src={previewResource.url} alt={previewResource.name} className="max-w-full max-h-[65vh] object-contain" />
                )}
                {previewResource.type === 'pdf' && (
                  <iframe src={previewResource.url} className="w-full h-[65vh]" title={previewResource.name} />
                )}
                {previewResource.type === 'video' && (
                  <video src={previewResource.url} controls className="max-w-full max-h-[65vh]" />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Resource?</h3>
              <p className="text-gray-600 text-sm mb-6">This action cannot be undone.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-3 bg-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-300 transition-colors min-h-[48px]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors min-h-[48px]"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
