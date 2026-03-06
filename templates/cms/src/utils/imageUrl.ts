// Get the base URL for API calls
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Get base URL for static uploads (strip /api suffix)
export const UPLOAD_BASE = API_BASE.replace('/api', '');

// Convert relative upload URLs to full URLs
export const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${UPLOAD_BASE}${url}`;
};
