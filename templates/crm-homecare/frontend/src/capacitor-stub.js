// Stub for Capacitor native plugins — used in web builds where native APIs aren't available
const noop = () => Promise.resolve()
const noopWithValue = (val) => () => Promise.resolve(val)

export const Geolocation = {
  getCurrentPosition: noopWithValue({ coords: { latitude: 0, longitude: 0, accuracy: 0 } }),
  watchPosition: noop,
  clearWatch: noop,
  checkPermissions: noopWithValue({ location: 'granted' }),
  requestPermissions: noopWithValue({ location: 'granted' }),
}

export const PushNotifications = {
  register: noop,
  addListener: noop,
  removeAllListeners: noop,
  checkPermissions: noopWithValue({ receive: 'granted' }),
  requestPermissions: noopWithValue({ receive: 'granted' }),
  getDeliveredNotifications: noopWithValue({ notifications: [] }),
}

export const LocalNotifications = {
  schedule: noop,
  addListener: noop,
  removeAllListeners: noop,
  checkPermissions: noopWithValue({ display: 'granted' }),
  requestPermissions: noopWithValue({ display: 'granted' }),
}

export const Network = {
  getStatus: noopWithValue({ connected: true, connectionType: 'wifi' }),
  addListener: noop,
  removeAllListeners: noop,
}

export const Haptics = {
  impact: noop,
  notification: noop,
  vibrate: noop,
  selectionStart: noop,
  selectionChanged: noop,
  selectionEnd: noop,
}

export const Keyboard = {
  show: noop,
  hide: noop,
  addListener: noop,
  removeAllListeners: noop,
}

export const SplashScreen = {
  show: noop,
  hide: noop,
}

export const StatusBar = {
  setStyle: noop,
  setBackgroundColor: noop,
  show: noop,
  hide: noop,
}

export const BackgroundGeolocationWatcher = {
  addWatcher: noop,
  removeWatcher: noop,
}

// Default export for generic imports
export default {
  Geolocation, PushNotifications, LocalNotifications, Network,
  Haptics, Keyboard, SplashScreen, StatusBar, BackgroundGeolocationWatcher,
}
