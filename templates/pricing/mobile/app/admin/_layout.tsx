import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { getProfile } from '@/lib/auth';

export default function AdminLayout() {
  const router = useRouter();

  useEffect(() => {
    const profile = getProfile();
    if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
      router.replace('/(app)');
    }
  }, []);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1e3a5f' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="pricebook" options={{ title: 'Pricebook' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}
