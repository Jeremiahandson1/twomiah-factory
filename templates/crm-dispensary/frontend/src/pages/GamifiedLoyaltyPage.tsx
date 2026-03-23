import { useState, useEffect } from 'react';
import { Trophy, Target, Crown, Zap, Search, Plus, RefreshCw, Users, Star, Gift, Calendar } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const challengeTypes = [
  { value: 'visit_streak', label: 'Visit Streak', color: 'bg-blue-100 text-blue-700' },
  { value: 'spending_goal', label: 'Spending Goal', color: 'bg-green-100 text-green-700' },
  { value: 'category_explorer', label: 'Category Explorer', color: 'bg-purple-100 text-purple-700' },
  { value: 'punch_card', label: 'Punch Card', color: 'bg-orange-100 text-orange-700' },
  { value: 'daily_spin', label: 'Daily Spin', color: 'bg-pink-100 text-pink-700' },
  { value: 'bonus_multiplier', label: 'Bonus Multiplier', color: 'bg-yellow-100 text-yellow-700' },
];

const rewardTypes = ['points', 'discount_percent', 'discount_fixed', 'free_product', 'tier_upgrade'];

export default function GamifiedLoyaltyPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('challenges');

  // Challenges
  const [challenges, setChallenges] = useState<any[]>([]);
  const [loadingChallenges, setLoadingChallenges] = useState(true);
  const [challengeModal, setChallengeModal] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState<any>(null);
  const [challengeForm, setChallengeForm] = useState({
    name: '',
    type: 'visit_streak',
    description: '',
    target: '',
    rewardType: 'points',
    rewardValue: '',
    startDate: '',
    endDate: '',
    active: true,
  });
  const [savingChallenge, setSavingChallenge] = useState(false);

  // Leaderboard
  const [selectedChallenge, setSelectedChallenge] = useState('');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  // Multiplier Events
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventModal, setEventModal] = useState(false);
  const [eventForm, setEventForm] = useState({ name: '', multiplier: '2', startDate: '', endDate: '' });
  const [savingEvent, setSavingEvent] = useState(false);

  // Member Progress
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [memberProgress, setMemberProgress] = useState<any[]>([]);
  const [loadingMember, setLoadingMember] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(false);

  useEffect(() => {
    if (tab === 'challenges') loadChallenges();
    if (tab === 'leaderboard') { loadChallenges(); }
    if (tab === 'multipliers') loadEvents();
  }, [tab]);

  useEffect(() => {
    if (selectedChallenge) loadLeaderboard();
  }, [selectedChallenge]);

  const loadChallenges = async () => {
    setLoadingChallenges(true);
    try {
      const data = await api.get('/api/loyalty/challenges');
      const list = Array.isArray(data) ? data : data?.data || [];
      setChallenges(list);
      if (tab === 'leaderboard' && list.length > 0 && !selectedChallenge) {
        setSelectedChallenge(list[0].id);
      }
    } catch (err) {
      console.error('Failed to load challenges:', err);
    } finally {
      setLoadingChallenges(false);
    }
  };

  const loadLeaderboard = async () => {
    if (!selectedChallenge) return;
    setLoadingLeaderboard(true);
    try {
      const data = await api.get(`/api/loyalty/challenges/${selectedChallenge}/leaderboard`);
      setLeaderboard(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    } finally {
      setLoadingLeaderboard(false);
    }
  };

  const loadEvents = async () => {
    setLoadingEvents(true);
    try {
      const data = await api.get('/api/loyalty/multiplier-events');
      setEvents(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setLoadingEvents(false);
    }
  };

  const openChallengeModal = (challenge?: any) => {
    if (challenge) {
      setEditingChallenge(challenge);
      setChallengeForm({
        name: challenge.name || '',
        type: challenge.type || 'visit_streak',
        description: challenge.description || '',
        target: String(challenge.target || ''),
        rewardType: challenge.rewardType || 'points',
        rewardValue: String(challenge.rewardValue || ''),
        startDate: challenge.startDate?.slice(0, 10) || '',
        endDate: challenge.endDate?.slice(0, 10) || '',
        active: challenge.active ?? true,
      });
    } else {
      setEditingChallenge(null);
      setChallengeForm({
        name: '', type: 'visit_streak', description: '', target: '',
        rewardType: 'points', rewardValue: '', startDate: '', endDate: '', active: true,
      });
    }
    setChallengeModal(true);
  };

  const saveChallenge = async () => {
    if (!challengeForm.name.trim()) {
      toast.error('Challenge name is required');
      return;
    }
    setSavingChallenge(true);
    try {
      const payload = {
        ...challengeForm,
        target: parseFloat(challengeForm.target) || 0,
        rewardValue: parseFloat(challengeForm.rewardValue) || 0,
      };
      if (editingChallenge) {
        await api.put(`/api/loyalty/challenges/${editingChallenge.id}`, payload);
        toast.success('Challenge updated');
      } else {
        await api.post('/api/loyalty/challenges', payload);
        toast.success('Challenge created');
      }
      setChallengeModal(false);
      loadChallenges();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save challenge');
    } finally {
      setSavingChallenge(false);
    }
  };

  const saveEvent = async () => {
    if (!eventForm.name.trim()) {
      toast.error('Event name is required');
      return;
    }
    setSavingEvent(true);
    try {
      await api.post('/api/loyalty/multiplier-events', {
        name: eventForm.name,
        multiplier: parseFloat(eventForm.multiplier) || 2,
        startDate: eventForm.startDate,
        endDate: eventForm.endDate,
      });
      toast.success('Multiplier event created');
      setEventModal(false);
      setEventForm({ name: '', multiplier: '2', startDate: '', endDate: '' });
      loadEvents();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create event');
    } finally {
      setSavingEvent(false);
    }
  };

  const searchMembers = async () => {
    if (!memberSearch.trim()) return;
    setLoadingMember(true);
    try {
      const data = await api.get('/api/customers', { search: memberSearch, limit: 20 });
      setMemberResults(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to search members:', err);
    } finally {
      setLoadingMember(false);
    }
  };

  const selectMember = async (member: any) => {
    setSelectedMember(member);
    setMemberResults([]);
    setLoadingProgress(true);
    try {
      const data = await api.get(`/api/loyalty/members/${member.id}/progress`);
      setMemberProgress(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load member progress:', err);
    } finally {
      setLoadingProgress(false);
    }
  };

  const getChallengeTypeInfo = (type: string) => {
    return challengeTypes.find(ct => ct.value === type) || { label: type, color: 'bg-gray-100 text-gray-700' };
  };

  const tabs = [
    { id: 'challenges', label: 'Challenges', icon: Target },
    { id: 'leaderboard', label: 'Leaderboard', icon: Crown },
    { id: 'multipliers', label: 'Multiplier Events', icon: Zap },
    { id: 'members', label: 'Member Progress', icon: Users },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gamified Loyalty</h1>
          <p className="text-gray-600">Challenges, leaderboards, and bonus point events</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Challenges Tab */}
      {tab === 'challenges' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={() => openChallengeModal()}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Create Challenge
            </Button>
          </div>

          {loadingChallenges ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : challenges.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Trophy className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No challenges yet</p>
              <p className="text-sm text-gray-400 mt-1">Create your first loyalty challenge</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {challenges.map(challenge => {
                const typeInfo = getChallengeTypeInfo(challenge.type);
                const progress = challenge.avgProgress || 0;
                return (
                  <div key={challenge.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-gray-900">{challenge.name}</h3>
                        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full mt-1 ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                      </div>
                      <button
                        onClick={() => openChallengeModal(challenge)}
                        className="text-sm text-green-600 hover:text-green-700"
                      >
                        Edit
                      </button>
                    </div>

                    {challenge.description && (
                      <p className="text-sm text-gray-600 mb-3">{challenge.description}</p>
                    )}

                    {/* Progress Bar */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Avg Progress</span>
                        <span>{Math.round(progress)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-green-500 h-2 rounded-full transition-all"
                          style={{ width: `${Math.min(100, progress)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {challenge.participantCount || 0} participants
                      </span>
                      <span className="flex items-center gap-1">
                        <Gift className="w-3 h-3" />
                        {challenge.rewardType === 'points' ? `${challenge.rewardValue || 0} pts` :
                         challenge.rewardType === 'discount_percent' ? `${challenge.rewardValue}% off` :
                         challenge.rewardType === 'discount_fixed' ? `$${challenge.rewardValue} off` :
                         challenge.rewardType === 'free_product' ? 'Free product' :
                         challenge.rewardType}
                      </span>
                    </div>

                    {(challenge.startDate || challenge.endDate) && (
                      <div className="mt-2 text-xs text-gray-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {challenge.startDate ? new Date(challenge.startDate).toLocaleDateString() : '—'}
                        {' — '}
                        {challenge.endDate ? new Date(challenge.endDate).toLocaleDateString() : 'Ongoing'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Challenge Modal */}
          <Modal
            isOpen={challengeModal}
            onClose={() => setChallengeModal(false)}
            title={editingChallenge ? 'Edit Challenge' : 'Create Challenge'}
            size="lg"
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Challenge Name *</label>
                <input
                  type="text"
                  value={challengeForm.name}
                  onChange={(e) => setChallengeForm({ ...challengeForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="e.g., 7-Day Visit Streak"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {challengeTypes.map(ct => (
                    <button
                      key={ct.value}
                      onClick={() => setChallengeForm({ ...challengeForm, type: ct.value })}
                      className={`text-left p-2 rounded-lg border-2 text-sm ${
                        challengeForm.type === ct.value
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {ct.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={challengeForm.description}
                  onChange={(e) => setChallengeForm({ ...challengeForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  rows={2}
                  placeholder="Describe the challenge rules..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Value</label>
                  <input
                    type="number"
                    value={challengeForm.target}
                    onChange={(e) => setChallengeForm({ ...challengeForm, target: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                    placeholder="e.g., 7 (visits), 100 (dollars)"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reward Type</label>
                  <select
                    value={challengeForm.rewardType}
                    onChange={(e) => setChallengeForm({ ...challengeForm, rewardType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  >
                    {rewardTypes.map(rt => (
                      <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reward Value</label>
                <input
                  type="number"
                  value={challengeForm.rewardValue}
                  onChange={(e) => setChallengeForm({ ...challengeForm, rewardValue: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="e.g., 500 (points), 10 (percent)"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={challengeForm.startDate}
                    onChange={(e) => setChallengeForm({ ...challengeForm, startDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={challengeForm.endDate}
                    onChange={(e) => setChallengeForm({ ...challengeForm, endDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={challengeForm.active}
                  onChange={(e) => setChallengeForm({ ...challengeForm, active: e.target.checked })}
                  className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                />
                <span className="text-sm text-gray-700">Active</span>
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setChallengeModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
              <Button onClick={saveChallenge} disabled={savingChallenge}>
                {savingChallenge ? 'Saving...' : editingChallenge ? 'Update Challenge' : 'Create Challenge'}
              </Button>
            </div>
          </Modal>
        </div>
      )}

      {/* Leaderboard Tab */}
      {tab === 'leaderboard' && (
        <div>
          {/* Challenge Selector */}
          <div className="mb-4">
            <select
              value={selectedChallenge}
              onChange={(e) => setSelectedChallenge(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="">Select a challenge</option>
              {challenges.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {!selectedChallenge ? (
            <div className="text-center py-12 text-gray-500">
              <Crown className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>Select a challenge to view rankings</p>
            </div>
          ) : loadingLeaderboard ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Progress</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">No participants yet</td>
                    </tr>
                  ) : leaderboard.map((entry, index) => (
                    <tr key={entry.id || index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">
                        {index < 3 ? (
                          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs ${
                            index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : 'bg-amber-700'
                          }`}>
                            {index + 1}
                          </span>
                        ) : (
                          <span className="text-gray-500 font-medium pl-2">{index + 1}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{entry.memberName || entry.name || 'Unknown'}</td>
                      <td className="px-4 py-3 text-sm text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-24 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-green-500 h-2 rounded-full"
                              style={{ width: `${Math.min(100, entry.progress || 0)}%` }}
                            />
                          </div>
                          <span className="text-gray-600 w-12 text-right">{Math.round(entry.progress || 0)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          entry.completed ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {entry.completed ? 'Completed' : 'In Progress'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {entry.lastActivity ? new Date(entry.lastActivity).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Multiplier Events Tab */}
      {tab === 'multipliers' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={() => { setEventForm({ name: '', multiplier: '2', startDate: '', endDate: '' }); setEventModal(true); }}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Create Event
            </Button>
          </div>

          {loadingEvents ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Zap className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No multiplier events</p>
              <p className="text-sm text-gray-400 mt-1">Create bonus point events to boost engagement</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {events.map(event => {
                const isActive = event.active || (
                  event.startDate && event.endDate &&
                  new Date(event.startDate) <= new Date() &&
                  new Date(event.endDate) >= new Date()
                );
                return (
                  <div key={event.id} className={`bg-white rounded-lg shadow-sm p-5 border-2 ${isActive ? 'border-yellow-300' : 'border-gray-100'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <Zap className={`w-4 h-4 ${isActive ? 'text-yellow-500' : 'text-gray-400'}`} />
                        {event.name}
                      </h3>
                      <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                        isActive ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {isActive ? 'ACTIVE' : 'Ended'}
                      </span>
                    </div>
                    <div className="text-center my-4">
                      <span className="text-4xl font-bold text-yellow-600">{event.multiplier || 2}x</span>
                      <p className="text-sm text-gray-500 mt-1">Point Multiplier</p>
                    </div>
                    <div className="space-y-1 text-sm text-gray-600">
                      <p className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Start: {event.startDate ? new Date(event.startDate).toLocaleDateString() : '—'}
                      </p>
                      <p className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        End: {event.endDate ? new Date(event.endDate).toLocaleDateString() : '—'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Event Modal */}
          <Modal
            isOpen={eventModal}
            onClose={() => setEventModal(false)}
            title="Create Multiplier Event"
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Event Name *</label>
                <input
                  type="text"
                  value={eventForm.name}
                  onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="e.g., 420 Double Points"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Multiplier</label>
                <select
                  value={eventForm.multiplier}
                  onChange={(e) => setEventForm({ ...eventForm, multiplier: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                >
                  <option value="1.5">1.5x</option>
                  <option value="2">2x</option>
                  <option value="3">3x</option>
                  <option value="4">4x</option>
                  <option value="5">5x</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={eventForm.startDate}
                    onChange={(e) => setEventForm({ ...eventForm, startDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={eventForm.endDate}
                    onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEventModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
              <Button onClick={saveEvent} disabled={savingEvent}>
                {savingEvent ? 'Saving...' : 'Create Event'}
              </Button>
            </div>
          </Modal>
        </div>
      )}

      {/* Member Progress Tab */}
      {tab === 'members' && (
        <div className="space-y-6">
          {/* Search */}
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search member by name or phone..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchMembers()}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              />
            </div>
            <Button onClick={searchMembers} variant="secondary">
              Search
            </Button>
          </div>

          {/* Member Results */}
          {loadingMember ? (
            <div className="flex items-center justify-center h-16">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : memberResults.length > 0 && !selectedMember && (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="divide-y">
                {memberResults.map(m => (
                  <button
                    key={m.id}
                    onClick={() => selectMember(m)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{m.name || `${m.firstName} ${m.lastName}`}</p>
                      <p className="text-sm text-gray-500">{m.phone || m.email || ''}</p>
                    </div>
                    <span className="text-sm text-green-600">View Progress</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selected Member Progress */}
          {selectedMember && (
            <div>
              <div className="bg-white rounded-lg shadow-sm p-5 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{selectedMember.name || `${selectedMember.firstName} ${selectedMember.lastName}`}</p>
                      <p className="text-sm text-gray-500">{selectedMember.phone || selectedMember.email || ''}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setSelectedMember(null); setMemberProgress([]); }}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    Change
                  </button>
                </div>
              </div>

              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Active Challenges</h3>
              {loadingProgress ? (
                <div className="flex items-center justify-center h-16">
                  <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : memberProgress.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-lg shadow-sm text-gray-500">
                  <Target className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No active challenges for this member</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {memberProgress.map(cp => {
                    const typeInfo = getChallengeTypeInfo(cp.challengeType || cp.type);
                    const pct = cp.target > 0 ? Math.min(100, (cp.current / cp.target) * 100) : 0;
                    return (
                      <div key={cp.id || cp.challengeId} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-gray-900">{cp.challengeName || cp.name}</h4>
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${typeInfo.color}`}>
                              {typeInfo.label}
                            </span>
                          </div>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            cp.completed ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {cp.completed ? 'Completed' : 'In Progress'}
                          </span>
                        </div>
                        <div className="mb-2">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-600">{cp.current || 0} / {cp.target || 0}</span>
                            <span className="font-medium text-gray-900">{Math.round(pct)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-3">
                            <div
                              className={`h-3 rounded-full transition-all ${cp.completed ? 'bg-green-500' : 'bg-blue-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <Gift className="w-3 h-3" />
                          Reward: {cp.rewardType?.replace(/_/g, ' ')} - {cp.rewardValue}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!selectedMember && memberResults.length === 0 && !loadingMember && (
            <div className="text-center py-12 text-gray-500">
              <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>Search for a loyalty member to view their challenge progress</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
