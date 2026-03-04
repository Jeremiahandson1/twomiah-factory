const { execSync } = require('child_process');
const path = require('path');

let rebuildTimeout = null;

function triggerRebuild() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Rebuild] Skipping in development mode');
    return;
  }
  
  if (rebuildTimeout) clearTimeout(rebuildTimeout);
  
  console.log('[Rebuild] Queued, waiting for more changes...');
  
  rebuildTimeout = setTimeout(() => {
    console.log('[Rebuild] Starting static site rebuild...');
    try {
      const buildScript = path.join(__dirname, '../../build-static.js');
      execSync(`node ${buildScript}`, {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' }
      });
      console.log('[Rebuild] ✓ Static site rebuilt successfully');
    } catch (error) {
      console.error('[Rebuild] ✗ Build failed:', error.message);
    }
  }, 15000); // Wait 15 seconds after last change
}

const TRIGGER_PATHS = [
  '/gallery', '/homepage', '/services-data', '/testimonials',
  '/pages', '/site-settings', '/nav-config'
];

function rebuildMiddleware(req, res, next) {
  if (req.method === 'GET') return next();
  
  const originalJson = res.json;
  res.json = function(data) {
    if (data && data.error === undefined) {
      if (TRIGGER_PATHS.some(p => req.path.startsWith(p))) {
        triggerRebuild();
      }
    }
    return originalJson.call(this, data);
  };
  
  next();
}

module.exports = { rebuildMiddleware, triggerRebuild };
