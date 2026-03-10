import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProfile, logout as authLogout } from '@/lib/auth';
import { downloadAll, getPendingCount, getLastSyncTime } from '@/lib/sync';
import { useOffline } from '@/hooks/useOffline';

export default function ProfileScreen() {
  const router = useRouter();
  const { isOnline, pendingCount, syncing, lastSyncAge, manualSync } = useOffline();
  const [profile, setProfile] = useState<{ id: string; name: string; email: string; role: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  useEffect(() => {
    const p = getProfile();
    setProfile(p);
  }, []);

  const handleSync = async () => {
    await manualSync();
    Alert.alert('Sync Complete', 'All pending items have been synced.');
  };

  const handleRedownload = async () => {
    Alert.alert(
      'Re-download Data',
      'This will re-download all pricebook data from the server. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            setDownloading(true);
            setDownloadProgress('Starting...');
            try {
              const result = await downloadAll((step, pct) => {
                setDownloadProgress(`${step}... ${pct}%`);
              });
              if (result.success) {
                Alert.alert('Success', `Downloaded ${result.downloaded} items.`);
              } else {
                Alert.alert('Partial Download', `Downloaded ${result.downloaded} items with ${result.errors.length} errors.`);
              }
            } catch (err) {
              Alert.alert('Error', 'Failed to download data.');
            } finally {
              setDownloading(false);
              setDownloadProgress('');
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await authLogout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView className="flex-1 px-6">
        <Text className="text-2xl font-bold text-gray-900 mt-4 mb-6">Profile</Text>

        <View className="bg-white rounded-2xl p-6 mb-6 border border-gray-100">
          <View className="w-16 h-16 bg-primary rounded-full items-center justify-center mb-4">
            <Text className="text-white text-2xl font-bold">
              {profile?.name?.charAt(0)?.toUpperCase() || '?'}
            </Text>
          </View>
          <Text className="text-xl font-bold text-gray-900">{profile?.name || 'Unknown'}</Text>
          <Text className="text-base text-gray-500 mt-1">{profile?.email || ''}</Text>
          <View className="mt-2 flex-row">
            <View className="bg-primary/10 px-3 py-1 rounded-md">
              <Text className="text-sm font-medium text-primary capitalize">
                {profile?.role || 'rep'}
              </Text>
            </View>
          </View>
        </View>

        <View className="bg-white rounded-2xl p-6 mb-6 border border-gray-100">
          <Text className="text-lg font-semibold text-gray-900 mb-4">Sync Status</Text>

          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-base text-gray-600">Connection</Text>
            <View className="flex-row items-center">
              <View
                className={`w-3 h-3 rounded-full mr-2 ${
                  isOnline ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <Text className="text-base text-gray-900 font-medium">
                {isOnline ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-base text-gray-600">Last Synced</Text>
            <Text className="text-base text-gray-900 font-medium">
              {lastSyncAge || 'Never'}
            </Text>
          </View>

          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-base text-gray-600">Pending Items</Text>
            <Text
              className={`text-base font-medium ${
                pendingCount > 0 ? 'text-amber-600' : 'text-gray-900'
              }`}
            >
              {pendingCount}
            </Text>
          </View>

          <TouchableOpacity
            className={`h-12 rounded-xl items-center justify-center mb-3 ${
              syncing || !isOnline ? 'bg-gray-200' : 'bg-primary'
            }`}
            onPress={handleSync}
            disabled={syncing || !isOnline}
            activeOpacity={0.8}
          >
            {syncing ? (
              <ActivityIndicator color="#1e3a5f" />
            ) : (
              <Text
                className={`text-base font-semibold ${
                  syncing || !isOnline ? 'text-gray-500' : 'text-white'
                }`}
              >
                Sync Now
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            className={`h-12 rounded-xl items-center justify-center border ${
              downloading || !isOnline
                ? 'bg-gray-50 border-gray-200'
                : 'bg-white border-primary'
            }`}
            onPress={handleRedownload}
            disabled={downloading || !isOnline}
            activeOpacity={0.8}
          >
            {downloading ? (
              <View className="flex-row items-center">
                <ActivityIndicator color="#1e3a5f" size="small" />
                <Text className="text-primary text-sm font-medium ml-2">
                  {downloadProgress}
                </Text>
              </View>
            ) : (
              <Text
                className={`text-base font-semibold ${
                  downloading || !isOnline ? 'text-gray-500' : 'text-primary'
                }`}
              >
                Re-download Data
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <View className="bg-white rounded-2xl p-6 mb-6 border border-gray-100">
          <Text className="text-lg font-semibold text-gray-900 mb-2">About</Text>
          <Text className="text-base text-gray-500">Twomiah Price v1.0.0</Text>
          <Text className="text-sm text-gray-400 mt-1">Powered by Twomiah Factory</Text>
        </View>

        <TouchableOpacity
          className="h-14 bg-red-50 border border-red-200 rounded-xl items-center justify-center mb-12"
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Text className="text-red-600 text-base font-semibold">Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
