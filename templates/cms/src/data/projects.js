// Project data — populate via CMS admin panel
export const projects = [];

// Helper to get projects by type/service
export function getProjectsByType(type) {
  if (!type) return projects;
  return projects.filter(p => p.type === type || p.serviceType === type || p.category === type);
}

// Helper to get project by ID
export function getProjectById(id) {
  return projects.find(p => p.id === id);
}

// Helper to get project by slug
export function getProjectBySlug(slug) {
  return projects.find(p => p.slug === slug);
}
