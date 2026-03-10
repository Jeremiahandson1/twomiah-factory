import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { login } from '@/lib/auth';
import { downloadAll } from '@/lib/sync';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await login(email.trim(), password);
      downloadAll().catch(() => {});
      router.replace('/(app)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center px-8">
          <View className="items-center mb-12">
            <View className="w-20 h-20 bg-primary rounded-2xl items-center justify-center mb-4">
              <Text className="text-white text-3xl font-bold">T</Text>
            </View>
            <Text className="text-3xl font-bold text-gray-900">Twomiah Price</Text>
            <Text className="text-base text-gray-500 mt-1">Sales Pricing Tool</Text>
          </View>

          {error ? (
            <View className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <Text className="text-red-700 text-center text-sm">{error}</Text>
            </View>
          ) : null}

          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-2">Email</Text>
            <TextInput
              className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base text-gray-900"
              placeholder="you@company.com"
              placeholderTextColor="#9ca3af"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          <View className="mb-8">
            <Text className="text-sm font-medium text-gray-700 mb-2">Password</Text>
            <TextInput
              className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base text-gray-900"
              placeholder="Enter password"
              placeholderTextColor="#9ca3af"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
              onSubmitEditing={handleLogin}
            />
          </View>

          <TouchableOpacity
            className={`h-14 rounded-xl items-center justify-center ${
              loading ? 'bg-primary-light' : 'bg-primary'
            }`}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-white text-lg font-semibold">Log In</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
