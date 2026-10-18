import { useState, useEffect, useCallback, useRef } from 'react';

// Debounce a value
export function useDebounce<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Debounce a callback
export function useDebouncedCallback<T extends (...args: unknown[]) => void>(callback: T, delay = 300): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedCallback = useCallback((...args: unknown[]) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]) as unknown as T;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

// Throttle a callback (limit how often it can be called)
export function useThrottledCallback<T extends (...args: unknown[]) => void>(callback: T, delay = 300): T {
  const lastRunRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const throttledCallback = useCallback((...args: unknown[]) => {
    const now = Date.now();
    const timeSinceLastRun = now - lastRunRef.current;

    if (timeSinceLastRun >= delay) {
      lastRunRef.current = now;
      callback(...args);
    } else {
      // Schedule to run after the remaining delay
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        lastRunRef.current = Date.now();
        callback(...args);
      }, delay - timeSinceLastRun);
    }
  }, [callback, delay]) as unknown as T;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return throttledCallback;
}

export default useDebounce;
