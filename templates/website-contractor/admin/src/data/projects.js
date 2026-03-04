// Project data — populate via CMS admin panel
export const projects = [];

export function getProjectsByType(type) {
  if (!type) return projects;
  return projects.filter(p => p.type === type || p.category === type);
}
