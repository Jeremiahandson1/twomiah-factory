import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Server, CheckCircle, Lock, Eye, AlertTriangle, RefreshCw,
  Download, Calendar, ChevronDown, ChevronRight, Clock, Users, Trash2,
  Plus, Edit, FileText, Activity, Info,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

const TRUST_CRITERIA = [
  { id: 'security', label: 'Security', code: 'CC6', icon: ShieldCheck, color: 'emerald' },
  { id: 'availability', label: 'Availability', code: 'A1', icon: Server, color: 'blue' },
  { id: 'processing_integrity', label: 'Processing Integrity', code: 'CC7', icon: CheckCircle, color: 'violet' },
  { id: 'confidentiality', label: 'Confidentiality', code: 'CC9', icon: Lock, color: 'amber' },
  { id: 'privacy', label: 'Privacy', code: 'P1', icon: Eye, color: 'rose' },
];

const EXAMPLE_CONTROLS = [
  { id: 'mfa_adoption', name: 'MFA Adoption Rate', category: 'security', detailKey: 'mfaAdoption' },
  { id: 'password_policy', name: 'Password Policy', category: 'security', detailKey: 'passwordPolicy' },
  { id: 'password_age', name: 'Password Age Compliance', category: 'security', detailKey: 'passwordAge' },
  { id: 'session_timeout', name: 'Session Timeout', category: 'security', detailKey: 'sessionTimeout' },
  { id: 'security_monitoring', name: 'Security Event Monitoring', category: 'security', detailKey: 'securityMonitoring' },
  { id: 'data_retention', name: 'Data Retention', category: 'confidentiality', detailKey: 'dataRetention' },
  { id: 'access_review', name: 'Last Access Review', category: 'privacy', detailKey: 'accessReview' },
  { id: 'encryption_keys', name: 'Encryption Key Rotation', category: 'confidentiality', detailKey: 'encryptionKeys' },
  { id: 'backup_verification', name: 'Last Backup Verification', category: 'availability', detailKey: 'backupVerification' },
  { id: 'uptime', name: 'Uptime (30-day)', category: 'availability', detailKey: 'uptime' },
];

const RETENTION_ACTIONS = [
  { value: 'archive', label: 'Archive' },
  { value: 'delete', label: 'Delete' },
  { value: 'anonymize', label: 'Anonymize' },
];

const CHANGE_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'policy', label: 'Policy' },
  { value: 'configuration', label: 'Configuration' },
  { value: 'access', label: 'Access Control' },
  { value: 'infrastructure', label: 'Infrastructure' },
];

const RISK_LEVELS = [
  { value: '', label: 'All Risk Levels' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'retention', label: 'Data Retention' },
  { id: 'access-reviews', label: 'Access Reviews' },
  { id: 'changelog', label: 'Change Log' },
];

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBorderColor(score: number): string {
  if (score >= 80) return 'border-emerald-500/30';
  if (score >= 50) return 'border-amber-500/30';
  return 'border-red-500/30';
}

function statusBadge(status: string) {
  switch (status) {
    case 'pass': return <Badge variant="success" dot>Pass</Badge>;
    case 'warning': return <Badge variant="warning" dot>Warning</Badge>;
    case 'fail': return <Badge variant="danger" dot>Fail</Badge>;
    case 'not_configured': return <Badge variant="default">Not Configured</Badge>;
    default: return <Badge variant="default">{status}</Badge>;
  }
}

function riskBadge(level: string) {
  switch (level) {
    case 'high': return <Badge variant="danger">High</Badge>;
    case 'medium': return <Badge variant="warning">Medium</Badge>;
    case 'low': return <Badge variant="info">Low</Badge>;
    default: return <Badge variant="default">{level}</Badge>;
  }
}

const initialRetentionForm = {
  category: '',
  retentionDays: 365,
  action: 'archive',
  description: '',
};

export default function SOC2DashboardPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('overview');

  // Overview state
  const [overallScore, setOverallScore] = useState(0);
  const [criteriaScores, setCriteriaScores] = useState<Record<string, { score: number; lastChecked: string }>>({});
  const [controls, setControls] = useState<any[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({ security: true });
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');

  // Data Retention state
  const [retentionPolicies, setRetentionPolicies] = useState<any[]>([]);
  const [loadingRetention, setLoadingRetention] = useState(false);
  const [retentionModal, setRetentionModal] = useState(false);
  const [editingRetention, setEditingRetention] = useState<any>(null);
  const [retentionForm, setRetentionForm] = useState(initialRetentionForm);
  const [savingRetention, setSavingRetention] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [policyToPurge, setPolicyToPurge] = useState<any>(null);

  // Access Reviews state
  const [reviews, setReviews] = useState<any[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [activeReview, setActiveReview] = useState<any>(null);
  const [reviewUsers, setReviewUsers] = useState<any[]>([]);
  const [loadingReviewUsers, setLoadingReviewUsers] = useState(false);
  const [startingReview, setStartingReview] = useState(false);
  const [completingReview, setCompletingReview] = useState(false);

  // Change Log state
  const [changeLogs, setChangeLogs] = useState<any[]>([]);
  const [loadingChangeLogs, setLoadingChangeLogs] = useState(false);
  const [changeTypeFilter, setChangeTypeFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [changeLogPage, setChangeLogPage] = useState(1);

  // Load overview
  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const data = await api.get('/api/compliance-controls/dashboard');
      if (data) {
        setOverallScore(data.overallScore || 0);
        setCriteriaScores(data.criteriaScores || {});
        setControls(data.controls || EXAMPLE_CONTROLS.map(c => ({
          ...c,
          status: 'not_configured',
          details: 'Not yet assessed',
          lastChecked: null,
        })));
      }
    } catch {
      // Use example controls as placeholder
      setControls(EXAMPLE_CONTROLS.map(c => ({
        ...c,
        status: 'not_configured',
        details: 'Not yet assessed',
        lastChecked: null,
      })));
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // Load retention policies
  const loadRetention = useCallback(async () => {
    setLoadingRetention(true);
    try {
      const data = await api.get('/api/compliance-controls/retention');
      setRetentionPolicies(Array.isArray(data) ? data : data?.data || []);
    } catch {
      toast.error('Failed to load retention policies');
    } finally {
      setLoadingRetention(false);
    }
  }, []);

  // Load access reviews
  const loadReviews = useCallback(async () => {
    setLoadingReviews(true);
    try {
      const data = await api.get('/api/compliance-controls/access-reviews');
      setReviews(Array.isArray(data) ? data : data?.data || []);
    } catch {
      toast.error('Failed to load access reviews');
    } finally {
      setLoadingReviews(false);
    }
  }, []);

  // Load change logs
  const loadChangeLogs = useCallback(async () => {
    setLoadingChangeLogs(true);
    try {
      const params: any = { page: changeLogPage, limit: 50 };
      if (changeTypeFilter) params.type = changeTypeFilter;
      if (riskFilter) params.riskLevel = riskFilter;
      const data = await api.get('/api/compliance-controls/changelog', params);
      setChangeLogs(Array.isArray(data) ? data : data?.data || []);
    } catch {
      toast.error('Failed to load change log');
    } finally {
      setLoadingChangeLogs(false);
    }
  }, [changeLogPage, changeTypeFilter, riskFilter]);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
    if (tab === 'retention') loadRetention();
    if (tab === 'access-reviews') loadReviews();
    if (tab === 'changelog') loadChangeLogs();
  }, [tab, loadOverview, loadRetention, loadReviews, loadChangeLogs]);

  // Run assessment
  const runAssessment = async () => {
    setAssessing(true);
    try {
      const data = await api.post('/api/compliance-controls/dashboard/assess');
      toast.success('Assessment complete');
      if (data) {
        setOverallScore(data.overallScore || 0);
        setCriteriaScores(data.criteriaScores || {});
        setControls(data.controls || []);
      }
    } catch {
      toast.error('Failed to run assessment');
    } finally {
      setAssessing(false);
    }
  };

  // Export report
  const exportReport = async () => {
    try {
      const data = await api.get('/api/compliance-controls/dashboard/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `soc2-compliance-report-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Report exported');
    } catch {
      toast.error('Failed to export report');
    }
  };

  // Schedule review
  const scheduleReview = async () => {
    if (!scheduleDate) return;
    try {
      await api.post('/api/compliance-controls/dashboard/schedule', { date: scheduleDate });
      toast.success('Review scheduled for ' + scheduleDate);
      setScheduleDate('');
    } catch {
      toast.error('Failed to schedule review');
    }
  };

  // Retention CRUD
  const openRetentionModal = (policy?: any) => {
    if (policy) {
      setEditingRetention(policy);
      setRetentionForm({
        category: policy.category || '',
        retentionDays: policy.retentionDays || 365,
        action: policy.action || 'archive',
        description: policy.description || '',
      });
    } else {
      setEditingRetention(null);
      setRetentionForm(initialRetentionForm);
    }
    setRetentionModal(true);
  };

  const saveRetention = async () => {
    setSavingRetention(true);
    try {
      if (editingRetention) {
        await api.update('/api/compliance-controls/retention', editingRetention.id, retentionForm);
        toast.success('Retention policy updated');
      } else {
        await api.create('/api/compliance-controls/retention', retentionForm);
        toast.success('Retention policy created');
      }
      setRetentionModal(false);
      loadRetention();
    } catch {
      toast.error('Failed to save retention policy');
    } finally {
      setSavingRetention(false);
    }
  };

  const runPurge = async () => {
    if (!policyToPurge) return;
    try {
      await api.post(`/api/compliance-controls/retention/${policyToPurge.id}/purge`);
      toast.success('Purge completed');
      loadRetention();
    } catch {
      toast.error('Failed to run purge');
    }
  };

  // Access Reviews
  const startNewReview = async () => {
    setStartingReview(true);
    try {
      const data = await api.post('/api/compliance-controls/access-reviews');
      toast.success('Access review started');
      setReviews(prev => [data, ...prev]);
      openReview(data);
    } catch {
      toast.error('Failed to start review');
    } finally {
      setStartingReview(false);
    }
  };

  const openReview = async (review: any) => {
    setActiveReview(review);
    setLoadingReviewUsers(true);
    try {
      const data = await api.get(`/api/compliance-controls/access-reviews/${review.id}/users`);
      setReviewUsers(Array.isArray(data) ? data : data?.data || []);
    } catch {
      toast.error('Failed to load review users');
    } finally {
      setLoadingReviewUsers(false);
    }
  };

  const updateReviewUser = (userId: string, field: string, value: string) => {
    setReviewUsers(prev =>
      prev.map(u => u.id === userId || u.userId === userId ? { ...u, [field]: value } : u)
    );
  };

  const completeReview = async () => {
    if (!activeReview) return;
    setCompletingReview(true);
    try {
      await api.post(`/api/compliance-controls/access-reviews/${activeReview.id}/complete`, {
        users: reviewUsers.map(u => ({
          userId: u.userId || u.id,
          decision: u.decision || 'keep',
          notes: u.notes || '',
        })),
      });
      toast.success('Review completed');
      setActiveReview(null);
      loadReviews();
    } catch {
      toast.error('Failed to complete review');
    } finally {
      setCompletingReview(false);
    }
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const categorizedControls = TRUST_CRITERIA.map(tc => ({
    ...tc,
    controls: controls.filter(c => c.category === tc.id),
  }));

  // Radial progress component
  const RadialProgress = ({ score, size = 160 }: { score: number; size?: number }) => {
    const radius = (size - 16) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;
    const strokeColor = score >= 80 ? '#34d399' : score >= 50 ? '#fbbf24' : '#f87171';

    return (
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#334155"
            strokeWidth="8"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000"
          />
        </svg>
        <div className="absolute text-center">
          <span className={`text-4xl font-bold ${scoreColor(score)}`}>{score}</span>
          <span className="text-slate-500 text-sm block">%</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-400" />
          SOC 2 Compliance Dashboard
        </h1>
        <p className="text-slate-400">Monitor compliance status across Trust Service Criteria</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-800/50 rounded-lg w-fit">
        {tabs.map(t => (
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

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {loadingOverview ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Score + Criteria Cards */}
              <div className="grid lg:grid-cols-6 gap-6">
                <div className="lg:col-span-1 bg-slate-800 rounded-lg border border-slate-700 p-6 flex flex-col items-center justify-center">
                  <p className="text-xs text-slate-400 uppercase mb-3">Overall Score</p>
                  <RadialProgress score={overallScore} />
                </div>
                <div className="lg:col-span-5 grid grid-cols-5 gap-4">
                  {TRUST_CRITERIA.map(tc => {
                    const data = criteriaScores[tc.id] || { score: 0, lastChecked: null };
                    const Icon = tc.icon;
                    return (
                      <div
                        key={tc.id}
                        className={`bg-slate-800 rounded-lg border ${scoreBorderColor(data.score)} p-4 flex flex-col items-center text-center`}
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-2 ${
                          data.score >= 80 ? 'bg-emerald-500/10' : data.score >= 50 ? 'bg-amber-500/10' : 'bg-red-500/10'
                        }`}>
                          <Icon className={`w-5 h-5 ${scoreColor(data.score)}`} />
                        </div>
                        <p className="text-sm text-white font-medium">{tc.label}</p>
                        <p className="text-xs text-slate-500 mb-2">{tc.code}</p>
                        <p className={`text-2xl font-bold ${scoreColor(data.score)}`}>{data.score}%</p>
                        <p className="text-xs text-slate-500 mt-1">
                          {data.lastChecked ? new Date(data.lastChecked).toLocaleDateString() : 'Not checked'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Controls Detail */}
              <div className="bg-slate-800 rounded-lg border border-slate-700">
                <div className="px-6 py-4 border-b border-slate-700">
                  <h3 className="text-white font-medium">Controls Detail</h3>
                </div>
                <div className="divide-y divide-slate-700">
                  {categorizedControls.map(cat => {
                    const Icon = cat.icon;
                    const isExpanded = expandedCategories[cat.id];
                    return (
                      <div key={cat.id}>
                        <button
                          onClick={() => toggleCategory(cat.id)}
                          className="w-full px-6 py-3 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <Icon className="w-4 h-4 text-slate-400" />
                            <span className="text-white font-medium">{cat.label}</span>
                            <span className="text-sm text-slate-500">({cat.controls.length} controls)</span>
                          </div>
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        </button>
                        {isExpanded && cat.controls.length > 0 && (
                          <div className="px-6 pb-4 space-y-2">
                            {cat.controls.map(control => (
                              <div
                                key={control.id}
                                className="flex items-center justify-between px-4 py-3 bg-slate-900/50 rounded-lg border border-slate-700/50"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-white">{control.name}</p>
                                  <p className="text-xs text-slate-500 truncate">{control.details || 'Not assessed'}</p>
                                </div>
                                <div className="flex items-center gap-4 ml-4">
                                  {statusBadge(control.status)}
                                  <span className="text-xs text-slate-500 whitespace-nowrap">
                                    {control.lastChecked ? new Date(control.lastChecked).toLocaleDateString() : '—'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {isExpanded && cat.controls.length === 0 && (
                          <div className="px-6 pb-4">
                            <p className="text-sm text-slate-500 italic">No controls defined for this category</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
                <h3 className="text-white font-medium mb-4">Actions</h3>
                <div className="flex flex-wrap items-center gap-4">
                  <Button onClick={runAssessment} loading={assessing} icon={RefreshCw}>
                    Run Full Assessment
                  </Button>
                  <Button variant="secondary" onClick={exportReport} icon={Download}>
                    Export Compliance Report
                  </Button>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                    <Button variant="secondary" onClick={scheduleReview} disabled={!scheduleDate} icon={Calendar} size="sm">
                      Schedule Review
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Data Retention Tab */}
      {tab === 'retention' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Data Retention Policies</h2>
            <Button size="sm" icon={Plus} onClick={() => openRetentionModal()}>
              Add Policy
            </Button>
          </div>

          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            {loadingRetention ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : retentionPolicies.length === 0 ? (
              <div className="p-12 text-center">
                <FileText className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400">No retention policies defined</p>
                <p className="text-sm text-slate-500">Create policies to manage data lifecycle</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-800/80">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Retention (days)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Last Purge</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Next Purge</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {retentionPolicies.map((policy: any) => (
                    <tr key={policy.id} className="hover:bg-slate-700/30">
                      <td className="px-4 py-3 text-sm text-white">{policy.category}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{policy.retentionDays}</td>
                      <td className="px-4 py-3">
                        <Badge variant={policy.action === 'delete' ? 'danger' : policy.action === 'anonymize' ? 'warning' : 'info'}>
                          {policy.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-400">
                        {policy.lastPurge ? new Date(policy.lastPurge).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-400">
                        {policy.nextPurge ? new Date(policy.nextPurge).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openRetentionModal(policy)}
                            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setPolicyToPurge(policy); setPurgeConfirmOpen(true); }}
                            className="px-2 py-1 text-xs text-amber-400 hover:text-amber-300 border border-amber-500/30 hover:border-amber-500/50 rounded-lg transition-colors"
                          >
                            Run Purge
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Retention Modal */}
          <Modal
            isOpen={retentionModal}
            onClose={() => setRetentionModal(false)}
            title={editingRetention ? 'Edit Retention Policy' : 'Create Retention Policy'}
            size="md"
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Category</label>
                <input
                  type="text"
                  value={retentionForm.category}
                  onChange={(e) => setRetentionForm(f => ({ ...f, category: e.target.value }))}
                  placeholder="e.g., Customer Data, Audit Logs, Sessions"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Retention Period (days)</label>
                <input
                  type="number"
                  min={1}
                  value={retentionForm.retentionDays}
                  onChange={(e) => setRetentionForm(f => ({ ...f, retentionDays: parseInt(e.target.value) || 365 }))}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Action After Retention</label>
                <select
                  value={retentionForm.action}
                  onChange={(e) => setRetentionForm(f => ({ ...f, action: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  {RETENTION_ACTIONS.map(a => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                <textarea
                  value={retentionForm.description}
                  onChange={(e) => setRetentionForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setRetentionModal(false)}>Cancel</Button>
                <Button onClick={saveRetention} loading={savingRetention}>
                  {editingRetention ? 'Update' : 'Create'}
                </Button>
              </div>
            </div>
          </Modal>

          <ConfirmModal
            isOpen={purgeConfirmOpen}
            onClose={() => setPurgeConfirmOpen(false)}
            onConfirm={runPurge}
            title="Run Data Purge"
            message={`This will immediately purge data in "${policyToPurge?.category}" that exceeds the ${policyToPurge?.retentionDays}-day retention period. This action cannot be undone.`}
            confirmText="Run Purge"
            variant="danger"
          />
        </div>
      )}

      {/* Access Reviews Tab */}
      {tab === 'access-reviews' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Access Reviews</h2>
            <Button size="sm" icon={Plus} onClick={startNewReview} loading={startingReview}>
              Start New Review
            </Button>
          </div>

          {activeReview ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActiveReview(null)}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    &larr; Back
                  </button>
                  <h3 className="text-white font-medium">
                    Review #{activeReview.id?.slice?.(0, 8) || activeReview.id}
                  </h3>
                  <Badge variant={activeReview.status === 'completed' ? 'success' : 'warning'} dot>
                    {activeReview.status || 'in_progress'}
                  </Badge>
                </div>
                {activeReview.status !== 'completed' && (
                  <Button onClick={completeReview} loading={completingReview} icon={CheckCircle}>
                    Complete Review
                  </Button>
                )}
              </div>

              <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                {loadingReviewUsers ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <table className="w-full">
                    <thead className="bg-slate-800/80">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Role</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Permissions</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Decision</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {reviewUsers.map((ru: any) => (
                        <tr key={ru.id || ru.userId} className="hover:bg-slate-700/30">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center">
                                <Users className="w-3.5 h-3.5 text-slate-400" />
                              </div>
                              <div>
                                <p className="text-sm text-white">{ru.name || ru.email || '—'}</p>
                                <p className="text-xs text-slate-500">{ru.email || ''}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="default">{ru.role || '—'}</Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-400 max-w-xs truncate">
                            {Array.isArray(ru.permissions) ? ru.permissions.join(', ') : ru.permissions || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={ru.decision || 'keep'}
                              onChange={(e) => updateReviewUser(ru.id || ru.userId, 'decision', e.target.value)}
                              disabled={activeReview.status === 'completed'}
                              className="px-2 py-1 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50"
                            >
                              <option value="keep">Keep</option>
                              <option value="modify">Modify</option>
                              <option value="revoke">Revoke</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={ru.notes || ''}
                              onChange={(e) => updateReviewUser(ru.id || ru.userId, 'notes', e.target.value)}
                              disabled={activeReview.status === 'completed'}
                              placeholder="Add notes..."
                              className="w-full px-2 py-1 bg-slate-900 border border-slate-600 rounded text-sm text-white placeholder-slate-600 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50"
                            />
                          </td>
                        </tr>
                      ))}
                      {reviewUsers.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                            No users found for this review
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
              {loadingReviews ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : reviews.length === 0 ? (
                <div className="p-12 text-center">
                  <Users className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                  <p className="text-slate-400">No access reviews yet</p>
                  <p className="text-sm text-slate-500">Start a review to audit user access</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-slate-800/80">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Review</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Started</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Completed</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Reviewer</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {reviews.map((review: any) => (
                      <tr key={review.id} className="hover:bg-slate-700/30">
                        <td className="px-4 py-3 text-sm text-white">
                          #{review.id?.slice?.(0, 8) || review.id}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={review.status === 'completed' ? 'success' : 'warning'} dot>
                            {review.status || 'in_progress'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-400">
                          {review.createdAt ? new Date(review.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-400">
                          {review.completedAt ? new Date(review.completedAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-400">
                          {review.reviewerName || review.reviewerEmail || '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openReview(review)}
                            className="px-3 py-1 text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/50 rounded-lg transition-colors"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* Change Log Tab */}
      {tab === 'changelog' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Change Log</h2>

          {/* Filters */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div className="flex gap-3">
              <select
                value={changeTypeFilter}
                onChange={(e) => { setChangeTypeFilter(e.target.value); setChangeLogPage(1); }}
                className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                {CHANGE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <select
                value={riskFilter}
                onChange={(e) => { setRiskFilter(e.target.value); setChangeLogPage(1); }}
                className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                {RISK_LEVELS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            {loadingChangeLogs ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : changeLogs.length === 0 ? (
              <div className="p-12 text-center">
                <Activity className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400">No changes recorded</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-800/80">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Changed By</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Risk</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Rolled Back</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {changeLogs.map((change: any) => (
                    <tr key={change.id} className="hover:bg-slate-700/30">
                      <td className="px-4 py-3">
                        <Badge variant="default">{change.type || '—'}</Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300 max-w-md truncate">
                        {change.description || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-400">
                        {change.changedBy || change.userName || '—'}
                      </td>
                      <td className="px-4 py-3">{riskBadge(change.riskLevel || 'low')}</td>
                      <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">
                        {change.createdAt ? new Date(change.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {change.rolledBack ? (
                          <Badge variant="warning" dot>Rolled Back</Badge>
                        ) : (
                          <span className="text-sm text-slate-500">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
