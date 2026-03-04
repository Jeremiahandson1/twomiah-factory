import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { API_BASE, getImageUrl } from '../utils/imageUrl';

function ServicePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [service, setService] = useState(null);
  const [customContent, setCustomContent] = useState(null);
  const [relatedProjects, setRelatedProjects] = useState([]);
  const [galleryProjects, setGalleryProjects] = useState([]);
  const [allServices, setAllServices] = useState([]);
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    const loadContent = async () => {
      try {
        // Fetch service data from API
        const response = await fetch(`${API_BASE}/admin/services-data/${id}`);
        if (!response.ok) {
          navigate('/');
          return;
        }
        const s = await response.json();
        setService(s);

        // Use fullDescription as the main description if available
        if (s.fullDescription && !s._descriptionOverridden) {
          s.description = s.fullDescription;
        }

        // Load all services for "Other Services" section
        try {
          const allRes = await fetch(`${API_BASE}/admin/services-data`);
          if (allRes.ok) {
            const allData = await allRes.json();
            setAllServices(allData);
          }
        } catch (err) {
          console.log('Could not load all services');
        }

        // Load gallery projects for this category
        try {
          const galleryRes = await fetch(`${API_BASE}/admin/gallery`);
          if (galleryRes.ok) {
            const allProjects = await galleryRes.json();
            const filtered = allProjects
              .filter(p => p.category?.toLowerCase().includes(s.title.toLowerCase().split(' ')[0]))
              .slice(0, 3);
            setGalleryProjects(filtered);
          }
        } catch (err) {
          console.log('No gallery projects found');
        }
        
        window.scrollTo(0, 0);
      } catch (err) {
        console.error('Failed to load service:', err);
        navigate('/');
      }
    };
    
    loadContent();
  }, [id, navigate]);

  if (!service) {
    return (
      <div className="page-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  // Service data comes directly from API - use fullDescription if available
  const pageData = service;
  const description = service.fullDescription || service.description;
  const heroImage = pageData.heroImage;
  const heroAnimation = pageData.heroAnimation || 'none';
  const heroAnimationSpeed = pageData.heroAnimationSpeed || 10;

  return (
    <div className="service-page">
      {/* Hero Section */}
      <section className={`service-hero ${heroImage ? 'has-image' : ''}`} style={{ '--hero-speed': `${heroAnimationSpeed}s` }}>
        {heroImage && (
          <>
            <div 
              className={`service-hero-bg animation-${heroAnimation}`}
              style={{ backgroundImage: `url(${getImageUrl(heroImage)})` }}
            />
            <div className="service-hero-overlay" />
          </>
        )}
        <div className="service-hero-content">
          <div className="container">
            <Link to="/#services" className="back-link">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
              All Services
            </Link>
            <h1>{pageData.title}</h1>
            {pageData.tagline && <p className="hero-tagline">{pageData.tagline}</p>}
            {pageData.heroDescription && <p className="hero-description">{pageData.heroDescription}</p>}
            <div className="hero-buttons">
              <Link to="/#contact" className="btn btn-primary btn-lg">Get Free Estimate</Link>
              <a href="tel:7159449065" className="btn btn-outline-light btn-lg">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
                (715)-944-9065
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="service-main">
        <div className="container">
          <div className="service-layout">
            {/* Main Column */}
            <div className="service-content">
              <div className="content-section">
                <h2>Expert {pageData.title} Services</h2>
                {description && (
                  typeof description === 'string' && description.includes('<') 
                    ? <div className="prose" dangerouslySetInnerHTML={{ __html: description }} />
                    : <div className="prose">{description.split('\n\n').map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}</div>
                )}
              </div>

              {/* Services Offered */}
              {pageData.offerings && pageData.offerings.length > 0 && (
                <div className="offerings-section">
                  <h2>Our {pageData.title} Services</h2>
                  <div className="offerings-grid">
                    {pageData.offerings.map((offering, index) => (
                      <div key={index} className="offering-card">
                        <div className="offering-number">{String(index + 1).padStart(2, '0')}</div>
                        <h3>{offering.title}</h3>
                        <p>{offering.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Materials & Features */}
              {((pageData.materials && pageData.materials.length > 0) || (pageData.features && pageData.features.length > 0)) && (
                <div className="details-section">
                  <div className="details-grid">
                    {pageData.materials && pageData.materials.length > 0 && (
                      <div className="details-card">
                        <h3>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                          </svg>
                          Materials We Use
                        </h3>
                        <ul>
                          {pageData.materials.map((material, i) => (
                            <li key={i}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                              {material}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {pageData.features && pageData.features.length > 0 && (
                      <div className="details-card">
                        <h3>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="8" r="7"></circle>
                            <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
                          </svg>
                          Why Choose Us
                        </h3>
                        <ul>
                          {pageData.features.map((feature, i) => (
                            <li key={i}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                              </svg>
                              {feature}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <aside className="service-sidebar">
              <div className="cta-card">
                <h3>Ready to Get Started?</h3>
                <p>Contact us today for a free, no-obligation estimate.</p>
                <a href="tel:7159449065" className="phone-link">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                  (715)-944-9065
                </a>
                <Link to="/#contact" className="btn btn-primary btn-block">Request Estimate</Link>
              </div>

              <div className="trust-card">
                <div className="trust-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  </svg>
                  <span>Licensed & Insured</span>
                </div>
                <div className="trust-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="8" r="7"></circle>
                    <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
                  </svg>
                  <span>Quality Guaranteed</span>
                </div>
                <div className="trust-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                    <path d="M2 17l10 5 10-5"></path>
                    <path d="M2 12l10 5 10-5"></path>
                  </svg>
                  <span>Expert Craftsmen</span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* Related Projects from Gallery */}
      {galleryProjects.length > 0 && (
        <section className="service-projects">
          <div className="container">
            <div className="section-header">
              <h2>Recent {pageData.title} Projects</h2>
              <Link to="/gallery" className="view-all-link">View All Projects →</Link>
            </div>
            <div className="projects-grid">
              {galleryProjects.map(project => (
                <Link to={`/gallery/${project.id}`} key={project.id} className="project-card">
                  <div className="project-image">
                    {project.images?.[0] ? (
                      <img 
                        src={getImageUrl(project.images[0].thumbnail || project.images[0].url)}
                        alt={project.title}
                      />
                    ) : (
                      <div className="project-placeholder">
                        <span>{project.category}</span>
                      </div>
                    )}
                    <div className="project-overlay">
                      <span>View Project</span>
                    </div>
                  </div>
                  <div className="project-info">
                    <h3>{project.title}</h3>
                    {project.location && <p>{project.location}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FAQ Section */}
      {pageData.faqs && pageData.faqs.length > 0 && (
        <section className="service-faq">
          <div className="container">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-list">
              {pageData.faqs.map((faq, index) => (
                <div 
                  key={index} 
                  className={`faq-item ${openFaq === index ? 'open' : ''}`}
                >
                  <button 
                    className="faq-question"
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  >
                    <span>{faq.question}</span>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points={openFaq === index ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}></polyline>
                    </svg>
                  </button>
                  <div className="faq-answer">
                    <p>{faq.answer}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* FAQ Schema */}
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": pageData.faqs.map(faq => ({
              "@type": "Question",
              "name": faq.question,
              "acceptedAnswer": {
                "@type": "Answer",
                "text": faq.answer
              }
            }))
          })}} />
        </section>
      )}

      {/* Bottom CTA */}
      <section className="service-cta">
        <div className="container">
          <h2>Ready to Start Your {pageData.title} Project?</h2>
          <p>Contact {{COMPANY_NAME}} today for a free estimate. We serve Eau Claire and the surrounding Chippewa Valley area.</p>
          <div className="cta-buttons">
            <Link to="/#contact" className="btn btn-primary btn-lg">Get Free Estimate</Link>
            <a href="tel:7159449065" className="btn btn-outline-light btn-lg">Call (715)-944-9065</a>
          </div>
        </div>
      </section>

      {/* Other Services */}
      <section className="other-services">
        <div className="container">
          <h3>Explore Our Other Services</h3>
          <div className="services-links">
            {allServices.filter(s => s.id !== id).map(s => (
              <Link to={`/services/${s.id}`} key={s.id} className="service-link">
                {s.title}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Service Schema */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Service",
        "name": `${pageData.title} - {{COMPANY_NAME}}`,
        "description": pageData.heroDescription || pageData.tagline,
        "provider": {
          "@type": "HomeAndConstructionBusiness",
          "name": "{{COMPANY_NAME}}",
          "url": "https://{{COMPANY_DOMAIN}}",
          "telephone": "+17159449065",
          "areaServed": { "@type": "City", "name": "Eau Claire, WI" }
        },
        "areaServed": ["Eau Claire", "Menomonie", "Eau Claire", "Chippewa Falls", "Osseo"].map(city => ({
          "@type": "City",
          "name": city + ", WI"
        })),
        "serviceType": pageData.title
      })}} />
    </div>
  );
}

export default ServicePage;
