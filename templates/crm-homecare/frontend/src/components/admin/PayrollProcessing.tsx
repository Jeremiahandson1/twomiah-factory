import { toast } from '../Toast';
// src/components/admin/PayrollProcessing.jsx
// Complete payroll: Overtime, Mileage, PTO, Shift Differentials, Pay Stubs, Exports
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';

const PayrollProcessing = () => {
  const { token } = useAuth();
  const [payPeriod, setPayPeriod] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 14)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const [payrollData, setPayrollData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState(null);
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [showPayStubModal, setShowPayStubModal] = useState(false);
  const [showMileageModal, setShowMileageModal] = useState(false);
  const [showPTOModal, setShowPTOModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [caregivers, setCaregivers] = useState([]);
  const [activeTab, setActiveTab] = useState('shifts');
  const [discrepancies, setDiscrepancies] = useState(null);
  const [discrepancyLoading, setDiscrepancyLoading] = useState(false);

  // Shift review state
  const [shiftData, setShiftData] = useState({ shifts: [], stats: {} });
  const [shiftLoading, setShiftLoading] = useState(false);
  const [shiftFilter, setShiftFilter] = useState('all');
  const [caregiverFilter, setCaregiverFilter] = useState('all');
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagShift, setFlagShift] = useState(null);
  const [flagReason, setFlagReason] = useState('');
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveShift, setResolveShift] = useState(null);
  const [resolveForm, setResolveForm] = useState({
    status: 'manual_entry',
    payableMinutes: '',
    resolutionNotes: ''
  });
  
  // Payroll settings
  const [settings, setSettings] = useState({
    overtimeThreshold: 40,
    overtimeRate: 1.5,
    dailyOvertimeEnabled: false,
    dailyOvertimeThreshold: 8,
    weekendDifferential: 0,
    nightDifferential: 0,
    mileageRate: 0.67, // 2024 IRS rate
    federalTaxRate: 0.22,
    stateTaxRate: 0.0765, // WI rate
    socialSecurityRate: 0.062,
    medicareRate: 0.0145
  });

  // Mileage form
  const [mileageForm, setMileageForm] = useState({
    caregiverId: '',
    date: new Date().toISOString().split('T')[0],
    miles: '',
    fromLocation: '',
    toLocation: '',
    notes: ''
  });

  // PTO form
  const [ptoForm, setPtoForm] = useState({
    caregiverId: '',
    type: 'vacation',
    startDate: '',
    endDate: '',
    hours: '',
    notes: ''
  });

  useEffect(() => {
    loadCaregivers();
    calculatePayroll();
  }, []);

  const loadCaregivers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/caregivers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setCaregivers(Array.isArray(data) ? data : (data.caregivers || []));
    } catch (error) {
      console.error('Failed to load caregivers:', error);
    }
  };

  // ==================== SHIFT REVIEW ====================

  const generateShifts = async () => {
    setShiftLoading(true);
    setMessage('');
    try {
      const genResponse = await fetch(`${API_BASE_URL}/api/payroll-shift-reviews/generate-shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ startDate: payPeriod.startDate, endDate: payPeriod.endDate })
      });
      if (!genResponse.ok) throw new Error('Failed to generate shifts');
      const genResult = await genResponse.json();
      await loadShifts();
      setMessage(`Generated ${genResult.generated} shifts (${genResult.matched} matched, ${genResult.missingPunch} missing punch)`);
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      setMessage('Error: ' + error.message);
      console.error('Generate shifts error:', error);
    } finally {
      setShiftLoading(false);
    }
  };

  const loadShifts = async () => {
    try {
      const params = new URLSearchParams({ startDate: payPeriod.startDate, endDate: payPeriod.endDate });
      const r = await fetch(`${API_BASE_URL}/api/payroll-shift-reviews/shifts?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (r.ok) setShiftData(await r.json());
    } catch (e) {
      console.error('Load shifts error:', e);
    }
  };

  const handleShiftAction = async (shiftId, status, extras = {}) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/payroll-shift-reviews/shifts/${shiftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status, ...extras })
      });
      if (!r.ok) throw new Error('Failed to update shift');
      await loadShifts();
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const handleBulkApproveShifts = async (mode) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/payroll-shift-reviews/shifts/approve-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ startDate: payPeriod.startDate, endDate: payPeriod.endDate, mode })
      });
      if (!r.ok) throw new Error('Failed to bulk approve');
      const result = await r.json();
      await loadShifts();
      const msg = mode === 'all'
        ? `Approved ${result.approvedCount || 0} shifts`
        : `Approved ${result.approvedCount || 0} clocked shifts`;
      setMessage(msg);
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const openFlagModal = (shift) => {
    setFlagShift(shift);
    setFlagReason('');
    setShowFlagModal(true);
  };

  const handleFlagShift = async (e) => {
    e.preventDefault();
    await handleShiftAction(flagShift.id, 'flagged', { flagReason });
    setShowFlagModal(false);
    setFlagShift(null);
  };

  const openResolveModal = (shift) => {
    setResolveShift(shift);
    setResolveForm({
      status: 'manual_entry',
      payableMinutes: shift.scheduled_minutes || '',
      resolutionNotes: ''
    });
    setShowResolveModal(true);
  };

  const handleResolveShift = async (e) => {
    e.preventDefault();
    await handleShiftAction(resolveShift.id, resolveForm.status, {
      payableMinutes: resolveForm.status === 'excused' ? 0 : parseInt(resolveForm.payableMinutes) || 0,
      resolutionNotes: resolveForm.resolutionNotes
    });
    setShowResolveModal(false);
    setResolveShift(null);
  };

  const calculatePayroll = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          startDate: payPeriod.startDate,
          endDate: payPeriod.endDate,
          settings
        })
      });
      const data = await response.json();
      
      // Enhance payroll data with calculations
      const enhanced = (data.payrollData || []).map(p => {
        const regularHours = Math.min(p.total_hours || 0, settings.overtimeThreshold);
        const overtimeHours = Math.max((p.total_hours || 0) - settings.overtimeThreshold, 0);
        const hourlyRate = parseFloat(p.hourly_rate || 15);
        
        const regularPay = regularHours * hourlyRate;
        const overtimePay = overtimeHours * hourlyRate * settings.overtimeRate;
        const mileageReimbursement = parseFloat(p.total_miles || 0) * settings.mileageRate;
        const weekendPay = parseFloat(p.weekend_hours || 0) * settings.weekendDifferential;
        const nightPay = parseFloat(p.night_hours || 0) * settings.nightDifferential;
        const ptoPay = parseFloat(p.pto_hours || 0) * hourlyRate;
        
        const grossPay = regularPay + overtimePay + mileageReimbursement + weekendPay + nightPay + ptoPay;
        
        const federalTax = grossPay * settings.federalTaxRate;
        const stateTax = grossPay * settings.stateTaxRate;
        const socialSecurity = grossPay * settings.socialSecurityRate;
        const medicare = grossPay * settings.medicareRate;
        const totalDeductions = federalTax + stateTax + socialSecurity + medicare;
        
        const netPay = grossPay - totalDeductions + mileageReimbursement; // Mileage is reimbursement, not taxed
        
        return {
          ...p,
          regular_hours: regularHours,
          overtime_hours: overtimeHours,
          regular_pay: regularPay,
          overtime_pay: overtimePay,
          mileage_reimbursement: mileageReimbursement,
          weekend_pay: weekendPay,
          night_pay: nightPay,
          pto_pay: ptoPay,
          gross_pay: grossPay,
          federal_tax: federalTax,
          state_tax: stateTax,
          social_security: socialSecurity,
          medicare: medicare,
          total_deductions: totalDeductions,
          net_pay: netPay,
          status: p.status || 'draft'
        };
      });
      
      setPayrollData(enhanced);
    } catch (error) {
      setMessage('Error: Failed to calculate payroll');
      console.error('Failed to calculate payroll:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprovePayroll = async (caregiverId) => {
    try {
      await fetch(`${API_BASE_URL}/api/payroll/${caregiverId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setPayrollData(payrollData.map(p => p.caregiver_id === caregiverId ? { ...p, status: 'approved' } : p));
      setMessage('✓ Payroll approved');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleApproveAll = async () => {
    const drafts = payrollData.filter(p => p.status === 'draft');
    for (const p of drafts) {
      await handleApprovePayroll(p.caregiver_id);
    }
    setMessage(`✓ Approved ${drafts.length} payroll records`);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleProcessPaycheck = async (caregiverId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/${caregiverId}/process`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      setPayrollData(payrollData.map(p => p.caregiver_id === caregiverId ? { ...p, status: 'processed', check_number: result.checkNumber } : p));
      setMessage(`✓ Check #${result.checkNumber} processed`);
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleAddMileage = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_BASE_URL}/api/mileage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(mileageForm)
      });
      setMileageForm({ caregiverId: '', date: new Date().toISOString().split('T')[0], miles: '', fromLocation: '', toLocation: '', notes: '' });
      setShowMileageModal(false);
      setMessage('✓ Mileage recorded');
      setTimeout(() => setMessage(''), 2000);
      calculatePayroll();
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const handleAddPTO = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_BASE_URL}/api/pto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(ptoForm)
      });
      setPtoForm({ caregiverId: '', type: 'vacation', startDate: '', endDate: '', hours: '', notes: '' });
      setShowPTOModal(false);
      setMessage('✓ PTO recorded');
      setTimeout(() => setMessage(''), 2000);
      calculatePayroll();
    } catch (error) {
      toast('Failed: ' + error.message, 'error');
    }
  };

  const handleExportPayroll = async (format) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ startDate: payPeriod.startDate, endDate: payPeriod.endDate, format })
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-${payPeriod.startDate}-to-${payPeriod.endDate}.${format}`;
      a.click();
    } catch (error) {
      toast('Failed to export: ' + error.message, 'error');
    }
  };

  const handleExportQuickBooks = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/export/quickbooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ startDate: payPeriod.startDate, endDate: payPeriod.endDate, payrollData })
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quickbooks-payroll-${payPeriod.startDate}.iif`;
      a.click();
      setMessage('✓ QuickBooks export downloaded');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      toast('Failed to export: ' + error.message, 'error');
    }
  };

  const generatePayStub = (payroll) => {
    setSelectedPayroll(payroll);
    setShowPayStubModal(true);
  };

  const printPayStub = () => {
    window.print();
  };

  // Shift computed values
  const shiftCaregivers = [...new Map(
    shiftData.shifts.map(s => [s.caregiver_id, { id: s.caregiver_id, name: `${s.caregiver_first} ${s.caregiver_last}` }])
  ).values()].sort((a, b) => a.name.localeCompare(b.name));

  const filteredShifts = shiftData.shifts.filter(s => {
    if (shiftFilter !== 'all' && s.status !== shiftFilter) return false;
    if (caregiverFilter !== 'all' && s.caregiver_id !== caregiverFilter) return false;
    return true;
  });

  const shiftStatusConfig = {
    pending:       { bg: '#F3F4F6', color: '#374151', label: 'Pending' },
    verified:      { bg: '#DBEAFE', color: '#1E40AF', label: 'Verified' },
    approved:      { bg: '#D1FAE5', color: '#065F46', label: 'Approved' },
    flagged:       { bg: '#FEE2E2', color: '#991B1B', label: 'Flagged' },
    missing_punch: { bg: '#FFEDD5', color: '#9A3412', label: 'Missing Punch' },
    excused:       { bg: '#FEF9C3', color: '#854D0E', label: 'Excused' },
    manual_entry:  { bg: '#EDE9FE', color: '#6B21A8', label: 'Manual Entry' }
  };

  const formatTime = (time) => time ? time.substring(0, 5) : '--:--';
  const formatMinutes = (min) => min != null ? `${(min / 60).toFixed(1)}h` : '--';

  const filteredPayroll = payrollData.filter(p => filter === 'all' || p.status === filter);

  const totals = {
    totalHours: payrollData.reduce((sum, p) => sum + (p.total_hours || 0), 0),
    totalOvertimeHours: payrollData.reduce((sum, p) => sum + (p.overtime_hours || 0), 0),
    totalMiles: payrollData.reduce((sum, p) => sum + parseFloat(p.total_miles || 0), 0),
    totalGrossPay: payrollData.reduce((sum, p) => sum + (p.gross_pay || 0), 0),
    totalDeductions: payrollData.reduce((sum, p) => sum + (p.total_deductions || 0), 0),
    totalNetPay: payrollData.reduce((sum, p) => sum + (p.net_pay || 0), 0),
    totalMileageReimbursement: payrollData.reduce((sum, p) => sum + (p.mileage_reimbursement || 0), 0)
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'draft': return 'badge-secondary';
      case 'approved': return 'badge-warning';
      case 'processed': return 'badge-info';
      case 'paid': return 'badge-success';
      default: return 'badge-secondary';
    }
  };

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);

  const loadDiscrepancies = async () => {
    setDiscrepancyLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/payroll/discrepancies?startDate=${payPeriod.startDate}&endDate=${payPeriod.endDate}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (r.ok) setDiscrepancies(await r.json());
    } catch(e) {}
    setDiscrepancyLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <h2>💰 Payroll Processing</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setShowMileageModal(true)}>🚗 Add Mileage</button>
          <button className="btn btn-primary" onClick={() => setShowPTOModal(true)}>🏖️ Add PTO</button>
          <button className="btn btn-secondary" onClick={() => setShowSettingsModal(true)}>⚙️ Settings</button>
          <button className="btn btn-secondary" onClick={() => handleExportPayroll('csv')}>📥 CSV</button>
          <button className="btn btn-secondary" onClick={handleExportQuickBooks}>📤 QuickBooks</button>
        </div>
      </div>

      {message && <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>{message}</div>}

      {/* Tab selector */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #E5E7EB', marginBottom: '1.25rem' }}>
        {[['shifts','📋 Shift Reviews'],['payroll','💰 Payroll'],['discrepancies','⚠️ Hour Discrepancies']].map(([id,label]) => (
          <button key={id} onClick={() => { setActiveTab(id); if(id==='discrepancies') loadDiscrepancies(); }}
            style={{ padding:'0.55rem 1.25rem', border:'none', background:'none', cursor:'pointer',
              fontWeight: activeTab===id ? 800 : 500, fontSize:'0.875rem',
              color: activeTab===id ? '{{PRIMARY_COLOR}}' : '#6B7280',
              borderBottom: `2px solid ${activeTab===id ? '{{PRIMARY_COLOR}}' : 'transparent'}`,
              marginBottom: -2 }}>
            {label}
            {id === 'shifts' && (shiftData.stats.pending || 0) + (shiftData.stats.flagged || 0) + (shiftData.stats.missing_punch || 0) > 0 && (
              <span style={{ marginLeft: 6, background: '#EF4444', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: '0.7rem', fontWeight: 700 }}>
                {(shiftData.stats.pending || 0) + (shiftData.stats.flagged || 0) + (shiftData.stats.missing_punch || 0)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ==================== SHIFT REVIEWS TAB ==================== */}
      {activeTab === 'shifts' && (
        <div>
          {/* Date pickers & Generate button */}
          <div className="card">
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Pay Period Start</label>
                <input type="date" value={payPeriod.startDate} onChange={(e) => setPayPeriod({ ...payPeriod, startDate: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Pay Period End</label>
                <input type="date" value={payPeriod.endDate} onChange={(e) => setPayPeriod({ ...payPeriod, endDate: e.target.value })} />
              </div>
              <button className="btn btn-primary" onClick={generateShifts} disabled={shiftLoading}>
                {shiftLoading ? 'Generating...' : 'Generate Shifts'}
              </button>
            </div>
          </div>

          {/* Shift Stats */}
          {shiftData.shifts.length > 0 && (
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {[
                { label: 'Total Shifts', val: shiftData.stats.total || 0, color: '#6366F1' },
                { label: 'Pending', val: shiftData.stats.pending || 0, color: '#6B7280' },
                { label: 'Verified', val: shiftData.stats.verified || 0, color: '#1E40AF' },
                { label: 'Approved', val: shiftData.stats.approved || 0, color: '#10B981' },
                { label: 'Flagged', val: shiftData.stats.flagged || 0, color: '#DC2626' },
                { label: 'Missing Punch', val: shiftData.stats.missing_punch || 0, color: '#EA580C' },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, minWidth: 120, padding: '0.75rem 1rem', background: '#F9FAFB', borderRadius: 12, borderLeft: `4px solid ${s.color}` }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: '0.7rem', color: '#6B7280', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Shift Filters & Bulk Actions */}
          {shiftData.shifts.length > 0 && (
            <div className="card" style={{ padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  {[
                    ['all', 'All'],
                    ['pending', 'Pending'],
                    ['verified', 'Verified'],
                    ['approved', 'Approved'],
                    ['flagged', 'Flagged'],
                    ['missing_punch', 'Missing Punch'],
                    ['excused', 'Excused'],
                    ['manual_entry', 'Manual'],
                  ].map(([val, label]) => (
                    <button key={val}
                      className={`filter-tab ${shiftFilter === val ? 'active' : ''}`}
                      onClick={() => setShiftFilter(val)}
                      style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                      {label}
                    </button>
                  ))}
                </div>
                <select value={caregiverFilter} onChange={e => setCaregiverFilter(e.target.value)}
                  style={{ padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: '0.82rem' }}>
                  <option value="all">All Caregivers</option>
                  {shiftCaregivers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="btn btn-sm btn-success" onClick={() => handleBulkApproveShifts('clocked')}
                  disabled={!shiftData.shifts.some(s => ['verified', 'pending'].includes(s.status) && s.time_entry_id)}>
                  Approve Clocked
                </button>
                <button className="btn btn-sm btn-warning" onClick={() => handleBulkApproveShifts('all')}
                  disabled={!shiftData.shifts.some(s => ['verified', 'pending', 'missing_punch'].includes(s.status))}>
                  Approve All
                </button>
              </div>
            </div>
          )}

          {/* Shift Table */}
          {shiftData.shifts.length === 0 ? (
            <div className="card card-centered">
              <p>No shift data. Select a pay period and click "Generate Shifts" to match schedules against clock-ins.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>Caregiver</th>
                    <th>Client</th>
                    <th>Date</th>
                    <th>Sched Start</th>
                    <th>Sched End</th>
                    <th>Actual Start</th>
                    <th>Actual End</th>
                    <th>Sched Min</th>
                    <th>Actual Min</th>
                    <th>Payable</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredShifts.map(shift => {
                    const sc = shiftStatusConfig[shift.status] || shiftStatusConfig.pending;
                    return (
                      <tr key={shift.id} style={{
                        background: shift.status === 'missing_punch' ? '#FFF5F5'
                          : shift.status === 'flagged' ? '#FFF5F5'
                          : shift.status === 'approved' || shift.status === 'verified' ? '#F0FDF4'
                          : undefined
                      }}>
                        <td style={{ fontWeight: 600 }}>{shift.caregiver_first} {shift.caregiver_last}</td>
                        <td>{shift.client_first} {shift.client_last}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {new Date(String(shift.shift_date).split('T')[0] + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </td>
                        <td>{shift.scheduled_start ? formatTime(shift.scheduled_start) : '--'}</td>
                        <td>{shift.scheduled_end ? formatTime(shift.scheduled_end) : '--'}</td>
                        <td>
                          {shift.actual_start
                            ? new Date(shift.actual_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                            : <span style={{ color: '#EF4444' }}>--</span>}
                        </td>
                        <td>
                          {shift.actual_end
                            ? new Date(shift.actual_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                            : <span style={{ color: '#EF4444' }}>--</span>}
                        </td>
                        <td>{shift.scheduled_minutes != null ? formatMinutes(shift.scheduled_minutes) : '--'}</td>
                        <td>{shift.actual_minutes != null ? formatMinutes(shift.actual_minutes) : '--'}</td>
                        <td style={{ fontWeight: 700, color: '{{PRIMARY_COLOR}}' }}>
                          {shift.payable_minutes != null ? formatMinutes(shift.payable_minutes) : '--'}
                        </td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: '0.73rem', fontWeight: 700, background: sc.bg, color: sc.color, whiteSpace: 'nowrap' }}>
                            {sc.label}
                          </span>
                          {shift.flag_reason && (
                            <div style={{ fontSize: '0.68rem', color: '#6B7280', marginTop: 2, maxWidth: 140 }} title={shift.flag_reason}>
                              {shift.flag_reason.substring(0, 30)}{shift.flag_reason.length > 30 ? '...' : ''}
                            </div>
                          )}
                          {shift.resolution_notes && (
                            <div style={{ fontSize: '0.68rem', color: '#6B7280', marginTop: 2, maxWidth: 140 }} title={shift.resolution_notes}>
                              {shift.resolution_notes.substring(0, 30)}{shift.resolution_notes.length > 30 ? '...' : ''}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                            {['pending', 'verified'].includes(shift.status) && (
                              <button className="btn btn-sm btn-success" onClick={() => handleShiftAction(shift.id, 'approved')}>Approve</button>
                            )}
                            {['pending', 'verified'].includes(shift.status) && (
                              <button className="btn btn-sm btn-secondary" onClick={() => openFlagModal(shift)} style={{ fontSize: '0.7rem' }}>Flag</button>
                            )}
                            {shift.status === 'flagged' && (
                              <>
                                <button className="btn btn-sm btn-success" onClick={() => handleShiftAction(shift.id, 'approved')}>Approve</button>
                                <button className="btn btn-sm btn-warning" onClick={() => openResolveModal(shift)}>Resolve</button>
                              </>
                            )}
                            {shift.status === 'missing_punch' && (
                              <button className="btn btn-sm btn-warning" onClick={() => openResolveModal(shift)}>Resolve</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Discrepancies Tab */}
      {activeTab === 'discrepancies' && (
        <div>
          <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:12, padding:'1rem 1.25rem', marginBottom:'1rem', fontSize:'0.875rem', color:'#92400E' }}>
            <strong>📋 How payroll hours work:</strong> Caregivers are paid for <strong>allotted hours only</strong> — the hours authorized per client per shift. 
            If a caregiver clocks in late, their shift end adjusts forward by the late amount so they still get their full allotted time. 
            If they work over their allotted hours, only the allotted hours are billable. Discrepancies of 5+ minutes are flagged here.
          </div>
          <div style={{ display:'flex', gap:'0.75rem', marginBottom:'1rem', flexWrap:'wrap', alignItems:'flex-end' }}>
            <div>
              <label style={{ display:'block', fontWeight:700, fontSize:'0.75rem', color:'#6B7280', marginBottom:4 }}>FROM</label>
              <input type="date" value={payPeriod.startDate} onChange={e=>setPayPeriod(p=>({...p,startDate:e.target.value}))}
                style={{ padding:'0.5rem', border:'1px solid #D1D5DB', borderRadius:8, fontSize:'0.875rem' }}/>
            </div>
            <div>
              <label style={{ display:'block', fontWeight:700, fontSize:'0.75rem', color:'#6B7280', marginBottom:4 }}>TO</label>
              <input type="date" value={payPeriod.endDate} onChange={e=>setPayPeriod(p=>({...p,endDate:e.target.value}))}
                style={{ padding:'0.5rem', border:'1px solid #D1D5DB', borderRadius:8, fontSize:'0.875rem' }}/>
            </div>
            <button onClick={loadDiscrepancies} style={{ padding:'0.55rem 1.25rem', background:'{{PRIMARY_COLOR}}', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontWeight:700 }}>
              {discrepancyLoading ? 'Loading...' : 'Run Report'}
            </button>
          </div>

          {discrepancies && (
            <>
              {/* Summary */}
              <div style={{ display:'flex', gap:'0.75rem', marginBottom:'1rem', flexWrap:'wrap' }}>
                {[
                  { label:'Shifts with Discrepancies', val: discrepancies.totals.totalShifts, color:'#6366F1' },
                  { label:'Over Allotted', val: discrepancies.totals.overageCount + ' shifts', color:'#EF4444' },
                  { label:'Under Allotted', val: discrepancies.totals.underageCount + ' shifts', color:'#F59E0B' },
                  { label:'Total Overage Cost', val: '$' + parseFloat(discrepancies.totals.totalOverageCost||0).toFixed(2), color:'#DC2626' },
                ].map(s => (
                  <div key={s.label} style={{ flex:1, minWidth:140, padding:'1rem', background:'#F9FAFB', borderRadius:12, borderLeft:`4px solid ${s.color}` }}>
                    <div style={{ fontSize:'1.25rem', fontWeight:800, color:s.color }}>{s.val}</div>
                    <div style={{ fontSize:'0.72rem', color:'#6B7280', marginTop:2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Table */}
              {discrepancies.discrepancies.length === 0 ? (
                <div style={{ textAlign:'center', padding:'2rem', color:'#9CA3AF', background:'#F9FAFB', borderRadius:12 }}>
                  ✅ No significant discrepancies found in this period
                </div>
              ) : (
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                    <thead>
                      <tr style={{ background:'#F9FAFB' }}>
                        {['Caregiver','Client','Date','Allotted','Actual','Billable','Discrepancy','Allotted Pay','Actual Cost','Overage $'].map(h => (
                          <th key={h} style={{ padding:'0.5rem 0.75rem', textAlign:'left', fontWeight:700, color:'#374151', borderBottom:'1px solid #E5E7EB', whiteSpace:'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {discrepancies.discrepancies.map(d => {
                        const over = parseFloat(d.discrepancy_hours) > 0;
                        const under = parseFloat(d.discrepancy_hours) < 0;
                        return (
                          <tr key={d.id} style={{ borderBottom:'1px solid #F3F4F6', background: over ? '#FFF5F5' : under ? '#FFFBEB' : '#fff' }}>
                            <td style={{ padding:'0.5rem 0.75rem', fontWeight:600 }}>{d.caregiver_first} {d.caregiver_last}</td>
                            <td style={{ padding:'0.5rem 0.75rem' }}>{d.client_first} {d.client_last}</td>
                            <td style={{ padding:'0.5rem 0.75rem', color:'#6B7280' }}>{new Date(d.start_time).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</td>
                            <td style={{ padding:'0.5rem 0.75rem' }}>{d.allotted_hours}h</td>
                            <td style={{ padding:'0.5rem 0.75rem' }}>{d.actual_hours}h</td>
                            <td style={{ padding:'0.5rem 0.75rem', fontWeight:700, color:'{{PRIMARY_COLOR}}' }}>{d.billable_hours}h</td>
                            <td style={{ padding:'0.5rem 0.75rem', fontWeight:700, color: over?'#DC2626':under?'#F59E0B':'#374151' }}>
                              {over ? '+' : ''}{d.discrepancy_hours}h {over ? '⚠️ Over' : under ? '⬇️ Short' : ''}
                            </td>
                            <td style={{ padding:'0.5rem 0.75rem', color:'#065F46' }}>${d.billable_pay}</td>
                            <td style={{ padding:'0.5rem 0.75rem', color:'#6B7280' }}>${d.actual_pay}</td>
                            <td style={{ padding:'0.5rem 0.75rem', fontWeight:700, color: over?'#DC2626':'#9CA3AF' }}>
                              {over ? `$${d.overage_cost}` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'payroll' && (
      <div>
      {/* Summary Cards */}
      <div className="grid">
        <div className="stat-card">
          <h3>Total Hours</h3>
          <div className="value">{totals.totalHours.toFixed(2)}</div>
          <div className="stat-subtext">{totals.totalOvertimeHours.toFixed(2)} overtime</div>
        </div>
        <div className="stat-card">
          <h3>Gross Pay</h3>
          <div className="value">{formatCurrency(totals.totalGrossPay)}</div>
        </div>
        <div className="stat-card">
          <h3>Deductions</h3>
          <div className="value" style={{ color: '#dc3545' }}>{formatCurrency(totals.totalDeductions)}</div>
        </div>
        <div className="stat-card">
          <h3>Net Pay</h3>
          <div className="value" style={{ color: '#28a745' }}>{formatCurrency(totals.totalNetPay)}</div>
        </div>
        <div className="stat-card">
          <h3>Mileage</h3>
          <div className="value">{totals.totalMiles.toFixed(2)} mi</div>
          <div className="stat-subtext">{formatCurrency(totals.totalMileageReimbursement)} reimbursement</div>
        </div>
      </div>

      {/* Pay Period Selection */}
      <div className="card">
        <h3>Pay Period</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Start Date</label>
            <input type="date" value={payPeriod.startDate} onChange={(e) => setPayPeriod({ ...payPeriod, startDate: e.target.value })} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>End Date</label>
            <input type="date" value={payPeriod.endDate} onChange={(e) => setPayPeriod({ ...payPeriod, endDate: e.target.value })} />
          </div>
          <button className="btn btn-primary" onClick={calculatePayroll} disabled={loading}>{loading ? 'Calculating...' : 'Calculate'}</button>
          <button className="btn btn-success" onClick={handleApproveAll} disabled={!payrollData.some(p => p.status === 'draft')}>Approve All</button>
        </div>
      </div>

      {/* Status Filters */}
      <div className="card">
        <div className="filter-tabs">
          {['all', 'draft', 'approved', 'processed', 'paid'].map(f => (
            <button key={f} className={`filter-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="filter-count">({payrollData.filter(p => f === 'all' || p.status === f).length})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Payroll Table */}
      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : filteredPayroll.length === 0 ? (
        <div className="card card-centered"><p>No payroll data for this period.</p></div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Caregiver</th>
              <th>Regular</th>
              <th>OT</th>
              <th>PTO</th>
              <th>Miles</th>
              <th>Rate</th>
              <th>Gross</th>
              <th>Deduct</th>
              <th>Net</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredPayroll.map(payroll => (
              <tr key={payroll.caregiver_id}>
                <td><strong>{payroll.first_name} {payroll.last_name}</strong></td>
                <td>{payroll.regular_hours?.toFixed(2)}</td>
                <td style={{ color: payroll.overtime_hours > 0 ? '#fd7e14' : undefined }}>{payroll.overtime_hours?.toFixed(2)}</td>
                <td>{payroll.pto_hours?.toFixed(2) || '0.0'}</td>
                <td>{parseFloat(payroll.total_miles || 0).toFixed(2)}</td>
                <td>${payroll.hourly_rate?.toFixed(2)}</td>
                <td style={{ color: '#28a745' }}>{formatCurrency(payroll.gross_pay)}</td>
                <td style={{ color: '#dc3545' }}>{formatCurrency(payroll.total_deductions)}</td>
                <td><strong style={{ color: '#2196f3' }}>{formatCurrency(payroll.net_pay)}</strong></td>
                <td><span className={`badge ${getStatusBadge(payroll.status)}`}>{payroll.status?.toUpperCase()}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                    <button className="btn btn-sm btn-primary" onClick={() => generatePayStub(payroll)}>Stub</button>
                    {payroll.status === 'draft' && <button className="btn btn-sm btn-warning" onClick={() => handleApprovePayroll(payroll.caregiver_id)}>Approve</button>}
                    {payroll.status === 'approved' && <button className="btn btn-sm btn-success" onClick={() => handleProcessPaycheck(payroll.caregiver_id)}>Process</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Totals Summary */}
      {filteredPayroll.length > 0 && (
        <div className="card" style={{ marginTop: '1rem', background: '#f5f5f5' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
            <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Total Hours</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.3rem', fontWeight: 'bold' }}>{totals.totalHours.toFixed(2)}</p></div>
            <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Overtime</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.3rem', fontWeight: 'bold', color: '#fd7e14' }}>{totals.totalOvertimeHours.toFixed(2)}</p></div>
            <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Gross Pay</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.3rem', fontWeight: 'bold', color: '#28a745' }}>{formatCurrency(totals.totalGrossPay)}</p></div>
            <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Deductions</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.3rem', fontWeight: 'bold', color: '#dc3545' }}>{formatCurrency(totals.totalDeductions)}</p></div>
            <div><p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>Net Pay</p><p style={{ margin: '0.25rem 0 0', fontSize: '1.3rem', fontWeight: 'bold', color: '#2196f3' }}>{formatCurrency(totals.totalNetPay)}</p></div>
          </div>
        </div>
      )}

      {/* PAY STUB MODAL */}
      {showPayStubModal && selectedPayroll && (
        <div className="modal active">
          <div className="modal-content modal-large" id="pay-stub">
            <div className="modal-header">
              <h2>Pay Stub</h2>
              <button className="close-btn" onClick={() => setShowPayStubModal(false)}>×</button>
            </div>
            
            <div style={{ border: '2px solid #333', padding: '1.5rem', background: 'white' }}>
              {/* Company Header */}
              <div style={{ textAlign: 'center', marginBottom: '1.5rem', borderBottom: '2px solid #333', paddingBottom: '1rem' }}>
                <h2 style={{ margin: 0, color: 'var(--color-teal)' }}>{{COMPANY_NAME}}</h2>
                <p style={{ margin: '0.25rem 0 0', color: '#666' }}>Pay Statement</p>
              </div>

              {/* Employee & Pay Period Info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <p style={{ margin: 0 }}><strong>Employee:</strong> {selectedPayroll.first_name} {selectedPayroll.last_name}</p>
                  <p style={{ margin: '0.25rem 0 0' }}><strong>Employee ID:</strong> {selectedPayroll.caregiver_id}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0 }}><strong>Pay Period:</strong> {payPeriod.startDate} to {payPeriod.endDate}</p>
                  <p style={{ margin: '0.25rem 0 0' }}><strong>Pay Date:</strong> {new Date().toLocaleDateString()}</p>
                  {selectedPayroll.check_number && <p style={{ margin: '0.25rem 0 0' }}><strong>Check #:</strong> {selectedPayroll.check_number}</p>}
                </div>
              </div>

              {/* Earnings */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ borderBottom: '1px solid #333', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>Earnings</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f0f0f0' }}>
                      <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Description</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>Hours</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>Rate</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Regular Hours</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{selectedPayroll.regular_hours?.toFixed(2)}</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>${selectedPayroll.hourly_rate?.toFixed(2)}</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.regular_pay)}</td>
                    </tr>
                    {selectedPayroll.overtime_hours > 0 && (
                      <tr>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Overtime (1.5x)</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{selectedPayroll.overtime_hours?.toFixed(2)}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>${(selectedPayroll.hourly_rate * settings.overtimeRate).toFixed(2)}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.overtime_pay)}</td>
                      </tr>
                    )}
                    {selectedPayroll.pto_hours > 0 && (
                      <tr>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>PTO</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{selectedPayroll.pto_hours?.toFixed(2)}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>${selectedPayroll.hourly_rate?.toFixed(2)}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.pto_pay)}</td>
                      </tr>
                    )}
                    {selectedPayroll.mileage_reimbursement > 0 && (
                      <tr>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Mileage Reimbursement</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{parseFloat(selectedPayroll.total_miles || 0).toFixed(2)} mi</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>${settings.mileageRate}/mi</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.mileage_reimbursement)}</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                      <td colSpan="3" style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>Gross Pay</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.gross_pay)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Deductions */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ borderBottom: '1px solid #333', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>Deductions</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Federal Income Tax</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.federal_tax)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>State Income Tax (WI)</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.state_tax)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Social Security</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.social_security)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>Medicare</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>{formatCurrency(selectedPayroll.medicare)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd' }}>Total Deductions</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #ddd', color: '#dc3545' }}>{formatCurrency(selectedPayroll.total_deductions)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Net Pay */}
              <div style={{ background: '#e8f5e9', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
                <h3 style={{ margin: 0, color: '#666' }}>Net Pay</h3>
                <p style={{ margin: '0.5rem 0 0', fontSize: '2rem', fontWeight: 'bold', color: '#28a745' }}>{formatCurrency(selectedPayroll.net_pay)}</p>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={printPayStub}>🖨️ Print</button>
              <button className="btn btn-secondary" onClick={() => setShowPayStubModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* MILEAGE MODAL */}
      {showMileageModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>🚗 Add Mileage</h2>
              <button className="close-btn" onClick={() => setShowMileageModal(false)}>×</button>
            </div>
            <form onSubmit={handleAddMileage}>
              <div className="form-group">
                <label>Caregiver *</label>
                <select value={mileageForm.caregiverId} onChange={(e) => setMileageForm({ ...mileageForm, caregiverId: e.target.value })} required>
                  <option value="">Select caregiver...</option>
                  {caregivers.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label>Date *</label><input type="date" value={mileageForm.date} onChange={(e) => setMileageForm({ ...mileageForm, date: e.target.value })} required /></div>
                <div className="form-group"><label>Miles *</label><input type="number" step="0.1" min="0" value={mileageForm.miles} onChange={(e) => setMileageForm({ ...mileageForm, miles: e.target.value })} required /></div>
                <div className="form-group"><label>From</label><input type="text" value={mileageForm.fromLocation} onChange={(e) => setMileageForm({ ...mileageForm, fromLocation: e.target.value })} placeholder="Starting location" /></div>
                <div className="form-group"><label>To</label><input type="text" value={mileageForm.toLocation} onChange={(e) => setMileageForm({ ...mileageForm, toLocation: e.target.value })} placeholder="Destination" /></div>
              </div>
              <div className="form-group"><label>Notes</label><textarea value={mileageForm.notes} onChange={(e) => setMileageForm({ ...mileageForm, notes: e.target.value })} rows="2" /></div>
              <p className="text-muted">Current IRS rate: ${settings.mileageRate}/mile</p>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Add Mileage</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowMileageModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PTO MODAL */}
      {showPTOModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>🏖️ Add PTO / Time Off</h2>
              <button className="close-btn" onClick={() => setShowPTOModal(false)}>×</button>
            </div>
            <form onSubmit={handleAddPTO}>
              <div className="form-group">
                <label>Caregiver *</label>
                <select value={ptoForm.caregiverId} onChange={(e) => setPtoForm({ ...ptoForm, caregiverId: e.target.value })} required>
                  <option value="">Select caregiver...</option>
                  {caregivers.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Type *</label>
                <select value={ptoForm.type} onChange={(e) => setPtoForm({ ...ptoForm, type: e.target.value })}>
                  <option value="vacation">Vacation</option>
                  <option value="sick">Sick Leave</option>
                  <option value="personal">Personal Day</option>
                  <option value="bereavement">Bereavement</option>
                  <option value="jury_duty">Jury Duty</option>
                  <option value="unpaid">Unpaid Leave</option>
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label>Start Date *</label><input type="date" value={ptoForm.startDate} onChange={(e) => setPtoForm({ ...ptoForm, startDate: e.target.value })} required /></div>
                <div className="form-group"><label>End Date *</label><input type="date" value={ptoForm.endDate} onChange={(e) => setPtoForm({ ...ptoForm, endDate: e.target.value })} required /></div>
              </div>
              <div className="form-group"><label>Hours *</label><input type="number" step="0.5" min="0" value={ptoForm.hours} onChange={(e) => setPtoForm({ ...ptoForm, hours: e.target.value })} required /></div>
              <div className="form-group"><label>Notes</label><textarea value={ptoForm.notes} onChange={(e) => setPtoForm({ ...ptoForm, notes: e.target.value })} rows="2" /></div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Add PTO</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPTOModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>⚙️ Payroll Settings</h2>
              <button className="close-btn" onClick={() => setShowSettingsModal(false)}>×</button>
            </div>
            
            <div className="form-section">
              <h3>Overtime Rules</h3>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Weekly OT Threshold (hours)</label>
                  <input type="number" value={settings.overtimeThreshold} onChange={(e) => setSettings({ ...settings, overtimeThreshold: parseFloat(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>OT Rate Multiplier</label>
                  <input type="number" step="0.1" value={settings.overtimeRate} onChange={(e) => setSettings({ ...settings, overtimeRate: parseFloat(e.target.value) })} />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>Shift Differentials</h3>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Weekend Differential ($/hr)</label>
                  <input type="number" step="0.25" value={settings.weekendDifferential} onChange={(e) => setSettings({ ...settings, weekendDifferential: parseFloat(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Night Differential ($/hr)</label>
                  <input type="number" step="0.25" value={settings.nightDifferential} onChange={(e) => setSettings({ ...settings, nightDifferential: parseFloat(e.target.value) })} />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>Mileage</h3>
              <div className="form-group">
                <label>Mileage Rate ($/mile)</label>
                <input type="number" step="0.01" value={settings.mileageRate} onChange={(e) => setSettings({ ...settings, mileageRate: parseFloat(e.target.value) })} />
                <small className="text-muted">2024 IRS standard rate is $0.67/mile</small>
              </div>
            </div>

            <div className="form-section">
              <h3>Tax Rates</h3>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Federal Tax Rate (%)</label>
                  <input type="number" step="0.01" value={settings.federalTaxRate * 100} onChange={(e) => setSettings({ ...settings, federalTaxRate: parseFloat(e.target.value) / 100 })} />
                </div>
                <div className="form-group">
                  <label>State Tax Rate (%)</label>
                  <input type="number" step="0.01" value={settings.stateTaxRate * 100} onChange={(e) => setSettings({ ...settings, stateTaxRate: parseFloat(e.target.value) / 100 })} />
                </div>
                <div className="form-group">
                  <label>Social Security (%)</label>
                  <input type="number" step="0.01" value={settings.socialSecurityRate * 100} onChange={(e) => setSettings({ ...settings, socialSecurityRate: parseFloat(e.target.value) / 100 })} />
                </div>
                <div className="form-group">
                  <label>Medicare (%)</label>
                  <input type="number" step="0.01" value={settings.medicareRate * 100} onChange={(e) => setSettings({ ...settings, medicareRate: parseFloat(e.target.value) / 100 })} />
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => { setShowSettingsModal(false); calculatePayroll(); }}>Save & Recalculate</button>
              <button className="btn btn-secondary" onClick={() => setShowSettingsModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* FLAG SHIFT MODAL */}
      {showFlagModal && flagShift && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>🚩 Flag Shift</h2>
              <button className="close-btn" onClick={() => setShowFlagModal(false)}>×</button>
            </div>
            <form onSubmit={handleFlagShift}>
              <p style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: '#374151' }}>
                <strong>{flagShift.caregiver_first} {flagShift.caregiver_last}</strong> — {flagShift.client_first} {flagShift.client_last}
              </p>
              <div className="form-group">
                <label>Flag Reason *</label>
                <textarea value={flagReason} onChange={(e) => setFlagReason(e.target.value)} rows="3" required
                  placeholder="Describe the issue with this shift..." />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Flag Shift</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowFlagModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESOLVE SHIFT MODAL */}
      {showResolveModal && resolveShift && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>🔧 Resolve Shift</h2>
              <button className="close-btn" onClick={() => setShowResolveModal(false)}>×</button>
            </div>
            <form onSubmit={handleResolveShift}>
              <p style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: '#374151' }}>
                <strong>{resolveShift.caregiver_first} {resolveShift.caregiver_last}</strong> — {resolveShift.client_first} {resolveShift.client_last}
                <br />
                <span style={{ color: '#6B7280', fontSize: '0.8rem' }}>
                  Scheduled: {resolveShift.scheduled_minutes != null ? formatMinutes(resolveShift.scheduled_minutes) : 'N/A'}
                  {resolveShift.actual_minutes != null && ` | Actual: ${formatMinutes(resolveShift.actual_minutes)}`}
                </span>
              </p>
              <div className="form-group">
                <label>Resolution Status *</label>
                <select value={resolveForm.status} onChange={(e) => setResolveForm({ ...resolveForm, status: e.target.value })}>
                  <option value="manual_entry">Manual Entry</option>
                  <option value="approved">Approved</option>
                  <option value="excused">Excused (0 payable)</option>
                </select>
              </div>
              {resolveForm.status !== 'excused' && (
                <div className="form-group">
                  <label>Payable Minutes *</label>
                  <input type="number" min="0" value={resolveForm.payableMinutes}
                    onChange={(e) => setResolveForm({ ...resolveForm, payableMinutes: e.target.value })} required />
                </div>
              )}
              <div className="form-group">
                <label>Resolution Notes</label>
                <textarea value={resolveForm.resolutionNotes} onChange={(e) => setResolveForm({ ...resolveForm, resolutionNotes: e.target.value })}
                  rows="3" placeholder="Explain the resolution..." />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">Resolve</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowResolveModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
      )}
    </div>

  );
};

export default PayrollProcessing;
