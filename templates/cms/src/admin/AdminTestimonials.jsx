import React, { useState, useEffect } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import { uploadImage } from './api';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function AdminTestimonials() {
  const [testimonials, setTestimonials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({ text: '', author: '', location: '', rating: 5, featured: true, image: '' });
  const [draggedIndex, setDraggedIndex] = useState(null);
  const toast = useToast();

  useEffect(() => {
    loadTestimonials();
  }, []);

  const loadTestimonials = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/admin/testimonials`);
      const data = await response.json();
      setTestimonials(data);
    } catch (err) {
      toast.error('Failed to load testimonials');
    }
    setLoading(false);
  };

  const getToken = () => localStorage.getItem('adminToken');

  const handleSave = async () => {
    if (!formData.text || !formData.author) {
      toast.error('Quote text and author name are required');
      return;
    }

    try {
      const url = editing 
        ? `${API_BASE}/admin/testimonials/${editing}`
        : `${API_BASE}/admin/testimonials`;
      
      const response = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        toast.success(editing ? 'Testimonial updated!' : 'Testimonial added!');
        loadTestimonials();
        setEditing(null);
        setFormData({ text: '', author: '', location: '', rating: 5, featured: true, image: '' });
      } else {
        throw new Error('Failed to save');
      }
    } catch (err) {
      toast.error('Failed to save testimonial');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this testimonial?')) return;

    try {
      const response = await fetch(`${API_BASE}/admin/testimonials/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });

      if (response.ok) {
        toast.success('Testimonial deleted');
        loadTestimonials();
      }
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  const handleEdit = (testimonial) => {
    setEditing(testimonial.id);
    setFormData({
      text: testimonial.text,
      author: testimonial.author,
      location: testimonial.location || '',
      rating: testimonial.rating || 5,
      featured: testimonial.featured !== false,
      image: testimonial.image || ''
    });
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const result = await uploadImage(file);
      setFormData(prev => ({ ...prev, image: result.url }));
      toast.success('Image uploaded');
    } catch (err) {
      toast.error('Upload failed');
    }
  };

  // Drag and drop handlers
  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newTestimonials = [...testimonials];
    const [dragged] = newTestimonials.splice(draggedIndex, 1);
    newTestimonials.splice(index, 0, dragged);
    setTestimonials(newTestimonials);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    try {
      const order = testimonials.map(t => t.id);
      await fetch(`${API_BASE}/admin/testimonials/reorder`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ order })
      });
      toast.success('Order saved');
    } catch (err) {
      toast.error('Failed to save order');
    }
    setDraggedIndex(null);
  };

  const renderStars = (rating) => {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  };

  return (
    <AdminLayout 
      title="Testimonials" 
      subtitle="Manage customer reviews and testimonials"
    >
      {/* Add/Edit Form */}
      <div className="admin-section">
        <h3 style={{ marginBottom: '16px' }}>{editing ? 'Edit Testimonial' : 'Add New Testimonial'}</h3>
        
        <div className="form-group">
          <label>Customer Quote *</label>
          <textarea 
            value={formData.text}
            onChange={e => setFormData({ ...formData, text: e.target.value })}
            placeholder="What the customer said about your work..."
            rows={4}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Customer Name *</label>
            <input 
              type="text" 
              value={formData.author}
              onChange={e => setFormData({ ...formData, author: e.target.value })}
              placeholder="Mike & Sarah T."
            />
          </div>
          <div className="form-group">
            <label>Location</label>
            <input 
              type="text" 
              value={formData.location}
              onChange={e => setFormData({ ...formData, location: e.target.value })}
              placeholder="{{CITY}}, {{STATE}}"
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Rating</label>
            <select 
              value={formData.rating}
              onChange={e => setFormData({ ...formData, rating: parseInt(e.target.value) })}
            >
              <option value={5}>★★★★★ (5 stars)</option>
              <option value={4}>★★★★☆ (4 stars)</option>
              <option value={3}>★★★☆☆ (3 stars)</option>
              <option value={2}>★★☆☆☆ (2 stars)</option>
              <option value={1}>★☆☆☆☆ (1 star)</option>
            </select>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', marginTop: '28px' }}>
              <input 
                type="checkbox" 
                checked={formData.featured}
                onChange={e => setFormData({ ...formData, featured: e.target.checked })}
                style={{ marginRight: '8px' }}
              />
              Featured on homepage
            </label>
          </div>
        </div>

        <div className="form-group">
          <label>Customer Photo (optional)</label>
          <div className="image-upload-box" style={{ maxWidth: '200px' }}>
            {formData.image ? (
              <div className="image-preview">
                <img src={getImageUrl(formData.image)} alt="Customer" style={{ maxHeight: '100px', borderRadius: '50%' }} />
                <button 
                  className="admin-btn admin-btn-danger admin-btn-sm"
                  onClick={() => setFormData({ ...formData, image: '' })}
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="upload-label">
                <input type="file" accept="image/*" onChange={handleImageUpload} />
                <span>Upload photo</span>
              </label>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="admin-btn admin-btn-primary" onClick={handleSave}>
            {editing ? 'Update Testimonial' : 'Add Testimonial'}
          </button>
          {editing && (
            <button 
              className="admin-btn admin-btn-secondary"
              onClick={() => {
                setEditing(null);
                setFormData({ text: '', author: '', location: '', rating: 5, featured: true, image: '' });
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Testimonials List */}
      <div className="admin-section">
        <h3 style={{ marginBottom: '16px' }}>All Testimonials ({testimonials.length})</h3>
        <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '16px' }}>
          Drag and drop to reorder. Featured testimonials appear on the homepage.
        </p>

        {loading ? (
          <div className="loading-skeleton">
            <div className="skeleton-content" style={{ height: '200px' }}></div>
          </div>
        ) : testimonials.length === 0 ? (
          <div className="empty-state">
            <p>No testimonials yet. Add your first one above!</p>
          </div>
        ) : (
          <div className="testimonials-list">
            {testimonials.map((testimonial, index) => (
              <div 
                key={testimonial.id}
                className="card"
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                style={{ 
                  marginBottom: '16px', 
                  padding: '20px',
                  cursor: 'grab',
                  opacity: draggedIndex === index ? 0.5 : 1,
                  border: editing === testimonial.id ? '2px solid var(--admin-primary)' : undefined
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      {testimonial.image && (
                        <img 
                          src={getImageUrl(testimonial.image)} 
                          alt={testimonial.author}
                          style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }}
                        />
                      )}
                      <div>
                        <strong>{testimonial.author}</strong>
                        {testimonial.location && (
                          <span style={{ color: 'var(--admin-text-secondary)', marginLeft: '8px' }}>
                            — {testimonial.location}
                          </span>
                        )}
                        <div style={{ color: '#f59e0b' }}>{renderStars(testimonial.rating || 5)}</div>
                      </div>
                      {testimonial.featured && (
                        <span style={{ 
                          background: 'var(--admin-success-bg)', 
                          color: 'var(--admin-success)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}>
                          Featured
                        </span>
                      )}
                    </div>
                    <p style={{ 
                      fontStyle: 'italic', 
                      color: 'var(--admin-text-secondary)',
                      margin: 0,
                      lineHeight: 1.6
                    }}>
                      "{testimonial.text}"
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginLeft: '16px' }}>
                    <button 
                      className="admin-btn admin-btn-secondary admin-btn-sm"
                      onClick={() => handleEdit(testimonial)}
                    >
                      ✏️ Edit
                    </button>
                    <button 
                      className="admin-btn admin-btn-danger admin-btn-sm"
                      onClick={() => handleDelete(testimonial.id)}
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
    </AdminLayout>
  );
}

export default AdminTestimonials;
