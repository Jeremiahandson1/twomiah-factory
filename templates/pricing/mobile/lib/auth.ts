import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';
import { insert, query, runSql } from './db';

const TOKEN_KEY = 'twomiah_price_jwt';
const PROFILE_KEY = 'user_profile';

export async function getToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export async function login(
  email: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let message = 'Login failed';
    try {
      const parsed = JSON.parse(errorBody);
      message = parsed.message || parsed.error || message;
    } catch {
      // Use default message
    }
    throw new Error(message);
  }

  const data: LoginResponse = await response.json();

  await setToken(data.token);

  insert('settings', { key: PROFILE_KEY, value: JSON.stringify(data.user) });

  return data;
}

export async function logout(): Promise<void> {
  await clearToken();
  runSql('DELETE FROM settings WHERE key = ?', [PROFILE_KEY]);
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
}

export function getProfile(): UserProfile | null {
  const results = query('SELECT value FROM settings WHERE key = ?', [PROFILE_KEY]);
  if (results.length === 0 || !results[0].value) return null;
  try {
    return JSON.parse(results[0].value) as UserProfile;
  } catch {
    return null;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();
  return token !== null;
}
