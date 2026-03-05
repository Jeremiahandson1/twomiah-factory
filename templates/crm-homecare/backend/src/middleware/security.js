// security.js
export const applySecurity = (app) => {
  // CSRF-lite: block requests with no origin on state-changing methods in prod
  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.headers.origin;
        const allowed = process.env.FRONTEND_URL;
        if (origin && allowed && !origin.startsWith(allowed)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }
      next();
    });
  }
};
