import { useState, useEffect } from 'react';
import { 
  Mail, Plus, Send, Calendar, Users, BarChart3,
  Edit2, Copy, Trash2, Loader2, Play, Pause,
  FileText, Zap, Clock, TrendingUp, Eye, MousePointer
} from 'lucide-react';
import api from '../../services/api';

/**
 * Marketing Automation Page
 */
export default function MarketingPage() {
  const [tab, setTab] = useState('campaigns'); // campaigns, templates, sequences
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await api.get('/api/marketing/stats');
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Marketing</h1>
          <p className="text-gray-500">Email campaigns and automation</p>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Mail} label="Total Campaigns" value={stats.totalCampaigns} />
          <StatCard icon={Zap} label="Active Sequences" value={stats.activeSequences} color="purple" />
          <StatCard icon={Send} label="Emails (30d)" value={stats.emailsSent30Days} color="green" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {[
          { id: 'campaigns', label: 'Campaigns', icon: Mail },
          { id: 'templates', label: 'Templates', icon: FileText },
          { id: 'sequences', label: 'Drip Sequences', icon: Zap },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 -mb-px ${
              tab === t.id
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'sequences' && <SequencesTab />}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600',
    purple: 'bg-purple-50 text-purple-600',
    green: 'bg-green-50 text-green-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  useEffect(() => {
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    try {
      const data = await api.get('/api/marketing/campaigns');
      setCampaigns(data.data || []);
    } catch (error) {
      console.error('Failed to load campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (campaignId) => {
    if (!confirm('Are you sure you want to send this campaign?')) return;
    try {
      await api.post(`/api/marketing/campaigns/${campaignId}/send`);
      loadCampaigns();
    } catch (error) {
      alert('Failed to send campaign');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => { setSelectedCampaign(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <Mail className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500">No campaigns yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Campaign</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Status</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Recipients</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Opens</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Clicks</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {campaigns.map(campaign => (
                <tr key={campaign.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{campaign.name}</p>
                    <p className="text-sm text-gray-500">{campaign.subject}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      campaign.status === 'sent' ? 'bg-green-100 text-green-700' :
                      campaign.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                      campaign.status === 'sending' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {campaign.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{campaign._count?.recipients || 0}</td>
                  <td className="px-4 py-3 text-right">-</td>
                  <td className="px-4 py-3 text-right">-</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      {campaign.status === 'draft' && (
                        <button
                          onClick={() => handleSend(campaign.id)}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"
                          title="Send"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => { setSelectedCampaign(campaign); setShowForm(true); }}
                        className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <CampaignFormModal
          campaign={selectedCampaign}
          onSave={() => { setShowForm(false); loadCampaigns(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const data = await api.get('/api/marketing/templates');
      setTemplates(data || []);
    } catch (error) {
      console.error('Failed to load templates:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => { setSelectedTemplate(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg"
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <FileText className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500">No templates yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(template => (
            <div key={template.id} className="bg-white rounded-xl border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-900">{template.name}</p>
                  <p className="text-sm text-gray-500">{template.category}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setSelectedTemplate(template); setShowForm(true); }}
                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-600 line-clamp-2">{template.subject}</p>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <TemplateFormModal
          template={selectedTemplate}
          onSave={() => { setShowForm(false); loadTemplates(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function SequencesTab() {
  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadSequences();
  }, []);

  const loadSequences = async () => {
    try {
      const data = await api.get('/api/marketing/sequences');
      setSequences(data || []);
    } catch (error) {
      console.error('Failed to load sequences:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg"
        >
          <Plus className="w-4 h-4" />
          New Sequence
        </button>
      </div>

      {sequences.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <Zap className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500">No drip sequences yet</p>
          <p className="text-sm text-gray-400 mt-1">Automate follow-up emails</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sequences.map(sequence => (
            <div key={sequence.id} className="bg-white rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    sequence.active ? 'bg-green-100' : 'bg-gray-100'
                  }`}>
                    <Zap className={`w-5 h-5 ${sequence.active ? 'text-green-600' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{sequence.name}</p>
                    <p className="text-sm text-gray-500">
                      {sequence.steps?.length || 0} steps • 
                      {sequence._count?.enrollments || 0} enrolled
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    sequence.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {sequence.active ? 'Active' : 'Paused'}
                  </span>
                  <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                    Trigger: {sequence.trigger}
                  </span>
                </div>
              </div>

              {/* Steps Preview */}
              {sequence.steps?.length > 0 && (
                <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-2">
                  {sequence.steps.map((step, i) => (
                    <div key={step.id} className="flex items-center">
                      <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm whitespace-nowrap">
                        <p className="font-medium">Step {step.stepNumber}</p>
                        <p className="text-xs text-gray-500">
                          {step.delayDays > 0 && `${step.delayDays}d `}
                          {step.delayHours > 0 && `${step.delayHours}h`}
                          {!step.delayDays && !step.delayHours && 'Immediately'}
                        </p>
                      </div>
                      {i < sequence.steps.length - 1 && (
                        <div className="w-8 h-0.5 bg-gray-200" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <SequenceFormModal
          onSave={() => { setShowForm(false); loadSequences(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

// Form Modals
function CampaignFormModal({ campaign, onSave, onClose }) {
  const [form, setForm] = useState({
    name: campaign?.name || '',
    subject: campaign?.subject || '',
    body: campaign?.body || '',
    audienceType: campaign?.audienceType || 'all',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (campaign) {
        await api.put(`/api/marketing/campaigns/${campaign.id}`, form);
      } else {
        await api.post('/api/marketing/campaigns', form);
      }
      onSave();
    } catch (error) {
      alert('Failed to save campaign');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6">
          <h2 className="text-lg font-bold mb-4">{campaign ? 'Edit Campaign' : 'New Campaign'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject Line</label>
              <input type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Audience</label>
              <select value={form.audienceType} onChange={(e) => setForm({ ...form, audienceType: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg">
                <option value="all">All Contacts</option>
                <option value="segment">Segment</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Body (HTML)</label>
              <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg font-mono text-sm" rows={10} />
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function TemplateFormModal({ template, onSave, onClose }) {
  const [form, setForm] = useState({
    name: template?.name || '',
    subject: template?.subject || '',
    body: template?.body || '',
    category: template?.category || 'general',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (template) {
        await api.put(`/api/marketing/templates/${template.id}`, form);
      } else {
        await api.post('/api/marketing/templates', form);
      }
      onSave();
    } catch (error) {
      alert('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6">
          <h2 className="text-lg font-bold mb-4">{template ? 'Edit Template' : 'New Template'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg">
                  <option value="general">General</option>
                  <option value="followup">Follow-up</option>
                  <option value="promotion">Promotion</option>
                  <option value="newsletter">Newsletter</option>
                  <option value="reminder">Reminder</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Body (HTML)</label>
              <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg font-mono text-sm" rows={10} />
              <p className="text-xs text-gray-500 mt-1">Variables: {'{{name}}'}, {'{{firstName}}'}, {'{{company}}'}</p>
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function SequenceFormModal({ onSave, onClose }) {
  const [form, setForm] = useState({
    name: '',
    trigger: 'manual',
    steps: [{ delayDays: 0, delayHours: 0, subject: '', body: '' }],
  });
  const [saving, setSaving] = useState(false);

  const addStep = () => {
    setForm({
      ...form,
      steps: [...form.steps, { delayDays: 1, delayHours: 0, subject: '', body: '' }],
    });
  };

  const updateStep = (index, field, value) => {
    const steps = [...form.steps];
    steps[index][field] = value;
    setForm({ ...form, steps });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/marketing/sequences', form);
      onSave();
    } catch (error) {
      alert('Failed to save sequence');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
          <h2 className="text-lg font-bold mb-4">New Drip Sequence</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sequence Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trigger</label>
                <select value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg">
                  <option value="manual">Manual Enrollment</option>
                  <option value="new_customer">New Customer</option>
                  <option value="quote_sent">Quote Sent</option>
                  <option value="invoice_paid">Invoice Paid</option>
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Steps</h3>
                <button type="button" onClick={addStep} className="text-sm text-orange-600 hover:text-orange-700">
                  + Add Step
                </button>
              </div>

              {form.steps.map((step, index) => (
                <div key={index} className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Step {index + 1}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">Delay:</span>
                      <input type="number" value={step.delayDays} onChange={(e) => updateStep(index, 'delayDays', parseInt(e.target.value))}
                        className="w-16 px-2 py-1 border rounded text-sm" min="0" /> days
                      <input type="number" value={step.delayHours} onChange={(e) => updateStep(index, 'delayHours', parseInt(e.target.value))}
                        className="w-16 px-2 py-1 border rounded text-sm" min="0" /> hours
                    </div>
                  </div>
                  <input type="text" value={step.subject} onChange={(e) => updateStep(index, 'subject', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg" placeholder="Subject line" />
                  <textarea value={step.body} onChange={(e) => updateStep(index, 'body', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" rows={3} placeholder="Email body (HTML)" />
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Saving...' : 'Create Sequence'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
