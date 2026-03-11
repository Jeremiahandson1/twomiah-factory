const API_URL = import.meta.env.VITE_API_URL || '';

class PortalApiClient {
  private token: string | null;

  constructor() {
    this.token = localStorage.getItem('portalToken');
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('portalToken', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('portalToken');
  }

  getToken() {
    return this.token;
  }

  async request(endpoint: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };

    const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

    if (response.status === 401) {
      this.clearToken();
      window.location.href = '/portal/login';
      throw new Error('Session expired');
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  get(endpoint: string) {
    return this.request(endpoint);
  }

  post(endpoint: string, body: any = {}) {
    return this.request(endpoint, { method: 'POST', body: JSON.stringify(body) });
  }
}

export const portalApi = new PortalApiClient();
export default portalApi;
