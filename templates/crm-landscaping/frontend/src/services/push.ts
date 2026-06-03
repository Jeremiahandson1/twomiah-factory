/**
 * Push Notifications Service (Frontend)
 * 
 * Handles browser push notification subscription
 */

import api from './api';

const VAPID_PUBLIC_KEY_STORAGE = 'vapid_public_key';

/**
 * Check if push notifications are supported
 */
export function isPushSupported() {
  return 'PushManager' in window && 'serviceWorker' in navigator;
}

/**
 * Get current notification permission state
 */
export function getPermissionState() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission; // 'granted', 'denied', 'default'
}

/**
 * Request notification permission
 */
export async function requestPermission() {
  if (!isPushSupported()) {
    return { granted: false, reason: 'unsupported' };
  }

  const permission = await Notification.requestPermission();
  
  return {
    granted: permission === 'granted',
    permission,
  };
}

/**
 * Subscribe to push notifications
 */
export async function subscribe() {
  if (!isPushSupported()) {
    throw new Error('Push notifications not supported');
  }

  // Request permission first
  const { granted } = await requestPermission();
  if (!granted) {
    throw new Error('Notification permission denied');
  }

  // Get VAPID public key
  let vapidKey = localStorage.getItem(VAPID_PUBLIC_KEY_STORAGE);
  
  if (!vapidKey) {
    const response = await api.get('/push/vapid-public-key');
    vapidKey = response.key;
    localStorage.setItem(VAPID_PUBLIC_KEY_STORAGE, vapidKey);
  }

  // Get service worker registration
  const registration = await navigator.serviceWorker.ready;

  // Subscribe to push
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  // Send subscription to server
  await api.post('/push/subscribe', {
    subscription: subscription.toJSON(),
  });

  return subscription;
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribe() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    // Notify server
    await api.post('/push/unsubscribe', {
      endpoint: subscription.endpoint,
    });

    // Unsubscribe locally
    await subscription.unsubscribe();
  }

  return true;
}

/**
 * Check if currently subscribed
 */
export async function isSubscribed() {
  if (!isPushSupported()) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

/**
 * Get current subscription
 */
export async function getSubscription() {
  if (!isPushSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Send test notification
 */
export async function sendTest() {
  return api.post('/push/test');
}

/**
 * Show local notification (doesn't require server)
 */
export async function showLocalNotification(title, options = {}) {
  if (!isPushSupported()) return false;
  
  if (Notification.permission !== 'granted') {
    const { granted } = await requestPermission();
    if (!granted) return false;
  }

  const registration = await navigator.serviceWorker.ready;
  
  await registration.showNotification(title, {
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    ...options,
  });

  return true;
}

// Helper: Convert VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  
  return outputArray;
}

export default {
  isPushSupported,
  getPermissionState,
  requestPermission,
  subscribe,
  unsubscribe,
  isSubscribed,
  getSubscription,
  sendTest,
  showLocalNotification,
};
