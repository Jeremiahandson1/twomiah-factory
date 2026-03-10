import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import { API_URL, TENANT_ID } from './config';
import { query as dbQuery } from './db';
import * as Crypto from 'expo-crypto';

const TOKEN_KEY = 'twomiah_price_jwt';

export async function getToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
}

export async function apiFetch<T = any>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;
  const token = await getToken();
  const netState = await NetInfo.fetch();
  const isOnline = netState.isConnected && netState.isInternetReachable;

  const url = `${API_URL}${path}`;
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  if (TENANT_ID) {
    requestHeaders['X-Tenant-ID'] = TENANT_ID;
  }

  if (!isOnline) {
    if (method === 'GET') {
      return getOfflineData<T>(path);
    } else {
      await queueRequest(method, url, body);
      throw new OfflineError('Request queued for sync');
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ApiError(response.status, errorBody);
    }

    const data = await response.json();
    return data as T;
  } catch (error) {
    if (error instanceof ApiError || error instanceof OfflineError) {
      throw error;
    }

    if (method === 'GET') {
      return getOfflineData<T>(path);
    } else {
      await queueRequest(method, url, body);
      throw new OfflineError('Request queued for sync');
    }
  }
}

function getOfflineData<T>(path: string): T {
  if (path.includes('/categories')) {
    return dbQuery('SELECT * FROM categories ORDER BY sort_order') as T;
  }
  if (path.includes('/products')) {
    return dbQuery('SELECT * FROM products WHERE active = 1 ORDER BY sort_order') as T;
  }
  if (path.includes('/tiers')) {
    return dbQuery('SELECT * FROM tiers') as T;
  }
  if (path.includes('/price-ranges')) {
    return dbQuery('SELECT * FROM price_ranges') as T;
  }
  if (path.includes('/addons')) {
    return dbQuery('SELECT * FROM addons ORDER BY sort_order') as T;
  }
  if (path.includes('/quotes')) {
    return dbQuery('SELECT * FROM quotes ORDER BY created_at DESC') as T;
  }
  if (path.includes('/pitch-multipliers')) {
    return dbQuery('SELECT * FROM pitch_multipliers') as T;
  }
  throw new OfflineError('No offline data available for this request');
}

async function queueRequest(
  method: string,
  url: string,
  body: any
): Promise<void> {
  const id = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${method}:${url}:${Date.now()}`
  );

  const { insert } = require('./db');
  insert('sync_queue', {
    id,
    method,
    url,
    body: body ? JSON.stringify(body) : null,
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
  });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`API Error ${status}: ${body}`);
    this.name = 'ApiError';
  }
}

export class OfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineError';
  }
}
