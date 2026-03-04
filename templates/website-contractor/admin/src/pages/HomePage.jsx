import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, getImageUrl } from '../utils/imageUrl';

function HomePage({ onFormSuccess }) {
  const [currentTestimonial, setCurrentTestimonial] = useState(0);
  const [homepage, setHomepage] = useState(null);
  const [services, setServices] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [settings, setSettings] = useState(null);
  const [formData, setFormData] = useState({
    name: '', phone: '', email: '', address: '', services: [], message: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Load all dynamic content
  useEffect(() => {
    const loadContent = async () => {
      try {
        // Load homepage content
        const homepageRes = await fetch(`${API_BASE}/admin/homepage`);
        if (homepageRes.ok) {
          const data = await homepageRes.json();
          setHomepage(data);
        }

        // Load services
        const servicesRes = await fetch(`${API_BASE}/admin/services-data`);
        if (servicesRes.ok) {
          const data = await servicesRes.json();
          setServices(data.filter(s => s.featured !== false));
        }

        // Load testimonials
        const testimonialsRes = await fetch(`${API_BASE}/admin/testimonials`);
        if (testimonialsRes.ok) {
          const data = await testimonialsRes.json();
          setTestimonials(data.filter(t => t.featured !== false));
        }

        // Load site settings
        const settingsRes = await fetch(`${API_BASE}/admin/public-settings`);
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setSettings(data);
        }
      } catch (err) {
        console.log('Error loading content:', err);
      }
    };
    loadContent();
  }, []);

  // Auto-rotate testimonials
  useEffect(() => {
    if (testimonials.length > 1) {
      const timer = setInterval(() => {
        setCurrentTestimonial((prev) => (prev + 1) % testimonials.length);
      }, 8000);
      return () => clearInterval(timer);
    }
  }, [testimonials.length]);

// Scroll animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );

    document.querySelectorAll('.animate-on-scroll').forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [services]);
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');
    
    try {
      const response = await fetch(`${API_BASE}/admin/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          service: formData.services.join(', '),
          source: 'homepage'
        })
      });
      
      if (response.ok) {
        setFormData({ name: '', phone: '', email: '', address: '', services: [], message: '' });
        if (onFormSuccess) onFormSuccess();
      } else {
        setFormError('Something went wrong. Please try again or call us directly.');
      }
    } catch (err) {
      console.error('Form submission error:', err);
      setFormError('Could not connect to server. Please call us directly.');
    }
    
    setSubmitting(false);
  };

  const handleServiceCheck = (service) => {
    setFormData(prev => ({
      ...prev,
      services: prev.services.includes(service)
        ? prev.services.filter(s => s !== service)
        : [...prev.services, service]
    }));
  };

  // Use settings or defaults
  const phone = settings?.phone || '(715)-944-9065';
  const email = settings?.email || '{{COMPANY_EMAIL}}';
  const address = settings?.address || '123 Main St';
  const city = settings?.city || 'Eau Claire';
  const state = settings?.state || 'WI';
  const zip = settings?.zip || '54701';
  
  // Homepage sections
  const hero = homepage?.hero || {};
  const trustBadges = homepage?.trustBadges?.filter(b => b.enabled) || [];
  const ctaSection = homepage?.ctaSection || {};
  const serviceAreas = homepage?.serviceAreas || ['Eau Claire', 'Menomonie', 'Eau Claire', 'Chippewa Falls', 'Osseo'];
  const businessHours = homepage?.businessHours || {};

  return (
    <div className="home-page">
      {/* Hero Section */}
      <section 
        className={`hero-video ${hero.image ? 'hero-animated' : ''}`}
        style={{ '--hero-speed': `${hero.animationSpeed || 10}s` }}
      >
        {hero.image ? (
          <>
            <div 
              className={`hero-bg animation-${hero.animation || 'none'}`}
              style={{ backgroundImage: `url(${getImageUrl(hero.image)})` }}
            />
            <div className="hero-overlay"></div>
          </>
        ) : (
          <div className="hero-video-bg">
            <div className="video-placeholder"></div>
            <div className="hero-overlay"></div>
          </div>
        )}
        <div className={`hero-video-content ${hero.image ? 'hero-content' : ''}`}>
          <h1>{hero.title || 'Eau Claire Area Contractor'}</h1>
          <h2>{hero.subtitle || 'Roofing • Siding • Windows • Insulation • Remodeling'}</h2>
          <div className="hero-line"></div>
          <p className="hero-tagline"><strong>{hero.tagline || 'YOUR TRUSTED LOCAL CONTRACTOR'}</strong></p>
          <p className="hero-awards">{hero.description || 'Serving the Chippewa Valley with Quality Craftsmanship'}</p>
          <div className="hero-buttons">
            <a href={hero.primaryButtonLink || '#contact'} className="btn btn-primary btn-lg">
              {hero.primaryButtonText || 'Request Free Estimate'}
            </a>
            <a href={hero.secondaryButtonLink || '/gallery'} className="btn btn-outline-light btn-lg">
              {hero.secondaryButtonText || 'View Our Work'}
            </a>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section className="services-section" id="services">
        <div className="container">
          <h2>Our Services</h2>
          <div className="services-grid">
            {services.map((service) => (
              <div key={service.id} className="service-card animate-on-scroll">
                <div 
                  className="service-image"
                  style={service.image ? { backgroundImage: `url(${getImageUrl(service.image)})` } : {}}
                >
                  {!service.image && <span className="service-icon">{service.icon || '🔧'}</span>}
                </div>
                <div className="service-content">
                  <h3>{service.title}</h3>
                  <p>{service.description}</p>
                  {service.links?.length > 0 && (
                    <>
                      <hr />
                      <ul className="service-links">
                        {service.links.map((link, i) => (
                          <li key={i}><Link to={link.href}>{link.label}</Link></li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      {testimonials.length > 0 && (
        <section className="testimonials-section">
          <div className="container">
            <h2>What Our Customers Say</h2>
            <div className="testimonial-slider">
              {testimonials.map((testimonial, index) => (
                <div 
                  key={testimonial.id}
                  className={`testimonial-card ${index === currentTestimonial ? 'active' : ''}`}
                >
                  <div className="testimonial-content">
                    <div className="testimonial-stars">{'★'.repeat(testimonial.rating || 5)}</div>
                    <blockquote>"{testimonial.text}"</blockquote>
                    <div className="testimonial-author">
                      {testimonial.image && (
                        <img src={getImageUrl(testimonial.image)} alt={testimonial.author} />
                      )}
                      <div>
                        <strong>{testimonial.author}</strong>
                        {testimonial.location && <span>{testimonial.location}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {testimonials.length > 1 && (
              <div className="testimonial-dots">
                {testimonials.map((_, i) => (
                  <button 
                    key={i}
                    className={i === currentTestimonial ? 'active' : ''}
                    onClick={() => setCurrentTestimonial(i)}
                    aria-label={`Testimonial ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Trust Badges */}
      {trustBadges.length > 0 && (
        <section className="trust-section">
          <div className="container">
            <div className="review-badges">
              {trustBadges.map((badge) => (
                <div key={badge.id} className="review-badge">
                  {badge.type === 'google' && (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  )}
                  {badge.type === 'facebook' && (
                    <svg viewBox="0 0 512 512" fill="currentColor">
                      <path d="M504 256C504 119 393 8 256 8S8 119 8 256c0 123.78 90.69 226.38 209.25 245V327.69h-63V256h63v-54.64c0-62.15 37-96.48 93.67-96.48 27.14 0 55.52 4.84 55.52 4.84v61h-31.28c-30.8 0-40.41 19.12-40.41 38.73V256h68.78l-11 71.69h-57.78V501C413.31 482.38 504 379.78 504 256z"/>
                    </svg>
                  )}
                  {badge.type === 'bbb' && <span className="badge-text">BBB</span>}
                  {badge.type === 'owens-corning' && <span className="badge-text">OC</span>}
                  {badge.type === 'gaf' && <span className="badge-text">GAF</span>}
                  {badge.type === 'custom' && <span className="badge-text">✓</span>}
                  <div className="badge-info">
                    <span className="stars">{badge.label}</span>
                    <span className="count">{badge.sublabel}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA Section */}
      <section 
        className="cta-section"
        style={ctaSection.backgroundImage ? { backgroundImage: `url(${getImageUrl(ctaSection.backgroundImage)})` } : {}}
      >
        <div className="container">
          <h2>{(ctaSection.title || 'Increase your comfort.\nDecrease your energy bills.').split('\n').map((line, i) => (
            <React.Fragment key={i}>{line}{i === 0 && <br />}</React.Fragment>
          ))}</h2>
          <p>{ctaSection.description || "Find out how we can improve your home's efficiency and curb appeal."}</p>
          <div className="cta-buttons">
            <a href={ctaSection.primaryButtonLink || '#contact'} className="btn btn-primary btn-lg">
              {ctaSection.primaryButtonText || 'Schedule a Free Estimate'}
            </a>
            <a href={ctaSection.secondaryButtonLink || `tel:${phone.replace(/\D/g, '')}`} className="btn btn-outline btn-lg">
              {ctaSection.secondaryButtonText || `Call ${phone}`}
            </a>
          </div>
        </div>
      </section>

      {/* Contact Form Section */}
      <section className="contact-section" id="contact">
        <div className="container">
          <div className="contact-grid">
            <div className="contact-info">
              <h2>Contact Us</h2>
              <div className="contact-item">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
                <div>
                  <strong>Phone</strong>
                  <a href={`tel:${phone.replace(/\D/g, '')}`}>{phone}</a>
                </div>
              </div>
              <div className="contact-item">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
                <div>
                  <strong>Email</strong>
                  <a href={`mailto:${email}`}>{email}</a>
                </div>
              </div>
              <div className="contact-item">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
                <div>
                  <strong>Address</strong>
                  <span>{address}<br/>{city}, {state} {zip}</span>
                </div>
              </div>
              <div className="contact-item">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <div>
                  <strong>Hours</strong>
                  <span>
                    {businessHours.monday && !businessHours.monday.closed 
                      ? `Mon - Fri: ${businessHours.monday.open} - ${businessHours.monday.close}`
                      : 'Mon - Fri: 8am - 5pm'
                    }
                    <br/>
                    {businessHours.saturday && !businessHours.saturday.closed
                      ? `Sat: ${businessHours.saturday.open}${businessHours.saturday.close ? ` - ${businessHours.saturday.close}` : ''}`
                      : 'Sat: By Appointment'
                    }
                  </span>
                </div>
              </div>
              
              <div className="service-areas">
                <h3>Service Areas</h3>
                <p>{serviceAreas.join(', ')}, and surrounding communities.</p>
              </div>
            </div>

            <div className="contact-form-container">
              <h2>Request an Estimate</h2>
              <form onSubmit={handleSubmit}>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="name">Name *</label>
                    <input
                      type="text"
                      id="name"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="phone">Phone *</label>
                    <input
                      type="tel"
                      id="phone"
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="email">Email</label>
                    <input
                      type="email"
                      id="email"
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="address">Address</label>
                    <input
                      type="text"
                      id="address"
                      value={formData.address}
                      onChange={(e) => setFormData({...formData, address: e.target.value})}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Services Needed</label>
                  <div className="checkbox-grid">
                    {services.slice(0, 6).map(service => (
                      <label key={service.id} className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={formData.services.includes(service.title)}
                          onChange={() => handleServiceCheck(service.title)}
                        />
                        <span>{service.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="message">Project Details</label>
                  <textarea
                    id="message"
                    rows="4"
                    value={formData.message}
                    onChange={(e) => setFormData({...formData, message: e.target.value})}
                    placeholder="Tell us about your project..."
                  ></textarea>
                </div>
                {formError && (
                  <div style={{ color: '#dc2626', background: '#fef2f2', padding: '12px 16px', borderRadius: '8px', marginBottom: '8px', fontSize: '0.95rem' }}>
                    {formError}
                  </div>
                )}
                <button type="submit" className="btn btn-primary btn-lg full-width" disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Map Section */}
      <section className="map-section">
        <iframe 
          src={`https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2844.8234567890!2d-91.4984!3d44.8113!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x87f8b1234567890%3A0x1234567890!2s${encodeURIComponent(address + ', ' + city + ', ' + state + ' ' + zip)}!5e0!3m2!1sen!2sus!4v1234567890`}
          allowFullScreen="" 
          loading="lazy"
          title="Location Map"
        ></iframe>
      </section>

      {/* Enhanced LocalBusiness Schema with Reviews */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "HomeAndConstructionBusiness",
        "name": "{{COMPANY_NAME}}",
        "image": "https://{{COMPANY_DOMAIN}}/logo.jpg",
        "url": "https://{{COMPANY_DOMAIN}}",
        "telephone": `+1${phone.replace(/\D/g, '')}`,
        "email": email,
        "address": {
          "@type": "PostalAddress",
          "streetAddress": address,
          "addressLocality": city,
          "addressRegion": state,
          "postalCode": zip,
          "addressCountry": "US"
        },
        "geo": {
          "@type": "GeoCoordinates",
          "latitude": 44.8113,
          "longitude": -91.4984
        },
        "areaServed": serviceAreas.map(area => ({
          "@type": "City",
          "name": area + ", WI"
        })),
        "priceRange": "$$",
        "openingHoursSpecification": [
          {
            "@type": "OpeningHoursSpecification",
            "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            "opens": "08:00",
            "closes": "17:00"
          }
        ],
        "hasOfferCatalog": {
          "@type": "OfferCatalog",
          "name": "Construction Services",
          "itemListElement": services.map(s => ({
            "@type": "Offer",
            "itemOffered": {
              "@type": "Service",
              "name": s.title,
              "description": s.description
            }
          }))
        },
        ...(testimonials.length > 0 ? {
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": (testimonials.reduce((sum, t) => sum + (t.rating || 5), 0) / testimonials.length).toFixed(1),
            "reviewCount": testimonials.length,
            "bestRating": "5",
            "worstRating": "1"
          },
          "review": testimonials.map(t => ({
            "@type": "Review",
            "author": {
              "@type": "Person",
              "name": t.author
            },
            "reviewRating": {
              "@type": "Rating",
              "ratingValue": t.rating || 5,
              "bestRating": "5"
            },
            "reviewBody": t.text,
            ...(t.createdAt ? { "datePublished": t.createdAt.split('T')[0] } : {})
          }))
        } : {})
      })}} />
    </div>
  );
}

export default HomePage;
