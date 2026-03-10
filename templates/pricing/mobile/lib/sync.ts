import NetInfo from '@react-native-community/netinfo';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { apiFetch, getToken } from './api';
import { query, insert, runSql, getAll } from './db';

const BACKGROUND_SYNC_TASK = 'background-sync-task';

interface SyncResult {
  success: boolean;
  downloaded: number;
  synced: number;
  errors: string[];
}

export async function downloadAll(
  onProgress?: (step: string, pct: number) => void
): Promise<SyncResult> {
  const token = await getToken();
  if (!token) {
    return { success: false, downloaded: 0, synced: 0, errors: ['Not authenticated'] };
  }

  const netState = await NetInfo.fetch();
  if (!netState.isConnected) {
    return { success: false, downloaded: 0, synced: 0, errors: ['No network connection'] };
  }

  const errors: string[] = [];
  let downloaded = 0;

  const steps = [
    { name: 'categories', path: '/api/categories', table: 'categories' },
    { name: 'products', path: '/api/products', table: 'products' },
    { name: 'tiers', path: '/api/tiers', table: 'tiers' },
    { name: 'price_ranges', path: '/api/price-ranges', table: 'price_ranges' },
    { name: 'addons', path: '/api/addons', table: 'addons' },
    { name: 'pitch_multipliers', path: '/api/pitch-multipliers', table: 'pitch_multipliers' },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const pct = Math.round(((i + 1) / steps.length) * 100);
    onProgress?.(step.name, pct);

    try {
      const data = await apiFetch<any[]>(step.path);
      if (Array.isArray(data)) {
        runSql(`DELETE FROM ${step.table}`);
        for (const item of data) {
          insert(step.table, item);
        }
        downloaded += data.length;
      }

      insert('sync_meta', {
        store_name: step.table,
        last_synced_at: new Date().toISOString(),
        version: '1',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${step.name}: ${msg}`);
    }
  }

  try {
    onProgress?.('settings', 100);
    const settings = await apiFetch<Record<string, string>>('/api/settings');
    if (settings && typeof settings === 'object') {
      runSql('DELETE FROM settings');
      for (const [key, value] of Object.entries(settings)) {
        insert('settings', { key, value: typeof value === 'string' ? value : JSON.stringify(value) });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`settings: ${msg}`);
  }

  return {
    success: errors.length === 0,
    downloaded,
    synced: 0,
    errors,
  };
}

export async function syncQueue(): Promise<{ synced: number; errors: string[] }> {
  const netState = await NetInfo.fetch();
  if (!netState.isConnected) {
    return { synced: 0, errors: ['No network connection'] };
  }

  const token = await getToken();
  if (!token) {
    return { synced: 0, errors: ['Not authenticated'] };
  }

  const pending = query(
    'SELECT * FROM sync_queue ORDER BY created_at ASC LIMIT 50'
  );

  let synced = 0;
  const errors: string[] = [];

  for (const item of pending) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: item.body || undefined,
      });

      if (response.ok) {
        runSql('DELETE FROM sync_queue WHERE id = ?', [item.id]);
        synced++;
      } else {
        const attempts = (item.attempts || 0) + 1;
        const errorText = await response.text();
        if (attempts >= 5) {
          runSql('DELETE FROM sync_queue WHERE id = ?', [item.id]);
          errors.push(`Dropped after 5 attempts: ${item.method} ${item.url}`);
        } else {
          runSql(
            'UPDATE sync_queue SET attempts = ?, last_error = ? WHERE id = ?',
            [attempts, errorText, item.id]
          );
        }
      }
    } catch (err) {
      const attempts = (item.attempts || 0) + 1;
      const msg = err instanceof Error ? err.message : String(err);
      runSql(
        'UPDATE sync_queue SET attempts = ?, last_error = ? WHERE id = ?',
        [attempts, msg, item.id]
      );
      errors.push(msg);
    }
  }

  return { synced, errors };
}

export async function syncQuotes(): Promise<void> {
  const unsyncedQuotes = query(
    'SELECT * FROM quotes WHERE server_synced = 0'
  );

  for (const q of unsyncedQuotes) {
    try {
      await apiFetch('/api/quotes', {
        method: 'POST',
        body: {
          ...q,
          line_items: q.line_items ? JSON.parse(q.line_items) : [],
        },
      });
      runSql('UPDATE quotes SET server_synced = 1, synced_at = ? WHERE id = ?', [
        new Date().toISOString(),
        q.id,
      ]);
    } catch {
      // Will retry next sync
    }
  }
}

export function getPendingCount(): number {
  const result = query('SELECT COUNT(*) as count FROM sync_queue');
  return result[0]?.count || 0;
}

export function getLastSyncTime(): string | null {
  const result = query(
    'SELECT last_synced_at FROM sync_meta ORDER BY last_synced_at DESC LIMIT 1'
  );
  return result[0]?.last_synced_at || null;
}

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const queueResult = await syncQueue();
    await syncQuotes();

    return queueResult.synced > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  try {
    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch {
    // Background fetch not available
  }
}
