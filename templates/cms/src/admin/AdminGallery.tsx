import React, { useState, useEffect, useRef } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import ImagePicker from './ImagePicker';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const CATEGORIES = ['Roofing', 'Siding', 'Windows', 'Insulation', 'Remodeling', 'New Construction'];

function AdminGallery() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    category: 'Roofing',
    location: '',
    description: '',
    images: [],
    featured: true,
    completedAt: new Date().toISOString().slice(0, 7)
  });
  const fileInputRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/admin/gallery`);
      const data = await response.json();
      setProjects(data);
    } catch (err) {
      toast.error('Failed to load projects');
    }
    setLoading(false);
  };

  const getToken = () => localStorage.getItem('adminToken');

  const handleSave = async () => {
    if (!formData.title) {
      toast.error('Project title is required');
      return;
    }

    try {
      const url = editing 
        ? `${API_BASE}/admin/gallery/${editing}`
        : `${API_BASE}/admin/gallery`;
      
      const response = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        toast.success(editing ? 'Project updated!' : 'Project added!');
        loadProjects();
        setEditing(null);
        setShowForm(false);
        resetForm();
      } else {
        throw new Error('Failed to save');
      }
    } catch (err) {
      toast.error('Failed to save project');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this project? This cannot be undone.')) return;

    try {
      const response = await fetch(`${API_BASE}/admin/gallery/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });

      if (response.ok) {
        toast.success('Project deleted');
        loadProjects();
      }
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  const handleEdit = (project) => {
    setEditing(project.id);
    setFormData({
      title: project.title,
      category: project.category || 'Roofing',
      location: project.location || '',
      description: project.description || '',
      images: project.images || [],
      featured: project.featured !== false,
      completedAt: project.completedAt || new Date().toISOString().slice(0, 7)
    });
    setShowForm(true);
    // Scroll to top on mobile
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setFormData({
      title: '',
      category: 'Roofing',
      location: '',
      description: '',
      images: [],
      featured: true,
      completedAt: new Date().toISOString().slice(0, 7)
    });
  };

  const handleImageUpload = async (e) => {
    if (uploading) return;
    
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    if (fileInputRef.current) fileInputRef.current.value = '';
    setUploading(true);
    
    try {
      const formDataUpload = new FormData();
      files.forEach(file => formDataUpload.append('images', file));
      formDataUpload.append('folder', 'Gallery');
      
      const response = await fetch(`${API_BASE}/admin/upload-multiple`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
        body: formDataUpload
      });
      
      if (response.ok) {
        const data = await response.json();
        const newImages = data.images.map(img => ({
          url: img.url,
          thumbnail: img.thumbnail,
          caption: ''
        }));
        
        setFormData(prev => ({
          ...prev,
          images: [...prev.images, ...newImages]
        }));
        
        toast.success(`${files.length} image(s) uploaded!`);
      }
    } catch (err) {
      toast.error('Upload failed');
    }
    
    setUploading(false);
  };

  // Handle drag and drop for file upload
  const handleDrop = async (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files?.length > 0) {
      // Create a fake event to reuse handleImageUpload
      handleImageUpload({ target: { files } });
    }
  };

  const removeImage = (index) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }));
  };

  const updateImageCaption = (index, caption) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images.map((img, i) => i === index ? { ...img, caption } : img)
    }));
  };

  // Move image up/down (mobile-friendly alternative to drag)
  const moveImage = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= formData.images.length) return;
    
    setFormData(prev => {
      const images = [...prev.images];
      const [moved] = images.splice(index, 1);
      images.splice(newIndex, 0, moved);
      return { ...prev, images };
    });
  };

  // Move project up/down
  const moveProject = async (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= projects.length) return;
    
    const newProjects = [...projects];
    const [moved] = newProjects.splice(index, 1);
    newProjects.splice(newIndex, 0, moved);
    setProjects(newProjects);
    
    // Save order
    try {
      const order = newProjects.map(p => p.id);
      await fetch(`${API_BASE}/admin/gallery-reorder`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ order })
      });
    } catch (err) {
      toast.error('Failed to save order');
    }
  };

  return (
    <AdminLayout 
      title="Gallery Manager" 
      subtitle="Manage your portfolio of completed projects"
      actions={
        !showForm && (
          <button 
            className="admin-btn admin-btn-primary"
            onClick={() => { setShowForm(true); setEditing(null); resetForm(); }}
          >
            + Add Project
          </button>
        )
      }
    >
      {/* Add/Edit Form */}
      {showForm && (
        <div className="admin-section">
          <div className="admin-card" style={{ padding: '20px' }}>
            <h3 style={{ marginBottom: '20px' }}>{editing ? 'Edit Project' : 'Add New Project'}</h3>
            
            <div className="form-group">
              <label>Project Title *</label>
              <input 
                type="text" 
                value={formData.title}
                onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="e.g., Complete Roof Replacement"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Category</label>
                <select 
                  value={formData.category}
                  onChange={e => setFormData(prev => ({ ...prev, category: e.target.value }))}
                >
                  {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Location</label>
                <input 
                  type="text" 
                  value={formData.location}
                  onChange={e => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  placeholder="e.g., {{CITY}}, {{STATE}}"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Completed Date</label>
                <input 
                  type="month" 
                  value={formData.completedAt}
                  onChange={e => setFormData(prev => ({ ...prev, completedAt: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '28px' }}>
                  <input 
                    type="checkbox" 
                    checked={formData.featured}
                    onChange={e => setFormData(prev => ({ ...prev, featured: e.target.checked }))}
                    style={{ width: 'auto' }}
                  />
                  Featured on homepage
                </label>
              </div>
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea 
                value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Describe the project..."
                rows={3}
              />
            </div>

            {/* Image Upload Area */}
            <div className="form-group">
              <label>Project Images</label>
              <div 
                className={`upload-dropzone ${uploading ? 'uploading' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                style={{ minHeight: '120px' }}
              >
                {uploading ? (
                  <div className="upload-spinner"></div>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '36px', height: '36px', marginBottom: '8px' }}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="17 8 12 3 7 8"></polyline>
                      <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                    <span>Tap to upload or drop images</span>
                  </>
                )}
                <input 
                  ref={fileInputRef}
                  type="file" 
                  accept="image/*" 
                  multiple
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
              </div>
            </div>

            {/* Image Grid */}
            {formData.images.length > 0 && (
              <div className="project-images-grid">
                {formData.images.map((img, index) => (
                  <div key={index} className="project-image-card">
                    <div className="project-image-preview">
                      <img 
                        src={getImageUrl(img.thumbnail || img.url)} 
                        alt={img.caption || `Image ${index + 1}`}
                      />
                      {index === 0 && (
                        <span className="cover-badge">Cover</span>
                      )}
                    </div>
                    
                    <input 
                      type="text"
                      placeholder="Caption"
                      value={img.caption || ''}
                      onChange={e => updateImageCaption(index, e.target.value)}
                      className="image-caption-input"
                    />
                    
                    <div className="image-actions">
                      <button 
                        type="button"
                        className="reorder-btn"
                        onClick={() => moveImage(index, -1)}
                        disabled={index === 0}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button 
                        type="button"
                        className="reorder-btn"
                        onClick={() => moveImage(index, 1)}
                        disabled={index === formData.images.length - 1}
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button 
                        type="button"
                        className="reorder-btn danger"
                        onClick={() => removeImage(index)}
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="form-actions">
              <button className="admin-btn admin-btn-primary" onClick={handleSave}>
                {editing ? 'Update Project' : 'Add Project'}
              </button>
              <button 
                className="admin-btn admin-btn-secondary"
                onClick={() => { setShowForm(false); setEditing(null); resetForm(); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Projects Grid */}
      <div className="admin-section">
        <div className="section-header">
          <h3>All Projects ({projects.length})</h3>
          <p className="section-hint">Tap arrows to reorder projects</p>
        </div>

        {loading ? (
          <div className="loading-skeleton">
            <div className="skeleton-content" style={{ height: '300px' }}></div>
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <h3>No projects yet</h3>
            <p>Add your first project to showcase your work!</p>
            <button 
              className="admin-btn admin-btn-primary"
              onClick={() => { setShowForm(true); resetForm(); }}
            >
              + Add Project
            </button>
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map((project, index) => (
              <div key={project.id} className="project-card">
                {/* Cover Image */}
                <div className="project-cover">
                  {project.images?.[0] ? (
                    <img 
                      src={getImageUrl(project.images[0].thumbnail || project.images[0].url)} 
                      alt={project.title}
                    />
                  ) : (
                    <div className="project-cover-placeholder">
                      <span>No Image</span>
                    </div>
                  )}
                  <span className="project-category">{project.category}</span>
                  {project.featured && <span className="project-featured">★ Featured</span>}
                  <span className="project-image-count">{project.images?.length || 0} photos</span>
                </div>

                <div className="project-info">
                  <h4>{project.title}</h4>
                  {project.location && (
                    <p className="project-location">📍 {project.location}</p>
                  )}
                  {project.description && (
                    <p className="project-description">{project.description}</p>
                  )}
                  
                  <div className="project-actions">
                    <div className="reorder-buttons">
                      <button 
                        className="reorder-btn"
                        onClick={() => moveProject(index, -1)}
                        disabled={index === 0}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button 
                        className="reorder-btn"
                        onClick={() => moveProject(index, 1)}
                        disabled={index === projects.length - 1}
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>
                    <button 
                      className="admin-btn admin-btn-secondary admin-btn-sm"
                      onClick={() => handleEdit(project)}
                    >
                      ✏️ Edit
                    </button>
                    <button 
                      className="admin-btn admin-btn-danger admin-btn-sm"
                      onClick={() => handleDelete(project.id)}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Styles */}
      <style>{`
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          flex-wrap: wrap;
          gap: 8px;
        }
        
        .section-header h3 {
          margin: 0;
        }
        
        .section-hint {
          color: var(--admin-text-secondary);
          font-size: 0.85rem;
          margin: 0;
        }
        
        .projects-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
        }
        
        @media (max-width: 600px) {
          .projects-grid {
            grid-template-columns: 1fr;
          }
        }
        
        .project-card {
          background: var(--admin-surface);
          border: 1px solid var(--admin-border);
          border-radius: 12px;
          overflow: hidden;
        }
        
        .project-cover {
          position: relative;
          aspect-ratio: 16 / 10;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        
        .project-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .project-cover-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 0.9rem;
          opacity: 0.8;
        }
        
        .project-category {
          position: absolute;
          top: 12px;
          left: 12px;
          background: rgba(0,0,0,0.6);
          color: white;
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 0.75rem;
        }
        
        .project-featured {
          position: absolute;
          top: 12px;
          right: 12px;
          background: var(--admin-success);
          color: white;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 0.7rem;
        }
        
        .project-image-count {
          position: absolute;
          bottom: 12px;
          right: 12px;
          background: rgba(0,0,0,0.6);
          color: white;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 0.75rem;
        }
        
        .project-info {
          padding: 16px;
        }
        
        .project-info h4 {
          margin: 0 0 8px 0;
          font-size: 1rem;
        }
        
        .project-location {
          color: var(--admin-text-secondary);
          font-size: 0.85rem;
          margin: 0 0 8px 0;
        }
        
        .project-description {
          color: var(--admin-text-secondary);
          font-size: 0.85rem;
          margin: 0 0 12px 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        
        .project-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        
        .reorder-buttons {
          display: flex;
          gap: 4px;
          margin-right: auto;
        }
        
        .reorder-btn {
          width: 32px;
          height: 32px;
          border: 1px solid var(--admin-border);
          border-radius: 6px;
          background: var(--admin-surface);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 14px;
          color: var(--admin-text-secondary);
          transition: all 0.15s;
        }
        
        .reorder-btn:hover:not(:disabled) {
          border-color: var(--admin-primary);
          color: var(--admin-primary);
        }
        
        .reorder-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        
        .reorder-btn.danger:hover:not(:disabled) {
          border-color: var(--admin-error);
          color: var(--admin-error);
          background: var(--admin-error-bg);
        }
        
        /* Project Images Grid in Form */
        .project-images-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 12px;
          margin-top: 12px;
        }
        
        @media (max-width: 500px) {
          .project-images-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        
        .project-image-card {
          background: var(--admin-surface);
          border: 1px solid var(--admin-border);
          border-radius: 8px;
          overflow: hidden;
        }
        
        .project-image-preview {
          position: relative;
          aspect-ratio: 1;
        }
        
        .project-image-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .cover-badge {
          position: absolute;
          bottom: 6px;
          left: 6px;
          background: var(--admin-primary);
          color: white;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.65rem;
          font-weight: 600;
        }
        
        .image-caption-input {
          width: 100%;
          border: none;
          border-top: 1px solid var(--admin-border);
          padding: 8px;
          font-size: 0.8rem;
          background: var(--admin-bg);
        }
        
        .image-caption-input:focus {
          outline: none;
          background: var(--admin-surface);
        }
        
        .image-actions {
          display: flex;
          gap: 4px;
          padding: 8px;
          background: var(--admin-bg);
          border-top: 1px solid var(--admin-border);
        }
        
        .image-actions .reorder-btn {
          flex: 1;
          height: 28px;
        }
        
        .form-actions {
          display: flex;
          gap: 12px;
          margin-top: 20px;
        }
        
        @media (max-width: 500px) {
          .form-actions {
            flex-direction: column;
          }
          
          .form-actions button {
            width: 100%;
          }
        }
      `}</style>
    </AdminLayout>
  );
}

export default AdminGallery;
