import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Hardcoded fallback in case API is unreachable
const FALLBACK_NAV = [
  { id: 'roofing', label: 'Roofing', href: '/services/roofing', children: [
    { id: 'roofing-overview', label: 'Overview', href: '/services/roofing' },
    { id: 'asphalt-shingles', label: 'Asphalt Shingles', href: '/services/roofing/asphalt-shingles' },
    { id: 'metal-roofing', label: 'Metal Roofing', href: '/services/roofing/metal-roofing' },
    { id: 'storm-damage', label: 'Storm Damage', href: '/services/roofing/storm-damage' },
    { id: 'roof-repair', label: 'Roof Repair', href: '/services/roofing/roof-repair' }
  ]},
  { id: 'siding', label: 'Siding', href: '/services/siding', children: [
    { id: 'siding-overview', label: 'Overview', href: '/services/siding' },
    { id: 'james-hardie', label: 'James Hardie', href: '/services/siding/james-hardie' },
    { id: 'lp-smartside', label: 'LP SmartSide', href: '/services/siding/lp-smartside' },
    { id: 'vinyl-siding', label: 'Vinyl Siding', href: '/services/siding/vinyl-siding' },
    { id: 'soffit-fascia', label: 'Soffit & Fascia', href: '/services/siding/soffit-fascia' }
  ]},
  { id: 'windows', label: 'Windows + Doors', href: '/services/windows', children: [
    { id: 'windows-overview', label: 'Overview', href: '/services/windows' },
    { id: 'replacement-windows', label: 'Windows', href: '/services/windows/replacement-windows' },
    { id: 'entry-doors', label: 'Entry Doors', href: '/services/windows/entry-doors' },
    { id: 'patio-doors', label: 'Patio Doors', href: '/services/windows/patio-doors' }
  ]},
  { id: 'insulation', label: 'Insulation', href: '/services/insulation', children: [
    { id: 'insulation-overview', label: 'Overview', href: '/services/insulation' },
    { id: 'blown-in-insulation', label: 'Blown-In Insulation', href: '/services/insulation/blown-in-insulation' },
    { id: 'spray-foam', label: 'Spray Foam', href: '/services/insulation/spray-foam' },
    { id: 'air-sealing', label: 'Air Sealing', href: '/services/insulation/air-sealing' }
  ]},
  { id: 'remodeling', label: 'Remodeling', href: '/services/remodeling', children: [
    { id: 'remodeling-overview', label: 'Exterior Remodeling', href: '/services/remodeling' },
    { id: 'new-construction', label: 'New Construction', href: '/services/new-construction' }
  ]}
];

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [settings, setSettings] = useState(null);
  const [navItems, setNavItems] = useState(FALLBACK_NAV);
  const location = useLocation();
  const navigate = useNavigate();

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/public-settings`);
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
        }
      } catch (err) {
        console.log('Could not load settings');
      }
    };
    loadSettings();
  }, []);

  // Load navigation from API
  useEffect(() => {
    const loadNav = async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/public-nav`);
        if (res.ok) {
          const data = await res.json();
          if (data.items && data.items.length > 0) {
            setNavItems(data.items);
          }
        }
      } catch (err) {
        console.log('Could not load nav, using fallback');
      }
    };
    loadNav();
  }, []);

  // Handle scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleLinkClick = () => {
    setMenuOpen(false);
  };

  const handleHashLink = (e, hash) => {
    e.preventDefault();
    setMenuOpen(false);
    
    if (location.pathname !== '/') {
      navigate('/' + hash);
    } else {
      const element = document.querySelector(hash);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  const phone = settings?.phone || '{{COMPANY_PHONE}}';
  const email = settings?.email || '{{COMPANY_EMAIL}}';
  const logoUrl = settings?.logo ? (settings.logo.startsWith('http') ? settings.logo : `${API_BASE.replace('/api', '')}${settings.logo}`) : '/logo.jpg';
  const phoneRaw = phone.replace(/\D/g, '');

  return (
    <header className={`main-header ${scrolled ? 'scrolled' : ''}`}>
      {/* Top Bar */}
      <div className="top-bar">
        <div className="container">
          <div className="top-bar-links">
            <Link to="/projects">Projects</Link>
            <a href="#about" onClick={(e) => handleHashLink(e, '#about')}>About</a>
          </div>
          <div className="top-bar-contact">
            <a href={`tel:${phoneRaw}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
              </svg>
              {phone}
            </a>
            <a href={`mailto:${email}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
              {email}
            </a>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="main-nav-wrapper">
        <div className="container">
          <div className="nav-content">
            <Link to="/" className="logo" onClick={handleLinkClick}>
  <img src={logoUrl} alt="{{COMPANY_NAME}}" className="logo-image" />
</Link>
            <nav className={`main-nav ${menuOpen ? 'active' : ''}`}>
              <ul>
                {navItems.map(item => (
                  <li key={item.id} className={item.children && item.children.length > 0 ? 'has-dropdown' : ''}>
                    <Link to={item.href}>{item.label}</Link>
                    {item.children && item.children.length > 0 && (
                      <div className="dropdown">
                        {item.children.map(child => (
                          <Link key={child.id} to={child.href} onClick={handleLinkClick}>
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
                <li className="mobile-only">
                  <Link to="/projects" onClick={handleLinkClick}>Projects</Link>
                </li>
                <li className="cta-item">
                  <a href="#contact" onClick={(e) => handleHashLink(e, '#contact')} className="btn btn-primary">
                    Request Estimate
                  </a>
                </li>
              </ul>
            </nav>

            <button 
              className={`nav-toggle ${menuOpen ? 'active' : ''}`}
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
            >
              <svg viewBox="0 0 100 100">
                <path className="line line1" d="M 30,33 H 70 C 72,33 75,36 75,41 C 75,46 72,49 70,49 H 50"/>
                <path className="line line2" d="M 30,50 H 70"/>
                <path className="line line3" d="M 70,67 H 30 C 28,67 25,64 25,59 C 25,54 28,51 30,51 H 50"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
