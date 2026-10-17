// THE BRAND PALETTE. generatePalette lives in ONE place — packages/tenant-ui/src/brandPalette.js, vendored
// here as src/shared/brandPalette.js — and the running app calls the same function, so a colour the owner
// changes later in Settings reaches every brand-coloured class without the tenant being regenerated:
//
//   · each shade is a CSS variable — orange-500 is rgb(var(--brand-500) / <alpha-value>)
//   · the palette for the colour chosen at signup is written as those variables' DEFAULTS on :root
//     (brandVarsPlugin), so a CRM nobody has re-coloured paints exactly what it always did
//   · once the company loads, the shell sets the same variables on <html> from company.primaryColor
//     (applyBrandPalette), through the same contrast clamps the build applies
import { generatePalette, brandVarScale, brandVarsPlugin } from './src/shared/brandPalette.js'

const buildPalette = generatePalette('{{PRIMARY_COLOR}}')
const brandPalette = brandVarScale()

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
  plugins: [brandVarsPlugin(buildPalette)],
}
