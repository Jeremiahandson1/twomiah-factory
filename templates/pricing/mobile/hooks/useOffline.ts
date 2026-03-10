import { useState, useEffect, useCallback, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { syncQueue, syncQuotes, getPendingCount, getLastSyncTime } from '@/lib/sync';

interface UseOfflineReturn {
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncAge: string | null;
  manualSync: () => Promise<void>;
}

export function useOffline(): UseOfflineReturn {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAge, setLastSyncAge] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = !!(state.isConnected && state.isInternetReachable);
      setIsOnline(online);
    });

    return () => unsubscribe();
  }, []);

  const refreshPending = useCallback(() => {
    setPendingCount(getPendingCount());
    const lastSync = getLastSyncTime();
    if (lastSync) {
      const diff = Date.now() - new Date(lastSync).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) {
        setLastSyncAge('just now');
      } else if (mins < 60) {
        setLastSyncAge(`${mins}m ago`);
      } else {
        const hrs = Math.floor(mins / 60);
        setLastSyncAge(`${hrs}h ago`);
      }
    } else {
      setLastSyncAge(null);
    }
  }, []);

  useEffect(() => {
    refreshPending();
    intervalRef.current = setInterval(refreshPending, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshPending]);

  useEffect(() => {
    if (isOnline && pendingCount > 0 && !syncing) {
      manualSync();
    }
  }, [isOnline]);

  const manualSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncQueue();
      await syncQuotes();
    } catch {
      // Sync errors handled internally
    } finally {
      setSyncing(false);
      refreshPending();
    }
  }, [syncing, refreshPending]);

  return { isOnline, pendingCount, syncing, lastSyncAge, manualSync };
}
