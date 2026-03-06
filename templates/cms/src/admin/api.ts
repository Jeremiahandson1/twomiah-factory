// Admin API utilities

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Get stored auth token
export const getToken = () => localStorage.getItem('adminToken');

// Make authenticated API request
export const apiRequest = async (endpoint, options = {}) => {
  const token = getToken();
  
  const config = {
    ...options,
    headers: {
      ...options.headers,
    }
  };
  
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  if (!(options.body instanceof FormData)) {
    config.headers['Content-Type'] = 'application/json';
  }
  
  const response = await fetch(`${API_BASE}${endpoint}`, config);
  
  if (response.status === 401) {
    localStorage.removeItem('adminToken');
    window.location.href = '/admin/login';
    throw new Error('Session expired');
  }
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || data.message || 'Request failed');
  }
  
  return data;
};

// ============ AUTH ============

export const login = async (password) => {
  const data = await apiRequest('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password })
  });
  if (data.token) localStorage.setItem('adminToken', data.token);
  return data;
};

export const verifyToken = async () => {
  try {
    await apiRequest('/admin/verify');
    return true;
  } catch {
    return false;
  }
};

export const logout = () => localStorage.removeItem('adminToken');

export const changePassword = async (currentPassword, newPassword) => {
  return apiRequest('/admin/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  });
};

// ============ SITE SETTINGS ============

export const getSiteSettings = async () => {
  return apiRequest('/admin/site-settings');
};

export const saveSiteSettings = async (settings) => {
  return apiRequest('/admin/site-settings', {
    method: 'PUT',
    body: JSON.stringify(settings)
  });
};

// ============ PAGES ============

export const getPage = async (pageId) => {
  try {
    return await apiRequest(`/admin/pages/${encodeURIComponent(pageId)}`);
  } catch {
    return null;
  }
};

export const savePage = async (pageId, content) => {
  return apiRequest(`/admin/pages/${encodeURIComponent(pageId)}`, {
    method: 'PUT',
    body: JSON.stringify(content)
  });
};

export const deletePage = async (pageId) => {
  return apiRequest(`/admin/pages/${encodeURIComponent(pageId)}`, {
    method: 'DELETE'
  });
};

export const getAllPages = async () => {
  return apiRequest('/admin/pages');
};

export const duplicatePage = async (pageId, newPageId) => {
  return apiRequest(`/admin/pages/${encodeURIComponent(pageId)}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ newPageId })
  });
};

export const createPage = async (pageId, title, placement = null, type = 'custom') => {
  return apiRequest('/admin/pages', {
    method: 'POST',
    body: JSON.stringify({ pageId, title, type, placement })
  });
};

export const getCustomPages = async () => {
  return apiRequest('/admin/custom-pages');
};

export const searchPages = async (query) => {
  return apiRequest(`/admin/search?q=${encodeURIComponent(query)}`);
};

export const bulkPageAction = async (action, pageIds) => {
  return apiRequest('/admin/bulk/pages', {
    method: 'POST',
    body: JSON.stringify({ action, pageIds })
  });
};

// ============ TRASH ============

export const getTrash = async () => {
  return apiRequest('/admin/trash');
};

export const restoreFromTrash = async (trashId) => {
  return apiRequest(`/admin/trash/${trashId}/restore`, {
    method: 'POST'
  });
};

export const deleteFromTrash = async (trashId) => {
  return apiRequest(`/admin/trash/${trashId}`, {
    method: 'DELETE'
  });
};

export const emptyTrash = async () => {
  return apiRequest('/admin/trash', {
    method: 'DELETE'
  });
};

// ============ LEADS ============

export const getLeads = async () => {
  return apiRequest('/admin/leads');
};

export const updateLead = async (leadId, data) => {
  return apiRequest(`/admin/leads/${leadId}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
};

export const deleteLead = async (leadId) => {
  return apiRequest(`/admin/leads/${leadId}`, {
    method: 'DELETE'
  });
};

// Public endpoint for form submissions
export const submitLead = async (data) => {
  const response = await fetch(`${API_BASE}/admin/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
};

// ============ REDIRECTS ============

export const getRedirects = async () => {
  return apiRequest('/admin/redirects');
};

export const createRedirect = async (from, to, type = '301') => {
  return apiRequest('/admin/redirects', {
    method: 'POST',
    body: JSON.stringify({ from, to, type })
  });
};

export const deleteRedirect = async (redirectId) => {
  return apiRequest(`/admin/redirects/${redirectId}`, {
    method: 'DELETE'
  });
};

// ============ REVISIONS ============

export const getRevisions = async (pageId) => {
  return apiRequest(`/admin/pages/${encodeURIComponent(pageId)}/revisions`);
};

export const restoreRevision = async (pageId, revisionId) => {
  return apiRequest(`/admin/pages/${encodeURIComponent(pageId)}/revisions/${revisionId}/restore`, {
    method: 'POST'
  });
};

// ============ ACTIVITY LOG ============

export const getActivity = async () => {
  return apiRequest('/admin/activity');
};

// ============ EXPORT / IMPORT ============

export const exportData = async () => {
  return apiRequest('/admin/export');
};

export const importData = async (data, merge = true) => {
  return apiRequest('/admin/import', {
    method: 'POST',
    body: JSON.stringify({ ...data, merge })
  });
};

// ============ MEDIA FOLDERS ============

export const getMediaFolders = async () => {
  return apiRequest('/admin/media-folders');
};

export const createMediaFolder = async (name) => {
  return apiRequest('/admin/media-folders', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
};

export const deleteMediaFolder = async (folderId) => {
  return apiRequest(`/admin/media-folders/${folderId}`, {
    method: 'DELETE'
  });
};

// ============ IMAGES ============

export const uploadImage = async (file, folder = 'default', altText = '') => {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('folder', folder);
  formData.append('altText', altText);
  return apiRequest('/admin/upload', {
    method: 'POST',
    body: formData
  });
};

export const getImages = async (folder = null) => {
  const query = folder ? `?folder=${encodeURIComponent(folder)}` : '';
  return apiRequest(`/admin/images${query}`);
};

export const updateImage = async (filename, data) => {
  return apiRequest(`/admin/images/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
};

export const deleteImage = async (filename) => {
  return apiRequest(`/admin/images/${encodeURIComponent(filename)}`, {
    method: 'DELETE'
  });
};

export const bulkImageAction = async (action, filenames, folder = null) => {
  return apiRequest('/admin/bulk/images', {
    method: 'POST',
    body: JSON.stringify({ action, filenames, folder })
  });
};

// ============ PUBLIC PAGE LOADER ============

export const getPublicPage = async (pageId) => {
  try {
    const response = await fetch(`${API_BASE}/admin/pages/${encodeURIComponent(pageId)}`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
};

// ============ NAVIGATION CONFIG ============

export const getNavConfig = async () => {
  return apiRequest('/admin/nav-config');
};

export const updateNavConfig = async (navConfig) => {
  return apiRequest('/admin/nav-config', {
    method: 'PUT',
    body: JSON.stringify(navConfig)
  });
};

export const toggleNavItem = async (itemId, parentId = null) => {
  return apiRequest(`/admin/nav-config/toggle/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({ parentId })
  });
};

// ============ PAGE ORDERING ============

export const reorderPages = async (order) => {
  return apiRequest('/admin/pages/reorder', {
    method: 'PUT',
    body: JSON.stringify({ order })
  });
};

export const movePageToParent = async (pageId, newParent) => {
  return apiRequest(`/admin/pages/${encodeURIComponent(pageId)}/move`, {
    method: 'PUT',
    body: JSON.stringify({ newParent })
  });
};

// ============ SEO ANALYSIS ============

export const analyzeSEO = (pageData) => {
  const issues = [];
  const suggestions = [];
  let score = 100;

  const title = pageData.metaTitle || pageData.title || '';
  const description = pageData.metaDescription || '';
  const content = pageData.content || '';

  if (!title) { issues.push('Missing page title'); score -= 20; }
  else if (title.length < 30) { suggestions.push('Title is short (aim for 50-60 characters)'); score -= 5; }
  else if (title.length > 60) { issues.push('Title too long (keep under 60 characters)'); score -= 10; }

  if (!description) { issues.push('Missing meta description'); score -= 15; }
  else if (description.length < 120) { suggestions.push('Meta description is short (aim for 150-160 characters)'); score -= 5; }
  else if (description.length > 160) { issues.push('Meta description too long (keep under 160 characters)'); score -= 10; }

  const wordCount = content.replace(/<[^>]*>/g, '').split(/\s+/).filter(w => w).length;
  if (wordCount < 100) { suggestions.push(`Content is thin (${wordCount} words)`); score -= 10; }
  if (!pageData.heroImage) { suggestions.push('No hero image set'); score -= 5; }
  if (wordCount > 200 && !content.includes('<h2')) { suggestions.push('Consider adding subheadings (H2)'); score -= 5; }

  return {
    score: Math.max(0, score),
    issues,
    suggestions,
    stats: { titleLength: title.length, descriptionLength: description.length, wordCount }
  };
};

// ============ BLOG POSTS ============

export const getPosts = async () => {
  return apiRequest('/admin/posts');
};

export const getPost = async (postId) => {
  return apiRequest(`/admin/posts/${encodeURIComponent(postId)}`);
};

export const createPost = async (data) => {
  return apiRequest('/admin/posts', {
    method: 'POST',
    body: JSON.stringify(data)
  });
};

export const updatePost = async (postId, data) => {
  return apiRequest(`/admin/posts/${encodeURIComponent(postId)}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
};

export const deletePost = async (postId) => {
  return apiRequest(`/admin/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE'
  });
};
