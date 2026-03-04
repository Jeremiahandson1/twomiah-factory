import crypto from 'crypto';
import logger from '../services/logger.js';

// Security headers middleware
export function securityHeaders(req, res, next) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Content Security Policy
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline';");
  
  // Remove X-Powered-By
  res.removeHeader('X-Powered-By');
  
  next();
}

// Input sanitization - removes potential XSS
export function sanitizeInput(obj) {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    // Remove script tags and event handlers
    return obj
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/on\w+='[^']*'/gi, '')
      .replace(/javascript:/gi, '')
      .trim();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }
  
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      // Skip prototype pollution attempts
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      sanitized[key] = sanitizeInput(obj[key]);
    }
    return sanitized;
  }
  
  return obj;
}

// Sanitization middleware
export function sanitizeMiddleware(req, res, next) {
  if (req.body) {
    req.body = sanitizeInput(req.body);
  }
  if (req.query) {
    req.query = sanitizeInput(req.query);
  }
  if (req.params) {
    req.params = sanitizeInput(req.params);
  }
  next();
}

// CSRF token generation and validation
const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_HEADER = 'x-csrf-token';
const CSRF_COOKIE_NAME = 'csrf_token';

export function generateCsrfToken() {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

// CSRF middleware
export function csrfProtection(req, res, next) {
  // Skip for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  const tokenFromHeader = req.get(CSRF_TOKEN_HEADER);
  const tokenFromCookie = req.cookies?.[CSRF_COOKIE_NAME];
  
  if (!tokenFromHeader || !tokenFromCookie) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }
  
  // Constant-time comparison to prevent timing attacks
  const headerBuffer = Buffer.from(tokenFromHeader);
  const cookieBuffer = Buffer.from(tokenFromCookie);
  
  if (headerBuffer.length !== cookieBuffer.length || !crypto.timingSafeEqual(headerBuffer, cookieBuffer)) {
    logger.warn('CSRF token mismatch', { ip: req.ip, path: req.path });
    return res.status(403).json({ error: 'CSRF token invalid' });
  }
  
  next();
}

// Set CSRF cookie
export function setCsrfCookie(req, res, next) {
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    const token = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false, // Must be readable by JS
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }
  next();
}

// Request ID middleware for tracing
export function requestId(req, res, next) {
  req.id = req.get('X-Request-ID') || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
}

// Request timing middleware
export function requestTiming(req, res, next) {
  req.startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    logger.logRequest(req, res, duration);
  });
  
  next();
}

// IP whitelist/blacklist
const ipBlacklist = new Set();
const ipWhitelist = new Set();

export function loadIpLists(blacklist = [], whitelist = []) {
  blacklist.forEach(ip => ipBlacklist.add(ip));
  whitelist.forEach(ip => ipWhitelist.add(ip));
}

export function ipFilter(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  // If whitelist is not empty, only allow whitelisted IPs
  if (ipWhitelist.size > 0 && !ipWhitelist.has(clientIp)) {
    logger.warn('IP not in whitelist', { ip: clientIp });
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Check blacklist
  if (ipBlacklist.has(clientIp)) {
    logger.warn('Blocked IP attempted access', { ip: clientIp });
    return res.status(403).json({ error: 'Access denied' });
  }
  
  next();
}

// SQL injection pattern detection (for logging/alerting)
const sqlPatterns = [
  /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
  /(\%22)|(\")/i,
  /(\%3B)|(;)/i,
  /(union|select|insert|update|delete|drop|truncate|alter|exec|execute)/i,
];

export function detectSqlInjection(value) {
  if (typeof value !== 'string') return false;
  return sqlPatterns.some(pattern => pattern.test(value));
}

export function sqlInjectionDetector(req, res, next) {
  const checkObject = (obj, path = '') => {
    if (!obj) return;
    
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (typeof value === 'string' && detectSqlInjection(value)) {
        logger.warn('Potential SQL injection detected', {
          ip: req.ip,
          path: req.path,
          field: currentPath,
          value: value.substring(0, 100),
        });
      } else if (typeof value === 'object' && value !== null) {
        checkObject(value, currentPath);
      }
    }
  };
  
  checkObject(req.body, 'body');
  checkObject(req.query, 'query');
  checkObject(req.params, 'params');
  
  next();
}

// Export all security middleware as a combined function
export function applySecurity(app) {
  app.use(requestId);
  app.use(requestTiming);
  app.use(securityHeaders);
  app.use(sanitizeMiddleware);
  app.use(sqlInjectionDetector);
}

export default {
  securityHeaders,
  sanitizeInput,
  sanitizeMiddleware,
  csrfProtection,
  setCsrfCookie,
  generateCsrfToken,
  requestId,
  requestTiming,
  ipFilter,
  loadIpLists,
  detectSqlInjection,
  sqlInjectionDetector,
  applySecurity,
};
