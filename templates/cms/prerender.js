/**
 * Post-build prerender script
 * 
 * Runs after `vite build` to generate static HTML for each public route.
 * This gives Google full page content on first crawl instead of an empty <div id="root">.
 * 
 * Usage: node prerender.js (runs automatically via `npm run build`)
 * Requires: puppeteer (devDependency)
 */

import { launch } from 'puppeteer';
import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');

// Static routes that every site has
const staticRoutes = ['/', '/gallery'];

// Discover service routes from the backend API at build time
async function discoverRoutes(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/services-data`);
    const services = await res.json();
    if (!Array.isArray(services)) return staticRoutes;

    const serviceRoutes = [];
    for (const svc of services) {
      if (svc.slug) {
        serviceRoutes.push(`/services/${svc.slug}`);
        if (Array.isArray(svc.subServices)) {
          for (const sub of svc.subServices) {
            if (sub.slug) serviceRoutes.push(`/services/${svc.slug}/${sub.slug}`);
          }
        }
      }
    }
    return [...staticRoutes, ...serviceRoutes];
  } catch {
    // If API isn't available, just prerender the static routes
    return staticRoutes;
  }
}

// Simple static file server for the built dist
function startServer(port) {
  return new Promise((resolve) => {
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };

    const server = createServer((req, res) => {
      // API calls during prerender — return empty/default data
      if (req.url.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        
        if (req.url.includes('public-settings')) {
          res.end(JSON.stringify({
            phone: '{{COMPANY_PHONE}}',
            email: '{{COMPANY_EMAIL}}',
            address: '{{COMPANY_ADDRESS}}',
            city: '{{CITY}}',
            state: '{{STATE}}',
            zip: '{{ZIP}}'
          }));
        } else if (req.url.includes('homepage')) {
          res.end(JSON.stringify({}));
        } else if (req.url.includes('testimonials')) {
          res.end(JSON.stringify([]));
        } else if (req.url.includes('services-data')) {
          res.end(JSON.stringify([]));
        } else if (req.url.includes('pages/')) {
          res.end(JSON.stringify(null));
        } else {
          res.end(JSON.stringify({}));
        }
        return;
      }

      let filePath = join(DIST, req.url === '/' ? 'index.html' : req.url);
      
      // SPA fallback
      if (!existsSync(filePath) || !filePath.includes('.')) {
        filePath = join(DIST, 'index.html');
      }

      try {
        const content = readFileSync(filePath);
        const ext = filePath.substring(filePath.lastIndexOf('.'));
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(port, () => resolve(server));
  });
}

async function prerender() {
  const PORT = 4173;
  const server = await startServer(PORT);
  
  const routes = await discoverRoutes(PORT);
  console.log(`\n🔍 Prerendering ${routes.length} routes for SEO...\n`);

  let browser;
  try {
    browser = await launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (const route of routes) {
      const page = await browser.newPage();
      
      try {
        await page.goto(`http://localhost:${PORT}${route}`, {
          waitUntil: 'networkidle0',
          timeout: 10000
        });

        // Wait a bit for any animations/transitions to settle
        await new Promise(r => setTimeout(r, 500));

        // Get the fully rendered HTML
        let html = await page.content();
        
        // Add a marker so the client-side React knows to hydrate, not re-render
        html = html.replace(
          '<div id="root">',
          '<div id="root" data-prerendered="true">'
        );

        // Write to the correct path
        const filePath = route === '/'
          ? join(DIST, 'index.html')
          : join(DIST, route, 'index.html');

        // Create directory if needed
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        writeFileSync(filePath, html);
        console.log(`  ✅ ${route}`);
      } catch (err) {
        console.log(`  ⚠️  ${route} - ${err.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  console.log(`\n✨ Prerendering complete!\n`);
}

prerender().catch((err) => {
  console.error('Prerender failed:', err.message);
  console.log('Build will continue without prerendering — site still works, just without static HTML for SEO.');
  process.exit(0); // Don't fail the build
});
