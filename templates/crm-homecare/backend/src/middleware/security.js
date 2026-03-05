// security.js — no CSRF origin blocking; CORS middleware handles origin validation
export const applySecurity = (app) => {
  // Intentionally empty — CORS is handled by the cors() middleware in index.js
};
