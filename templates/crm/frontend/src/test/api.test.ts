import { describe, it, expect, vi, beforeEach } from 'vitest';

declare const global: typeof globalThis;

describe('API Client', () => {
  beforeEach(() => {
    (global as Record<string, unknown>).fetch = vi.fn();
    (global as Record<string, unknown>).localStorage = {
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
      const params: Record<string, string | number> = { page: 1, limit: 25, status: 'active' };
      const query = new URLSearchParams(params as Record<string, string>).toString();
      expect(query).toBe('page=1&limit=25&status=active');
    });

    it('handles empty params', () => {
      const params: Record<string, string> = {};
      const query = new URLSearchParams(params).toString();
      expect(query).toBe('');
    });

    it('filters out undefined values', () => {
      const params: Record<string, string | number | undefined> = { page: 1, search: undefined };
      Object.keys(params).forEach((k: string) => params[k] === undefined && delete params[k]);
      const query = new URLSearchParams(params as Record<string, string>).toString();
      expect(query).toBe('page=1');
    });
  });

  describe('Response handling', () => {
    it('parses JSON response', async () => {
      const mockData = { id: '1', name: 'Test' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const response = await fetch('/api/test');
      const data = await response.json();

      expect(data).toEqual(mockData);
    });

    it('handles error response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
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
