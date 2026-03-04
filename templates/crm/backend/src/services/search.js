/**
 * Global Search Service
 * 
 * Searches across all entities: contacts, projects, jobs, quotes, invoices, etc.
 * Returns unified results with type, name, and link.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Search all entities
 */
export async function globalSearch(companyId, query, options = {}) {
  const { limit = 20, types = null } = options;
  
  if (!query || query.length < 2) {
    return { results: [], query };
  }

  const searchTerm = query.trim();
  const perType = Math.ceil(limit / 6); // Distribute across types
  
  // Define which types to search
  const searchTypes = types || ['contact', 'project', 'job', 'quote', 'invoice', 'document'];
  
  const searches = [];

  // Contacts
  if (searchTypes.includes('contact')) {
    searches.push(
      prisma.contact.findMany({
        where: {
          companyId,
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { email: { contains: searchTerm, mode: 'insensitive' } },
            { company: { contains: searchTerm, mode: 'insensitive' } },
            { phone: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, type: true, email: true, company: true },
        take: perType,
        orderBy: { updatedAt: 'desc' },
      }).then(items => items.map(item => ({
        type: 'contact',
        subtype: item.type,
        id: item.id,
        name: item.name,
        description: item.company || item.email || '',
        url: `/contacts/${item.id}`,
        icon: 'user',
      })))
    );
  }

  // Projects
  if (searchTypes.includes('project')) {
    searches.push(
      prisma.project.findMany({
        where: {
          companyId,
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { number: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } },
            { address: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, number: true, status: true },
        take: perType,
        orderBy: { updatedAt: 'desc' },
      }).then(items => items.map(item => ({
        type: 'project',
        subtype: item.status,
        id: item.id,
        name: item.name,
        description: item.number,
        url: `/projects/${item.id}`,
        icon: 'folder',
      })))
    );
  }

  // Jobs
  if (searchTypes.includes('job')) {
    searches.push(
      prisma.job.findMany({
        where: {
          companyId,
          OR: [
            { title: { contains: searchTerm, mode: 'insensitive' } },
            { number: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: { id: true, title: true, number: true, status: true },
        take: perType,
        orderBy: { updatedAt: 'desc' },
      }).then(items => items.map(item => ({
        type: 'job',
        subtype: item.status,
        id: item.id,
        name: item.title,
        description: item.number,
        url: `/jobs/${item.id}`,
        icon: 'wrench',
      })))
    );
  }

  // Quotes
  if (searchTypes.includes('quote')) {
    searches.push(
      prisma.quote.findMany({
        where: {
          companyId,
          OR: [
            { number: { contains: searchTerm, mode: 'insensitive' } },
            { name: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, number: true, status: true, total: true },
        take: perType,
        orderBy: { updatedAt: 'desc' },
      }).then(items => items.map(item => ({
        type: 'quote',
        subtype: item.status,
        id: item.id,
        name: item.name || item.number,
        description: `${item.number} • $${Number(item.total).toLocaleString()}`,
        url: `/quotes/${item.id}`,
        icon: 'file-text',
      })))
    );
  }

  // Invoices
  if (searchTypes.includes('invoice')) {
    searches.push(
      prisma.invoice.findMany({
        where: {
          companyId,
          OR: [
            { number: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: { id: true, number: true, status: true, total: true },
        take: perType,
        orderBy: { updatedAt: 'desc' },
      }).then(items => items.map(item => ({
        type: 'invoice',
        subtype: item.status,
        id: item.id,
        name: item.number,
        description: `$${Number(item.total).toLocaleString()} • ${item.status}`,
        url: `/invoices/${item.id}`,
        icon: 'file-invoice',
      })))
    );
  }

  // Documents
  if (searchTypes.includes('document')) {
    searches.push(
      prisma.document.findMany({
        where: {
          companyId,
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, type: true, fileType: true },
        take: perType,
        orderBy: { updatedAt: 'desc' },
      }).then(items => items.map(item => ({
        type: 'document',
        subtype: item.type,
        id: item.id,
        name: item.name,
        description: item.fileType || '',
        url: `/documents/${item.id}`,
        icon: 'file',
      })))
    );
  }

  // Team Members
  if (searchTypes.includes('team')) {
    searches.push(
      prisma.teamMember.findMany({
        where: {
          companyId,
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { email: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, role: true, email: true },
        take: perType,
        orderBy: { name: 'asc' },
      }).then(items => items.map(item => ({
        type: 'team',
        subtype: item.role,
        id: item.id,
        name: item.name,
        description: item.role || item.email || '',
        url: `/team/${item.id}`,
        icon: 'users',
      })))
    );
  }

  // RFIs
  if (searchTypes.includes('rfi')) {
    searches.push(
      prisma.rFI.findMany({
        where: {
          companyId,
          OR: [
            { number: { contains: searchTerm, mode: 'insensitive' } },
            { subject: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: { id: true, number: true, subject: true, status: true },
        take: perType,
        orderBy: { updatedAt: 'desc' },
      }).then(items => items.map(item => ({
        type: 'rfi',
        subtype: item.status,
        id: item.id,
        name: item.subject,
        description: item.number,
        url: `/rfis/${item.id}`,
        icon: 'help-circle',
      })))
    );
  }

  // Execute all searches in parallel
  const resultsArrays = await Promise.all(searches);
  
  // Flatten and sort by relevance (exact matches first)
  let results = resultsArrays.flat();
  
  // Sort: exact name matches first, then partial matches
  const lowerQuery = searchTerm.toLowerCase();
  results.sort((a, b) => {
    const aExact = a.name.toLowerCase() === lowerQuery;
    const bExact = b.name.toLowerCase() === lowerQuery;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    
    const aStarts = a.name.toLowerCase().startsWith(lowerQuery);
    const bStarts = b.name.toLowerCase().startsWith(lowerQuery);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    
    return 0;
  });

  // Limit total results
  results = results.slice(0, limit);

  return {
    results,
    query: searchTerm,
    count: results.length,
  };
}

/**
 * Quick search - lighter weight, just names
 */
export async function quickSearch(companyId, query, limit = 10) {
  if (!query || query.length < 2) {
    return [];
  }

  const results = await globalSearch(companyId, query, { limit });
  return results.results.map(r => ({
    type: r.type,
    id: r.id,
    name: r.name,
    url: r.url,
  }));
}

/**
 * Get recent items (for empty search state)
 */
export async function getRecentItems(companyId, limit = 10) {
  const [contacts, projects, jobs] = await Promise.all([
    prisma.contact.findMany({
      where: { companyId },
      select: { id: true, name: true, type: true },
      take: 3,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.project.findMany({
      where: { companyId },
      select: { id: true, name: true, number: true },
      take: 3,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.job.findMany({
      where: { companyId },
      select: { id: true, title: true, number: true },
      take: 4,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  return [
    ...contacts.map(c => ({ type: 'contact', id: c.id, name: c.name, url: `/contacts/${c.id}` })),
    ...projects.map(p => ({ type: 'project', id: p.id, name: p.name, url: `/projects/${p.id}` })),
    ...jobs.map(j => ({ type: 'job', id: j.id, name: j.title, url: `/jobs/${j.id}` })),
  ].slice(0, limit);
}

export default { globalSearch, quickSearch, getRecentItems };
