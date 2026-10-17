import { describe, it, expect } from 'vitest';

describe('Utility functions', () => {
  describe('Currency formatting', () => {
    const formatCurrency = (amount) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(amount || 0);
    };

    it('formats positive numbers', () => {
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
    });

    it('formats zero', () => {
      expect(formatCurrency(0)).toBe('$0.00');
    });

    it('handles null', () => {
      expect(formatCurrency(null)).toBe('$0.00');
    });

    it('handles negative numbers', () => {
      expect(formatCurrency(-100)).toBe('-$100.00');
    });
  });

  describe('Date formatting', () => {
    const formatDate = (date) => {
      if (!date) return '';
      return new Date(date).toLocaleDateString('en-US');
    };

    it('formats date string', () => {
      const result = formatDate('2024-03-15');
      expect(result).toMatch(/3\/15\/2024|03\/15\/2024/);
    });

    it('handles null', () => {
      expect(formatDate(null)).toBe('');
    });
  });

  describe('Status colors', () => {
    const getStatusColor = (status) => {
      const colors = {
        draft: 'gray',
        sent: 'blue',
        approved: 'green',
        rejected: 'red',
        paid: 'green',
        overdue: 'red',
      };
      return colors[status] || 'gray';
    };

    it('returns correct colors', () => {
      expect(getStatusColor('draft')).toBe('gray');
      expect(getStatusColor('approved')).toBe('green');
      expect(getStatusColor('overdue')).toBe('red');
    });

    it('defaults to gray for unknown status', () => {
      expect(getStatusColor('unknown')).toBe('gray');
    });
  });

  describe('Pagination', () => {
    const getPaginationRange = (current, total) => {
      const delta = 2;
      const range = [];
      const left = Math.max(2, current - delta);
      const right = Math.min(total - 1, current + delta);

      range.push(1);
      if (left > 2) range.push('...');
      for (let i = left; i <= right; i++) range.push(i);
      if (right < total - 1) range.push('...');
      if (total > 1) range.push(total);

      return range;
    };

    it('shows all pages when total is small', () => {
      const range = getPaginationRange(1, 5);
      expect(range).toContain(1);
      expect(range).toContain(5);
    });

    it('shows ellipsis for large page counts', () => {
      const range = getPaginationRange(5, 20);
      expect(range).toContain('...');
    });
  });
});
