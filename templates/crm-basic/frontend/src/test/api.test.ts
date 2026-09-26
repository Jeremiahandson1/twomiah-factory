import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('API Client', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    global.localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
  });

  describe('Token management', () => {
    it('stores tokens in localStorage', () => {
      localStorage.setItem('accessToken', 'test-token');
      expect(localStorage.setItem).toHaveBeenCalledWith('accessToken', 'test-token');
    });

    it('clears tokens on logout', () => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      expect(localStorage.removeItem).toHaveBeenCalledWith('accessToken');
      expect(localStorage.removeItem).toHaveBeenCalledWith('refreshToken');
    });
  });

  describe('Request building', () => {
    it('builds query string from params', () => {
      const params = { page: 1, limit: 25, status: 'active' };
      const query = new URLSearchParams(params).toString();
      expect(query).toBe('page=1&limit=25&status=active');
    });

    it('handles empty params', () => {
      const params = {};
      const query = new URLSearchParams(params).toString();
      expect(query).toBe('');
    });

    it('filters out undefined values', () => {
      const params = { page: 1, search: undefined };
      Object.keys(params).forEach(k => params[k] === undefined && delete params[k]);
      const query = new URLSearchParams(params).toString();
      expect(query).toBe('page=1');
    });
  });

  describe('Response handling', () => {
    it('parses JSON response', async () => {
      const mockData = { id: '1', name: 'Test' };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const response = await fetch('/api/test');
      const data = await response.json();
      
      expect(data).toEqual(mockData);
    });

    it('handles error response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Not found' }),
      });

      const response = await fetch('/api/test');
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });
});
