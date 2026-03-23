import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Smartphone, Mail, Key, Trash2, Copy, Download, Monitor,
  MapPin, Clock, AlertTriangle, CheckCircle, Info, X, RefreshCw,
  Lock, Eye, EyeOff, Plus, ChevronDown,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

const MFA_TYPES = [
  { value: 'authenticator', label: 'Authenticator App', icon: Smartphone, description: 'Use Google Authenticator, Authy, or similar' },
  { value: 'sms', label: 'SMS', icon: Mail, description: 'Receive codes via text message' },
  { value: 'email', label: 'Email', icon: Mail, description: 'Receive codes via email' },
];

const tabs = [
  { id: 'mfa', label: 'MFA' },
  { id: 'password-policy', label: 'Password Policy' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'security-events', label: 'Security Events' },
];

const defaultPasswordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: false,
  maxAgeDays: 90,
  historyCount: 5,
  maxFailedAttempts: 5,
  lockoutDurationMinutes: 30,
  sessionTimeoutMinutes: 480,
  idleTimeoutMinutes: 30,
  mfaRequired: false,
  mfaRequiredRoles: [] as string[],
};

const EVENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'login_failed', label: 'Login Failed' },
  { value: 'login_success', label: 'Login Success' },
  { value: 'mfa_enabled', label: 'MFA Enabled' },
  { value: 'mfa_disabled', label: 'MFA Disabled' },
  { value: 'password_changed', label: 'Password Changed' },
  { value: 'session_revoked', label: 'Session Revoked' },
  { value: 'account_locked', label: 'Account Locked' },
  { value: 'permission_change', label: 'Permission Change' },
  { value: 'suspicious_activity', label: 'Suspicious Activity' },
];

const SEVERITY_OPTIONS = [
  { value: '', label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

function relativeTime(dateStr: string): string {
  if (!dateStr) return 'Never';
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function SecurityPage() {
  const { user, isAdmin, isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('mfa');

  // MFA State
  const [mfaDevices, setMfaDevices] = useState<any[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [setupModal, setSetupModal] = useState(false);
  const [setupType, setSetupType] = useState('');
  const [setupStep, setSetupStep] = useState<'choose' | 'configure' | 'verify'>('choose');
  const [setupData, setSetupData] = useState<any>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [settingUp, setSettingUp] = useState(false);
  const [backupCodesModal, setBackupCodesModal] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [generatingCodes, setGeneratingCodes] = useState(false);
  const [deleteDeviceOpen, setDeleteDeviceOpen] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState<any>(null);

  // Password Policy State
  const [policy, setPolicy] = useState(defaultPasswordPolicy);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Sessions State
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);

  // Security Events State
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventSummary, setEventSummary] = useState({ critical: 0, warning: 0, info: 0 });
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [eventDateFrom, setEventDateFrom] = useState('');
  const [eventDateTo, setEventDateTo] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [eventPage, setEventPage] = useState(1);

  // Load MFA Devices
  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const data = await api.get('/api/security/mfa/devices');
      setMfaDevices(Array.isArray(data) ? data : data?.data || []);
    } catch {
      toast.error('Failed to load MFA devices');
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  // Load Password Policy
  const loadPolicy = useCallback(async () => {
    setLoadingPolicy(true);
    try {
      const data = await api.get('/api/security/password-policy');
      if (data) setPolicy({ ...defaultPasswordPolicy, ...data });
    } catch {
      // Use defaults
    } finally {
      setLoadingPolicy(false);
    }
  }, []);

  // Load Sessions
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const endpoint = showAllSessions && isAdmin ? '/api/security/sessions/all' : '/api/security/sessions';
      const data = await api.get(endpoint);
      setSessions(Array.isArray(data) ? data : data?.data || []);
    } catch {
      toast.error('Failed to load sessions');
    } finally {
      setLoadingSessions(false);
    }
  }, [showAllSessions, isAdmin]);

  // Load Events
  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const params: any = { page: eventPage, limit: 50 };
      if (eventTypeFilter) params.type = eventTypeFilter;
      if (severityFilter) params.severity = severityFilter;
      if (eventDateFrom) params.dateFrom = eventDateFrom;
      if (eventDateTo) params.dateTo = eventDateTo;
      const data = await api.get('/api/security/events', params);
      setEvents(Array.isArray(data) ? data : data?.data || []);
      if (data?.summary) setEventSummary(data.summary);
    } catch {
      toast.error('Failed to load security events');
    } finally {
      setLoadingEvents(false);
    }
  }, [eventPage, eventTypeFilter, severityFilter, eventDateFrom, eventDateTo]);

  // Load event summary
  const loadEventSummary = useCallback(async () => {
    try {
      const data = await api.get('/api/security/events/summary');
      if (data) setEventSummary(data);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (tab === 'mfa') loadDevices();
    if (tab === 'password-policy' && isAdmin) loadPolicy();
    if (tab === 'sessions') loadSessions();
    if (tab === 'security-events' && isAdmin) {
      loadEvents();
      loadEventSummary();
    }
  }, [tab, loadDevices, loadPolicy, loadSessions, loadEvents, loadEventSummary, isAdmin]);

  // MFA Setup
  const startSetup = (type: string) => {
    setSetupType(type);
    setSetupStep('configure');
    setVerificationCode('');
    setPhoneNumber('');
    setDeviceName('');
    setSetupData(null);
  };

  const initiateSetup = async () => {
    setSettingUp(true);
    try {
      const payload: any = { type: setupType, name: deviceName || setupType };
      if (setupType === 'sms') payload.phoneNumber = phoneNumber;
      const data = await api.post('/api/security/mfa/setup', payload);
      setSetupData(data);
      setSetupStep('verify');
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate MFA setup');
    } finally {
      setSettingUp(false);
    }
  };

  const verifyAndEnableDevice = async () => {
    setSettingUp(true);
    try {
      await api.post('/api/security/mfa/verify', {
        type: setupType,
        code: verificationCode,
        setupId: setupData?.setupId,
      });
      toast.success('MFA device added successfully');
      setSetupModal(false);
      setSetupStep('choose');
      loadDevices();
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setSettingUp(false);
    }
  };

  const deleteDevice = async () => {
    if (!deviceToDelete) return;
    try {
      await api.delete('/api/security/mfa/devices', deviceToDelete.id);
      toast.success('MFA device removed');
      loadDevices();
    } catch {
      toast.error('Failed to remove device');
    }
  };

  const generateBackupCodes = async () => {
    setGeneratingCodes(true);
    try {
      const data = await api.post('/api/security/mfa/backup-codes');
      setBackupCodes(data?.codes || []);
      setBackupCodesModal(true);
    } catch {
      toast.error('Failed to generate backup codes');
    } finally {
      setGeneratingCodes(false);
    }
  };

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    toast.success('Backup codes copied to clipboard');
  };

  const downloadBackupCodes = () => {
    const blob = new Blob([backupCodes.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Password Policy
  const savePolicy = async () => {
    setSavingPolicy(true);
    try {
      await api.put('/api/security/password-policy', policy);
      toast.success('Password policy saved');
    } catch {
      toast.error('Failed to save password policy');
    } finally {
      setSavingPolicy(false);
    }
  };

  // Sessions
  const revokeSession = async (sessionId: string) => {
    try {
      await api.delete('/api/security/sessions', sessionId);
      toast.success('Session revoked');
      loadSessions();
    } catch {
      toast.error('Failed to revoke session');
    }
  };

  const revokeAllSessions = async () => {
    try {
      await api.post('/api/security/sessions/revoke-all');
      toast.success('All other sessions revoked');
      loadSessions();
    } catch {
      toast.error('Failed to revoke sessions');
    }
  };

  // Security Events
  const acknowledgeEvent = async (eventId: string, acknowledged: boolean) => {
    try {
      await api.put('/api/security/events/' + eventId, { acknowledged });
      setEvents(prev => prev.map(e => e.id === eventId ? { ...e, acknowledged } : e));
    } catch {
      toast.error('Failed to update event');
    }
  };

  const severityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'danger';
      case 'warning': return 'warning';
      case 'info': return 'info';
      default: return 'default';
    }
  };

  const deviceTypeIcon = (type: string) => {
    switch (type) {
      case 'authenticator': return <Smartphone className="w-4 h-4" />;
      case 'sms': return <Mail className="w-4 h-4" />;
      case 'email': return <Mail className="w-4 h-4" />;
      default: return <Key className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Shield className="w-6 h-6 text-emerald-400" />
          Security Settings
        </h1>
        <p className="text-slate-400">Manage multi-factor authentication, password policies, and sessions</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-800/50 rounded-lg w-fit">
        {tabs.filter(t => {
          if (t.id === 'password-policy' && !isAdmin) return false;
          if (t.id === 'security-events' && !isAdmin) return false;
          return true;
        }).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
              tab === t.id
                ? 'bg-slate-700 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* MFA Tab */}
      {tab === 'mfa' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Multi-Factor Authentication</h2>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={Key}
                onClick={generateBackupCodes}
                loading={generatingCodes}
              >
                Generate Backup Codes
              </Button>
              <Button
                size="sm"
                icon={Plus}
                onClick={() => { setSetupModal(true); setSetupStep('choose'); }}
              >
                Set Up MFA
              </Button>
            </div>
          </div>

          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            {loadingDevices ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : mfaDevices.length === 0 ? (
              <div className="p-12 text-center">
                <Shield className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400 mb-1">No MFA devices configured</p>
                <p className="text-sm text-slate-500">Add a device to secure your account</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-800/80">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Last Used</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {mfaDevices.map((device: any) => (
                    <tr key={device.id} className="hover:bg-slate-700/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {deviceTypeIcon(device.type)}
                          <Badge variant={device.type === 'authenticator' ? 'info' : device.type === 'sms' ? 'warning' : 'default'}>
                            {device.type}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">{device.name || device.type}</td>
                      <td className="px-4 py-3">
                        <Badge variant={device.verified ? 'success' : 'warning'} dot>
                          {device.verified ? 'Verified' : 'Pending'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-400">
                        {device.lastUsed ? relativeTime(device.lastUsed) : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => { setDeviceToDelete(device); setDeleteDeviceOpen(true); }}
                          className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-700 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* MFA Setup Modal */}
          <Modal isOpen={setupModal} onClose={() => setSetupModal(false)} title="Set Up MFA" size="md">
            {setupStep === 'choose' && (
              <div className="space-y-3">
                <p className="text-slate-400 text-sm mb-4">Choose your preferred authentication method:</p>
                {MFA_TYPES.map(type => (
                  <button
                    key={type.value}
                    onClick={() => startSetup(type.value)}
                    className="w-full flex items-center gap-4 p-4 rounded-lg border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-800/50 transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center">
                      <type.icon className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-white font-medium">{type.label}</p>
                      <p className="text-sm text-slate-400">{type.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {setupStep === 'configure' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Device Name</label>
                  <input
                    type="text"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder={`My ${setupType}`}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
                {setupType === 'sms' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Phone Number</label>
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <Button variant="secondary" onClick={() => setSetupStep('choose')}>Back</Button>
                  <Button
                    onClick={initiateSetup}
                    loading={settingUp}
                    disabled={setupType === 'sms' && !phoneNumber}
                  >
                    {setupType === 'sms' ? 'Send Code' : 'Continue'}
                  </Button>
                </div>
              </div>
            )}

            {setupStep === 'verify' && (
              <div className="space-y-4">
                {setupType === 'authenticator' && setupData && (
                  <div className="space-y-4">
                    <p className="text-slate-300 text-sm">Scan this code in your authenticator app, or enter the secret key manually:</p>
                    <div className="bg-slate-800 rounded-lg p-4 border border-slate-600">
                      <p className="text-xs text-slate-400 mb-2">OTP Auth URL:</p>
                      <p className="text-sm text-slate-300 font-mono break-all">{setupData.otpauthUrl || 'otpauth://totp/Dispensary?secret=' + (setupData.secret || '')}</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4 border border-slate-600">
                      <p className="text-xs text-slate-400 mb-1">Secret Key (for manual entry):</p>
                      <div className="flex items-center gap-2">
                        <code className="text-emerald-400 font-mono text-lg tracking-wider">{setupData.secret}</code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(setupData.secret); toast.success('Secret copied'); }}
                          className="p-1 text-slate-400 hover:text-white"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {setupType === 'sms' && (
                  <p className="text-slate-300 text-sm">A verification code has been sent to {phoneNumber}.</p>
                )}
                {setupType === 'email' && (
                  <p className="text-slate-300 text-sm">A verification code has been sent to your email address.</p>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Verification Code</label>
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder="000000"
                    maxLength={6}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-center text-2xl tracking-[0.5em] font-mono"
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <Button variant="secondary" onClick={() => setSetupStep('configure')}>Back</Button>
                  <Button
                    onClick={verifyAndEnableDevice}
                    loading={settingUp}
                    disabled={verificationCode.length < 6}
                  >
                    Verify & Enable
                  </Button>
                </div>
              </div>
            )}
          </Modal>

          {/* Backup Codes Modal */}
          <Modal isOpen={backupCodesModal} onClose={() => setBackupCodesModal(false)} title="Backup Codes" size="md">
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-300">
                  These codes are only shown once. Save them in a secure location. Each code can only be used once.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code, i) => (
                  <div key={i} className="bg-slate-800 rounded px-3 py-2 text-center font-mono text-slate-200 text-sm border border-slate-700">
                    {code}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" icon={Copy} onClick={copyBackupCodes}>Copy All</Button>
                <Button variant="secondary" icon={Download} onClick={downloadBackupCodes}>Download</Button>
              </div>
            </div>
          </Modal>

          {/* Delete Device Confirm */}
          <ConfirmModal
            isOpen={deleteDeviceOpen}
            onClose={() => setDeleteDeviceOpen(false)}
            onConfirm={deleteDevice}
            title="Remove MFA Device"
            message={`Are you sure you want to remove "${deviceToDelete?.name || deviceToDelete?.type}"? You will no longer be able to use this device for authentication.`}
            confirmText="Remove Device"
            variant="danger"
          />
        </div>
      )}

      {/* Password Policy Tab */}
      {tab === 'password-policy' && isAdmin && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Password Policy</h2>
            <Button onClick={savePolicy} loading={savingPolicy} icon={CheckCircle}>Save Policy</Button>
          </div>

          {loadingPolicy ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Password Requirements */}
              <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 space-y-4">
                <h3 className="text-white font-medium flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-400" />
                  Password Requirements
                </h3>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Minimum Length</label>
                  <input
                    type="number"
                    min={6}
                    max={128}
                    value={policy.minLength}
                    onChange={(e) => setPolicy(p => ({ ...p, minLength: parseInt(e.target.value) || 8 }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
                {[
                  { key: 'requireUppercase', label: 'Require uppercase letters' },
                  { key: 'requireLowercase', label: 'Require lowercase letters' },
                  { key: 'requireNumbers', label: 'Require numbers' },
                  { key: 'requireSpecialChars', label: 'Require special characters' },
                ].map(toggle => (
                  <label key={toggle.key} className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-slate-300">{toggle.label}</span>
                    <button
                      onClick={() => setPolicy(p => ({ ...p, [toggle.key]: !p[toggle.key as keyof typeof p] }))}
                      className={`w-10 h-5 rounded-full transition-colors relative ${
                        policy[toggle.key as keyof typeof policy] ? 'bg-emerald-500' : 'bg-slate-600'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        policy[toggle.key as keyof typeof policy] ? 'translate-x-5' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </label>
                ))}
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Max Password Age (days)</label>
                  <input
                    type="number"
                    min={0}
                    value={policy.maxAgeDays}
                    onChange={(e) => setPolicy(p => ({ ...p, maxAgeDays: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Password History Count</label>
                  <input
                    type="number"
                    min={0}
                    value={policy.historyCount}
                    onChange={(e) => setPolicy(p => ({ ...p, historyCount: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Account Lockout & Session */}
              <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 space-y-4">
                <h3 className="text-white font-medium flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  Lockout & Sessions
                </h3>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Max Failed Attempts</label>
                  <input
                    type="number"
                    min={1}
                    value={policy.maxFailedAttempts}
                    onChange={(e) => setPolicy(p => ({ ...p, maxFailedAttempts: parseInt(e.target.value) || 5 }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Lockout Duration (minutes)</label>
                  <input
                    type="number"
                    min={1}
                    value={policy.lockoutDurationMinutes}
                    onChange={(e) => setPolicy(p => ({ ...p, lockoutDurationMinutes: parseInt(e.target.value) || 30 }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Session Timeout (minutes)</label>
                  <input
                    type="number"
                    min={5}
                    value={policy.sessionTimeoutMinutes}
                    onChange={(e) => setPolicy(p => ({ ...p, sessionTimeoutMinutes: parseInt(e.target.value) || 480 }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Idle Timeout (minutes)</label>
                  <input
                    type="number"
                    min={1}
                    value={policy.idleTimeoutMinutes}
                    onChange={(e) => setPolicy(p => ({ ...p, idleTimeoutMinutes: parseInt(e.target.value) || 30 }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
                <hr className="border-slate-700" />
                <h3 className="text-white font-medium flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-emerald-400" />
                  MFA Requirements
                </h3>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-slate-300">Require MFA for all users</span>
                  <button
                    onClick={() => setPolicy(p => ({ ...p, mfaRequired: !p.mfaRequired }))}
                    className={`w-10 h-5 rounded-full transition-colors relative ${
                      policy.mfaRequired ? 'bg-emerald-500' : 'bg-slate-600'
                    }`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      policy.mfaRequired ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </label>
                {!policy.mfaRequired && (
                  <div>
                    <label className="block text-sm text-slate-300 mb-2">Require MFA for roles:</label>
                    <div className="flex flex-wrap gap-2">
                      {['admin', 'manager', 'budtender', 'viewer'].map(role => (
                        <button
                          key={role}
                          onClick={() => {
                            setPolicy(p => ({
                              ...p,
                              mfaRequiredRoles: p.mfaRequiredRoles.includes(role)
                                ? p.mfaRequiredRoles.filter(r => r !== role)
                                : [...p.mfaRequiredRoles, role],
                            }));
                          }}
                          className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                            policy.mfaRequiredRoles.includes(role)
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                              : 'border-slate-600 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sessions Tab */}
      {tab === 'sessions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Active Sessions</h2>
            <div className="flex items-center gap-3">
              {isAdmin && (
                <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAllSessions}
                    onChange={(e) => setShowAllSessions(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  Show all company sessions
                </label>
              )}
              <Button
                variant="danger"
                size="sm"
                onClick={() => setRevokeAllOpen(true)}
              >
                Revoke All Other Sessions
              </Button>
            </div>
          </div>

          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            {loadingSessions ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-12 text-center">
                <Monitor className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400">No active sessions found</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-800/80">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Device</th>
                    {showAllSessions && isAdmin && (
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">User</th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">IP Address</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Last Activity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Created</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {sessions.map((session: any) => {
                    const isCurrent = session.isCurrent || session.id === 'current';
                    return (
                      <tr
                        key={session.id}
                        className={`${isCurrent ? 'bg-emerald-500/5 border-l-2 border-l-emerald-500' : 'hover:bg-slate-700/30'}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Monitor className={`w-4 h-4 ${isCurrent ? 'text-emerald-400' : 'text-slate-400'}`} />
                            <span className="text-sm text-slate-300">
                              {session.deviceType || session.userAgent || 'Unknown'}
                            </span>
                            {isCurrent && (
                              <Badge variant="success" dot>Current</Badge>
                            )}
                          </div>
                        </td>
                        {showAllSessions && isAdmin && (
                          <td className="px-4 py-3 text-sm text-slate-300">{session.userName || session.userEmail || '—'}</td>
                        )}
                        <td className="px-4 py-3 text-sm text-slate-400 font-mono">{session.ipAddress || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-sm text-slate-400">
                            <MapPin className="w-3 h-3" />
                            {session.location || 'Unknown'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-400">
                          {session.lastActivity ? relativeTime(session.lastActivity) : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {session.createdAt ? new Date(session.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!isCurrent && (
                            <button
                              onClick={() => revokeSession(session.id)}
                              className="px-3 py-1 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 rounded-lg transition-colors"
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <ConfirmModal
            isOpen={revokeAllOpen}
            onClose={() => setRevokeAllOpen(false)}
            onConfirm={revokeAllSessions}
            title="Revoke All Sessions"
            message="This will sign out all other devices. Your current session will not be affected."
            confirmText="Revoke All"
            variant="danger"
          />
        </div>
      )}

      {/* Security Events Tab */}
      {tab === 'security-events' && isAdmin && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Security Events</h2>

          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-800 rounded-lg border border-red-500/30 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Critical (24h)</p>
                  <p className="text-3xl font-bold text-red-400">{eventSummary.critical}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-red-400/50" />
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg border border-amber-500/30 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Warning (24h)</p>
                  <p className="text-3xl font-bold text-amber-400">{eventSummary.warning}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-amber-400/50" />
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg border border-blue-500/30 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Info (24h)</p>
                  <p className="text-3xl font-bold text-blue-400">{eventSummary.info}</p>
                </div>
                <Info className="w-8 h-8 text-blue-400/50" />
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div className="grid md:grid-cols-4 gap-3">
              <select
                value={eventTypeFilter}
                onChange={(e) => { setEventTypeFilter(e.target.value); setEventPage(1); }}
                className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                {EVENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <select
                value={severityFilter}
                onChange={(e) => { setSeverityFilter(e.target.value); setEventPage(1); }}
                className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                {SEVERITY_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <input
                type="date"
                value={eventDateFrom}
                onChange={(e) => { setEventDateFrom(e.target.value); setEventPage(1); }}
                className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
              <input
                type="date"
                value={eventDateTo}
                onChange={(e) => { setEventDateTo(e.target.value); setEventPage(1); }}
                className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Events Table */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            {loadingEvents ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : events.length === 0 ? (
              <div className="p-12 text-center">
                <Shield className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400">No security events found</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-800/80">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Severity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">IP</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Time</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">Ack</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {events.map((event: any) => (
                    <tr
                      key={event.id}
                      className="hover:bg-slate-700/30 cursor-pointer"
                      onClick={() => setSelectedEvent(event)}
                    >
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {(event.type || '').replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={severityColor(event.severity)} dot>
                          {event.severity}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-400 max-w-xs truncate">
                        {event.description || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-400">{event.userName || event.userEmail || '—'}</td>
                      <td className="px-4 py-3 text-sm text-slate-500 font-mono">{event.ipAddress || '—'}</td>
                      <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">
                        {event.createdAt ? relativeTime(event.createdAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={event.acknowledged || false}
                          onChange={(e) => acknowledgeEvent(event.id, e.target.checked)}
                          className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Event Detail Modal */}
          <Modal isOpen={!!selectedEvent} onClose={() => setSelectedEvent(null)} title="Event Details" size="lg">
            {selectedEvent && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-400 uppercase mb-1">Type</p>
                    <p className="text-white">{(selectedEvent.type || '').replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase mb-1">Severity</p>
                    <Badge variant={severityColor(selectedEvent.severity)} dot>{selectedEvent.severity}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase mb-1">User</p>
                    <p className="text-white">{selectedEvent.userName || selectedEvent.userEmail || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase mb-1">IP Address</p>
                    <p className="text-white font-mono">{selectedEvent.ipAddress || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase mb-1">Timestamp</p>
                    <p className="text-white">{selectedEvent.createdAt ? new Date(selectedEvent.createdAt).toLocaleString() : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase mb-1">Acknowledged</p>
                    <p className="text-white">{selectedEvent.acknowledged ? 'Yes' : 'No'}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Description</p>
                  <p className="text-slate-300">{selectedEvent.description || '—'}</p>
                </div>
                {selectedEvent.metadata && (
                  <div>
                    <p className="text-xs text-slate-400 uppercase mb-1">Metadata</p>
                    <pre className="bg-slate-900 rounded-lg p-4 text-sm text-slate-300 overflow-auto max-h-60 border border-slate-700">
                      {typeof selectedEvent.metadata === 'string'
                        ? selectedEvent.metadata
                        : JSON.stringify(selectedEvent.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </Modal>
        </div>
      )}
    </div>
  );
}
