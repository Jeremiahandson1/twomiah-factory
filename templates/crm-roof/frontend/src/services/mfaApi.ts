// The shared Two-Factor card asks for its five calls by name; these are roofing's client making them. (Launch list, 10/17)
import api from './api'

export const mfaApi = {
  mfa: {
    devices: () => api.request('/api/auth/mfa-devices/devices'),
    setup: () => api.request('/api/auth/mfa-devices/setup', { method: 'POST', body: '{}' }),
    verify: (deviceId: string, code: string) => api.request('/api/auth/mfa-devices/verify', { method: 'POST', body: JSON.stringify({ deviceId, code }) }),
    newRecoveryCodes: (code: string) => api.request('/api/auth/mfa-devices/recovery-codes', { method: 'POST', body: JSON.stringify({ code }) }),
    remove: (deviceId: string, code: string) => api.request(`/api/auth/mfa-devices/devices/${deviceId}`, { method: 'DELETE', body: JSON.stringify({ code }) }),
  },
}
