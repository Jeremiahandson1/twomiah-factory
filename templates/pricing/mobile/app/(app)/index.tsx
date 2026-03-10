import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProfile } from '@/lib/auth';
import { query } from '@/lib/db';
import { useOffline } from '@/hooks/useOffline';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SyncIndicator } from '@/components/SyncIndicator';
import { format } from 'date-fns';

interface RecentItem {
  id: string;
  customer_name: string;
  mode: string;
  status: string;
  total_price: number;
  created_at: string;
  server_synced: number;
}

export default function HomeScreen() {
  const router = useRouter();
  const { isOnline, pendingCount, syncing, lastSyncAge, manualSync } = useOffline();
  const [profile, setProfile] = useState<{ name: string; role: string } | null>(null);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = () => {
    const p = getProfile();
    setProfile(p ? { name: p.name, role: p.role } : null);

    const items = query(
      'SELECT id, customer_name, mode, status, total_price, created_at, server_synced FROM quotes ORDER BY created_at DESC LIMIT 20'
    );
    setRecentItems(items);
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await manualSync();
    loadData();
    setRefreshing(false);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 text-gray-600';
      case 'presented':
        return 'bg-blue-100 text-blue-700';
      case 'signed':
        return 'bg-green-100 text-green-700';
      case 'sent':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const renderRecentItem = ({ item }: { item: RecentItem }) => (
    <TouchableOpacity
      className="bg-white rounded-xl p-4 mb-3 border border-gray-100"
      onPress={() => {
        if (item.mode === 'estimator') {
          router.push(`/(app)/estimate/${item.id}`);
        } else {
          router.push(`/(app)/quote/${item.id}`);
        }
      }}
      activeOpacity={0.7}
    >
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
          {item.customer_name || 'Unnamed Customer'}
        </Text>
        <SyncIndicator synced={item.server_synced === 1} syncing={false} />
      </View>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View className={`px-2 py-1 rounded-md ${getStatusColor(item.status)}`}>
            <Text className="text-xs font-medium capitalize">{item.status}</Text>
          </View>
          <Text className="text-xs text-gray-400 capitalize">{item.mode}</Text>
        </View>
        <Text className="text-base font-bold text-gray-900">
          ${(item.total_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </Text>
      </View>
      <Text className="text-xs text-gray-400 mt-2">
        {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy h:mm a') : ''}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <OfflineBanner isOnline={isOnline} pendingCount={pendingCount} />

      <View className="px-6 pt-4 pb-2">
        <Text className="text-2xl font-bold text-gray-900">
          {getGreeting()}, {profile?.name?.split(' ')[0] || 'Rep'}
        </Text>
        {lastSyncAge && (
          <Text className="text-sm text-gray-400 mt-1">Last synced {lastSyncAge}</Text>
        )}
      </View>

      <View className="flex-row px-6 py-4 gap-4">
        <TouchableOpacity
          className="flex-1 bg-primary rounded-2xl p-5 items-center justify-center"
          onPress={() => router.push('/(app)/quote/new')}
          activeOpacity={0.8}
        >
          <Text className="text-white text-3xl mb-2">+</Text>
          <Text className="text-white text-base font-semibold">New Quote</Text>
          <Text className="text-white/70 text-xs mt-1">Menu Mode</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="flex-1 bg-primary-light rounded-2xl p-5 items-center justify-center"
          onPress={() => router.push('/(app)/estimate/new')}
          activeOpacity={0.8}
        >
          <Text className="text-white text-3xl mb-2">+</Text>
          <Text className="text-white text-base font-semibold">New Estimate</Text>
          <Text className="text-white/70 text-xs mt-1">Estimator Mode</Text>
        </TouchableOpacity>
      </View>

      <View className="px-6 flex-row items-center justify-between mb-2">
        <Text className="text-lg font-semibold text-gray-900">Recent</Text>
        <TouchableOpacity onPress={() => router.push('/(app)/history')}>
          <Text className="text-primary text-sm font-medium">View All</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={recentItems}
        renderItem={renderRecentItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e3a5f" />
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-gray-400 text-base">No quotes or estimates yet</Text>
            <Text className="text-gray-300 text-sm mt-1">
              Tap a button above to get started
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
