// src/components/CaregiverDashboard.jsx
// Enhanced with self-service: availability, open shifts pickup, time off requests
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import { toast } from './Toast';
import CaregiverClientModal from './CaregiverClientModal';
import MileageTracker from './MileageTracker';
import ShiftMissReport from './caregiver/ShiftMissReport';
import IncidentReportForm from './caregiver/IncidentReportForm';
import CaregiverHelp from './caregiver/CaregiverHelp';
import CaregiverMessages from './caregiver/CaregiverMessages';
import PaydayVerificationModal from './caregiver/PaydayVerificationModal';
import { useGeolocation, useHaptics, useOfflineSync, useBackgroundGeolocation, isNative, platform } from '../hooks/useNative';
import OfflineBanner from './OfflineBanner';
import { useAuth } from '../contexts/AuthContext';
import { SandataPrompt, SandataIdBox, SandataHelp, SandataNotice, useSandataContext } from './caregiver/SandataEvv';
import { needsSandata, visitNeedsSandata, evvWeekMet, openSandata } from '../utils/sandata';
import CareTaskChecklist from './CareTaskChecklist';
import SignaturePad from './SignaturePad';
import { savePunch, newLocalId, offlineSession, flushPunches, isUnreachable, pendingPunches } from '../offlinePunches';
import { isBiweeklyOn, toYMD } from '../utils/biweekly';
import { CLIENT_UNAVAILABLE_REASONS } from '../utils/cancelReasons';

// A punch must never hang on a dead connection: give up after 20s and treat it as "no signal",
// so the tap is saved on the phone instead of lost.
const fetchWithTimeout = async (url, options = {}, ms = 20000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); } finally { clearTimeout(t); }
};

const subscribeToPush = async (token) => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    const vapidRes = await fetch(`${API_BASE_URL}/api/push/vapid-key`, { headers: { Authorization: `Bearer ${token}` } });
    const { publicKey } = await vapidRes.json();
    if (!publicKey || publicKey === 'PLACEHOLDER_REPLACE_WITH_REAL_KEY') return;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });
    await fetch(`${API_BASE_URL}/api/push/subscribe`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    });
  } catch (e) {
    console.log('[Push] subscription skipped:', e.message);
  }
};

const CaregiverDashboard = ({ onLogout }) => {
  const { user, token, company } = useAuth();
  const [currentPage, setCurrentPage] = useState('home');
  const [schedules, setSchedules] = useState([]);
  const [clients, setClients] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  // Documents waiting for this caregiver's signature (their own, and company policies)
  const [unsignedDocs, setUnsignedDocs] = useState([]);
  const [signTarget, setSignTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [visitNote, setVisitNote] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [recentVisits, setRecentVisits] = useState([]);
  const [viewingClientId, setViewingClientId] = useState(null);
  const timerRef = useRef(null);

  // Sandata EVV: which of my clients are in Sandata, and the "check in/out on Sandata too" prompt.
  const { ctx: sandataCtx, reload: reloadSandata } = useSandataContext(token);
  const sandataCtxRef = useRef(null);
  sandataCtxRef.current = sandataCtx;
  const [sandataPrompt, setSandataPrompt] = useState(null); // { kind: 'in' | 'out', clientId, clientName }
  const [showSandataHelp, setShowSandataHelp] = useState(false);
  const sandataClient = (id) => (sandataCtx?.clients || []).find(c => c.id === id);
  const sessionClientId = (s) => (s ? (s.client_id || s.clientId) : null);
  // The visit's Sandata decision was made at clock-in; after a reload it comes from the context.
  const sessionSandataRequired = (s) => {
    if (!s) return undefined;
    if (s.sandata_required !== undefined) return s.sandata_required;
    const av = sandataCtx?.activeVisit;
    return av && av.time_entry_id === s.id ? av.sandata_required : undefined;
  };

  // Visits for clients in Sandata must also be checked in and out on Sandata Mobile Connect.
  // `sandataRequired` is the server's per-visit answer (weekly EVV allowance): false = this week's
  // EVV hours are already met, so this visit does NOT go to Sandata. Unknown (offline) -> prompt.
  const promptSandata = (kind, clientId, sandataRequired) => {
    const cl = (sandataCtxRef.current?.clients || []).find(c => c.id === clientId);
    if (visitNeedsSandata(cl, sandataRequired)) {
      setSandataPrompt({ kind, clientId, clientName: `${cl.first_name || ''} ${cl.last_name || ''}`.trim() });
    } else if (kind === 'in' && evvWeekMet(cl, sandataRequired)) {
      toast(`EVV hours for ${cl.first_name || 'this client'} are already done this week — no Sandata check-in needed for this visit.`, 'success');
    }
  };

  // Native GPS — works on web AND iOS/Android
  const { position: location, error: locationError, getPosition } = useGeolocation({ watch: true });
  const { impact, notification: hapticNotify } = useHaptics();
  const { online, queueCount } = useOfflineSync();
  const { start: startBgGeo } = useBackgroundGeolocation();

  // Self-service state
  const [openShifts, setOpenShifts] = useState([]);
  const [myHoursThisWeek, setMyHoursThisWeek] = useState(0);
  const [availability, setAvailability] = useState({
    status: 'available',
    maxHoursPerWeek: 40,
    weeklyAvailability: {
      0: { available: false, start: '09:00', end: '17:00' },
      1: { available: true, start: '09:00', end: '17:00' },
      2: { available: true, start: '09:00', end: '17:00' },
      3: { available: true, start: '09:00', end: '17:00' },
      4: { available: true, start: '09:00', end: '17:00' },
      5: { available: true, start: '09:00', end: '17:00' },
      6: { available: false, start: '09:00', end: '17:00' }
    },
    notes: ''
  });
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [newTimeOff, setNewTimeOff] = useState({ startDate: '', endDate: '', reason: '' });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [showMissReport, setShowMissReport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  // Payday verification: last pay period's hours to confirm. Null unless the agency switched the prompt on.
  const [pendingVerification, setPendingVerification] = useState<any>(null);
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE_URL}/api/payroll-verification/me/pending`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.pending) setPendingVerification(d.pending); })
      .catch(() => {});
  }, [token]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [showMoreDrawer, setShowMoreDrawer] = useState(false);

  // ── Visits (ported from the CVHC home care CRM) ──────────────────────────
  // Set when the server refuses a clock-out because a note is required (VA clients): the note
  // modal stays open with the reason instead of closing on a generic error.
  const [noteError, setNoteError] = useState('');
  const [clockingIn, setClockingIn] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  // Visit photos staged for upload on clock-out
  const [pendingPhotos, setPendingPhotos] = useState([]); // [{ dataUri, caption, category, sizeBytes }]
  const [photoUploading, setPhotoUploading] = useState(false);
  // Shift swap requests (to me and from me)
  const [swapRequests, setSwapRequests] = useState([]);
  const [swapModal, setSwapModal] = useState(null);
  const [swapForm, setSwapForm] = useState({ targetCaregiverId: '', reason: '' });
  // "Client refused / not available": the visit comes off the books (not billed, not paid);
  // nobody needs covering, so no open shift.
  const [unavailModal, setUnavailModal] = useState(null);
  const [unavailForm, setUnavailForm] = useState({ reason: '', note: '' });
  const [unavailSubmitting, setUnavailSubmitting] = useState(false);
  const [moveModal, setMoveModal] = useState(null);
  const [moveForm, setMoveForm] = useState({ date: '', startTime: '', endTime: '', reason: '' });
  const [myReschedules, setMyReschedules] = useState([]); // this caregiver's own pending asks
  const [changeRequests, setChangeRequests] = useState([]); // what CLIENTS asked about my visits
  const [crResolving, setCrResolving] = useState(null);
  const [otherCaregivers, setOtherCaregivers] = useState([]);

  const loadSwapRequests = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/shift-swaps`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setSwapRequests(await r.json());
    } catch {}
  };

  const loadOtherCaregivers = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/caregivers`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const all = await r.json();
        const list = Array.isArray(all) ? all : (all?.caregivers || []);
        setOtherCaregivers(list.filter(c => c.id !== user?.id));
      }
    } catch {}
  };
  useEffect(() => { loadSwapRequests(); loadOtherCaregivers(); }, [user?.id]);

  const submitClientUnavailable = async () => {
    if (!unavailModal) return;
    if (!unavailForm.reason) { toast('Pick a reason', 'error'); return; }
    if (unavailForm.reason === 'other' && !unavailForm.note.trim()) { toast('Add a short note for "Other"', 'error'); return; }
    const date = unavailModal.resolvedDate || (unavailModal.date && unavailModal.date.split('T')[0]);
    setUnavailSubmitting(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/emergency/client-unavailable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scheduleId: unavailModal.id, date, reason: unavailForm.reason, note: unavailForm.note || null }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Could not save');
      toast('Saved — the office has been notified and this visit will not be billed');
      setUnavailModal(null); setUnavailForm({ reason: '', note: '' });
      loadData();
    } catch (e) { toast(e.message, 'error'); }
    finally { setUnavailSubmitting(false); }
  };

  const submitSwapRequest = async () => {
    if (!swapModal || !swapForm.targetCaregiverId) { toast('Pick a coworker to swap with', 'error'); return; }
    try {
      const r = await fetch(`${API_BASE_URL}/api/shift-swaps`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          scheduleId: swapModal.id,
          // The day the caregiver tapped — a repeating shift has no date of its own.
          shiftDate: swapModal.resolvedDate || (swapModal.date && swapModal.date.split('T')[0]) || undefined,
          targetCaregiverId: swapForm.targetCaregiverId,
          reason: swapForm.reason || null,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      toast('Swap request sent');
      setSwapModal(null); setSwapForm({ targetCaregiverId: '', reason: '' });
      loadSwapRequests();
    } catch (e) { toast(e.message, 'error'); }
  };

  // Ask the office to move a shift to another day/time. Nothing changes until the office approves
  // it — the visit is billed and EVV'd against the scheduled time.
  const openMoveModal = (shift) => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const onDate = shift.resolvedDate || (shift.date && shift.date.split('T')[0]) || toYMD(t);
    setMoveModal({ ...shift, occurrenceDate: onDate });
    setMoveForm({ date: onDate, startTime: (shift.start_time || '').slice(0, 5), endTime: (shift.end_time || '').slice(0, 5), reason: '' });
  };

  // One open request per visit — the server enforces it (409); this just hides a button that can only fail.
  const movePendingFor = (shift) => {
    const onDate = shift.resolvedDate || (shift.date && shift.date.split('T')[0]);
    return myReschedules.some(cr => cr.schedule_id === shift.id && String(cr.visit_date).slice(0, 10) === onDate);
  };

  const submitMoveRequest = async () => {
    if (!moveModal) return;
    const { date, startTime, endTime, reason } = moveForm;
    if (!date || !startTime || !endTime) { toast('Pick the new day and times', 'error'); return; }
    const origStart = (moveModal.start_time || '').slice(0, 5);
    const origEnd = (moveModal.end_time || '').slice(0, 5);
    if (date === moveModal.occurrenceDate && startTime === origStart && endTime === origEnd) {
      toast('That is the same day and time it already has', 'error'); return;
    }
    try {
      const r = await fetch(`${API_BASE_URL}/api/visit-change-requests/reschedule-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          scheduleId: moveModal.id, visitDate: moveModal.occurrenceDate,
          startTime: moveModal.start_time, endTime: moveModal.end_time,
          proposedDate: date, proposedStartTime: startTime, proposedEndTime: endTime, reason: reason || null,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      toast('Sent to the office — the shift moves once they approve it');
      setMoveModal(null);
      loadChangeRequests();
    } catch (e) { toast(e.message, 'error'); }
  };

  const respondToSwap = async (req, accepted) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/shift-swaps/${req.id}/respond`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accepted }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      toast(accepted ? 'Swap accepted — admin approval pending' : 'Swap declined');
      loadSwapRequests();
    } catch (e) { toast(e.message, 'error'); }
  };

  // Every open request on this caregiver's visits. What the CLIENT asked is theirs to answer; what
  // THEY asked is waiting on the office (and must never be shown with Approve/Deny).
  const loadChangeRequests = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/visit-change-requests`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data) ? data : [];
        setChangeRequests(rows.filter(cr => cr.requested_by !== 'caregiver'));
        setMyReschedules(rows.filter(cr => cr.requested_by === 'caregiver'));
      }
    } catch { /* keep the dashboard working */ }
  };

  const resolveChangeRequest = async (crId, action, extra = {}) => {
    setCrResolving(crId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/visit-change-requests/${crId}/resolve`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) { toast('Request resolved', 'success'); loadChangeRequests(); loadData(); }
      else { const err = await res.json().catch(() => ({})); toast(err.error || 'Failed to resolve', 'error'); }
    } catch { toast('Network error', 'error'); }
    finally { setCrResolving(null); }
  };

  // Send punches saved on the phone while there was no signal: now, when the connection comes back,
  // when the app is reopened, and every 30s while any wait.
  useEffect(() => {
    if (!user?.id) return;
    let stopped = false;
    const trySend = async () => {
      if (stopped || !pendingPunches(user.id).length) return;
      const r = await flushPunches({ apiBase: API_BASE_URL, token, userId: user.id });
      if (stopped) return;
      if (r.sent) { toast(`✅ Saved ${r.sent === 1 ? 'punch' : `${r.sent} punches`} sent to the office.`, 'success'); loadData(); }
      for (const x of r.rejected) {
        toast(`⚠️ A saved ${x.punch.kind === 'in' ? 'clock-in' : 'clock-out'} could not be recorded: ${x.error}`, 'error');
      }
      if (r.rejected.length && !r.sent) loadData();
    };
    trySend();
    const onVisible = () => { if (document.visibilityState === 'visible') trySend(); };
    window.addEventListener('online', trySend);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(trySend, 30000);
    return () => {
      stopped = true;
      window.removeEventListener('online', trySend);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [user?.id, token]);

  // A photo is downscaled to a JPEG data URI (max 1600px, ~80%) to keep uploads small.
  const handlePhotoFile = async (file, category = 'other') => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Pick an image file', 'error'); return; }
    if (file.size > 15_000_000) { toast('Photo too large (15MB max)', 'error'); return; }
    const img = new Image();
    const reader = new FileReader();
    const dataUrl: any = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const compressed = canvas.toDataURL('image/jpeg', 0.82);
    const sizeBytes = Math.floor(compressed.length * 0.75);
    if (sizeBytes > 5_000_000) { toast('Photo too large after compression', 'error'); return; }
    setPendingPhotos(prev => [...prev, { dataUri: compressed, caption: '', category, sizeBytes }]);
  };

  useEffect(() => {
    loadData();
    // GPS tracking handled by useGeolocation hook (watch: true)
    subscribeToPush(token);
    // Start background geolocation on Android so geofence works when screen is off
    startBgGeo({
      notificationTitle: '{{COMPANY_NAME}}',
      notificationText: 'Monitoring location for auto clock-in',
      onLocation: (loc) => {
        // Background location updates feed into the geofence check
        // The geofence polling useEffect will pick up the latest position
      }
    });
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Poll for unread messages
  useEffect(() => {
    const checkUnread = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/messages/unread-count`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status === 429) return; // rate limited - skip
        if (res.ok) { const data = await res.json(); setUnreadMessages(data.count); }
      } catch (e) { }
    };
    checkUnread();
    const interval = setInterval(checkUnread, 90000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (activeSession) {
      timerRef.current = setInterval(() => {
        const start = new Date(activeSession.start_time);
        const now = new Date();
        setElapsedTime(Math.floor((now - start) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsedTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeSession]);

  useEffect(() => {
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, [currentPage]);

  useEffect(() => {
    if (currentPage === 'open-shifts') loadOpenShifts();
    if (currentPage === 'availability') loadAvailability();
    if (currentPage === 'time-off') loadTimeOffRequests();
  }, [currentPage]);

  const loadData = async () => {
    try {
      const [schedulesRes, clientsRes, activeRes, visitsRes] = await Promise.all([
        // includeMovedIn: days moved ONTO this caregiver from someone else's pattern.
        fetch(`${API_BASE_URL}/api/schedules/${user.id}?includeMovedIn=1`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/clients`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/time-entries/active`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => ({ ok: false })),
        fetch(`${API_BASE_URL}/api/time-entries/recent?limit=10`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => ({ ok: false }))
      ]);

      if (schedulesRes.ok) setSchedules(await schedulesRes.json());
      if (clientsRes.ok) setClients(await clientsRes.json());
      if (activeRes.ok) {
        const data = await activeRes.json();
        if (data?.id) {
          setActiveSession(data);
          setSelectedClient(data.client_id);
        } else {
          // The server has no open visit. A clock-in still saved on this phone is one — keep
          // showing it; otherwise drop an offline visit that has synced.
          const saved = offlineSession(user.id);
          if (saved) { setActiveSession(saved); setSelectedClient(saved.client_id); }
          else setActiveSession(s => (s && s.offline ? null : s));
        }
      } else {
        // Couldn't reach the server — a visit saved on the phone is still in progress.
        const saved = offlineSession(user.id);
        if (saved) { setActiveSession(s => s || saved); setSelectedClient(c => c || saved.client_id); }
      }
      if (visitsRes.ok) setRecentVisits(await visitsRes.json());
      loadMyHours();
      loadChangeRequests();
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadOpenShifts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/available`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setOpenShifts(await res.json());
    } catch (error) {
      console.error('Failed to load open shifts:', error);
    }
  };

  const loadAvailability = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/caregivers/${user.id}/availability`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setAvailability(prev => ({
            status: data.status || prev.status,
            maxHoursPerWeek: data.max_hours_per_week || prev.maxHoursPerWeek,
            weeklyAvailability: data.weekly_availability ? 
              (typeof data.weekly_availability === 'string' ? JSON.parse(data.weekly_availability) : data.weekly_availability) 
              : prev.weeklyAvailability,
            notes: data.notes || ''
          }));
        }
      }
    } catch (error) {
      console.error('Failed to load availability:', error);
    }
  };

  const loadTimeOffRequests = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/absences/my`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setTimeOffRequests(await res.json());
    } catch (error) {
      console.error('Failed to load time off:', error);
    }
  };

  const loadMyHours = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/scheduling/caregiver-hours/${user.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMyHoursThisWeek(parseFloat(data.totalHours) || 0);
      }
    } catch (error) {
      console.error('Failed to load hours:', error);
    }
  };

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  const startGPSTracking = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.watchPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
          setLocationError(null);
        },
        (err) => setLocationError(err.message),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    }
  };

  // Push GPS breadcrumbs every 60 seconds during active shift
  const startGPSBreadcrumbs = (sessionId) => {
    if (!("geolocation" in navigator)) return;
    const interval = setInterval(() => {
      // GPS breadcrumb
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          fetch(`${API_BASE_URL}/api/time-entries/${sessionId}/gps`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, speed: pos.coords.speed, heading: pos.coords.heading })
          }).catch(() => {});
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );

      // 15-minute shift warning check (runs every 60s alongside GPS)
      fetch(`${API_BASE_URL}/api/time-entries/check-warnings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ timeEntryId: sessionId })
      })
      .then(r => r.json())
      .then(d => {
        if (d.warning && !d.overTime) {
          // 15-min warning - show in-app alert
          toast(`⏰ ${d.minutesRemaining} min remaining — start wrapping up your shift!`, 'warning');
        } else if (d.warning && d.overTime) {
          toast(`⚠️ You are ${d.minutesOver} min over your scheduled time — please clock out`, 'error');
        }
      })
      .catch(() => {});

    }, 60000); // every 60s
    return interval;
  };
  const gpsIntervalRef = React.useRef(null);
  const geofenceIntervalRef = React.useRef(null);
  const geofenceTriggeredRef = React.useRef(new Set()); // track which clients we've already auto-clocked for

  const _startGPSTracking_REMOVED = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.watchPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
          setLocationError(null);
        },
        (err) => setLocationError(err.message),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    } else {
      setLocationError('Geolocation not supported');
    }
  };

  // ── GEOFENCE AUTO CLOCK-IN/OUT ────────────────────────────────────────────
  const runGeofenceCheck = async (currentLocation, currentSession, currentClients, currentSchedules) => {
    if (!currentLocation?.lat && !currentLocation?.latitude) return;
    const lat = currentLocation.lat || currentLocation.latitude;
    const lng = currentLocation.lng || currentLocation.longitude;

    // Get today's day of week
    const todayDay = new Date().getDay();
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    // Clients with a visit that really happens today — the pattern's dates, bi-weekly parity,
    // suspension and that day's exception (a cancelled visit never auto-clocks anyone in).
    const todayDate = new Date(now); todayDate.setHours(0, 0, 0, 0);
    const todayYmd = toYMD(todayDate);
    const todaysVisits = (currentSchedules || [])
      .filter(s => s.date
        ? (String(s.date).slice(0, 10) === todayYmd && !isSuspendedOn(s, todayYmd))
        : (s.day_of_week === todayDay && isScheduleActiveForDate(s, todayDate)))
      .map(s => applyExceptionForDate(s, todayYmd))
      .filter(Boolean);
    const todayClients = [...new Set(todaysVisits.map(s => s.client_id).filter(Boolean))];
    // Proximity alone must not clock anyone in: a visit for THIS client has to be live now
    // (15 minutes before its start through its end).
    const hasShiftNow = (clientId) => todaysVisits.some(s => {
      if (s.client_id !== clientId || !s.start_time) return false;
      const [sh, sm] = s.start_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      let endMin = startMin + 8 * 60;
      if (s.end_time) {
        const [eh, em] = s.end_time.split(':').map(Number);
        endMin = eh * 60 + em;
        if (endMin <= startMin) endMin += 24 * 60; // overnight
      }
      return nowMins >= startMin - 15 && nowMins <= endMin;
    });

    if (!todayClients.length) return;

    for (const clientId of todayClients) {
      const alreadyTriggered = geofenceTriggeredRef.current.has(clientId);

      try {
        const res = await fetch(`${API_BASE_URL}/api/route-optimizer/geofence/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ clientId, latitude: lat, longitude: lng })
        });
        if (!res.ok) continue;
        const data = await res.json();

        // AUTO CLOCK-IN: within geofence, not clocked in, not already triggered
        if (data.withinGeofence && data.autoClockIn && !currentSession && !alreadyTriggered && hasShiftNow(clientId)) {
          geofenceTriggeredRef.current.add(clientId);
          toast(`📍 You've arrived at ${data.clientName} — clocking you in automatically`, 'success');
          // Auto clock in
          const clockRes = await fetch(`${API_BASE_URL}/api/time-entries/clock-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ clientId, latitude: lat, longitude: lng, autoClockIn: true })
          });
          if (clockRes.ok) {
            const clockData = await clockRes.json();
            setActiveSession(clockData);
            setSelectedClient(clientId);
            gpsIntervalRef.current = startGPSBreadcrumbs(clockData.id);
            promptSandata('in', clientId, clockData.sandata_required);
          } else {
            // Refused (e.g. no live visit on the server's view) — allow a later retry.
            geofenceTriggeredRef.current.delete(clientId);
          }
          break; // only clock into one client at a time
        }

        // AUTO CLOCK-OUT: was within geofence but now left, currently clocked into this client
        if (!data.withinGeofence && data.autoClockOut && currentSession?.client_id === clientId && alreadyTriggered) {
          // Only auto clock-out if they've been there at least 10 minutes
          const sessionStart = new Date(currentSession.start_time);
          const minsElapsed = (now - sessionStart) / 60000;
          if (minsElapsed >= 10) {
            toast(`📍 You've left ${data.clientName}'s location — clocking you out automatically`, 'success');
            geofenceTriggeredRef.current.delete(clientId);
            setShowNoteModal(true); // prompt for visit note before clocking out
          }
        }
      } catch(e) {
        // Silently fail — don't interrupt the caregiver
      }
    }
  };

  // Start geofence polling when location is available
  useEffect(() => {
    if (!location) return;
    // Run immediately on location change
    runGeofenceCheck(location, activeSession, clients, schedules);
    // Also run on interval every 30 seconds
    if (!geofenceIntervalRef.current) {
      geofenceIntervalRef.current = setInterval(() => {
        runGeofenceCheck(location, activeSession, clients, schedules);
      }, 30000);
    }
    return () => {
      if (geofenceIntervalRef.current) {
        clearInterval(geofenceIntervalRef.current);
        geofenceIntervalRef.current = null;
      }
    };
  }, [location, activeSession, clients, schedules]);

  const handleClockIn = async () => {
    if (!selectedClient) return toast('Please select a client.');
    if (clockingIn) return;
    setClockingIn(true);
    const tapAt = new Date().toISOString(); // the real clock-in time, even if the send fails

    try {
      // Never wait on GPS at the tap: use the fix already in hand.
      const lat = location?.latitude || null;
      const lng = location?.longitude || null;
      if (!lat) getPosition?.(); // warm it for the clock-out

      await impact('medium'); // native haptic on button press

      let res = null;
      try {
        res = await fetchWithTimeout(`${API_BASE_URL}/api/time-entries/clock-in`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ clientId: selectedClient, latitude: lat, longitude: lng })
        });
      } catch { res = null; } // never reached the server
      if (isUnreachable(res)) {
        // No signal: save the tap on the phone with its real time; it sends itself later.
        const localId = newLocalId();
        const saved = savePunch({ userId: user.id, localId, kind: 'in', at: tapAt, clientId: selectedClient, latitude: lat, longitude: lng });
        if (!saved) throw new Error('No signal, and this phone could not save the clock-in. Call the office with your start time.');
        await hapticNotify('warning');
        toast(`No signal — clock-in saved on your phone at ${new Date(tapAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. It will send by itself when you have signal.`, 'warning');
        setActiveSession({ id: `offline-${localId}`, offline: true, client_id: selectedClient, start_time: tapAt });
        promptSandata('in', selectedClient, undefined);
        return;
      }

      // The server answered: a refusal (auto transition off, an offline overlap, …) is shown, never queued.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');

      await hapticNotify('success'); // success haptic
      setActiveSession(data);
      gpsIntervalRef.current = startGPSBreadcrumbs(data.id);
      if (!lat) toast('Clocked in (location unavailable)', 'warning');
      promptSandata('in', selectedClient, data.sandata_required);
      reloadSandata();
    } catch (error) {
      await hapticNotify('error');
      toast('Failed to clock in: ' + error.message, 'error');
    } finally {
      setClockingIn(false);
    }
  };

  const handleClockOut = () => {
    if (!activeSession) return toast('No active session.');
    setNoteError('');
    setShowNoteModal(true);
  };

  const completeClockOut = async () => {
    // Guard: a stale modal (reload, re-login) must close cleanly instead of trapping the caregiver.
    if (!activeSession?.id) { toast('No active session — reopen and try again.', 'error'); setShowNoteModal(false); return; }
    if (clockingOut) return; // ignore re-taps while the first one is in flight
    const isOfflineVisit = String(activeSession.id).startsWith('offline-');
    // A visit saved offline is only on this phone until it syncs — the note is the only record of
    // the visit if the office has to fix it, so ask for one.
    if (isOfflineVisit && !String(visitNote || '').trim()) {
      setNoteError('No signal — please add a short visit note so this visit can be saved on your phone.');
      return;
    }
    setClockingOut(true);
    const tapAt = new Date().toISOString(); // the real clock-out time, even if the send fails
    const finishSavedOffline = async () => {
      await hapticNotify('warning');
      toast(`No signal — clock-out saved on your phone at ${new Date(tapAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. It will send by itself when you have signal.${pendingPhotos.length ? ' Photos could not be saved offline.' : ''}`, 'warning');
      setActiveSession(null);
      setSelectedClient('');
      setVisitNote('');
      setNoteError('');
      setPendingPhotos([]);
      setShowNoteModal(false);
    };
    try {
      await impact('heavy'); // strong haptic for clock out

      const lat = location?.latitude || null;
      const lng = location?.longitude || null;
      const outClientId = sessionClientId(activeSession);
      const outSandataRequired = sessionSandataRequired(activeSession);

      if (isOfflineVisit) {
        // Its clock-in is still on the phone — queue the clock-out behind it.
        const saved = savePunch({ userId: user.id, localId: newLocalId(), kind: 'out', at: tapAt,
          inLocalId: String(activeSession.id).slice('offline-'.length), entryId: null,
          latitude: lat, longitude: lng, notes: visitNote });
        if (!saved) throw new Error('This phone could not save the clock-out. Call the office with your end time.');
        await finishSavedOffline();
        promptSandata('out', outClientId, outSandataRequired);
        return;
      }

      let res = null;
      try {
        res = await fetchWithTimeout(`${API_BASE_URL}/api/time-entries/${activeSession.id}/clock-out`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ latitude: lat, longitude: lng, notes: visitNote })
        });
      } catch { res = null; } // never reached the server
      if (isUnreachable(res)) {
        const saved = savePunch({ userId: user.id, localId: newLocalId(), kind: 'out', at: tapAt,
          inLocalId: null, entryId: activeSession.id, latitude: lat, longitude: lng, notes: visitNote });
        if (!saved) throw new Error('No signal, and this phone could not save the clock-out. Call the office with your end time.');
        await finishSavedOffline();
        promptSandata('out', outClientId, outSandataRequired);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // VA client with no note: keep the modal open so they can add one and retry.
        if (data.code === 'va_note_required') {
          await hapticNotify('warning');
          setNoteError(data.error || 'A visit note is required for this client.');
          return;
        }
        throw new Error(data.error || 'Failed');
      }

      const outData = await res.json().catch(() => null);
      // Clock-out succeeded — upload any staged visit photos before resetting.
      if (pendingPhotos.length > 0) {
        setPhotoUploading(true);
        let failed = 0;
        for (const p of pendingPhotos) {
          try {
            const pr = await fetch(`${API_BASE_URL}/api/time-entries/${activeSession.id}/photos`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ imageBase64: p.dataUri, caption: p.caption, category: p.category }),
            });
            if (!pr.ok) failed++;
          } catch { failed++; }
        }
        setPhotoUploading(false);
        if (failed > 0) toast(`${pendingPhotos.length - failed}/${pendingPhotos.length} photos uploaded`, 'warning');
      }

      await hapticNotify('success');
      setActiveSession(null);
      setSelectedClient('');
      setVisitNote('');
      setNoteError('');
      setPendingPhotos([]);
      setShowNoteModal(false);
      // The clock-out prompt follows the clock-in decision.
      promptSandata('out', outClientId, outData && outData.sandata_required != null ? outData.sandata_required : outSandataRequired);
      loadData();
      reloadSandata();
    } catch (error) {
      await hapticNotify('error');
      toast('Failed to clock out: ' + error.message, 'error');
      setShowNoteModal(false); // never trap the caregiver in the notes modal on error
    } finally {
      setClockingOut(false);
    }
  };

  const handlePickupShift = async (shiftId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      // "It's yours — …" when the office offered it first-come, otherwise pending approval.
      showMsg(data.message || 'Shift claimed!');
      loadOpenShifts();
      loadData();
    } catch (error) {
      showMsg(error.message, 'error');
    }
  };

  const handleSaveAvailability = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/caregiver-availability/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          status: availability.status,
          maxHoursPerWeek: availability.maxHoursPerWeek,
          weeklyAvailability: availability.weeklyAvailability,
          notes: availability.notes
        })
      });
      if (!res.ok) throw new Error('Failed');
      showMsg('Availability saved!');
    } catch (error) {
      showMsg(error.message, 'error');
    }
  };

  const handleRequestTimeOff = async (e) => {
    e.preventDefault();
    if (!newTimeOff.startDate || !newTimeOff.endDate) return showMsg('Select dates', 'error');

    try {
      const res = await fetch(`${API_BASE_URL}/api/absences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          caregiverId: user.id,
          absenceType: 'time_off_request',
          startDate: newTimeOff.startDate,
          endDate: newTimeOff.endDate,
          reason: newTimeOff.reason,
          status: 'pending'
        })
      });
      if (!res.ok) throw new Error('Failed');
      showMsg('Request submitted!');
      setNewTimeOff({ startDate: '', endDate: '', reason: '' });
      loadTimeOffRequests();
    } catch (error) {
      showMsg(error.message, 'error');
    }
  };

  const handlePageClick = (page) => {
    setCurrentPage(page);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const getClientName = (id) => {
    const c = clients.find(c => c.id === id);
    return c ? `${c.first_name} ${c.last_name}` : 'Unknown';
  };

  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
  };

  const formatElapsed = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const getDayName = (n) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n] || '';

  // A suspended schedule (service paused) generates nothing on/after suspended_from.
  const isSuspendedOn = (schedule, ymd) =>
    !!(schedule.suspended_from && ymd && ymd >= String(schedule.suspended_from).slice(0, 10));

  // Does a recurring pattern happen on this date? Effective / end dates, bi-weekly parity (the one
  // shared rule, utils/biweekly) and suspension — the same answer the server's engine gives.
  const isScheduleActiveForDate = (schedule, targetDate) => {
    const ymd = toYMD(new Date(targetDate));
    if (schedule.effective_date && ymd < String(schedule.effective_date).slice(0, 10)) return false;
    if (schedule.end_date && ymd > String(schedule.end_date).slice(0, 10)) return false;
    if (schedule.frequency === 'biweekly' && schedule.anchor_date && !isBiweeklyOn(ymd, schedule.anchor_date)) return false;
    if (isSuspendedOn(schedule, ymd)) return false;
    return true;
  };

  // Per-day exceptions ride along on each recurring row: 'cancelled' removes that one date,
  // 'modified' changes its times or moves it to another client / caregiver. Returns the shift to
  // show for that date, or null.
  const applyExceptionForDate = (schedule, dateStr) => {
    const ex = (schedule.exceptions || []).find(e => String(e.exception_date).slice(0, 10) === dateStr);
    if (!ex) return schedule;
    if (ex.exception_type === 'cancelled') return null;
    if (ex.exception_type === 'modified') {
      if (ex.override_caregiver_id && schedule.caregiver_id && ex.override_caregiver_id !== schedule.caregiver_id) return null;
      const out = { ...schedule, start_time: ex.override_start_time || schedule.start_time, end_time: ex.override_end_time || schedule.end_time };
      if (ex.override_client_id && ex.override_client_id !== schedule.client_id) out.client_id = ex.override_client_id;
      return out;
    }
    return schedule;
  };

  // Get today's appointments from schedules
  const getTodaysAppointments = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay();
    const todayStr = toYMD(today); // the local calendar day, not UTC's

    const recurring = schedules
      .filter(s => s.day_of_week === dayOfWeek && s.day_of_week !== null && !s.date && isScheduleActiveForDate(s, today))
      .map(s => applyExceptionForDate(s, todayStr))
      .filter(Boolean);
    const oneTime = schedules
      .filter(s => s.date && String(s.date).slice(0, 10) === todayStr && !isSuspendedOn(s, todayStr))
      .map(s => applyExceptionForDate(s, todayStr))
      .filter(Boolean);
    // A moved-in (covering) shift identical to an own shift today is shown once.
    const ownToday = new Set(recurring.map(s => `${s.client_id}|${s.start_time}|${s.end_time}`));
    const oneTimeDeduped = oneTime.filter(s => !s.moved_in || !ownToday.has(`${s.client_id}|${s.start_time}|${s.end_time}`));

    return [...recurring, ...oneTimeDeduped].sort((a, b) => (a.start_time || '00:00').localeCompare(b.start_time || '00:00'));
  };

  const getClientById = (id) => clients.find(c => c.id === id);

  const myId = user?.id || user?.userId;
  const loadUnsignedDocs = async () => {
    if (!myId) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/documents/unsigned/${myId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setUnsignedDocs(await r.json());
    } catch { /* not fatal */ }
  };
  useEffect(() => { loadUnsignedDocs(); }, [myId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitDocSignature = async (dataUri, typedName) => {
    if (!signTarget) return;
    const r = await fetch(`${API_BASE_URL}/api/documents/${signTarget.id}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ signatureImageBase64: dataUri, typedName }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Sign failed');
    toast('Signed ✓');
    setSignTarget(null);
    loadUnsignedDocs();
  };

  // RENDER PAGES
  const renderHomePage = () => {
    const todaysAppointments = getTodaysAppointments();
    
    return (
    <>
      <div className="card" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Hours This Week</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{myHoursThisWeek.toFixed(2)}h</div>
          </div>
          <div style={{ fontSize: '3rem', opacity: 0.5 }}>⏱️</div>
        </div>
        {myHoursThisWeek > 35 && (
          <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(255,255,255,0.2)', borderRadius: '6px', fontSize: '0.85rem' }}>
            ⚠️ Approaching 40 hour limit
          </div>
        )}
      </div>

      {/* Incoming swap requests — a coworker wants me to take their shift */}
      {(() => {
        const incoming = swapRequests.filter(s => s.target_id === user?.id && s.status === 'pending');
        if (!incoming.length) return null;
        return (
          <div className="card" style={{ marginBottom: '1rem', borderLeft: '4px solid #6366F1' }}>
            <div className="card-title" style={{ color: '#4338CA' }}>
              🔄 {incoming.length} shift swap request{incoming.length === 1 ? '' : 's'} for you
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              {incoming.map(req => (
                <div key={req.id} style={{ padding: '0.6rem 0.75rem', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, color: '#1F2937' }}>
                  <div style={{ fontWeight: 600 }}>{req.requester_first} {req.requester_last} wants you to take their shift</div>
                  <div style={{ fontSize: '0.82rem', color: '#4338CA' }}>
                    {req.shift_date && formatDate(req.shift_date + 'T12:00:00')} {req.start_time ? `· ${formatTime(req.start_time)}–${formatTime(req.end_time)}` : ''} {req.client_first ? `· ${req.client_first} ${req.client_last}` : ''}
                  </div>
                  {req.reason && <div style={{ fontSize: '0.82rem', color: '#374151', fontStyle: 'italic', marginTop: 4 }}>"{req.reason}"</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button onClick={() => respondToSwap(req, true)} style={{ background: '#047857', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700 }}>✓ Take it</button>
                    <button onClick={() => respondToSwap(req, false)} style={{ background: '#fff', color: '#B91C1C', border: '1px solid #FCA5A5', padding: '0.4rem 0.8rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem' }}>✕ Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Moves this caregiver asked for — so a request doesn't vanish after sending */}
      {myReschedules.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderLeft: '4px solid #059669' }}>
          <div className="card-title" style={{ color: '#047857' }}>Waiting on the Office ({myReschedules.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {myReschedules.map(cr => (
              <div key={cr.id} style={{ padding: '0.75rem', borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: '0.88rem', color: '#1F2937' }}>
                <div style={{ fontWeight: 700, color: '#065F46' }}>{cr.client_first_name} {cr.client_last_name}</div>
                <div style={{ color: '#374151', marginTop: 2 }}>
                  {cr.visit_date} {formatTime(cr.original_start_time)} → <strong>{cr.proposed_date} {formatTime(cr.proposed_start_time)}–{formatTime(cr.proposed_end_time)}</strong>
                </div>
                <div style={{ color: '#4B5563', marginTop: 4, fontSize: '0.8rem' }}>
                  {cr.status === 'counter_offered'
                    ? `Office suggested ${cr.counter_date} at ${formatTime(cr.counter_start_time)} — call the office to confirm.`
                    : 'Pending — work the original time until it is approved.'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What clients asked about my visits */}
      {changeRequests.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderLeft: '4px solid #e67e22' }}>
          <div className="card-title" style={{ color: '#B45309' }}>Client Requests ({changeRequests.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {changeRequests.slice(0, 5).map(cr => (
              <div key={cr.id} style={{ padding: '1rem', borderRadius: '8px', background: '#FFF7ED', border: '1px solid #FED7AA', color: '#1F2937' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#1F2937' }}>{cr.client_first_name} {cr.client_last_name}</div>
                    <div style={{ fontSize: '0.85rem', color: '#4B5563' }}>
                      {cr.request_type === 'cancel' ? 'Wants to cancel' : 'Wants to reschedule'} — {cr.visit_date} {formatTime(cr.original_start_time)}
                    </div>
                    {cr.cancel_reason && <div style={{ fontSize: '0.82rem', color: '#92400E', marginTop: '4px' }}>Reason: {cr.cancel_reason}</div>}
                    {cr.request_type === 'reschedule' && cr.proposed_date && (
                      <div style={{ fontSize: '0.82rem', color: '#1D4ED8', marginTop: '4px' }}>
                        Proposed: {cr.proposed_date} {cr.proposed_start_time?.slice(0, 5)} - {cr.proposed_end_time?.slice(0, 5)}
                      </div>
                    )}
                    {cr.status === 'counter_offered' && (
                      <div style={{ fontSize: '0.82rem', color: '#6D28D9', marginTop: '4px' }}>
                        You suggested {cr.counter_date} {cr.counter_start_time?.slice(0, 5)} — waiting on the client.
                      </div>
                    )}
                  </div>
                  <span style={{
                    background: cr.request_type === 'cancel' ? '#FEE2E2' : '#DBEAFE',
                    color: cr.request_type === 'cancel' ? '#991B1B' : '#1E40AF',
                    padding: '2px 8px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
                  }}>{cr.request_type === 'cancel' ? 'Cancel' : 'Reschedule'}</span>
                </div>
                {cr.status === 'pending' && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    <button className="btn btn-sm" style={{ background: '#047857', color: '#fff', padding: '0.35rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                      disabled={crResolving === cr.id} onClick={() => resolveChangeRequest(cr.id, 'approve')}>Approve</button>
                    <button className="btn btn-sm" style={{ background: '#B91C1C', color: '#fff', padding: '0.35rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                      disabled={crResolving === cr.id} onClick={() => resolveChangeRequest(cr.id, 'deny')}>Deny</button>
                    {cr.request_type === 'reschedule' && (
                      <button className="btn btn-sm" style={{ background: '#6D28D9', color: '#fff', padding: '0.35rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                        disabled={crResolving === cr.id}
                        onClick={() => {
                          const counterDate = prompt('Suggest a different date (YYYY-MM-DD):');
                          const counterStart = prompt('Start time (HH:MM):');
                          const counterEnd = prompt('End time (HH:MM):');
                          const msg = prompt('Optional message to client:');
                          if (counterDate && counterStart && counterEnd) {
                            resolveChangeRequest(cr.id, 'counter', { counterDate, counterStartTime: counterStart, counterEndTime: counterEnd, counterMessage: msg || '' });
                          }
                        }}>Counter-Offer</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's Appointments Section */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title">📅 Today's Appointments</div>
        {todaysAppointments.length === 0 ? (
          <p className="text-muted text-center" style={{ padding: '1rem 0' }}>No appointments scheduled for today</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {todaysAppointments.map((appt, idx) => {
              const client = getClientById(appt.client_id);
              const isCurrentClient = activeSession?.client_id === appt.client_id;
              return (
                <div 
                  key={appt.id || idx} 
                  style={{ 
                    padding: '1rem', 
                    borderRadius: '8px', 
                    background: isCurrentClient ? '#DBEAFE' : '#F9FAFB',
                    border: isCurrentClient ? '2px solid #2563eb' : '1px solid #E5E7EB'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '600', fontSize: '1.1rem', color: '#1F2937' }}>
                        {client ? `${client.first_name} ${client.last_name}` : 'Unknown Client'}
                        {isCurrentClient && <span style={{ marginLeft: '0.5rem', color: '#059669', fontSize: '0.85rem' }}>● Active</span>}
                      </div>
                      <div style={{ fontSize: '0.9rem', color: '#6B7280', marginTop: '0.25rem' }}>
                        🕐 {formatTime(appt.start_time)} - {formatTime(appt.end_time)}
                      </div>
                      {client && (
                        <div style={{ fontSize: '0.85rem', color: '#6B7280', marginTop: '0.5rem' }}>
                          {client.phone && <span>📞 {client.phone}</span>}
                          {client.address && <span style={{ marginLeft: client.phone ? '1rem' : 0 }}>📍 {client.address}{client.city ? `, ${client.city}` : ''}</span>}
                        </div>
                      )}
                      {appt.notes && (
                        <div style={{ fontSize: '0.85rem', color: '#4B5563', marginTop: '0.5rem', padding: '0.5rem', background: '#FEF3C7', borderRadius: '4px' }}>
                          📝 {appt.notes}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginLeft: '1rem' }}>
                      <button 
                        className="btn btn-sm" 
                        style={{ background: '#E5E7EB', color: '#374151', padding: '0.4rem 0.75rem' }}
                        onClick={() => setViewingClientId(appt.client_id)}
                      >
                        View
                      </button>
                      {!activeSession && (
                        <button 
                          className="btn btn-sm btn-primary" 
                          style={{ padding: '0.4rem 0.75rem' }}
                          onClick={() => setSelectedClient(appt.client_id)}
                        >
                          Select
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SANDATA EVV — visits for clients in Sandata are also checked in/out on Sandata Mobile Connect */}
      {sandataPrompt && (
        <SandataPrompt prompt={sandataPrompt} client={sandataClient(sandataPrompt.clientId)} ctx={sandataCtx}
          email={user?.email} onClose={() => setSandataPrompt(null)} />
      )}

      {/* Documents waiting for this caregiver's signature */}
      {unsignedDocs.length > 0 && (
        <div className="card mb-4 border-l-4 border-red-600 dark:border-red-500">
          <div className="card-title text-red-700 dark:text-red-300">
            ✍️ {unsignedDocs.length} document{unsignedDocs.length === 1 ? '' : 's'} need your signature
          </div>
          <div className="flex flex-col gap-2 mt-2">
            {unsignedDocs.map(d => (
              <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-gray-900 dark:border-red-900 dark:bg-red-950 dark:text-slate-100">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{d.name || d.file_name || 'Document'}</div>
                  {d.description && <div className="text-xs text-gray-600 dark:text-slate-300">{d.description}</div>}
                  {d.expiration_date && <div className="text-xs mt-0.5 text-red-700 dark:text-red-300">Expires {String(d.expiration_date).slice(0, 10)}</div>}
                </div>
                <button type="button" onClick={() => setSignTarget(d)}
                  className="ml-2 px-3 py-2 rounded-md text-sm font-bold bg-teal-600 text-white dark:bg-teal-600 dark:text-white">✍️ Sign</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MOBILE-FIRST CLOCK-IN — Full prominent card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {activeSession ? (
          // ACTIVE SESSION — big timer, center-stage
          <div style={{ textAlign: 'center', padding: '2rem 1.5rem', background: 'linear-gradient(135deg, #F0FDF4, #DCFCE7)' }}>
            <div style={{ fontSize: '0.9rem', color: '#166534', fontWeight: '600', marginBottom: '0.25rem' }}>
              🟢 Clocked In with {getClientName(activeSession.client_id)}
            </div>
            <div style={{ fontSize: '4rem', fontWeight: '900', fontFamily: 'monospace', color: '#16A34A', lineHeight: 1.1, margin: '0.5rem 0' }}>
              {formatElapsed(elapsedTime)}
            </div>
            <div style={{ fontSize: '0.82rem', color: '#4B5563', marginBottom: '1.5rem' }}>
              {location ? `📍 GPS Active (±${location.accuracy?.toFixed(0)}m)` : '📍 Location unavailable'}
            </div>
            <button
              onClick={handleClockOut}
              style={{
                width: '100%', padding: '1.125rem', background: '#DC2626', color: '#fff',
                border: 'none', borderRadius: '12px', cursor: 'pointer',
                fontWeight: '800', fontSize: '1.15rem', letterSpacing: '0.02em',
                boxShadow: '0 4px 12px rgba(220,38,38,0.3)'
              }}
            >
              🛑 Clock Out
            </button>
            {evvWeekMet(sandataClient(sessionClientId(activeSession)), sessionSandataRequired(activeSession)) && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                ✅ This week's EVV hours are done — no Sandata for this visit.
              </div>
            )}
            {visitNeedsSandata(sandataClient(sessionClientId(activeSession)), sessionSandataRequired(activeSession)) && (
              <>
                <button type="button" onClick={openSandata}
                  className="mt-3 w-full rounded-xl border-2 border-blue-700 bg-white py-3 font-bold text-blue-700 dark:border-blue-400 dark:bg-slate-900 dark:text-blue-300">
                  📲 Open the Sandata app (check in / check out)
                  <div className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">Not installed yet? This takes you to the store to download it.</div>
                </button>
                <SandataIdBox client={sandataClient(sessionClientId(activeSession))} />
                <button type="button" onClick={() => setShowSandataHelp(v => !v)}
                  className="mt-1 bg-transparent text-sm text-blue-700 underline dark:text-blue-300">
                  {showSandataHelp ? 'Hide login help' : 'How do I log in to Sandata?'}
                </button>
                {showSandataHelp && <SandataHelp agencyId={sandataCtx?.sandataAgencyId || null} isWisconsin={!!sandataCtx?.isWisconsin} email={user?.email} />}
              </>
            )}
            {activeSession.id && !String(activeSession.id).startsWith('offline-') && (
              <div className="mt-5 rounded-xl p-1 text-left bg-white dark:bg-slate-800">
                <CareTaskChecklist timeEntryId={activeSession.id} />
              </div>
            )}
          </div>
        ) : (
          // CLOCK IN — prominent select + button
          <div style={{ padding: '1.5rem' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#111827', marginBottom: '1rem', textAlign: 'center' }}>
              ⏰ Ready to Start a Shift?
            </div>
            {(sandataCtx?.clients || []).some(needsSandata) && (
              <div className="mb-3 text-center">
                <button type="button" onClick={() => setShowSandataHelp(v => !v)}
                  className="bg-transparent text-sm text-blue-700 underline dark:text-blue-300">
                  📲 {showSandataHelp ? 'Hide Sandata login help' : 'Set up Sandata (needed for your Sandata visits)'}
                </button>
                {showSandataHelp && <SandataHelp agencyId={sandataCtx?.sandataAgencyId || null} isWisconsin={!!sandataCtx?.isWisconsin} email={user?.email} />}
              </div>
            )}
            <div className="form-group" style={{ marginBottom: '0.875rem' }}>
              <label style={{ fontWeight: '700', fontSize: '0.9rem', color: '#374151' }}>Select Client *</label>
              <select
                value={selectedClient}
                onChange={(e) => setSelectedClient(e.target.value)}
                style={{ width: '100%', padding: '0.875rem', fontSize: '1rem', border: '2px solid #D1D5DB', borderRadius: '10px', background: '#fff', boxSizing: 'border-box' }}
              >
                <option value="">Choose client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
              {/* Sandata client: the ID to paste into Sandata, ready before they even clock in. */}
              {selectedClient && <SandataIdBox client={sandataClient(selectedClient)} />}
            </div>
            <div style={{ padding: '0.6rem 0.875rem', background: location ? '#F0FDF4' : '#F9FAFB', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem', color: location ? '#166534' : '#6B7280', border: `1px solid ${location ? '#BBF7D0' : '#E5E7EB'}` }}>
              {location ? `✅ GPS Active (±${location.accuracy?.toFixed(0)}m)` : locationError ? '⚠️ Location unavailable — you can still clock in' : '📍 Getting your location...'}
            </div>
            <button
              onClick={handleClockIn}
              disabled={!selectedClient}
              style={{
                width: '100%', padding: '1.125rem', background: selectedClient ? '{{PRIMARY_COLOR}}' : '#D1D5DB',
                color: selectedClient ? '#fff' : '#9CA3AF', border: 'none', borderRadius: '12px',
                cursor: selectedClient ? 'pointer' : 'not-allowed', fontWeight: '800', fontSize: '1.15rem',
                transition: 'all 0.15s', boxShadow: selectedClient ? '0 4px 12px rgba(42,187,167,0.3)' : 'none'
              }}
            >
              ▶️ Clock In
            </button>
          </div>
        )}
      </div>

      {/* Quick Actions row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem' }} onClick={() => handlePageClick('open-shifts')}>
          <div style={{ fontSize: '1.6rem' }}>📋</div>
          <div style={{ fontWeight: '600', fontSize: '0.82rem' }}>Open Shifts</div>
        </div>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem' }} onClick={() => handlePageClick('availability')}>
          <div style={{ fontSize: '1.6rem' }}>⏰</div>
          <div style={{ fontWeight: '600', fontSize: '0.82rem' }}>Availability</div>
        </div>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem', background: '#FEF2F2', border: '1px solid #FCA5A5' }}
          onClick={() => setShowMissReport(true)}>
          <div style={{ fontSize: '1.6rem' }}>🚨</div>
          <div style={{ fontWeight: '600', fontSize: '0.82rem', color: '#DC2626' }}>Miss Report</div>
        </div>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem', background: '#EEF2FF', border: '1px solid #C7D2FE', position: 'relative' }}
          onClick={() => setShowMessages(true)}>
          <div style={{ fontSize: '1.6rem' }}>💬</div>
          <div style={{ fontWeight: '600', fontSize: '0.82rem', color: '#4338CA' }}>Messages</div>
          {unreadMessages > 0 && (
            <span style={{ position: 'absolute', top: '6px', right: '6px', background: '#EF4444', color: '#fff', borderRadius: '99px', fontSize: '0.62rem', fontWeight: '700', padding: '1px 6px', minWidth: '16px', textAlign: 'center' }}>{unreadMessages}</span>
          )}
        </div>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem', background: '#F0FDFB', border: '1px solid #A7F3D0' }}
          onClick={() => setShowHelp(true)}>
          <div style={{ fontSize: '1.6rem' }}>❓</div>
          <div style={{ fontWeight: '600', fontSize: '0.82rem', color: '#065F46' }}>Help</div>
        </div>
      </div>
    </>
    );
  };

  const renderOpenShiftsPage = () => (
    <>
      <div className="schedule-header"><h3>📋 Available Shifts</h3></div>
      {openShifts.length === 0 ? (
        <div className="card text-center"><p style={{ fontSize: '3rem', margin: '1rem 0' }}>✅</p><p className="text-muted">No open shifts</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {openShifts.map(shift => (
            <div key={shift.id} className="card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: '600' }}>{shift.client_first_name} {shift.client_last_name}</div>
                  <div style={{ fontSize: '0.9rem', color: '#666' }}>📅 {formatDate(shift.date)}</div>
                  <div style={{ fontSize: '0.9rem', color: '#666' }}>🕐 {formatTime(shift.start_time)} - {formatTime(shift.end_time)}</div>
                </div>
                <button className="btn btn-sm btn-primary" onClick={() => handlePickupShift(shift.id)}>Claim</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const renderAvailabilityPage = () => (
    <>
      <div className="schedule-header"><h3>⏰ My Availability</h3></div>
      <div className="card">
        <div className="form-group">
          <label>Status</label>
          <select value={availability.status} onChange={(e) => setAvailability({ ...availability, status: e.target.value })}>
            <option value="available">✅ Available</option>
            <option value="limited">⚠️ Limited</option>
            <option value="unavailable">❌ Unavailable</option>
          </select>
        </div>
        <div className="form-group">
          <label>Max Hours/Week: {availability.maxHoursPerWeek}</label>
          <input type="range" min="0" max="60" value={availability.maxHoursPerWeek} onChange={(e) => setAvailability({ ...availability, maxHoursPerWeek: parseInt(e.target.value) })} style={{ width: '100%' }} />
        </div>
        <div className="form-group">
          <label>Weekly Schedule</label>
          {[0,1,2,3,4,5,6].map(day => {
            const d = availability.weeklyAvailability[day] || { available: false, start: '09:00', end: '17:00' };
            return (
              <div key={day} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: d.available ? '#D1FAE5' : '#F3F4F6', borderRadius: '6px', marginBottom: '0.25rem' }}>
                <input type="checkbox" checked={d.available} onChange={(e) => {
                  const u = { ...availability.weeklyAvailability };
                  u[day] = { ...d, available: e.target.checked };
                  setAvailability({ ...availability, weeklyAvailability: u });
                }} style={{ width: 'auto' }} />
                <span style={{ width: '60px', fontWeight: '500' }}>{getDayName(day).slice(0,3)}</span>
                {d.available && (
                  <>
                    <input type="time" value={d.start} onChange={(e) => {
                      const u = { ...availability.weeklyAvailability };
                      u[day] = { ...d, start: e.target.value };
                      setAvailability({ ...availability, weeklyAvailability: u });
                    }} style={{ padding: '0.25rem' }} />
                    <span>-</span>
                    <input type="time" value={d.end} onChange={(e) => {
                      const u = { ...availability.weeklyAvailability };
                      u[day] = { ...d, end: e.target.value };
                      setAvailability({ ...availability, weeklyAvailability: u });
                    }} style={{ padding: '0.25rem' }} />
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea value={availability.notes} onChange={(e) => setAvailability({ ...availability, notes: e.target.value })} rows={2} placeholder="Any notes..." />
        </div>
        <button className="btn btn-primary btn-block" onClick={handleSaveAvailability}>💾 Save</button>
      </div>
    </>
  );

  const renderTimeOffPage = () => (
    <>
      <div className="schedule-header"><h3>🏖️ Time Off</h3></div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h4 style={{ margin: '0 0 1rem 0' }}>Request Time Off</h4>
        <form onSubmit={handleRequestTimeOff}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Start</label>
              <input type="date" value={newTimeOff.startDate} onChange={(e) => setNewTimeOff({ ...newTimeOff, startDate: e.target.value })} min={new Date().toISOString().split('T')[0]} required />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>End</label>
              <input type="date" value={newTimeOff.endDate} onChange={(e) => setNewTimeOff({ ...newTimeOff, endDate: e.target.value })} min={newTimeOff.startDate || new Date().toISOString().split('T')[0]} required />
            </div>
          </div>
          <div className="form-group">
            <label>Reason</label>
            <input type="text" value={newTimeOff.reason} onChange={(e) => setNewTimeOff({ ...newTimeOff, reason: e.target.value })} placeholder="Vacation, etc." />
          </div>
          <button type="submit" className="btn btn-primary">Submit</button>
        </form>
      </div>
      <div className="card">
        <h4 style={{ margin: '0 0 1rem 0' }}>My Requests</h4>
        {timeOffRequests.length === 0 ? <p className="text-muted text-center">None</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {timeOffRequests.map(r => (
              <div key={r.id} style={{ padding: '0.75rem', borderRadius: '6px', background: r.status === 'approved' ? '#D1FAE5' : r.status === 'denied' ? '#FEE2E2' : '#FEF3C7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: '500' }}>{formatDate(r.start_date)} - {formatDate(r.end_date)}</div>
                  {r.reason && <div style={{ fontSize: '0.85rem', color: '#666' }}>{r.reason}</div>}
                </div>
                <span style={{ padding: '0.25rem 0.75rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600', background: r.status === 'approved' ? '#059669' : r.status === 'denied' ? '#DC2626' : '#D97706', color: '#fff' }}>
                  {(r.status || 'pending').toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  // The three things a caregiver can do about one visit: say the client wasn't available, ask a
  // coworker to take it, or ask the office to move it.
  const shiftActions = (s) => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <button onClick={() => { setUnavailModal(s); setUnavailForm({ reason: '', note: '' }); }}
        style={{ background: '#fff', border: '1px solid #FECACA', color: '#B91C1C', padding: '0.3rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
        title="Client refused care, wasn't home, or cancelled — the visit won't be billed">🚫 Client N/A</button>
      <button onClick={() => { setSwapModal(s); setSwapForm({ targetCaregiverId: '', reason: '' }); }}
        style={{ background: '#fff', border: '1px solid #C7D2FE', color: '#4338CA', padding: '0.3rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
        title="Ask a coworker to take this shift">🔄 Swap</button>
      {movePendingFor(s) ? (
        <span style={{ border: '1px solid #FCD34D', background: '#FFFBEB', color: '#92400E', padding: '0.3rem 0.6rem', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600 }}
          title="Waiting on the office">⏳ Move sent</span>
      ) : (
        <button onClick={() => openMoveModal(s)}
          style={{ background: '#fff', border: '1px solid #A7F3D0', color: '#047857', padding: '0.3rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
          title="Ask the office to move this shift to another day or time">🕐 Move</button>
      )}
    </div>
  );

  const renderSchedulePage = () => {
    // Every schedule (recurring + one-time + moved-in) resolved into concrete dated visits for the
    // next 14 days, each with that day's exception applied — cancelled gone, modified at its new time.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = toYMD(today);
    const concreteShifts = [];

    schedules.forEach(s => {
      if (s.date) {
        const dateStr = String(s.date).slice(0, 10);
        if (dateStr >= todayStr && !isSuspendedOn(s, dateStr)) {
          const resolved = applyExceptionForDate(s, dateStr);
          if (resolved) concreteShifts.push({ ...resolved, resolvedDate: dateStr });
        }
      } else if (s.day_of_week != null) {
        for (let d = 0; d < 14; d++) {
          const target = new Date(today);
          target.setDate(target.getDate() + d);
          if (target.getDay() !== s.day_of_week) continue;
          if (!isScheduleActiveForDate(s, target)) continue;
          const dateStr = toYMD(target);
          const resolved = applyExceptionForDate(s, dateStr);
          if (resolved) concreteShifts.push({ ...resolved, resolvedDate: dateStr });
        }
      }
    });

    // A moved-in copy identical to an own shift is shown once.
    const ownKeys = new Set(concreteShifts.filter(s => !s.moved_in).map(s => `${s.client_id}|${s.resolvedDate}|${s.start_time}|${s.end_time}`));
    const shifts = concreteShifts.filter(s => !s.moved_in || !ownKeys.has(`${s.client_id}|${s.resolvedDate}|${s.start_time}|${s.end_time}`));
    shifts.sort((a, b) => a.resolvedDate.localeCompare(b.resolvedDate) || (a.start_time || '').localeCompare(b.start_time || ''));

    const byDate = {};
    shifts.forEach(s => { (byDate[s.resolvedDate] ||= []).push(s); });
    const todayShifts = byDate[todayStr] || [];
    const upcomingKeys = Object.keys(byDate).sort().filter(d => d > todayStr);
    const formatDateLabel = (dateStr) => new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    // Week at a glance: 7 days from today with the hours each day.
    const hoursOf = (s) => {
      const [sh, sm] = (s.start_time || '00:00').split(':').map(Number);
      const [eh, em] = (s.end_time || '00:00').split(':').map(Number);
      let mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins < 0) mins += 24 * 60;
      return mins / 60;
    };
    const weekDays = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(today); dt.setDate(today.getDate() + d);
      const key = toYMD(dt);
      const dayShifts = byDate[key] || [];
      weekDays.push({ key, dt, shifts: dayShifts, totalHrs: dayShifts.reduce((sum, s) => sum + hoursOf(s), 0), isToday: d === 0 });
    }
    const weekTotalHrs = weekDays.reduce((s, d) => s + d.totalHrs, 0);

    const row = (s, i) => (
      <div key={s.id + '-' + i} style={{ padding: '0.5rem 0', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontWeight: '500' }}>{getClientName(s.client_id)}{s.moved_in ? ' (covering)' : ''}</div>
          <div style={{ fontSize: '0.9rem', color: '#4B5563' }}>{formatTime(s.start_time)} - {formatTime(s.end_time)}</div>
        </div>
        {shiftActions(s)}
      </div>
    );

    return (
      <>
        <div className="schedule-header"><h3>📅 My Schedule</h3></div>

        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', fontSize: '0.85rem', color: '#374151' }}>
            <strong>This Week</strong>
            <span>{weekTotalHrs.toFixed(1)}h total</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {weekDays.map(d => (
              <div key={d.key} style={{
                padding: '6px 4px', textAlign: 'center', borderRadius: 6,
                background: d.isToday ? '#DBEAFE' : (d.shifts.length > 0 ? '#F0FDF4' : '#F3F4F6'),
                border: d.isToday ? '1px solid #93C5FD' : '1px solid transparent', fontSize: '0.7rem',
              }}>
                <div style={{ fontWeight: 700, color: d.isToday ? '#1E40AF' : '#374151' }}>{d.dt.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#111827', marginTop: 2 }}>{d.dt.getDate()}</div>
                {d.shifts.length > 0 ? (
                  <>
                    <div style={{ fontWeight: 700, color: '#047857', marginTop: 4 }}>{d.totalHrs.toFixed(1)}h</div>
                    <div style={{ color: '#4B5563' }}>{d.shifts.length} shift{d.shifts.length !== 1 ? 's' : ''}</div>
                  </>
                ) : (
                  <div style={{ color: '#4B5563', marginTop: 4 }}>off</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {shifts.length === 0 ? (
          <div className="card text-center"><p className="text-muted">No upcoming shifts</p></div>
        ) : (
          <div>
            {todayShifts.length > 0 && (
              <div className="card" style={{ marginBottom: '0.75rem', borderLeft: '4px solid #2563eb' }}>
                <div style={{ fontWeight: '600', color: '#1D4ED8', marginBottom: '0.5rem' }}>Today — {formatDateLabel(todayStr)}</div>
                {todayShifts.map(row)}
              </div>
            )}
            {upcomingKeys.map(dateStr => (
              <div key={dateStr} className="card" style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontWeight: '600', color: '#047857' }}>{formatDateLabel(dateStr)}</div>
                {byDate[dateStr].map(row)}
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  const renderHistoryPage = () => (
    <div className="card">
      <div className="card-title">Recent Visits</div>
      {recentVisits.length === 0 ? <p className="text-muted text-center">None</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Date</th><th>Client</th><th>Hours</th></tr></thead>
            <tbody>
              {recentVisits.map((v, i) => (
                <tr key={v.id || i}>
                  <td>{formatDate(v.start_time)}</td>
                  <td><span onClick={() => setViewingClientId(v.client_id)} style={{ cursor: 'pointer', color: '#007bff' }}>{v.client_name || getClientName(v.client_id)}</span></td>
                  <td>{v.hours_worked ? `${parseFloat(v.hours_worked).toFixed(2)}h` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderClientsPage = () => {
    const myClients = clients.filter(c => schedules.some(s => s.client_id === c.id));
    return (
      <>
        <div className="schedule-header"><h3>👥 My Clients</h3></div>
        {myClients.length === 0 ? <div className="card text-center"><p className="text-muted">No clients</p></div> : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {myClients.map(c => (
              <div key={c.id} className="card" onClick={() => setViewingClientId(c.id)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0 }}>{c.first_name} {c.last_name}</h4>
                    <p style={{ margin: '0.25rem 0 0 0', color: '#666', fontSize: '0.9rem' }}>📞 {c.phone || 'N/A'} • 📍 {c.city || 'N/A'}</p>
                  </div>
                  <span style={{ color: '#007bff', fontSize: '1.2rem' }}>→</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  const renderSettingsPage = () => (
    <>
      <div className="card">
        <div className="card-title">Profile</div>
        <div className="form-group"><label>Name</label><input type="text" value={user.name || `${user.first_name} ${user.last_name}`} disabled /></div>
        <div className="form-group"><label>Email</label><input type="text" value={user.email} disabled /></div>
      </div>
      <div className="card">
        <div className="card-title">GPS Status</div>
        <div className={`alert ${location ? 'alert-success' : 'alert-info'}`}>
          {location ? <>GPS Active (±{location.accuracy?.toFixed(0)}m)</> : <>{locationError || 'Location unavailable'} - Clock in still works</>}
        </div>
      </div>
      <button className="btn btn-danger btn-block" onClick={onLogout}>Log Out</button>
    </>
  );

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {message.text && (
        <div style={{ position: 'fixed', top: '1rem', right: '1rem', padding: '1rem 1.5rem', borderRadius: '8px', zIndex: 1001, background: message.type === 'error' ? '#FEE2E2' : '#D1FAE5', color: message.type === 'error' ? '#DC2626' : '#059669', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          {message.text}
        </div>
      )}

      {sidebarOpen && window.innerWidth <= 768 && <div className="sidebar-overlay active" onClick={() => setSidebarOpen(false)} />}

      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">{{COMPANY_SHORT}}</div>
        <ul className="sidebar-nav">
          <li><a href="#" className={currentPage === 'home' ? 'active' : ''} onClick={() => handlePageClick('home')}>🏠 Home</a></li>
          <li><a href="#" className={currentPage === 'schedule' ? 'active' : ''} onClick={() => handlePageClick('schedule')}>📅 Schedule</a></li>
          <li><a href="#" className={currentPage === 'clients' ? 'active' : ''} onClick={() => handlePageClick('clients')}>👥 Clients</a></li>
          <li><a href="#" className={currentPage === 'history' ? 'active' : ''} onClick={() => handlePageClick('history')}>📜 History</a></li>
          <li style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', display: 'block', padding: '0.5rem 1rem' }}>Self Service</span>
          </li>
          <li><a href="#" className={currentPage === 'open-shifts' ? 'active' : ''} onClick={() => handlePageClick('open-shifts')}>📋 Open Shifts</a></li>
          <li><a href="#" className={currentPage === 'availability' ? 'active' : ''} onClick={() => handlePageClick('availability')}>⏰ Availability</a></li>
          <li><a href="#" className={currentPage === 'miss-report' ? 'active' : ''} onClick={() => handlePageClick('miss-report')}>🚨 Report Miss</a></li>
          <li><a href="#" className={currentPage === 'incident-report' ? 'active' : ''} onClick={() => handlePageClick('incident-report')}>⚠️ Report Incident</a></li>
          <li><a href="#" className={currentPage === 'time-off' ? 'active' : ''} onClick={() => handlePageClick('time-off')}>🏖️ Time Off</a></li>
          <li style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.5rem' }}>
            <a href="#" className={currentPage === 'settings' ? 'active' : ''} onClick={() => handlePageClick('settings')}>⚙️ Settings</a>
          </li>
        </ul>
        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name || `${user.first_name || ''} ${user.last_name || ''}`}</div>
          <div className="sidebar-user-role">Caregiver</div>
          <button className="btn-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="main-content">
        <div className="header">
          <div><h1>{{COMPANY_NAME}}</h1><p>Caregiver Portal</p></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button className="hamburger-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>Menu</button>
            <button
              onClick={onLogout}
              style={{
                padding: '0.4rem 0.85rem', borderRadius: '8px', border: 'none',
                background: '#FEE2E2', color: '#DC2626', fontWeight: '700',
                fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap'
              }}>
              ⏻ Logout
            </button>
          </div>
        </div>
        <div className="container">
          {currentPage === 'home' && renderHomePage()}
          {currentPage === 'schedule' && renderSchedulePage()}
          {currentPage === 'clients' && renderClientsPage()}
          {currentPage === 'history' && renderHistoryPage()}
          {currentPage === 'open-shifts' && renderOpenShiftsPage()}
          {currentPage === 'availability' && renderAvailabilityPage()}
          {currentPage === 'time-off' && renderTimeOffPage()}
          {currentPage === 'miss-report' && <ShiftMissReport userId={user?.id} onClose={() => setCurrentPage('home')} />}
          {currentPage === 'incident-report' && <IncidentReportForm onClose={() => setCurrentPage('home')} />}
          {currentPage === 'settings' && renderSettingsPage()}
        </div>
      </div>

      <SandataNotice userId={user?.id} ctx={sandataCtx} companyPhone={company?.phone}
        onSetup={() => { setCurrentPage('home'); setShowSandataHelp(true); }} />

      {showNoteModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header"><h2>Visit Notes</h2><button className="close-btn" onClick={() => { setShowNoteModal(false); setNoteError(''); }}>×</button></div>
            <p className={noteError ? 'text-danger' : 'text-muted'} style={noteError ? { color: '#B91C1C', fontWeight: 600 } : undefined}>
              {noteError || 'Add notes (optional)'}
            </p>
            <div className="form-group">
              <textarea
                value={visitNote}
                onChange={(e) => { setVisitNote(e.target.value); if (noteError) setNoteError(''); }}
                placeholder="How did the visit go?"
                rows={4}
                style={noteError ? { borderColor: '#B91C1C' } : undefined}
              />
            </div>

            {/* Visit photos — proof of care; uploaded once the clock-out goes through */}
            <div className="form-group">
              <label style={{ display: 'block', fontWeight: 700, marginBottom: 6 }}>
                📷 Photos ({pendingPhotos.length}) <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#4B5563' }}>optional</span>
              </label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={(e) => { Array.from(e.target.files || []).forEach(f => handlePhotoFile(f, 'task')); e.target.value = ''; }}
                style={{ display: 'block', marginBottom: 8 }}
              />
              {pendingPhotos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6, marginBottom: 6 }}>
                  {pendingPhotos.map((p, i) => (
                    <div key={i} style={{ position: 'relative', border: '1px solid #E5E7EB', borderRadius: 6, overflow: 'hidden', background: '#000' }}>
                      <img src={p.dataUri} alt={p.caption || `Photo ${i + 1}`} style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                      <button type="button" onClick={() => setPendingPhotos(prev => prev.filter((_, idx) => idx !== i))}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(185,28,28,0.95)', color: '#fff', border: 'none', borderRadius: 4, width: 22, height: 22, cursor: 'pointer', fontSize: 14, lineHeight: '20px' }}
                        title="Remove">×</button>
                      <input type="text" value={p.caption} onChange={(e) => setPendingPhotos(prev => prev.map((x, idx) => idx === i ? { ...x, caption: e.target.value } : x))}
                        placeholder="Caption…"
                        style={{ width: '100%', border: 'none', borderTop: '1px solid #E5E7EB', padding: '3px 5px', fontSize: '0.7rem', background: '#fff', color: '#111827' }} />
                    </div>
                  ))}
                </div>
              )}
              {photoUploading && <div style={{ fontSize: '0.8rem', color: '#0E7490' }}>Uploading photos…</div>}
            </div>

            <div className="form-actions">
              <button className="btn btn-secondary" disabled={clockingOut} onClick={() => { setShowNoteModal(false); setNoteError(''); }}>Cancel</button>
              <button className="btn btn-primary" disabled={clockingOut} onClick={completeClockOut}
                style={clockingOut ? { opacity: 0.7, cursor: 'wait' } : undefined}>
                {clockingOut ? '⏳ Clocking out…' : 'Clock Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      <CaregiverClientModal clientId={viewingClientId} isOpen={!!viewingClientId} onClose={() => setViewingClientId(null)} />

      <SignaturePad
        open={!!signTarget}
        onClose={() => setSignTarget(null)}
        documentName={signTarget?.name || signTarget?.file_name}
        onSign={submitDocSignature}
      />
      {swapModal && (
        <div className="modal active" onClick={() => setSwapModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>🔄 Request Shift Swap</h2><button className="close-btn" onClick={() => setSwapModal(null)}>×</button></div>
            <p className="text-muted">
              {getClientName(swapModal.client_id)} on {swapModal.resolvedDate || (swapModal.date && swapModal.date.split('T')[0])} ({formatTime(swapModal.start_time)}–{formatTime(swapModal.end_time)})
            </p>
            <div className="form-group">
              <label>Ask coworker</label>
              <select value={swapForm.targetCaregiverId} onChange={(e) => setSwapForm({ ...swapForm, targetCaregiverId: e.target.value })}>
                <option value="">Pick a coworker…</option>
                {otherCaregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Reason (optional, but helps)</label>
              <textarea value={swapForm.reason} onChange={(e) => setSwapForm({ ...swapForm, reason: e.target.value })} placeholder="Doctor appointment, family emergency, etc." rows={3} />
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setSwapModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitSwapRequest}>Send Request</button>
            </div>
          </div>
        </div>
      )}

      {unavailModal && (
        <div className="modal active" onClick={() => !unavailSubmitting && setUnavailModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>🚫 Client Not Available</h2><button className="close-btn" onClick={() => setUnavailModal(null)}>×</button></div>
            <p className="text-muted">
              {getClientName(unavailModal.client_id)} on {unavailModal.resolvedDate || (unavailModal.date && unavailModal.date.split('T')[0])} ({formatTime(unavailModal.start_time)}–{formatTime(unavailModal.end_time)})
            </p>
            <p style={{ fontSize: '0.85rem', color: '#374151', margin: '0 0 0.75rem' }}>
              Use this when the <strong>client</strong> is the reason the visit didn't happen. The office is notified and the visit is not billed or paid.
              If <strong>you</strong> can't make a shift, use <em>Report Miss</em> instead so it can be covered.
            </p>
            <div className="form-group">
              <label>What happened? *</label>
              <select value={unavailForm.reason} onChange={(e) => setUnavailForm({ ...unavailForm, reason: e.target.value })}>
                <option value="">Pick a reason…</option>
                {CLIENT_UNAVAILABLE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Note {unavailForm.reason === 'other' ? '*' : '(optional)'}</label>
              <textarea value={unavailForm.note} onChange={(e) => setUnavailForm({ ...unavailForm, note: e.target.value })} placeholder="Who you spoke to, what they said, anything the office should know" rows={3} maxLength={500} />
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setUnavailModal(null)} disabled={unavailSubmitting}>Cancel</button>
              <button className="btn btn-primary" onClick={submitClientUnavailable} disabled={unavailSubmitting || !unavailForm.reason}>{unavailSubmitting ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {moveModal && (
        <div className="modal active" onClick={() => setMoveModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>🕐 Ask to Move This Shift</h2><button className="close-btn" onClick={() => setMoveModal(null)}>×</button></div>
            <p className="text-muted">
              {getClientName(moveModal.client_id)} — currently {moveModal.occurrenceDate} ({formatTime(moveModal.start_time)}–{formatTime(moveModal.end_time)})
            </p>
            <div className="form-group">
              <label>New day</label>
              <input type="date" value={moveForm.date} onChange={(e) => setMoveForm({ ...moveForm, date: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Start</label>
                <input type="time" value={moveForm.startTime} onChange={(e) => setMoveForm({ ...moveForm, startTime: e.target.value })} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>End</label>
                <input type="time" value={moveForm.endTime} onChange={(e) => setMoveForm({ ...moveForm, endTime: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Reason (helps the office decide)</label>
              <textarea value={moveForm.reason} onChange={(e) => setMoveForm({ ...moveForm, reason: e.target.value })} placeholder="Client asked for a later start, appointment conflict, etc." rows={3} />
            </div>
            <div style={{ fontSize: '0.82rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
              Work the shift at its current time until the office approves the move. Your pay and the client's billing follow the schedule, not the request.
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setMoveModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitMoveRequest}>Send Request</button>
            </div>
          </div>
        </div>
      )}

      {/* Messages Modal */}
      {showMessages && <CaregiverMessages onClose={() => { setShowMessages(false); setUnreadMessages(0); }} />}

      {/* Payday verification — can be put off, so it never blocks clocking in or out */}
      {pendingVerification && !showMessages && (
        <PaydayVerificationModal
          pending={pendingVerification}
          token={token}
          onResolved={() => setPendingVerification(null)}
          onLater={() => setPendingVerification(null)}
        />
      )}

      {/* Help Modal */}
      {showHelp && <CaregiverHelp onClose={() => setShowHelp(false)} />}

      {/* Shift Miss Report Modal */}
      {showMissReport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '1.5rem', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
            <ShiftMissReport userId={user.id} onClose={() => setShowMissReport(false)} />
          </div>
        </div>
      )}

      {/* ── Mobile Bottom Navigation ── */}
      {showMoreDrawer && <div className="mobile-more-drawer-overlay" onClick={() => setShowMoreDrawer(false)} />}

      <div className={`mobile-more-drawer ${showMoreDrawer ? 'open' : ''}`}>
        <div className="mobile-more-drawer-handle" />
        <div className="mobile-more-drawer-section">
          <div className="mobile-more-drawer-section-title">Self Service</div>
          {[
            { page: 'open-shifts',   icon: '📋', label: 'Open Shifts' },
            { page: 'availability',  icon: '⏰', label: 'Availability' },
            { page: 'miss-report',   icon: '🚨', label: 'Report Miss' },
            { page: 'incident-report', icon: '⚠️', label: 'Report Incident' },
            { page: 'time-off',      icon: '🏖️', label: 'Time Off' },
          ].map(({ page, icon, label }) => (
            <button
              key={page}
              className={`mobile-more-drawer-item ${currentPage === page ? 'active' : ''}`}
              onClick={() => { setCurrentPage(page); setShowMoreDrawer(false); }}
            >
              <span className="mobile-more-drawer-item-icon">{icon}</span>
              {label}
            </button>
          ))}
        </div>
        <div className="mobile-more-drawer-section">
          <div className="mobile-more-drawer-section-title">Account</div>
          <button
            className={`mobile-more-drawer-item ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={() => { setCurrentPage('settings'); setShowMoreDrawer(false); }}
          >
            <span className="mobile-more-drawer-item-icon">⚙️</span>
            Settings
          </button>
          <button
            className="mobile-more-drawer-item"
            onClick={onLogout}
            style={{ color: '#DC2626' }}
          >
            <span className="mobile-more-drawer-item-icon" style={{ background: '#FEE2E2' }}>⏻</span>
            Log Out
          </button>
        </div>
      </div>

      <nav className="mobile-bottom-nav">
        {[
          { page: 'home',     icon: '🏠', label: 'Home' },
          { page: 'schedule', icon: '📅', label: 'Schedule' },
          { page: 'clients',  icon: '👥', label: 'Clients' },
          { page: 'history',  icon: '📜', label: 'History' },
        ].map(({ page, icon, label }) => (
          <button
            key={page}
            className={`mobile-bottom-nav-item ${currentPage === page ? 'active' : ''}`}
            onClick={() => { setCurrentPage(page); setShowMoreDrawer(false); }}
          >
            <span className="mobile-bottom-nav-icon">{icon}</span>
            {label}
          </button>
        ))}
        <button
          className={`mobile-bottom-nav-item ${showMoreDrawer ? 'active' : ''}`}
          onClick={() => setShowMoreDrawer(v => !v)}
        >
          <span className="mobile-bottom-nav-icon">⋯</span>
          More
        </button>
      </nav>
    </div>
  );
};

export default CaregiverDashboard;
