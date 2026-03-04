// Service data — populate via CMS admin panel
export const services = [];

// Helper to get service by ID
export function getServiceById(id) {
  return services.find(s => s.id === id);
}

// Helper to get service by slug
export function getServiceBySlug(slug) {
  return services.find(s => s.id === slug || s.slug === slug);
}

// Helper to get sub-service by serviceId + subId
export function getSubServiceById(serviceId, subId) {
  const service = getServiceById(serviceId);
  if (!service) return null;
  return (service.subServices || []).find(s => s.id === subId || s.slug === subId) || null;
}
