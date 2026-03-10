import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { query } from '@/lib/db';
import { SyncIndicator } from '@/components/SyncIndicator';
import { format } from 'date-fns';

interface HistoryItem {
  id: string;
  customer_name: string;
  mode: string;
  status: string;
  total_price: number;
  created_at: string;
  server_synced: number;
}

type TabType = 'quotes' | 'estimates';
type StatusFilter = 'all' | 'draft' | 'presented' | 'signed' | 'sent';

export default function HistoryScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('quotes');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadItems = useCallback(() => {
    const mode = activeTab === 'quotes' ? 'menu' : 'estimator';
    let sql = 'SELECT id, customer_name, mode, status, total_price, created_at, server_synced FROM quotes WHERE mode = ?';
    const params: any[] = [mode];

    if (statusFilter !== 'all') {
      sql += ' AND status = ?';
      params.push(statusFilter);
    }

    if (search.trim()) {
      sql += ' AND customer_name LIKE ?';
      params.push(`%${search.trim()}%`);
    }

    sql += ' ORDER BY created_at DESC';
    setItems(query(sql, params));
  }, [activeTab, statusFilter, search]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const onRefresh = () => {
    setRefreshing(true);
    loadItems();
    setRefreshing(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-600';
      case 'presented': return 'bg-blue-100 text-blue-700';
      case 'signed': return 'bg-green-100 text-green-700';
      case 'sent': return 'bg-amber-100 text-amber-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const statusFilters: StatusFilter[] = ['all', 'draft', 'presented', 'signed', 'sent'];

  const renderItem = ({ item }: { item: HistoryItem }) => (
    <TouchableOpacity
      className="bg-white rounded-xl p-4 mb-3 border border-gray-100 mx-6"
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
        <Text className="text-base font-semibold text-gray-900 flex-1" numberOfLines={1}>
          {item.customer_name || 'Unnamed Customer'}
        </Text>
        <SyncIndicator synced={item.server_synced === 1} syncing={false} />
      </View>
      <View className="flex-row items-center justify-between">
        <View className={`px-2 py-1 rounded-md ${getStatusColor(item.status)}`}>
          <Text className="text-xs font-medium capitalize">{item.status}</Text>
        </View>
        <Text className="text-lg font-bold text-gray-900">
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
      <View className="px-6 pt-4 pb-2">
        <Text className="text-2xl font-bold text-gray-900">History</Text>
      </View>

      <View className="flex-row mx-6 mb-4 bg-gray-100 rounded-xl p-1">
        <TouchableOpacity
          className={`flex-1 py-3 rounded-lg items-center ${
            activeTab === 'quotes' ? 'bg-white' : ''
          }`}
          onPress={() => setActiveTab('quotes')}
        >
          <Text
            className={`text-base font-medium ${
              activeTab === 'quotes' ? 'text-primary' : 'text-gray-500'
            }`}
          >
            Quotes
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={`flex-1 py-3 rounded-lg items-center ${
            activeTab === 'estimates' ? 'bg-white' : ''
          }`}
          onPress={() => setActiveTab('estimates')}
        >
          <Text
            className={`text-base font-medium ${
              activeTab === 'estimates' ? 'text-primary' : 'text-gray-500'
            }`}
          >
            Estimates
          </Text>
        </TouchableOpacity>
      </View>

      <View className="mx-6 mb-3">
        <TextInput
          className="h-12 bg-white border border-gray-200 rounded-xl px-4 text-base"
          placeholder="Search by customer name..."
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <View className="flex-row mx-6 mb-4 gap-2">
        {statusFilters.map((filter) => (
          <TouchableOpacity
            key={filter}
            className={`px-3 py-2 rounded-lg ${
              statusFilter === filter ? 'bg-primary' : 'bg-gray-100'
            }`}
            onPress={() => setStatusFilter(filter)}
          >
            <Text
              className={`text-xs font-medium capitalize ${
                statusFilter === filter ? 'text-white' : 'text-gray-600'
              }`}
            >
              {filter}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e3a5f" />
        }
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-gray-400 text-base">No {activeTab} found</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
