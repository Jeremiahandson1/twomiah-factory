/**
 * Generate lighter/darker shades from a hex color.
 * Uses simple HSL-based mixing for build-time shade generation.
 */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1,3), 16) / 255;
  const g = parseInt(hex.slice(3,5), 16) / 255;
  const b = parseInt(hex.slice(5,7), 16) / 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch(max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

function generatePalette(hex) {
  // Fallback for unreplaced token
  if (!hex || hex.startsWith('{')) hex = '#f97316';
  const [h, s] = hexToHsl(hex);
  return {
    50:  hslToHex(h, Math.min(s, 100), 96),
    100: hslToHex(h, Math.min(s, 100), 90),
    200: hslToHex(h, Math.min(s, 100), 80),
    300: hslToHex(h, Math.min(s, 95), 65),
    400: hslToHex(h, Math.min(s, 95), 55),
    500: hex,
    600: hslToHex(h, Math.min(s + 5, 100), 40),
    700: hslToHex(h, Math.min(s + 5, 100), 33),
    800: hslToHex(h, Math.min(s + 5, 100), 26),
    900: hslToHex(h, Math.min(s + 5, 100), 20),
    950: hslToHex(h, Math.min(s + 5, 100), 12),
  };
}

const brandPalette = generatePalette('{{PRIMARY_COLOR}}');

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
  // Override orange with the brand palette so all existing orange-* classes use the brand color
  orange: brandPalette,
  primary: brandPalette,
  brand: brandPalette,
},
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      screens: {
        'xs': '475px',
        '3xl': '1920px',
      },
    },
  },
  plugins: [],
}
