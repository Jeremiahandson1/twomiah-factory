import { useState, useEffect, useRef } from 'react';
import { Camera, Upload, X, ZoomIn, Trash2, Edit2, ChevronLeft, ChevronRight, Loader2, Image } from 'lucide-react';
import api from '../../services/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const CATEGORIES = [
  { value: 'before', label: 'Before', color: 'bg-blue-100 text-blue-700' },
  { value: 'during', label: 'During', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'after', label: 'After', color: 'bg-green-100 text-green-700' },
  { value: 'progress', label: 'Progress', color: 'bg-purple-100 text-purple-700' },
  { value: 'issue', label: 'Issue', color: 'bg-red-100 text-red-700' },
  { value: 'material', label: 'Material', color: 'bg-orange-100 text-orange-700' },
  { value: 'equipment', label: 'Equipment', color: 'bg-gray-100 text-gray-700' },
  { value: 'safety', label: 'Safety', color: 'bg-amber-100 text-amber-700' },
  { value: 'inspection', label: 'Inspection', color: 'bg-cyan-100 text-cyan-700' },
  { value: 'other', label: 'Other', color: 'bg-gray-100 text-gray-600' },
];

/**
 * Photo Gallery Component
 * 
 * Usage:
 *   <PhotoGallery projectId="abc123" />
 *   <PhotoGallery jobId="xyz789" />
 */
export default function PhotoGallery({ projectId, jobId, title = 'Photos', showUpload = true }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [filter, setFilter] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadPhotos();
  }, [projectId, jobId, filter]);

  const loadPhotos = async () => {
    try {
      const params = new URLSearchParams();
      if (projectId) params.append('projectId', projectId);
      if (jobId) params.append('jobId', jobId);
      if (filter) params.append('category', filter);
      
      const result = await api.get(`/photos?${params}`);
      setPhotos(result.data || []);
    } catch (error) {
      console.error('Failed to load photos:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return;
    
    setUploading(true);
    const formData = new FormData();
    
    for (const file of files) {
      formData.append('photos', file);
    }
    if (projectId) formData.append('projectId', projectId);
    if (jobId) formData.append('jobId', jobId);
    
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`${API_URL}/photos/bulk`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      
      if (!response.ok) throw new Error('Upload failed');
      
      const result = await response.json();
      if (result.uploaded > 0) {
        loadPhotos();
      }
      if (result.failed > 0) {
        alert(`${result.failed} photo(s) failed to upload`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload photos');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (photoId) => {
    if (!confirm('Delete this photo?')) return;
    
    try {
      await api.delete(`/photos/${photoId}`);
      setPhotos(photos.filter(p => p.id !== photoId));
      if (selectedPhoto?.id === photoId) setSelectedPhoto(null);
    } catch (error) {
      alert('Failed to delete photo');
    }
  };

  const getCategoryStyle = (category) => {
    const cat = CATEGORIES.find(c => c.value === category);
    return cat?.color || 'bg-gray-100 text-gray-600';
  };

  const getCategoryLabel = (category) => {
    const cat = CATEGORIES.find(c => c.value === category);
    return cat?.label || category;
  };

  return (
    <div className="photo-gallery">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        
        <div className="flex items-center gap-2">
          {/* Category filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
          
          {/* Upload button */}
          {showUpload && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handleUpload(e.target.files)}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                Upload
              </button>
            </>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      )}

      {/* Empty state */}
      {!loading && photos.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 text-gray-900">
          <Camera className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 mb-2">No photos yet</p>
          {showUpload && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-orange-600 hover:underline text-sm"
            >
              Upload your first photo
            </button>
          )}
        </div>
      )}

      {/* Photo grid */}
      {!loading && photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative group aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-pointer"
              onClick={() => setSelectedPhoto(photo)}
            >
              <img
                src={`${API_URL}/photos/${photo.id}/thumbnail`}
                alt={photo.caption || 'Photo'}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              
              {/* Category badge */}
              {photo.category && (
                <span className={`absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-medium ${getCategoryStyle(photo.category)}`}>
                  {getCategoryLabel(photo.category)}
                </span>
              )}
              
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button className="p-2 bg-white rounded-full hover:bg-gray-100">
                  <ZoomIn className="w-5 h-5 text-gray-700" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(photo.id); }}
                  className="p-2 bg-white rounded-full hover:bg-red-50"
                >
                  <Trash2 className="w-5 h-5 text-red-600" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {selectedPhoto && (
        <PhotoLightbox
          photo={selectedPhoto}
          photos={photos}
          onClose={() => setSelectedPhoto(null)}
          onNavigate={setSelectedPhoto}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

/**
 * Photo Lightbox
 */
function PhotoLightbox({ photo, photos, onClose, onNavigate, onDelete }) {
  const currentIndex = photos.findIndex(p => p.id === photo.id);

  const handlePrev = () => {
    if (currentIndex > 0) onNavigate(photos[currentIndex - 1]);
  };

  const handleNext = () => {
    if (currentIndex < photos.length - 1) onNavigate(photos[currentIndex + 1]);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentIndex]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-white hover:bg-white/20 rounded-lg z-10"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Navigation */}
      {currentIndex > 0 && (
        <button
          onClick={handlePrev}
          className="absolute left-4 p-2 text-white hover:bg-white/20 rounded-lg"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}
      {currentIndex < photos.length - 1 && (
        <button
          onClick={handleNext}
          className="absolute right-4 p-2 text-white hover:bg-white/20 rounded-lg"
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {/* Image */}
      <img
        src={`${API_URL}/photos/${photo.id}/file`}
        alt={photo.caption || 'Photo'}
        className="max-w-full max-h-[85vh] object-contain"
      />

      {/* Info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            {photo.caption && <p className="font-medium">{photo.caption}</p>}
            <p className="text-sm text-gray-300">
              {photo.uploadedBy && `${photo.uploadedBy.firstName} ${photo.uploadedBy.lastName} • `}
              {new Date(photo.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">
              {currentIndex + 1} / {photos.length}
            </span>
            <button
              onClick={() => onDelete(photo.id)}
              className="p-2 hover:bg-white/20 rounded-lg"
            >
              <Trash2 className="w-5 h-5 text-red-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Photo Upload Dropzone
 */
export function PhotoDropzone({ projectId, jobId, onUpload, category }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      await uploadFiles(files);
    }
  };

  const uploadFiles = async (files) => {
    setUploading(true);
    const formData = new FormData();
    
    for (const file of files) {
      formData.append('photos', file);
    }
    if (projectId) formData.append('projectId', projectId);
    if (jobId) formData.append('jobId', jobId);
    if (category) formData.append('category', category);
    
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`${API_URL}/photos/bulk`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      
      if (!response.ok) throw new Error('Upload failed');
      
      const result = await response.json();
      if (onUpload) onUpload(result);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload photos');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
        ${dragging ? 'border-orange-500 bg-orange-50' : 'border-gray-300 hover:border-gray-400'}
      `}
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => uploadFiles(Array.from(e.target.files))}
        className="hidden"
      />
      
      {uploading ? (
        <Loader2 className="w-10 h-10 text-orange-500 mx-auto animate-spin" />
      ) : (
        <Camera className="w-10 h-10 text-gray-400 mx-auto" />
      )}
      
      <p className="mt-2 text-gray-600">
        {uploading ? 'Uploading...' : 'Drop photos here or click to upload'}
      </p>
      <p className="text-sm text-gray-400 mt-1">
        Supports JPG, PNG, HEIC up to 20MB
      </p>
    </div>
  );
}
