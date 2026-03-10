import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, ActivityIndicator } from 'react-native';
import { initDatabase } from '@/lib/db';
import { getToken } from '@/lib/auth';
import { downloadAll, registerBackgroundSync } from '@/lib/sync';
import NetInfo from '@react-native-community/netinfo';
import '../global.css';

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    async function init() {
      try {
        initDatabase();

        const token = await getToken();
        setIsAuthenticated(!!token);

        if (token) {
          const netState = await NetInfo.fetch();
          if (netState.isConnected && netState.isInternetReachable) {
            downloadAll().catch(() => {});
          }
          registerBackgroundSync().catch(() => {});
        }
      } catch {
        // Init errors handled gracefully
      } finally {
        setIsReady(true);
      }
    }

    init();
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(app)');
    }
  }, [isReady, isAuthenticated, segments]);

  if (!isReady) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#1e3a5f" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="admin" options={{ headerShown: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
