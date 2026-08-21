import { useState, useCallback, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext';
import type { ApiOptions } from '../types';

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const execute = useCallback(async <T = unknown>(apiCall: () => Promise<T>, options: ApiOptions = {}): Promise<T> => {
    const {
      showSuccessToast = false,
      successMessage = 'Success!',
      showErrorToast = true,
      errorMessage,
      onSuccess,
      onError,
    } = options;

    setLoading(true);
    setError(null);

    try {
      const result = await apiCall();

      if (showSuccessToast) {
        toast.success(successMessage);
      }

      if (onSuccess) {
        onSuccess(result);
      }

      return result;
    } catch (err) {
      const message = errorMessage || (err instanceof Error ? err.message : 'Something went wrong');
      setError(message);

      if (showErrorToast) {
        toast.error(message);
      }

      if (onError) {
        onError(err instanceof Error ? err : new Error(message));
      }

      throw err;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
  }, []);

  return { loading, error, execute, reset };
}

// Hook for fetching data with automatic loading states
export function useFetch<T = unknown>(fetchFn: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch on mount and when deps change
  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch, setData };
}
