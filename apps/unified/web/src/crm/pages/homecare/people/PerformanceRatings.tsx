// Moved from templates/crm-homecare/frontend/src/components/admin/PerformanceRatings.tsx (/crm/performance).
//
// Replies read (server/crm/homecare):
//   GET    /api/users/caregivers           hr/caregivers.ts — { data }: id, firstName, lastName
//   GET    /api/clients                    clients/clients.ts — { data, pagination } (50 a page, as the template's)
//   GET    /api/performance-reviews        hr/performanceReviews.ts — { data }: caregiverId, clientId, reviewDate,
//                                          overallAssessment, performanceNotes, strengths, areasForImprovement
//   POST   /api/performance-reviews        care-hr:create
//   DELETE /api/performance-reviews/:id    care-hr:delete
import { useEffect, useState, type FormEvent } from 'react'
import { useConfirm } from '../../../../shared'
import { api, errorMessage, rows } from '../lib/http'
import { formatDate, parseLocalDate, toLocalYMD } from '../lib/date'
import type { CaregiverPick } from './shared'

interface ClientPick { id: string; firstName: string | null; lastName: string | null }
interface Review {
  id: string
  caregiverId: string
  clientId: string
  reviewDate: string
  overallAssessment: string
  performanceNotes: string
  strengths: string
  areasForImprovement: string
}

const EMPTY = () => ({
  caregiverId: '',
  clientId: '',
  reviewDate: toLocalYMD(new Date()),
  performanceNotes: '',
  strengths: '',
  areasForImprovement: '',
  overallAssessment: 'satisfactory', // excellent, satisfactory, needs_improvement
})

// The assessment's colour: the review's left rule (an ink on the surface) and its badge (a ground with its ink).
const ASSESSMENT: Record<string, { rule: string; badge: string }> = {
  excellent: { rule: 'var(--hc-green-ink)', badge: 'hc-badge-success' },
  satisfactory: { rule: 'var(--hc-blue-ink)', badge: 'hc-badge-info' },
  needs_improvement: { rule: 'var(--hc-warning-ink)', badge: 'hc-badge-warning' },
}

const getAssessmentLabel = (assessment: string) => {
  switch (assessment) {
    case 'excellent': return 'Excellent'
    case 'satisfactory': return 'Satisfactory'
    case 'needs_improvement': return 'Needs Improvement'
    default: return assessment
  }
}

export default function PerformanceRatings() {
  const confirm = useConfirm()
  const [caregivers, setCaregivers] = useState<CaregiverPick[]>([])
  const [clients, setClients] = useState<ClientPick[]>([])
  const [loading, setLoading] = useState(true)
  const [reviews, setReviews] = useState<Record<string, Review[]>>({})
  const [showForm, setShowForm] = useState(false)
  const [message, setMessage] = useState('')
  const [expandedCaregiverId, setExpandedCaregiverId] = useState<string | null>(null)
  const [formData, setFormData] = useState(EMPTY)

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    try {
      const [caregiversData, clientsData] = await Promise.all([
        api.get('/api/users/caregivers'),
        // Every client: /api/clients pages at 50, so the picker stopped at the 50th.
        api.get('/api/clients', { limit: 1000 }),
      ])
      const cgList = rows<CaregiverPick>(caregiversData)
      setCaregivers(cgList)
      setClients(rows<ClientPick>(clientsData))
      loadReviews(cgList)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadReviews = async (caregiversList: CaregiverPick[]) => {
    try {
      const reviewsList = rows<Review>(await api.get('/api/performance-reviews'))
      const reviewsByCaregiver: Record<string, Review[]> = {}
      caregiversList.forEach((cg) => { reviewsByCaregiver[cg.id] = [] })
      reviewsList.forEach((review) => {
        if (reviewsByCaregiver[review.caregiverId]) reviewsByCaregiver[review.caregiverId].push(review)
      })
      setReviews(reviewsByCaregiver)
    } catch (error) {
      console.error('Failed to load reviews:', error)
    }
  }

  const handleSubmitReview = async (e: FormEvent) => {
    e.preventDefault()
    setMessage('')

    if (!formData.caregiverId || !formData.clientId) {
      setMessage('Caregiver and Client are required')
      return
    }

    if (!formData.performanceNotes.trim()) {
      setMessage('Performance notes are required')
      return
    }

    try {
      await api.post('/api/performance-reviews', {
        caregiverId: formData.caregiverId,
        clientId: formData.clientId,
        reviewDate: formData.reviewDate,
        performanceNotes: formData.performanceNotes,
        strengths: formData.strengths,
        areasForImprovement: formData.areasForImprovement,
        overallAssessment: formData.overallAssessment,
      })

      setMessage('Performance review saved successfully!')
      setFormData(EMPTY())
      setShowForm(false)
      loadReviews(caregivers)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to submit review'))
    }
  }

  const handleDeleteReview = async (reviewId: string) => {
    if (!(await confirm('Delete this review? This cannot be undone.', { danger: true }))) return

    try {
      await api.delete(`/api/performance-reviews/${reviewId}`)
      setMessage('Review deleted')
      setTimeout(() => setMessage(''), 2000)
      loadReviews(caregivers)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to delete'))
    }
  }

  const getClientName = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId)
    return client ? `${client.firstName} ${client.lastName}` : 'Unknown Client'
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h2>Performance Reviews</h2>
        <button className="hc-btn hc-btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Add Review'}
        </button>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Review Form */}
      {showForm && (
        <div className="hc-card hc-card-form">
          <h3>Add Performance Review</h3>
          <form onSubmit={handleSubmitReview}>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Caregiver *</label>
                <select value={formData.caregiverId} onChange={(e) => setFormData({ ...formData, caregiverId: e.target.value })} required>
                  <option value="">Select caregiver...</option>
                  {caregivers.map((cg) => (
                    <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Client *</label>
                <select value={formData.clientId} onChange={(e) => setFormData({ ...formData, clientId: e.target.value })} required>
                  <option value="">Select client...</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.firstName} {client.lastName}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Review Date *</label>
                <input type="date" value={formData.reviewDate} onChange={(e) => setFormData({ ...formData, reviewDate: e.target.value })} required />
              </div>

              <div className="form-group">
                <label>Overall Assessment *</label>
                <select value={formData.overallAssessment} onChange={(e) => setFormData({ ...formData, overallAssessment: e.target.value })}>
                  <option value="excellent">Excellent</option>
                  <option value="satisfactory">Satisfactory</option>
                  <option value="needs_improvement">Needs Improvement</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Performance Notes *</label>
              <textarea
                value={formData.performanceNotes}
                onChange={(e) => setFormData({ ...formData, performanceNotes: e.target.value })}
                placeholder="Detailed notes about this caregiver's performance with this client..."
                rows={4}
                required
              ></textarea>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Strengths</label>
                <textarea value={formData.strengths} onChange={(e) => setFormData({ ...formData, strengths: e.target.value })} placeholder="What did this caregiver do well?" rows={3}></textarea>
              </div>

              <div className="form-group">
                <label>Areas for Improvement</label>
                <textarea value={formData.areasForImprovement} onChange={(e) => setFormData({ ...formData, areasForImprovement: e.target.value })} placeholder="What could be improved?" rows={3}></textarea>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="hc-btn hc-btn-primary">Save Review</button>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Caregivers & Reviews */}
      {caregivers.length === 0 ? (
        <div className="hc-card hc-card-centered">
          <p>No caregivers to review.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {caregivers.map((caregiver) => {
            const caregiversReviews = reviews[caregiver.id] || []
            const isExpanded = expandedCaregiverId === caregiver.id

            return (
              <div key={caregiver.id} className="hc-card">
                <div
                  onClick={() => setExpandedCaregiverId(isExpanded ? null : caregiver.id)}
                  style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--hc-line)' }}
                >
                  <div>
                    <h3 style={{ margin: 0 }}>{caregiver.firstName} {caregiver.lastName}</h3>
                    <small style={{ color: 'var(--hc-muted)' }}>
                      {caregiversReviews.length} review{caregiversReviews.length !== 1 ? 's' : ''}
                    </small>
                  </div>
                  <span style={{ fontSize: '1.2rem' }}>{isExpanded ? '▼' : '▶'}</span>
                </div>

                {isExpanded && (
                  <div style={{ paddingTop: '1rem' }}>
                    {caregiversReviews.length === 0 ? (
                      <p style={{ color: 'var(--hc-muted)', textAlign: 'center', paddingTop: '1rem' }}>
                        No reviews yet for this caregiver.
                      </p>
                    ) : (
                      <div style={{ display: 'grid', gap: '1rem' }}>
                        {[...caregiversReviews]
                          .sort((a, b) => parseLocalDate(b.reviewDate).getTime() - parseLocalDate(a.reviewDate).getTime())
                          .map((review) => {
                            const look = ASSESSMENT[review.overallAssessment]
                            return (
                              <div
                                key={review.id}
                                style={{ padding: '1rem', background: 'var(--hc-subtle)', borderLeft: `4px solid ${look?.rule || 'var(--hc-muted)'}`, borderRadius: '4px' }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                                  <div>
                                    <strong>{getClientName(review.clientId)}</strong>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--hc-muted)' }}>{formatDate(review.reviewDate)}</div>
                                  </div>
                                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <span className={`hc-badge ${look?.badge || 'hc-badge-secondary'}`}>
                                      {getAssessmentLabel(review.overallAssessment)}
                                    </span>
                                    <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => handleDeleteReview(review.id)}>
                                      Delete
                                    </button>
                                  </div>
                                </div>

                                <div style={{ marginBottom: '0.75rem' }}>
                                  <strong>Notes:</strong>
                                  <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>{review.performanceNotes}</p>
                                </div>

                                {review.strengths && (
                                  <div style={{ marginBottom: '0.75rem' }}>
                                    <strong>Strengths:</strong>
                                    <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>{review.strengths}</p>
                                  </div>
                                )}

                                {review.areasForImprovement && (
                                  <div>
                                    <strong>Areas for Improvement:</strong>
                                    <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>{review.areasForImprovement}</p>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
