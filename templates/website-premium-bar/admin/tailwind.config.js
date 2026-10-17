/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
        ink: '#0f172a',
        'ink-soft': '#334155',
        muted: '#64748b',
        line: '#e5e7eb',
        paper: '#fafaf7',
        brand: '#1a2e22',
        'brand-deep': '#0f1f17',
        accent: '#c89a4e',
      },
    },
  },
  plugins: [],
}
