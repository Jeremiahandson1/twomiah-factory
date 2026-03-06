import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Hook to fetch navigation configuration from the backend
 * Falls back to default nav if fetch fails
 */
export function useNavConfig() {
  const [navConfig, setNavConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchNav = async () => {
      try {
        const response = await fetch(`${API_BASE}/admin/public/nav-config`);
        if (!response.ok) throw new Error('Failed to fetch nav');
        const data = await response.json();
        setNavConfig(data);
      } catch (err) {
        console.error('Nav config fetch failed, using defaults:', err);
        setError(err);
        // Fallback to hardcoded defaults if API fails
        setNavConfig(getDefaultNav());
      } finally {
        setLoading(false);
      }
    };

    fetchNav();
  }, []);

  return { navConfig, loading, error };
}

// Default navigation as fallback
function getDefaultNav() {
  return {
    items: [
      {
        id: 'roofing',
        label: 'Roofing',
        href: '/services/roofing',
        children: [
          { id: 'roofing-overview', label: 'Overview', href: '/services/roofing' },
          { id: 'asphalt-shingles', label: 'Asphalt Shingles', href: '/services/roofing/asphalt-shingles' },
          { id: 'metal-roofing', label: 'Metal Roofing', href: '/services/roofing/metal-roofing' },
          { id: 'storm-damage', label: 'Storm Damage', href: '/services/roofing/storm-damage' },
          { id: 'roof-repair', label: 'Roof Repair', href: '/services/roofing/roof-repair' }
        ]
      },
      {
        id: 'siding',
        label: 'Siding',
        href: '/services/siding',
        children: [
          { id: 'siding-overview', label: 'Overview', href: '/services/siding' },
          { id: 'james-hardie', label: 'James Hardie', href: '/services/siding/james-hardie' },
          { id: 'lp-smartside', label: 'LP SmartSide', href: '/services/siding/lp-smartside' },
          { id: 'vinyl-siding', label: 'Vinyl Siding', href: '/services/siding/vinyl-siding' },
          { id: 'soffit-fascia', label: 'Soffit & Fascia', href: '/services/siding/soffit-fascia' }
        ]
      },
      {
        id: 'windows',
        label: 'Windows + Doors',
        href: '/services/windows',
        children: [
          { id: 'windows-overview', label: 'Overview', href: '/services/windows' },
          { id: 'replacement-windows', label: 'Windows', href: '/services/windows/replacement-windows' },
          { id: 'entry-doors', label: 'Entry Doors', href: '/services/windows/entry-doors' },
          { id: 'patio-doors', label: 'Patio Doors', href: '/services/windows/patio-doors' }
        ]
      },
      {
        id: 'insulation',
        label: 'Insulation',
        href: '/services/insulation',
        children: [
          { id: 'insulation-overview', label: 'Overview', href: '/services/insulation' },
          { id: 'blown-in-insulation', label: 'Blown-In Insulation', href: '/services/insulation/blown-in-insulation' },
          { id: 'spray-foam', label: 'Spray Foam', href: '/services/insulation/spray-foam' },
          { id: 'air-sealing', label: 'Air Sealing', href: '/services/insulation/air-sealing' }
        ]
      },
      {
        id: 'remodeling',
        label: 'Remodeling',
        href: '/services/remodeling',
        children: [
          { id: 'remodeling-overview', label: 'Exterior Remodeling', href: '/services/remodeling' },
          { id: 'new-construction', label: 'New Construction', href: '/services/new-construction' }
        ]
      }
    ],
    footerLinks: [
      { id: 'footer-home', label: 'Home', href: '/' },
      { id: 'footer-about', label: 'About', href: '/about' },
      { id: 'footer-gallery', label: 'Gallery', href: '/gallery' },
      { id: 'footer-contact', label: 'Contact', href: '/contact' }
    ]
  };
}

export default useNavConfig;
