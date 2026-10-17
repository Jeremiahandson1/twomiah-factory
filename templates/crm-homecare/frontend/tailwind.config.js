// Minimal Tailwind config so shared @twomiah/tenant-ui components render
// with expected styling. The homecare template's existing pages use plain
// CSS — Tailwind is additive, they keep working unchanged.
//
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

const buildPalette = generatePalette('{{PRIMARY_COLOR}}', '#be185d')
const brandPalette = brandVarScale()

/** @type {import('tailwindcss').Config} */
export default {
  // Home care is light-only: index.css paints .card / .modal-content white and nothing puts `dark` on <html>.
  // Tailwind's default ('media') switched every `dark:` class on with the OS setting, so light ink landed on those
  // white grounds. 'class' (as every other CRM sets it) keeps `dark:` off until a theme toggle exists.
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        orange: brandPalette,
        primary: brandPalette,
        brand: brandPalette,
      },
    },
  },
  plugins: [brandVarsPlugin(buildPalette)],
}
