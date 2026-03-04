import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../utils/imageUrl';

function Footer() {
  const currentYear = new Date().getFullYear();
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/public-settings`);
        if (res.ok) setSettings(await res.json());
      } catch (err) {
        console.log('Could not load footer settings');
      }
    };
    loadSettings();
  }, []);

  const phone = settings?.phone || '{{COMPANY_PHONE}}';
  const email = settings?.email || '{{COMPANY_EMAIL}}';
  const address = settings?.address || '{{COMPANY_ADDRESS}}';
  const city = settings?.city || '{{CITY}}';
  const state = settings?.state || 'WI';
  const zip = settings?.zip || '{{ZIP}}';
  const phoneRaw = phone.replace(/\D/g, '');

  return (
    <footer className="main-footer">
      <div className="footer-main">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-col about-col">
              <div className="footer-logo">
                <div className="logo-icon">
                  <svg viewBox="0 0 40 40" fill="none">
                    <path d="M20 4L4 16V36H36V16L20 4Z" stroke="currentColor" strokeWidth="2" fill="none"/>
                    <path d="M20 4L36 16" stroke="currentColor" strokeWidth="2"/>
                    <path d="M4 16L20 4" stroke="currentColor" strokeWidth="2"/>
                    <rect x="15" y="22" width="10" height="14" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <span>{{COMPANY_NAME_UPPER}}</span>
              </div>
              <p>Quality services for customers throughout the {{CITY}} area. Licensed, insured, and committed to excellence.</p>
              <div className="social-links">
                {settings?.socialLinks?.facebook && (
                  <a href={settings.socialLinks.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                    <svg viewBox="0 0 512 512" fill="currentColor">
                      <path d="M504 256C504 119 393 8 256 8S8 119 8 256c0 123.78 90.69 226.38 209.25 245V327.69h-63V256h63v-54.64c0-62.15 37-96.48 93.67-96.48 27.14 0 55.52 4.84 55.52 4.84v61h-31.28c-30.8 0-40.41 19.12-40.41 38.73V256h68.78l-11 71.69h-57.78V501C413.31 482.38 504 379.78 504 256z"/>
                    </svg>
                  </a>
                )}
                {settings?.socialLinks?.instagram && (
                  <a href={settings.socialLinks.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                    <svg viewBox="0 0 448 512" fill="currentColor">
                      <path d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z"/>
                    </svg>
                  </a>
                )}
                {settings?.socialLinks?.googleBusiness && (
                  <a href={settings.socialLinks.googleBusiness} target="_blank" rel="noopener noreferrer" aria-label="Google">
                    <svg viewBox="0 0 488 512" fill="currentColor">
                      <path d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"/>
                    </svg>
                  </a>
                )}
                {settings?.socialLinks?.youtube && (
                  <a href={settings.socialLinks.youtube} target="_blank" rel="noopener noreferrer" aria-label="YouTube">
                    <svg viewBox="0 0 576 512" fill="currentColor">
                      <path d="M549.655 124.083c-6.281-23.65-24.787-42.276-48.284-48.597C458.781 64 288 64 288 64S117.22 64 74.629 75.486c-23.497 6.322-42.003 24.947-48.284 48.597-11.412 42.867-11.412 132.305-11.412 132.305s0 89.438 11.412 132.305c6.281 23.65 24.787 41.5 48.284 47.821C117.22 448 288 448 288 448s170.78 0 213.371-11.486c23.497-6.321 42.003-24.171 48.284-47.821 11.412-42.867 11.412-132.305 11.412-132.305s0-89.438-11.412-132.305zm-317.51 213.508V175.185l142.739 81.205-142.739 81.201z"/>
                    </svg>
                  </a>
                )}
                {settings?.socialLinks?.linkedin && (
                  <a href={settings.socialLinks.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
                    <svg viewBox="0 0 448 512" fill="currentColor">
                      <path d="M416 32H31.9C14.3 32 0 46.5 0 64.3v383.4C0 465.5 14.3 480 31.9 480H416c17.6 0 32-14.5 32-32.3V64.3c0-17.8-14.4-32.3-32-32.3zM135.4 416H69V202.2h66.5V416zm-33.2-243c-21.3 0-38.5-17.3-38.5-38.5S80.9 96 102.2 96c21.2 0 38.5 17.3 38.5 38.5 0 21.3-17.2 38.5-38.5 38.5zm282.1 243h-66.4V312c0-24.8-.5-56.7-34.5-56.7-34.6 0-39.9 27-39.9 54.9V416h-66.4V202.2h63.7v29.2h.9c8.9-16.8 30.6-34.5 62.9-34.5 67.2 0 79.7 44.3 79.7 101.9V416z"/>
                    </svg>
                  </a>
                )}
                {settings?.socialLinks?.twitter && (
                  <a href={settings.socialLinks.twitter} target="_blank" rel="noopener noreferrer" aria-label="X/Twitter">
                    <svg viewBox="0 0 512 512" fill="currentColor">
                      <path d="M389.2 48h70.6L305.6 224.2 487 464H345L233.7 318.6 106.5 464H35.8L200.7 275.5 26.8 48H172.4L272.9 180.9 389.2 48zM364.4 421.8h39.1L151.1 88h-42L364.4 421.8z"/>
                    </svg>
                  </a>
                )}
                {settings?.socialLinks?.yelp && (
                  <a href={settings.socialLinks.yelp} target="_blank" rel="noopener noreferrer" aria-label="Yelp">
                    <svg viewBox="0 0 384 512" fill="currentColor">
                      <path d="M42.9 240.32l99.62 48.61c19.2 9.4 16.2 37.51-4.5 42.71L30.5 358.45a22.79 22.79 0 0 1-28.21-19.6 197.16 197.16 0 0 1 9-85.32 22.8 22.8 0 0 1 31.61-13.21zm44 239.25a199.45 199.45 0 0 0 79.42 32.11A22.78 22.78 0 0 0 192.94 490l3.9-110.82c.7-21.3-25.5-31.91-39.81-16.1l-74.21 82.4a22.82 22.82 0 0 0 4.09 34.09zm145.34-109.92l58.81 94a22.93 22.93 0 0 0 34 5.5 198.36 198.36 0 0 0 52.71-67.61A22.8 22.8 0 0 0 367.61 373l-104.4-36.51c-20.31-7.2-39.91 15.1-29.6 33.16zM199 127.61C199 149.41 227.3 156 241.8 139l79.11-92.8a22.79 22.79 0 0 0-4-34 199.32 199.32 0 0 0-79.52-32.2A22.78 22.78 0 0 0 211.61 2L199 112.8zm-95.9 32.91C115.6 176.4 127.2 156 107 141L17.61 102.4a22.91 22.91 0 0 0-29.5 12.4A197.21 197.21 0 0 0 0 195.61a22.81 22.81 0 0 0 20.9 23.8l92.91 10.11c20.8 2.3 34.8-17.3 27.11-35.4-11.2-26.4 32-55.5 45.1-33.2z"/>
                    </svg>
                  </a>
                )}
              </div>
            </div>

            <div className="footer-col">
              <h4>Services</h4>
              <ul>
                <li><Link to="/services/roofing">Roofing</Link></li>
                <li><Link to="/services/siding">Siding</Link></li>
                <li><Link to="/services/windows">Windows + Doors</Link></li>
                <li><Link to="/services/insulation">Insulation</Link></li>
                <li><Link to="/services/remodeling">Remodeling</Link></li>
                <li><Link to="/services/new-construction">New Construction</Link></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4>Company</h4>
              <ul>
                <li><Link to="/projects">Projects</Link></li>
                <li><Link to="/#about">About Us</Link></li>
                <li><Link to="/#contact">Contact</Link></li>
                <li><Link to="/#contact">Request Estimate</Link></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4>Contact</h4>
              <ul className="contact-list">
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                  <a href={`tel:${phoneRaw}`}>{phone}</a>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                  </svg>
                  <a href={`mailto:${email}`}>{email}</a>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                  </svg>
                  <span>{address}<br/>{city}, {state} {zip}</span>
                </li>
              </ul>
              <div className="hours">
                <strong>Hours:</strong>
                <span>Mon - Fri: 8am - 5pm</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="container">
          <p>&copy; {currentYear} {{COMPANY_NAME}}. All rights reserved.</p>
          <p>Serving {{CITY}}, {{NEARBY_CITY_4}}, {{NEARBY_CITY_1}}, and the {{SERVICE_REGION}}</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
