// Capacitor stub for web builds — replaces native mobile APIs with no-ops
export const Capacitor = {
  isNativePlatform: () => false,
  isPluginAvailable: () => false,
  getPlatform: () => 'web',
};

export const Geolocation = {
  getCurrentPosition: async () => { throw new Error('Geolocation not available on web'); },
  watchPosition: () => {},
  clearWatch: () => {},
};

export const Network = {
  getStatus: async () => ({ connected: true, connectionType: 'wifi' }),
  addListener: () => ({ remove: () => {} }),
};

export const Haptics = {
  impact: async () => {},
  notification: async () => {},
  vibrate: async () => {},
};

export const LocalNotifications = {
  schedule: async () => {},
  requestPermissions: async () => ({ display: 'denied' }),
  checkPermissions: async () => ({ display: 'denied' }),
};

export default { Capacitor, Geolocation, Network, Haptics, LocalNotifications };
