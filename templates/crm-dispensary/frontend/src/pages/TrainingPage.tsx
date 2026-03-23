import { useState, useEffect } from 'react';
import {
  BookOpen, GraduationCap, Shield, UserPlus, Plus, Play, Check, X,
  Clock, AlertTriangle, ChevronRight, Video, FileText, HelpCircle, Award
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const CATEGORY_COLORS: Record<string, string> = {
  compliance: 'bg-red-100 text-red-700',
  product: 'bg-green-100 text-green-700',
  sales: 'bg-blue-100 text-blue-700',
  safety: 'bg-orange-100 text-orange-700',
  onboarding: 'bg-purple-100 text-purple-700',
  general: 'bg-gray-100 text-gray-700',
};

export default function TrainingPage() {
  const { user, isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('courses');
  const [loading, setLoading] = useState(true);

  // Courses
  const [courses, setCourses] = useState<any[]>([]);
  const [courseModal, setCourseModal] = useState(false);
  const [courseForm, setCourseForm] = useState({
    title: '', description: '', category: 'general', required: false, estimatedMinutes: '30',
  });
  const [courseSteps, setCourseSteps] = useState<any[]>([]);
  const [savingCourse, setSavingCourse] = useState(false);

  // My training
  const [myTraining, setMyTraining] = useState<any[]>([]);
  const [activeQuiz, setActiveQuiz] = useState<any>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // Compliance
  const [complianceData, setComplianceData] = useState<any[]>([]);

  // Assign
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [assignByRole, setAssignByRole] = useState('');
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (tab === 'courses') loadCourses();
    if (tab === 'my-training') loadMyTraining();
    if (tab === 'compliance') loadCompliance();
    if (tab === 'assign') { loadCourses(); loadEmployees(); }
  }, [tab]);

  const loadCourses = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/training/courses');
      setCourses(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load courses');
    } finally {
      setLoading(false);
    }
  };

  const loadMyTraining = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/training/my-courses');
      setMyTraining(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load training');
    } finally {
      setLoading(false);
    }
  };

  const loadCompliance = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/training/compliance');
      setComplianceData(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load compliance data');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    try {
      const data = await api.get('/api/team', { limit: 100 });
      setEmployees(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load employees');
    }
  };

  const addStep = (type: 'text' | 'video' | 'quiz') => {
    const step: any = { type, order: courseSteps.length + 1 };
    if (type === 'text') { step.title = ''; step.content = ''; }
    if (type === 'video') { step.title = ''; step.videoUrl = ''; }
    if (type === 'quiz') { step.question = ''; step.options = ['', '', '', '']; step.correctIndex = 0; }
    setCourseSteps([...courseSteps, step]);
  };

  const updateStep = (index: number, updates: any) => {
    const updated = [...courseSteps];
    updated[index] = { ...updated[index], ...updates };
    setCourseSteps(updated);
  };

  const removeStep = (index: number) => {
    setCourseSteps(courseSteps.filter((_, i) => i !== index));
  };

  const handleCreateCourse = async () => {
    if (!courseForm.title) { toast.error('Title required'); return; }
    setSavingCourse(true);
    try {
      await api.post('/api/training/courses', {
        ...courseForm,
        estimatedMinutes: parseInt(courseForm.estimatedMinutes) || 30,
        steps: courseSteps,
      });
      toast.success('Course created');
      setCourseModal(false);
      setCourseForm({ title: '', description: '', category: 'general', required: false, estimatedMinutes: '30' });
      setCourseSteps([]);
      loadCourses();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create course');
    } finally {
      setSavingCourse(false);
    }
  };

  const continueCourse = async (enrollment: any) => {
    try {
      const data = await api.get(`/api/training/courses/${enrollment.courseId}/content`);
      const currentStep = data?.steps?.find((s: any) => s.order === (enrollment.currentStep || 1));
      if (currentStep?.type === 'quiz') {
        setActiveQuiz({ enrollment, step: currentStep, course: data });
        setQuizAnswers({});
        setQuizSubmitted(false);
      } else {
        // Mark step complete and advance
        await api.post(`/api/training/enrollments/${enrollment.id}/advance`);
        toast.success('Step completed');
        loadMyTraining();
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load course content');
    }
  };

  const submitQuiz = async () => {
    if (!activeQuiz) return;
    try {
      await api.post(`/api/training/enrollments/${activeQuiz.enrollment.id}/quiz`, {
        stepOrder: activeQuiz.step.order,
        answers: quizAnswers,
      });
      setQuizSubmitted(true);
      toast.success('Quiz submitted');
      loadMyTraining();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit quiz');
    }
  };

  const handleAssign = async () => {
    if (!selectedCourse) { toast.error('Select a course'); return; }
    if (selectedEmployees.length === 0 && !assignByRole) { toast.error('Select employees or a role'); return; }
    setAssigning(true);
    try {
      await api.post('/api/training/assign', {
        courseId: selectedCourse,
        userIds: selectedEmployees.length > 0 ? selectedEmployees : undefined,
        role: assignByRole || undefined,
      });
      toast.success('Course assigned');
      setSelectedEmployees([]);
      setSelectedCourse('');
      setAssignByRole('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign course');
    } finally {
      setAssigning(false);
    }
  };

  const toggleEmployee = (id: string) => {
    setSelectedEmployees(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]);
  };

  const tabs = [
    { id: 'courses', label: 'Courses', icon: BookOpen },
    { id: 'my-training', label: 'My Training', icon: GraduationCap },
    { id: 'compliance', label: 'Compliance', icon: Shield },
    { id: 'assign', label: 'Assign', icon: UserPlus },
  ];

  return (
    <div>
      <PageHeader title="Budtender Training" action={
        isManager ? <Button onClick={() => setCourseModal(true)}><Plus className="w-4 h-4 mr-2 inline" />Create Course</Button> : undefined
      } />

      <div className="flex gap-1 mb-6 overflow-x-auto border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Courses Tab */}
      {tab === 'courses' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : courses.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No courses yet. Create one to get started.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {courses.map(course => (
                <div key={course.id} className="border rounded-lg p-5 bg-white hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[course.category] || CATEGORY_COLORS.general}`}>
                        {course.category}
                      </span>
                      {course.required && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Required</span>
                      )}
                    </div>
                  </div>
                  <h3 className="font-semibold text-lg mb-1">{course.title}</h3>
                  <p className="text-sm text-gray-500 mb-4 line-clamp-2">{course.description}</p>
                  <div className="flex items-center justify-between text-sm text-gray-400">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{course.estimatedMinutes || 30} min</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />{course.enrolledCount || 0} enrolled</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* My Training Tab */}
      {tab === 'my-training' && (
        <div>
          {activeQuiz ? (
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Quiz: {activeQuiz.course?.title}</h3>
                <button onClick={() => setActiveQuiz(null)} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
              </div>
              <div className="border rounded-lg p-6 bg-white space-y-6">
                <p className="font-medium text-lg">{activeQuiz.step.question}</p>
                <div className="space-y-3">
                  {(activeQuiz.step.options || []).map((opt: string, i: number) => (
                    <label key={i} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer ${quizAnswers[0] === i ? 'border-green-500 bg-green-50' : 'hover:bg-gray-50'} ${quizSubmitted && activeQuiz.step.correctIndex === i ? 'border-green-500 bg-green-50' : ''} ${quizSubmitted && quizAnswers[0] === i && activeQuiz.step.correctIndex !== i ? 'border-red-500 bg-red-50' : ''}`}>
                      <input type="radio" name="quiz" checked={quizAnswers[0] === i} onChange={() => setQuizAnswers({ 0: i })}
                        disabled={quizSubmitted} className="text-green-600" />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
                {!quizSubmitted ? (
                  <Button onClick={submitQuiz} disabled={quizAnswers[0] === undefined}>Submit Answer</Button>
                ) : (
                  <div className="flex items-center gap-2">
                    {quizAnswers[0] === activeQuiz.step.correctIndex ? (
                      <span className="text-green-600 font-medium flex items-center gap-1"><Check className="w-5 h-5" />Correct!</span>
                    ) : (
                      <span className="text-red-600 font-medium flex items-center gap-1"><X className="w-5 h-5" />Incorrect</span>
                    )}
                    <Button onClick={() => { setActiveQuiz(null); loadMyTraining(); }}>Continue</Button>
                  </div>
                )}
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : myTraining.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No training assigned to you yet.</div>
          ) : (
            <div className="space-y-4">
              {myTraining.map(enrollment => {
                const progress = enrollment.totalSteps ? Math.round((enrollment.completedSteps / enrollment.totalSteps) * 100) : 0;
                return (
                  <div key={enrollment.id} className="border rounded-lg p-5 bg-white flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{enrollment.courseTitle}</h3>
                        {enrollment.completed && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Completed</span>}
                      </div>
                      <div className="text-sm text-gray-500 mb-2">{enrollment.courseCategory} &middot; {enrollment.estimatedMinutes || 30} min</div>
                      <div className="w-64 bg-gray-200 rounded-full h-2">
                        <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="text-xs text-gray-400 mt-1">{enrollment.completedSteps || 0} / {enrollment.totalSteps || 0} steps ({progress}%)</div>
                    </div>
                    {!enrollment.completed && (
                      <Button onClick={() => continueCourse(enrollment)}>
                        <Play className="w-4 h-4 mr-1 inline" />Continue
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Compliance Tab */}
      {tab === 'compliance' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Employee</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Role</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Required Courses</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Certifications</th>
                  </tr>
                </thead>
                <tbody>
                  {complianceData.map((row: any) => (
                    <tr key={row.employeeId} className="border-t">
                      <td className="px-4 py-3 text-sm font-medium">{row.employeeName}</td>
                      <td className="px-4 py-3 text-sm">{row.role || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          {(row.courses || []).map((c: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              {c.status === 'completed' && <Check className="w-4 h-4 text-green-600" />}
                              {c.status === 'in_progress' && <Clock className="w-4 h-4 text-yellow-500" />}
                              {c.status === 'not_started' && <X className="w-4 h-4 text-red-500" />}
                              <span className={c.overdue ? 'text-red-600 font-medium' : ''}>{c.title}</span>
                              {c.overdue && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Overdue</span>}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${row.allComplete ? 'bg-green-100 text-green-700' : row.hasOverdue ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {row.allComplete ? 'Compliant' : row.hasOverdue ? 'Non-Compliant' : 'In Progress'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          {(row.certifications || []).map((cert: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <Award className="w-3 h-3 text-gray-400" />
                              <span>{cert.name}</span>
                              {cert.expiring && (
                                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />Expires {cert.expiresAt}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {complianceData.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-500">No compliance data available</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Assign Tab */}
      {tab === 'assign' && (
        <div className="max-w-2xl">
          <h3 className="text-lg font-semibold mb-4">Assign Training</h3>
          <div className="bg-white border rounded-lg p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium mb-1">Course *</label>
              <select value={selectedCourse} onChange={e => setSelectedCourse(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg">
                <option value="">Select course...</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Assign by Role (optional)</label>
              <select value={assignByRole} onChange={e => setAssignByRole(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg">
                <option value="">All roles</option>
                <option value="budtender">Budtender</option>
                <option value="manager">Manager</option>
                <option value="security">Security</option>
                <option value="driver">Driver</option>
                <option value="inventory">Inventory</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Or Select Employees</label>
              <div className="border rounded-lg max-h-48 overflow-y-auto">
                {employees.map(emp => (
                  <label key={emp.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0">
                    <input type="checkbox" checked={selectedEmployees.includes(emp.id)}
                      onChange={() => toggleEmployee(emp.id)} className="rounded text-green-600" />
                    <span className="text-sm">{emp.name}</span>
                    <span className="text-xs text-gray-400">{emp.role}</span>
                  </label>
                ))}
                {employees.length === 0 && <div className="px-3 py-4 text-sm text-gray-500 text-center">No employees found</div>}
              </div>
              {selectedEmployees.length > 0 && (
                <div className="text-xs text-gray-500 mt-1">{selectedEmployees.length} selected</div>
              )}
            </div>

            <Button onClick={handleAssign} disabled={assigning}>
              <UserPlus className="w-4 h-4 mr-2 inline" />{assigning ? 'Assigning...' : 'Assign Course'}
            </Button>
          </div>
        </div>
      )}

      {/* Create Course Modal */}
      <Modal isOpen={courseModal} onClose={() => setCourseModal(false)} title="Create Course" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input value={courseForm.title} onChange={e => setCourseForm({ ...courseForm, title: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" placeholder="e.g., Cannabis Product Knowledge" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea value={courseForm.description} onChange={e => setCourseForm({ ...courseForm, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select value={courseForm.category} onChange={e => setCourseForm({ ...courseForm, category: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg">
                {Object.keys(CATEGORY_COLORS).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Est. Minutes</label>
              <input type="number" value={courseForm.estimatedMinutes} onChange={e => setCourseForm({ ...courseForm, estimatedMinutes: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={courseForm.required} onChange={e => setCourseForm({ ...courseForm, required: e.target.checked })}
                  className="rounded text-green-600" />
                <span className="text-sm font-medium">Required</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Content Steps</label>
            <div className="space-y-3">
              {courseSteps.map((step, i) => (
                <div key={i} className="border rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium flex items-center gap-1">
                      {step.type === 'text' && <><FileText className="w-3 h-3" />Text Block</>}
                      {step.type === 'video' && <><Video className="w-3 h-3" />Video</>}
                      {step.type === 'quiz' && <><HelpCircle className="w-3 h-3" />Quiz Question</>}
                      <span className="text-gray-400">#{i + 1}</span>
                    </span>
                    <button onClick={() => removeStep(i)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
                  </div>
                  {step.type === 'text' && (
                    <div className="space-y-2">
                      <input value={step.title} onChange={e => updateStep(i, { title: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-sm" placeholder="Section title" />
                      <textarea value={step.content} onChange={e => updateStep(i, { content: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-sm" rows={3} placeholder="Content..." />
                    </div>
                  )}
                  {step.type === 'video' && (
                    <div className="space-y-2">
                      <input value={step.title} onChange={e => updateStep(i, { title: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-sm" placeholder="Video title" />
                      <input value={step.videoUrl} onChange={e => updateStep(i, { videoUrl: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-sm" placeholder="Video URL (YouTube, Vimeo, etc.)" />
                    </div>
                  )}
                  {step.type === 'quiz' && (
                    <div className="space-y-2">
                      <input value={step.question} onChange={e => updateStep(i, { question: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-sm" placeholder="Question" />
                      {(step.options || []).map((opt: string, oi: number) => (
                        <div key={oi} className="flex items-center gap-2">
                          <input type="radio" name={`correct-${i}`} checked={step.correctIndex === oi}
                            onChange={() => updateStep(i, { correctIndex: oi })} className="text-green-600" />
                          <input value={opt} onChange={e => {
                            const opts = [...step.options]; opts[oi] = e.target.value;
                            updateStep(i, { options: opts });
                          }} className="flex-1 px-2 py-1 border rounded text-sm" placeholder={`Option ${oi + 1}`} />
                        </div>
                      ))}
                      <div className="text-xs text-gray-400">Select the radio button next to the correct answer</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => addStep('text')} className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">
                <FileText className="w-3 h-3" />Add Text
              </button>
              <button onClick={() => addStep('video')} className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">
                <Video className="w-3 h-3" />Add Video
              </button>
              <button onClick={() => addStep('quiz')} className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">
                <HelpCircle className="w-3 h-3" />Add Quiz
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setCourseModal(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
          <Button onClick={handleCreateCourse} disabled={savingCourse}>{savingCourse ? 'Creating...' : 'Create Course'}</Button>
        </div>
      </Modal>
    </div>
  );
}
