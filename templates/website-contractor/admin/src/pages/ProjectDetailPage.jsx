import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { API_BASE, getImageUrl } from '../utils/imageUrl';

function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [relatedProjects, setRelatedProjects] = useState([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProject = async () => {
      try {
        const projectRes = await fetch(`${API_BASE}/admin/gallery/${id}`);
        if (projectRes.ok) {
          const data = await projectRes.json();
          setProject(data);
          
          const allRes = await fetch(`${API_BASE}/admin/gallery`);
          if (allRes.ok) {
            const allProjects = await allRes.json();
            const related = allProjects
              .filter(p => p.id !== id && p.category === data.category)
              .slice(0, 3);
            setRelatedProjects(related);
          }
        } else {
          navigate('/gallery');
        }
      } catch (err) {
        console.error('Failed to load project:', err);
        navigate('/gallery');
      }
      setLoading(false);
      window.scrollTo(0, 0);
    };
    loadProject();
  }, [id, navigate]);

  const openLightbox = (index) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);
    document.body.style.overflow = 'hidden';
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    document.body.style.overflow = 'auto';
  };

  const nextImage = () => {
    if (!project?.images?.length) return;
    setCurrentImageIndex((prev) => 
      prev === project.images.length - 1 ? 0 : prev + 1
    );
  };

  const prevImage = () => {
    if (!project?.images?.length) return;
    setCurrentImageIndex((prev) => 
      prev === 0 ? project.images.length - 1 : prev - 1
    );
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!lightboxOpen) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') nextImage();
      if (e.key === 'ArrowLeft') prevImage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, project]);

  if (loading) {
    return (
      <div className="project-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (!project) return null;

  const images = project.images || [];
  const completedYear = project.completedAt ? new Date(project.completedAt).getFullYear() : null;

  return (
    <div className="project-detail">
      {/* Hero Section - Full Width Image */}
      <section className="project-hero">
        {images.length > 0 ? (
          <div className="project-hero-image" onClick={() => openLightbox(0)}>
            <img src={getImageUrl(images[0].url)} alt={project.title} />
            <div className="hero-zoom-hint">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="11" y1="8" x2="11" y2="14"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
              </svg>
              <span>Click to enlarge</span>
            </div>
          </div>
        ) : (
          <div className="project-hero-placeholder">
            <span>{project.category}</span>
          </div>
        )}
      </section>

      {/* Project Info Bar */}
      <section className="project-info-bar">
        <div className="container">
          <div className="project-info-content">
            <div className="project-info-main">
              <nav className="project-breadcrumb">
                <Link to="/">Home</Link>
                <span className="sep">/</span>
                <Link to="/gallery">Projects</Link>
                <span className="sep">/</span>
                <span>{project.title}</span>
              </nav>
              <h1>{project.title}</h1>
            </div>
            <div className="project-info-meta">
              {project.category && (
                <div className="meta-item">
                  <span className="meta-label">Category</span>
                  <span className="meta-value">{project.category}</span>
                </div>
              )}
              {project.location && (
                <div className="meta-item">
                  <span className="meta-label">Location</span>
                  <span className="meta-value">{project.location}</span>
                </div>
              )}
              {completedYear && (
                <div className="meta-item">
                  <span className="meta-label">Completed</span>
                  <span className="meta-value">{completedYear}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="project-content">
        <div className="container">
          <div className="project-layout">
            {/* Left Column - Gallery & Description */}
            <div className="project-main">
              {/* Thumbnail Gallery */}
              {images.length > 1 && (
                <div className="project-gallery-grid">
                  {images.slice(1, 7).map((image, index) => (
                    <div 
                      key={index}
                      className="gallery-thumb"
                      onClick={() => openLightbox(index + 1)}
                    >
                      <img 
                        src={getImageUrl(image.thumbnail || image.url)}
                        alt={image.caption || `Project image ${index + 2}`}
                      />
                      <div className="thumb-overlay">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                      </div>
                    </div>
                  ))}
                  {images.length > 7 && (
                    <div 
                      className="gallery-thumb more-photos"
                      onClick={() => openLightbox(7)}
                    >
                      <img 
                        src={getImageUrl(images[7].thumbnail || images[7].url)}
                        alt="More photos"
                      />
                      <div className="more-overlay">
                        <span>+{images.length - 7}</span>
                        <span>more photos</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Project Description */}
              <div className="project-description">
                <h2>About This Project</h2>
                <p>{project.description || 'Professional workmanship and quality materials deliver lasting results for this project.'}</p>
              </div>
            </div>

            {/* Right Column - CTA Sidebar */}
            <aside className="project-sidebar">
              <div className="cta-card">
                <h3>Want Similar Results?</h3>
                <p>Get a free, no-obligation estimate for your project.</p>
                <Link to="/#contact" className="btn btn-primary btn-block">
                  Get Free Estimate
                </Link>
                <a href="tel:7159449065" className="btn btn-outline btn-block">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                  (715)-944-9065
                </a>
              </div>

              <div className="trust-indicators">
                <div className="trust-item">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    <polyline points="9 12 11 14 15 10"></polyline>
                  </svg>
                  <span>Licensed & Insured</span>
                </div>
                <div className="trust-item">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="8" r="7"></circle>
                    <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
                  </svg>
                  <span>Quality Guaranteed</span>
                </div>
                <div className="trust-item">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <span>Free Estimates</span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* Related Projects */}
      {relatedProjects.length > 0 && (
        <section className="related-projects">
          <div className="container">
            <div className="section-header">
              <h2>Similar Projects</h2>
              <Link to="/gallery" className="view-all-link">View All Projects →</Link>
            </div>
            <div className="related-grid">
              {relatedProjects.map(rp => (
                <Link to={`/gallery/${rp.id}`} key={rp.id} className="related-card">
                  <div className="related-image">
                    {rp.images?.[0] ? (
                      <img 
                        src={getImageUrl(rp.images[0].thumbnail || rp.images[0].url)}
                        alt={rp.title}
                      />
                    ) : (
                      <div className="placeholder">
                        <span>{rp.category}</span>
                      </div>
                    )}
                    <div className="related-overlay">
                      <span>View Project</span>
                    </div>
                  </div>
                  <div className="related-info">
                    <span className="related-category">{rp.category}</span>
                    <h3>{rp.title}</h3>
                    {rp.location && <p>{rp.location}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Bottom CTA */}
      <section className="project-bottom-cta">
        <div className="container">
          <h2>Ready to Start Your Project?</h2>
          <p>Contact {{COMPANY_NAME}} for a free estimate on your roofing, siding, or window project.</p>
          <div className="cta-buttons">
            <Link to="/#contact" className="btn btn-primary btn-lg">Get Free Estimate</Link>
            <a href="tel:7159449065" className="btn btn-outline-light btn-lg">Call (715)-944-9065</a>
          </div>
        </div>
      </section>

      {/* Lightbox */}
      {lightboxOpen && images.length > 0 && (
        <div className="lightbox" onClick={closeLightbox}>
          <button className="lightbox-close" onClick={closeLightbox} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          
          {images.length > 1 && (
            <>
              <button className="lightbox-nav prev" onClick={(e) => { e.stopPropagation(); prevImage(); }} aria-label="Previous">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
              <button className="lightbox-nav next" onClick={(e) => { e.stopPropagation(); nextImage(); }} aria-label="Next">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </>
          )}

          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img 
              src={getImageUrl(images[currentImageIndex].url)}
              alt={images[currentImageIndex].caption || `Image ${currentImageIndex + 1}`}
            />
            {(images[currentImageIndex]?.caption || images.length > 1) && (
              <div className="lightbox-footer">
                {images[currentImageIndex]?.caption && (
                  <p className="lightbox-caption">{images[currentImageIndex].caption}</p>
                )}
                {images.length > 1 && (
                  <span className="lightbox-counter">{currentImageIndex + 1} / {images.length}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectDetailPage;
