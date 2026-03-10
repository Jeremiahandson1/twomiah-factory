/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'color-mix(in srgb, {{PRIMARY_COLOR}} 5%, white)',
          100: 'color-mix(in srgb, {{PRIMARY_COLOR}} 10%, white)',
          200: 'color-mix(in srgb, {{PRIMARY_COLOR}} 20%, white)',
          300: 'color-mix(in srgb, {{PRIMARY_COLOR}} 40%, white)',
          400: 'color-mix(in srgb, {{PRIMARY_COLOR}} 60%, white)',
          500: '{{PRIMARY_COLOR}}',
          600: 'color-mix(in srgb, {{PRIMARY_COLOR}} 80%, black)',
          700: 'color-mix(in srgb, {{PRIMARY_COLOR}} 60%, black)',
          800: 'color-mix(in srgb, {{PRIMARY_COLOR}} 40%, black)',
          900: 'color-mix(in srgb, {{PRIMARY_COLOR}} 20%, black)',
        },
      },
      screens: {
        tablet: '768px',
        'tablet-landscape': '1024px',
      },
    },
  },
  plugins: [],
}
