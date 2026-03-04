import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPublicPage } from '../admin/api';
import { getImageUrl } from '../utils/imageUrl';

function CustomPage() {
  const { pageId } = useParams();
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    loadPage();
  }, [pageId]);

  const loadPage = async () => {
    setLoading(true);
    try {
      const data = await getPublicPage(pageId);
      if (data && data.isCustomPage && data.status === 'published') {
        setPage(data);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      setNotFound(true);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="error-page">
        <div className="container">
          <div className="error-content">
            <h1>404</h1>
            <p>The page you're looking for doesn't exist.</p>
            <Link to="/" className="btn btn-primary">← Back to Home</Link>
          </div>
        </div>
      </div>
    );
  }

  const animationSpeed = page.heroAnimationSpeed || 10;

  return (
    <div className="custom-page">
      {/* Hero Section */}
      {page.heroImage ? (
        <section 
          className={`custom-hero has-image animation-${page.heroAnimation || 'none'}`}
          style={{ '--hero-speed': `${animationSpeed}s` }}
        >
          <div 
            className="custom-hero-bg"
            style={{ backgroundImage: `url(${getImageUrl(page.heroImage)})` }}
          />
          <div className="custom-hero-overlay" />
          <div className="custom-hero-content">
            <div className="container">
              {page.tagline && <span className="hero-tagline">{page.tagline}</span>}
              <h1>{page.title}</h1>
              {page.heroDescription && <p className="hero-description">{page.heroDescription}</p>}
            </div>
          </div>
        </section>
      ) : (
        <section className="custom-hero simple">
          <div className="container">
            <h1>{page.title}</h1>
            {page.tagline && <p className="hero-tagline">{page.tagline}</p>}
          </div>
        </section>
      )}

      {/* Main Content */}
      <section className="custom-content">
        <div className="container">
          <div className="content-wrapper">
            {page.content && (
              <div 
                className="prose"
                dangerouslySetInnerHTML={{ __html: page.content }}
              />
            )}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="custom-cta">
        <div className="container">
          <h2>Have Questions?</h2>
          <p>Contact {{COMPANY_NAME}} today. We're here to help with all your construction needs.</p>
          <div className="cta-buttons">
            <Link to="/#contact" className="btn btn-primary btn-lg">Contact Us</Link>
            <a href="tel:7159449065" className="btn btn-outline-light btn-lg">Call (715)-944-9065</a>
          </div>
        </div>
      </section>
    </div>
  );
}

export default CustomPage;
