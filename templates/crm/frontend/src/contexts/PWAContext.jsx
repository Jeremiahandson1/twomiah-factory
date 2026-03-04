import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { 
  initDB, 
  getPendingActions, 
  syncPendingActions,
  queueAction,
  isOnline,
  onConnectivityChange,
} from '../services/offline';
import api from '../services/api';

const PWAContext = createContext(null);

export function PWAProvider({ children }) {
  const [online, setOnline] = useState(isOnline());
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState(null);

  // Initialize
  useEffect(() => {
    // Init IndexedDB
    initDB().then(() => {
      updatePendingCount();
    });

    // Check if app is installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    // Listen for install prompt
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // Listen for app installed
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    // Register service worker
    registerServiceWorker();

    // Cleanup
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Listen for connectivity changes
  useEffect(() => {
    const cleanup = onConnectivityChange((isOnline) => {
      setOnline(isOnline);
      
      // Auto-sync when back online
      if (isOnline) {
        syncOfflineActions();
      }
    });

    return cleanup;
  }, []);

  // Register service worker
  const registerServiceWorker = async () => {
    if (!('serviceWorker' in navigator)) {
      console.log('Service workers not supported');
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      setRegistration(reg);

      // Check for updates
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }
        });
      });

      // Listen for messages from SW
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'SYNC_COMPLETE') {
          updatePendingCount();
        }
      });

      console.log('Service worker registered');
    } catch (error) {
      console.error('Service worker registration failed:', error);
    }
  };

  // Update pending actions count
  const updatePendingCount = async () => {
    const actions = await getPendingActions();
    setPendingCount(actions.length);
  };

  // Sync offline actions
  const syncOfflineActions = useCallback(async () => {
    if (syncing || !online) return;

    setSyncing(true);
    try {
      const results = await syncPendingActions(api);
      console.log('Sync results:', results);
      await updatePendingCount();
      return results;
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    } finally {
      setSyncing(false);
    }
  }, [syncing, online]);

  // Queue an action for offline sync
  const queueOfflineAction = useCallback(async (action) => {
    const queued = await queueAction(action);
    await updatePendingCount();
    return queued;
  }, []);

  // Install the PWA
  const installApp = useCallback(async () => {
    if (!installPrompt) return false;

    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setInstallPrompt(null);
      return true;
    }
    
    return false;
  }, [installPrompt]);

  // Apply update
  const applyUpdate = useCallback(() => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }, [registration]);

  const value = {
    // State
    online,
    pendingCount,
    syncing,
    isInstalled,
    canInstall: !!installPrompt,
    updateAvailable,
    
    // Actions
    syncOfflineActions,
    queueOfflineAction,
    installApp,
    applyUpdate,
  };

  return (
    <PWAContext.Provider value={value}>
      {children}
    </PWAContext.Provider>
  );
}

export function usePWA() {
  const context = useContext(PWAContext);
  if (!context) {
    throw new Error('usePWA must be used within a PWAProvider');
  }
  return context;
}

/**
 * Offline indicator component
 */
export function OfflineIndicator() {
  const { online, pendingCount, syncing, syncOfflineActions } = usePWA();

  if (online && pendingCount === 0) return null;

  return (
    <div className={`fixed bottom-4 left-4 z-50 px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 ${
      online ? 'bg-yellow-500 text-yellow-900' : 'bg-red-500 text-white'
    }`}>
      {!online ? (
        <>
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-sm font-medium">You're offline</span>
        </>
      ) : (
        <>
          <span className="text-sm">
            {pendingCount} pending {pendingCount === 1 ? 'change' : 'changes'}
          </span>
          <button
            onClick={syncOfflineActions}
            disabled={syncing}
            className="text-sm underline"
          >
            {syncing ? 'Syncing...' : 'Sync now'}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Install prompt component
 */
export function InstallPrompt() {
  const { canInstall, installApp, isInstalled } = usePWA();
  const [dismissed, setDismissed] = useState(false);

  if (!canInstall || isInstalled || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-white rounded-xl shadow-xl p-4 max-w-sm border">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <span className="text-2xl">📲</span>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">Install Twomiah Build</h3>
          <p className="text-sm text-gray-500 mt-1">
            Add to your home screen for quick access and offline use.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={installApp}
              className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600"
            >
              Install
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="px-3 py-1.5 text-gray-500 text-sm hover:text-gray-700"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Update prompt component
 */
export function UpdatePrompt() {
  const { updateAvailable, applyUpdate } = usePWA();

  if (!updateAvailable) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
      <span className="text-sm">A new version is available!</span>
      <button
        onClick={applyUpdate}
        className="px-3 py-1 bg-white text-blue-600 text-sm rounded font-medium hover:bg-blue-50"
      >
        Update now
      </button>
    </div>
  );
}
