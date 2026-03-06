import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, getImageUrl } from '../utils/imageUrl';

function GalleryPage() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadGallery = async () => {
      try {
        const projectsRes = await fetch(`${API_BASE}/admin/gallery`);
        if (projectsRes.ok) {
          const data = await projectsRes.json();
          setProjects(data);
          const cats = [...new Set(data.map(p => p.category))].filter(Boolean);
          setCategories(cats);
        }
      } catch (err) {
        console.error('Failed to load gallery:', err);
      }
      setLoading(false);
    };
    loadGallery();
  }, []);

  const filteredProjects = activeFilter === 'all' 
    ? projects 
    : projects.filter(p => p.category === activeFilter);

  const getCoverImage = (project) => {
    if (project.images && project.images.length > 0) {
      return getImageUrl(project.images[0].thumbnail || project.images[0].url);
    }
    return null;
  };

  return (
    <div className="gallery-page">
      {/* Hero Section */}
      <section className="gallery-hero">
        <div className="gallery-hero-bg"></div>
        <div className="gallery-hero-content">
          <div className="container">
            <h1>Our Work</h1>
            <p>Browse our portfolio of completed projects throughout the {{SERVICE_REGION}}</p>
          </div>
        </div>
      </section>

      {/* Filter Bar */}
      <section className="gallery-filters">
        <div className="container">
          <div className="filter-buttons">
            <button 
              className={`filter-btn ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              All Projects
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                className={`filter-btn ${activeFilter === cat ? 'active' : ''}`}
                onClick={() => setActiveFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="results-count">
            {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''}
          </div>
        </div>
      </section>

      {/* Projects Grid */}
      <section className="gallery-grid-section">
        <div className="container">
          {loading ? (
            <div className="gallery-loading">
              <div className="loading-spinner"></div>
              <p>Loading projects...</p>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="gallery-empty">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <h3>No projects found</h3>
              <p>Try selecting a different category</p>
            </div>
          ) : (
            <div className="gallery-grid">
              {filteredProjects.map(project => (
                <Link 
                  to={`/gallery/${project.id}`} 
                  key={project.id} 
                  className="gallery-card"
                >
                  <div className="gallery-card-image">
                    {getCoverImage(project) ? (
                      <img 
                        src={getCoverImage(project)} 
                        alt={project.title}
                        loading="lazy"
                      />
                    ) : (
                      <div className="gallery-card-placeholder">
                        <span>{project.category}</span>
                      </div>
                    )}
                    <div className="gallery-card-overlay">
                      <span className="view-btn">View Project</span>
                    </div>
                    {project.images?.length > 1 && (
                      <span className="photo-count">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                          <circle cx="8.5" cy="8.5" r="1.5"></circle>
                          <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        {project.images.length}
                      </span>
                    )}
                  </div>
                  <div className="gallery-card-content">
                    <span className="project-category">{project.category}</span>
                    <h3>{project.title}</h3>
                    {project.location && (
                      <p className="project-location">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                          <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        {project.location}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA Section */}
      <section className="gallery-cta">
        <div className="container">
          <div className="cta-content">
            <h2>Ready to Start Your Project?</h2>
            <p>Contact us today for a free estimate on your roofing, siding, or window project.</p>
            <div className="cta-buttons">
              <Link to="/#contact" className="btn btn-primary btn-lg">Get Free Estimate</Link>
              <a href="tel:{{COMPANY_PHONE_RAW}}" className="btn btn-outline-light btn-lg">Call {{COMPANY_PHONE}}</a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default GalleryPage;
