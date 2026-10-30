// The free "Try the demo" build: the CRM's own screens and code (web/src, unchanged), started by web/demo/bootstrap.ts so that
// its API is answered in the browser from recorded data. Static files only — no server.
//   bun run build:demo     →  web/dist-demo   (app.html is the CRM for every path; picker.html is the /demo page)
// What is different from web/vite.config.ts, and why:
//   - the two Stripe packages are swapped for stand-ins (web/demo/stubs), so Stripe's address is not in the build;
//   - the files in demo/public (the recorded data per trade, the host's headers and rewrites) are copied to the root;
//   - assets go under /demo-assets/, so the host can send every other path to the app.
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from './tailwind.config.ts'

const here = import.meta.dirname

/**
 * No address of Twomiah, Stripe, Twilio, Cloudflare, Render or Netlify in the build — not even as a link's text. The screens
 * name a few (a "Get an account" link, the Stripe dashboard): in the demo each is turned into a dead anchor, so the build
 * holds nothing that points outside, and tests/demo/outbound.test.ts can hold it to that.
 */
export const OUTSIDE_URL = /(?:https?|wss?):\/\/[^\s'"`)<>\\]*?(?:twomiah|stripe|twilio|cloudflare|onrender|netlify|googleapis|gstatic|openstreetmap|mapbox|cartocdn)[^\s'"`)<>\\]*/gi
function noOutsideAddresses(): Plugin {
  return {
    name: 'demo-no-outside-addresses',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (file.includes('node_modules') || !/\.(tsx?|jsx?)$/.test(file)) return null
      const out = code.replace(OUTSIDE_URL, '#demo-link-off')
      return out === code ? null : { code: out, map: null }
    },
    // The libraries' own code and comments (a map library names its issue tracker): the finished chunks are scrubbed too, so
    // the build as shipped holds no such address wherever it came from.
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') item.code = item.code.replace(OUTSIDE_URL, '#demo-link-off')
        else if (typeof item.source === 'string' && /\.(css|html)$/.test(item.fileName)) item.source = item.source.replace(OUTSIDE_URL, '#demo-link-off')
      }
    },
  }
}

export default defineConfig({
  root: path.resolve(here, 'demo'),
  base: '/',
  publicDir: path.resolve(here, '../demo/public'),
  plugins: [noOutsideAddresses(), react()],
  define: {
    'import.meta.env.VITE_AUTH_MODE': JSON.stringify('cookie'),
    'import.meta.env.VITE_DEMO': JSON.stringify('true'),
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ ...tailwindConfig, content: [...tailwindConfig.content.map((p) => path.resolve(here, '..', p)), path.resolve(here, 'demo/**/*.{ts,tsx,html}')] }),
        autoprefixer(),
      ],
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router-dom', 'lucide-react'],
    alias: [
      { find: /^@stripe\/stripe-js$/, replacement: path.resolve(here, 'demo/stubs/stripe-js.ts') },
      { find: /^@stripe\/react-stripe-js$/, replacement: path.resolve(here, 'demo/stubs/react-stripe-js.tsx') },
    ],
  },
  build: {
    outDir: path.resolve(here, 'dist-demo'),
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: 'demo-assets',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: { app: path.resolve(here, 'demo/app.html'), picker: path.resolve(here, 'demo/picker.html') },
      output: { manualChunks: { 'vendor-react': ['react', 'react-dom', 'react-router-dom'] } },
    },
  },
})
