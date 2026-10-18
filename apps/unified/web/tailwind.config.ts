// The admin's styling: the CRM templates' Tailwind config (one file, identical in all of them) plus the colour names
// the website screens are written in. The brand palette is CSS variables (packages/tenant-ui/src/brandPalette.js):
// the defaults are the shared fallback colour, and the shell sets the company's own colour at runtime — the templates
// baked the signup colour in at build, which the one app can't do.
import type { Config } from 'tailwindcss'
import { generatePalette, brandVarScale, brandVarsPlugin } from '../../../packages/tenant-ui/src/brandPalette.js'

const brand = brandVarScale() as Record<string, string>
/** A theme-aware colour: its light and dark values are CSS variables set in src/index.css. */
const ui = (name: string) => `rgb(var(--ui-${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: [
    './web/index.html',
    './web/src/**/*.{ts,tsx}',
    '../../packages/tenant-ui/src/**/*.{ts,tsx,js}',
  ],
  theme: {
    extend: {
      colors: {
        // Every orange-*/primary-*/brand-* class is the company's colour (as in the templates).
        orange: brand,
        primary: brand,
        brand: { ...brand, DEFAULT: brand['600'] },
        'brand-deep': brand['700'],
        // The website screens' names, each with a light and a dark value (src/index.css), so they read in both themes.
        ink: ui('ink'),
        'ink-soft': ui('ink-soft'),
        muted: ui('muted'),
        line: ui('line'),
        paper: ui('paper'),
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
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { '0%': { transform: 'translateY(-10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      screens: { xs: '475px', '3xl': '1920px' },
    },
  },
  plugins: [brandVarsPlugin(generatePalette(null))],
} satisfies Config
