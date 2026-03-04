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


export function getSubServiceById(id) {
  for (const service of services) {
    const sub = (service.subServices || []).find(s => s.id === id || s.slug === id);
    if (sub) return { ...sub, parentService: service };
  }
  return null;
}
