import React, { useState, useEffect, useRef } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import AdminLayout from './AdminLayout';
import ImageEditor from './ImageEditor';
import { useToast } from './Toast';
import { getImages, uploadImage, deleteImage, updateImage, getMediaFolders, createMediaFolder, deleteMediaFolder, bulkImageAction } from './api';

function AdminMedia() {
  const [images, setImages] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('all');
  const [selectedImages, setSelectedImages] = useState([]);
  const [editingImage, setEditingImage] = useState(null);
  const [editAltText, setEditAltText] = useState('');
  const [editFolder, setEditFolder] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [viewingImage, setViewingImage] = useState(null);
  const [cropImage, setCropImage] = useState(null);
  const fileInputRef = useRef(null);
  const uploadingRef = useRef(false);
  const toast = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [imagesData, foldersData] = await Promise.all([
        getImages(),
        getMediaFolders()
      ]);
      setImages(imagesData || []);
      setFolders(foldersData || []);
    } catch (err) {
      toast.error('Failed to load media');
    }
    setLoading(false);
  };

  const handleUpload = async (files) => {
    if (uploadingRef.current || !files?.length) return;
    
    uploadingRef.current = true;
    setUploading(true);
    
    try {
      for (const file of files) {
        await uploadImage(file, selectedFolder === 'all' ? 'Uncategorized' : selectedFolder);
      }
      toast.success(`Uploaded ${files.length} image(s)`);
      loadData();
    } catch (err) {
      toast.error('Upload failed: ' + err.message);
    }
    
    setUploading(false);
    uploadingRef.current = false;
  };

  const handleFileInputChange = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    handleUpload(files);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    handleUpload(files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDelete = async (filename) => {
    if (!confirm('Delete this image?')) return;
    try {
      await deleteImage(filename);
      setImages(images.filter(i => i.filename !== filename));
      toast.success('Image deleted');
    } catch (err) {
      toast.error('Delete failed');
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedImages.length) return;
    if (!confirm(`Delete ${selectedImages.length} images?`)) return;
    
    try {
      await bulkImageAction('delete', selectedImages);
      setImages(images.filter(i => !selectedImages.includes(i.filename)));
      setSelectedImages([]);
      toast.success('Images deleted');
    } catch (err) {
      toast.error('Delete failed');
    }
  };

  const handleBulkMove = async (folder) => {
    if (!selectedImages.length || !folder) return;
    
    try {
      await bulkImageAction('move', selectedImages, folder);
      loadData();
      setSelectedImages([]);
      toast.success('Images moved');
    } catch (err) {
      toast.error('Move failed');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingImage) return;
    
    try {
      await updateImage(editingImage.filename, { altText: editAltText, folder: editFolder });
      setImages(images.map(i => 
        i.filename === editingImage.filename 
          ? { ...i, altText: editAltText, folder: editFolder }
          : i
      ));
      setEditingImage(null);
      toast.success('Image updated');
    } catch (err) {
      toast.error('Update failed');
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    
    try {
      await createMediaFolder(newFolderName);
      loadData();
      setShowNewFolder(false);
      setNewFolderName('');
      toast.success('Folder created');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteFolder = async (folderId) => {
    if (!confirm('Delete this folder? Images will be moved to "Uncategorized".')) return;
    
    try {
      await deleteMediaFolder(folderId);
      loadData();
      setSelectedFolder('all');
      toast.success('Folder deleted');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleSelect = (filename) => {
    setSelectedImages(prev => 
      prev.includes(filename)
        ? prev.filter(f => f !== filename)
        : [...prev, filename]
    );
  };

  const selectAll = () => {
    const visible = filteredImages.map(i => i.filename);
    setSelectedImages(prev => 
      prev.length === visible.length ? [] : visible
    );
  };

  const copyUrl = (url) => {
    navigator.clipboard.writeText(getImageUrl(url));
    toast.success('URL copied!');
  };

  const filteredImages = selectedFolder === 'all' 
    ? images 
    : images.filter(i => i.folder === selectedFolder);

  return (
    <AdminLayout title="Media Library" subtitle="Upload and manage images">
      {/* Upload Area */}
      <div className="admin-section">
        <div 
          className={`upload-dropzone ${uploading ? 'uploading' : ''} ${dragOver ? 'drag-over' : ''}`}
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {uploading ? (
            <>
              <div className="upload-spinner"></div>
              <span>Uploading...</span>
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '48px', height: '48px', marginBottom: '12px' }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span>Tap to upload or drop images here</span>
              <span style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '4px' }}>
                Supports JPG, PNG, GIF, WebP
              </span>
            </>
          )}
          <input 
            ref={fileInputRef}
            type="file" 
            accept="image/*" 
            multiple
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* Folders */}
      <div className="admin-section">
        <div className="folders-bar">
          <div className="folders-list">
            <button 
              className={`folder-btn ${selectedFolder === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedFolder('all')}
            >
              📁 All ({images.length})
            </button>
            {folders.map((folder, index) => (
              <div key={folder || index} className="folder-item">
                <button 
                  className={`folder-btn ${selectedFolder === folder ? 'active' : ''}`}
                  onClick={() => setSelectedFolder(folder)}
                >
                  📁 {folder} ({images.filter(i => i.folder === folder).length})
                </button>
                {folder !== 'Uncategorized' && (
                  <button 
                    className="folder-delete"
                    onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder); }}
                    title="Delete folder"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => setShowNewFolder(true)}>
            + Folder
          </button>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedImages.length > 0 && (
        <div className="admin-section">
          <div className="bulk-actions">
            <span className="bulk-count">{selectedImages.length} selected</span>
            <select onChange={e => { handleBulkMove(e.target.value); e.target.value = ''; }} defaultValue="">
              <option value="">Move to...</option>
              {folders.map((f, index) => <option key={f || index} value={f}>{f}</option>)}
            </select>
            <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={handleBulkDelete}>
              Delete
            </button>
            <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => setSelectedImages([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Images Grid */}
      <div className="admin-section">
        {loading ? (
          <div className="loading-skeleton">
            <div className="skeleton-content" style={{ height: '300px' }}></div>
          </div>
        ) : filteredImages.length === 0 ? (
          <div className="empty-state">
            <h3>No images yet</h3>
            <p>Upload your first image to get started</p>
          </div>
        ) : (
          <>
            <div className="media-toolbar">
              <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={selectAll}>
                {selectedImages.length === filteredImages.length ? 'Deselect All' : 'Select All'}
              </button>
              <span className="media-count">{filteredImages.length} images</span>
            </div>
            <div className="media-grid">
              {filteredImages.map(image => (
                <div 
                  key={image.filename} 
                  className={`media-card ${selectedImages.includes(image.filename) ? 'selected' : ''}`}
                >
                  <div 
                    className="media-checkbox" 
                    onClick={(e) => { e.stopPropagation(); toggleSelect(image.filename); }}
                  >
                    {selectedImages.includes(image.filename) && '✓'}
                  </div>
                  <div 
                    className="media-preview"
                    onClick={() => setViewingImage(image)}
                  >
                    <img src={getImageUrl(image.url)} alt={image.altText || image.filename} loading="lazy" />
                  </div>
                  <div className="media-actions-bar">
                    <button onClick={() => copyUrl(image.url)} title="Copy URL">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                    <button onClick={() => setCropImage(image)} title="Crop / Rotate">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M6 2v14a2 2 0 0 0 2 2h14"></path>
                        <path d="M18 22V8a2 2 0 0 0-2-2H2"></path>
                      </svg>
                    </button>
                    <button onClick={() => { setEditingImage(image); setEditAltText(image.altText || ''); setEditFolder(image.folder || 'Uncategorized'); }} title="Edit Details">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(image.filename)} title="Delete" className="delete-btn">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Image Viewer Modal */}
      {viewingImage && (
        <div className="image-viewer-modal" onClick={() => setViewingImage(null)}>
          <button className="viewer-close" onClick={() => setViewingImage(null)}>×</button>
          <img src={getImageUrl(viewingImage.url)} alt={viewingImage.altText || ''} />
          <div className="viewer-info" onClick={e => e.stopPropagation()}>
            <p>{viewingImage.filename}</p>
            {viewingImage.altText && <p className="alt-text">{viewingImage.altText}</p>}
            <div className="viewer-actions">
              <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => copyUrl(viewingImage.url)}>
                Copy URL
              </button>
              <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => { 
                setCropImage(viewingImage);
                setViewingImage(null);
              }}>
                Crop / Rotate
              </button>
              <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => { 
                setEditingImage(viewingImage); 
                setEditAltText(viewingImage.altText || ''); 
                setEditFolder(viewingImage.folder || 'Uncategorized'); 
                setViewingImage(null);
              }}>
                Edit Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingImage && (
        <div className="modal-overlay" onClick={() => setEditingImage(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Edit Image</h3>
            <div style={{ textAlign: 'center', margin: '16px 0' }}>
              <img src={getImageUrl(editingImage.url)} alt="" style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px', objectFit: 'contain' }} />
            </div>
            <div className="form-group">
              <label>Alt Text (for accessibility & SEO)</label>
              <input 
                type="text"
                value={editAltText}
                onChange={e => setEditAltText(e.target.value)}
                placeholder="Describe this image..."
              />
            </div>
            <div className="form-group">
              <label>Folder</label>
              <select value={editFolder} onChange={e => setEditFolder(e.target.value)}>
                <option value="Uncategorized">Uncategorized</option>
                {folders.filter(f => f !== 'Uncategorized').map((f, index) => <option key={f || index} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setEditingImage(null)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={handleSaveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolder && (
        <div className="modal-overlay" onClick={() => setShowNewFolder(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Create Folder</h3>
            <div className="form-group">
              <label>Folder Name</label>
              <input 
                type="text"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="e.g. Projects, Team Photos"
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowNewFolder(false)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={handleCreateFolder}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Image Crop/Rotate Editor */}
      {cropImage && (
        <div className="media-editor-backdrop">
          <div className="media-editor-modal">
            <ImageEditor
              src={getImageUrl(cropImage.url)}
              folder={cropImage.folder || 'Edited'}
              onSave={(newUrl) => {
                setCropImage(null);
                toast.success('Image saved! New version added to library.');
                loadData();
              }}
              onCancel={() => setCropImage(null)}
            />
          </div>
        </div>
      )}

      {/* Styles */}
      <style>{`
        .upload-dropzone.drag-over {
          border-color: var(--admin-primary);
          background: var(--admin-primary-light);
          transform: scale(1.01);
        }
        
        .media-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        
        .media-count {
          color: var(--admin-text-secondary);
          font-size: 0.9rem;
        }
        
        .media-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }
        
        @media (max-width: 500px) {
          .media-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
          }
        }
        
        .media-card {
          position: relative;
          border-radius: 10px;
          overflow: hidden;
          background: var(--admin-surface);
          border: 2px solid var(--admin-border);
          transition: all 0.15s ease;
        }
        
        .media-card:hover,
        .media-card.selected {
          border-color: var(--admin-primary);
        }
        
        .media-card.selected {
          box-shadow: 0 0 0 2px var(--admin-primary-light);
        }
        
        .media-checkbox {
          position: absolute;
          top: 8px;
          left: 8px;
          width: 26px;
          height: 26px;
          border-radius: 6px;
          background: white;
          border: 2px solid var(--admin-border);
          cursor: pointer;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: bold;
          transition: all 0.15s;
        }
        
        .media-card.selected .media-checkbox {
          background: var(--admin-primary);
          border-color: var(--admin-primary);
          color: white;
        }
        
        .media-preview {
          aspect-ratio: 1;
          cursor: pointer;
          overflow: hidden;
        }
        
        .media-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.2s;
        }
        
        .media-card:hover .media-preview img {
          transform: scale(1.05);
        }
        
        .media-actions-bar {
          display: flex;
          justify-content: center;
          gap: 4px;
          padding: 8px;
          background: var(--admin-bg);
          border-top: 1px solid var(--admin-border);
        }
        
        .media-actions-bar button {
          width: 36px;
          height: 36px;
          border: 1px solid var(--admin-border);
          border-radius: 6px;
          background: var(--admin-surface);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--admin-text-secondary);
          transition: all 0.15s;
        }
        
        .media-actions-bar button:hover {
          border-color: var(--admin-primary);
          color: var(--admin-primary);
        }
        
        .media-actions-bar button.delete-btn:hover {
          border-color: var(--admin-error);
          color: var(--admin-error);
        }
        
        .bulk-count {
          font-weight: 600;
          color: var(--admin-primary);
        }
        
        /* Image Viewer Modal */
        .image-viewer-modal {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.9);
          z-index: 1000;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        
        .image-viewer-modal img {
          max-width: 100%;
          max-height: 70vh;
          object-fit: contain;
          border-radius: 8px;
        }
        
        .viewer-close {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 44px;
          height: 44px;
          border: none;
          background: rgba(255,255,255,0.1);
          color: white;
          font-size: 28px;
          border-radius: 50%;
          cursor: pointer;
        }
        
        .viewer-info {
          margin-top: 16px;
          text-align: center;
          color: white;
        }
        
        .viewer-info p {
          margin: 0 0 8px 0;
        }
        
        .viewer-info .alt-text {
          opacity: 0.7;
          font-size: 0.9rem;
        }
        
        .viewer-actions {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-top: 16px;
        }
        
        .folder-delete {
          position: absolute;
          top: -6px;
          right: -6px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--admin-error);
          color: white;
          border: 2px solid var(--admin-surface);
          cursor: pointer;
          font-size: 12px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        @media (hover: hover) {
          .folder-delete {
            opacity: 0;
            transition: opacity 0.15s;
          }
          
          .folder-item:hover .folder-delete {
            opacity: 1;
          }
        }

        .media-editor-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.85);
          z-index: 1001;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .media-editor-modal {
          width: 100%;
          height: 100%;
          max-width: 900px;
          display: flex;
          flex-direction: column;
          background: var(--admin-surface);
          overflow: hidden;
        }
        
        @media (min-width: 769px) {
          .media-editor-modal {
            max-height: 90vh;
            height: auto;
            border-radius: 16px;
            margin: 20px;
          }
        }
      `}</style>
    </AdminLayout>
  );
}

export default AdminMedia;
