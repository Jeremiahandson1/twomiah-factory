const API_BASE = import.meta.env.VITE_API_URL || '/api';

export async function fetchApi(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  };

  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Something went wrong');
  }

  return data;
}

export const api = {
  // Leads
  submitLead: (data) => fetchApi('/leads', { method: 'POST', body: data }),
  getLeads: (params) => fetchApi(`/leads?${new URLSearchParams(params)}`),
  getLead: (id) => fetchApi(`/leads/${id}`),
  updateLead: (id, data) => fetchApi(`/leads/${id}`, { method: 'PATCH', body: data }),
  updateLeadStatus: (id, status) => fetchApi(`/leads/${id}/status`, { method: 'PATCH', body: { status } }),
  deleteLead: (id) => fetchApi(`/leads/${id}`, { method: 'DELETE' }),
  getLeadStatuses: () => fetchApi('/leads/statuses'),
  getPipeline: () => fetchApi('/leads/pipeline'),

  // Services
  getServices: () => fetchApi('/services')
};
