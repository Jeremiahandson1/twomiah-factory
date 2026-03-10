import { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL, TENANT_ID } from '@/lib/config';
import { getLastSyncTime, getPendingCount } from '@/lib/sync';
import { query } from '@/lib/db';
import { useOffline } from '@/hooks/useOffline';

export default function AdminSettingsScreen() {
  const { isOnline } = useOffline();
  const [settings, setSettings] = useState<{ key: string; value: string }[]>([]);
  const [dbStats, setDbStats] = useState<Record<string, number>>({});

  useEffect(() => {
    setSettings(query('SELECT * FROM settings ORDER BY key'));

    const tables = [
      'categories',
      'products',
      'tiers',
      'price_ranges',
      'addons',
      'quotes',
      'pitch_multipliers',
      'sync_queue',
    ];
    const stats: Record<string, number> = {};
    for (const table of tables) {
      const result = query(`SELECT COUNT(*) as count FROM ${table}`);
      stats[table] = result[0]?.count || 0;
    }
    setDbStats(stats);
  }, []);

  const lastSync = getLastSyncTime();
  const pendingCount = getPendingCount();

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['bottom']}>
      <ScrollView className="flex-1 px-6">
        <Text className="text-lg font-semibold text-gray-900 mb-3 mt-4">
          Connection
        </Text>
        <View className="bg-white rounded-2xl p-6 mb-6 border border-gray-100">
          <View className="flex-row justify-between mb-3">
            <Text className="text-base text-gray-600">API URL</Text>
            <Text className="text-sm text-gray-900 font-mono">{API_URL}</Text>
          </View>
          <View className="flex-row justify-between mb-3">
            <Text className="text-base text-gray-600">Tenant ID</Text>
            <Text className="text-sm text-gray-900 font-mono">
              {TENANT_ID || 'Not set'}
            </Text>
          </View>
          <View className="flex-row justify-between mb-3">
            <Text className="text-base text-gray-600">Status</Text>
            <View className="flex-row items-center">
              <View
                className={`w-2 h-2 rounded-full mr-2 ${
                  isOnline ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <Text className="text-sm text-gray-900">
                {isOnline ? 'Connected' : 'Disconnected'}
              </Text>
            </View>
          </View>
          <View className="flex-row justify-between mb-3">
            <Text className="text-base text-gray-600">Last Sync</Text>
            <Text className="text-sm text-gray-900">{lastSync || 'Never'}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-base text-gray-600">Pending Queue</Text>
            <Text className="text-sm text-gray-900">{pendingCount} items</Text>
          </View>
        </View>

        <Text className="text-lg font-semibold text-gray-900 mb-3">
          Database Stats
        </Text>
        <View className="bg-white rounded-2xl p-6 mb-6 border border-gray-100">
          {Object.entries(dbStats).map(([table, count]) => (
            <View key={table} className="flex-row justify-between mb-2">
              <Text className="text-base text-gray-600 capitalize">
                {table.replace(/_/g, ' ')}
              </Text>
              <Text className="text-sm text-gray-900 font-medium">{count}</Text>
            </View>
          ))}
        </View>

        {settings.length > 0 && (
          <>
            <Text className="text-lg font-semibold text-gray-900 mb-3">
              Settings
            </Text>
            <View className="bg-white rounded-2xl p-6 mb-6 border border-gray-100">
              {settings
                .filter((s) => s.key !== 'user_profile')
                .map((s) => (
                  <View key={s.key} className="flex-row justify-between mb-2">
                    <Text className="text-sm text-gray-600 flex-1">{s.key}</Text>
                    <Text className="text-sm text-gray-900 flex-1 text-right" numberOfLines={2}>
                      {s.value}
                    </Text>
                  </View>
                ))}
            </View>
          </>
        )}

        <View className="bg-white rounded-2xl p-6 mb-8 border border-gray-100">
          <Text className="text-lg font-semibold text-gray-900 mb-2">About</Text>
          <Text className="text-base text-gray-500">Twomiah Price Mobile</Text>
          <Text className="text-sm text-gray-400">Version 1.0.0</Text>
          <Text className="text-sm text-gray-400 mt-1">
            Expo SDK 51 | React Native 0.74
          </Text>
          <Text className="text-sm text-gray-400 mt-2">
            Built with Twomiah Factory
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
