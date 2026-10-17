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
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // 'class', as in every other CRM. Left unset, Tailwind's default is 'media': every dark: class in the pages switched
  // on whenever the COMPUTER was in dark mode, while .card/.input/.label (index.css) and `color-scheme: light` stay
  // light — so a dark-mode laptop got near-white text on white cards, the sign-in screen first (Store QA T1, B1:
  // rgb(241,245,249) on #fff, 1.10:1). The store has no theme toggle, so nothing adds .dark and it is light everywhere,
  // which is what its own CSS already declares (and what index.css's `.dark .pac-container` rules assumed).
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // The shop's own colour, as a whole scale. This used to be a fixed indigo ramp with only shade
        // 500 swapped for the tenant — so a red-branded store had a red button whose hover (600, used
        // 18 times) was still blue. generatePalette is the same function every other CRM template uses.
        //
        // `orange` is deliberately NOT remapped here, unlike the other templates: their chrome is
        // orange-*, whereas store's only orange is a semantic status chip in lib/format.ts.
        primary: brandPalette,
        brand: brandPalette,
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [brandVarsPlugin(buildPalette)],
}
