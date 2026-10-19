// Moved from templates/crm-homecare/frontend/src/components/admin/VisitPhotoGallery.tsx (ported there from the CVHC home
// care CRM) — the office's view of a client's visit photos. The list fetches metadata only; opening a thumbnail loads the
// full image, so a client with 200 visits doesn't blow up the network.
//
// Server (server/crm/homecare/visits/timeTracking.ts): GET /api/time-entries/photos/client/:clientId?limit ({ data }:
// id, caption, category, takenAt, imageSize, timeEntryId, firstName, lastName) and GET /api/time-entries/photo/:id (the
// photo row, imageBase64 included). Changes from the template: no token; a { data } list and camelCase (taken_at →
// takenAt, image_base64 → imageBase64); the app's toast; every colour a frame token (the thumbnail and the lightbox's
// loading ground stay dark in both themes, with light ink on them).
import { useCallback, useEffect, useState } from 'react'
import { api, rows, errorMessage } from '../lib/http'
import { formatAgencyDateTime } from '../lib/agencyClock'
import { useToast } from '../../../../shared'

/** A row of GET /api/time-entries/photos/client/:clientId. */
interface PhotoMeta {
  id: string
  caption: string | null
  category: string | null
  takenAt: string | null
  firstName?: string | null
  lastName?: string | null
}

/** GET /api/time-entries/photo/:id (the image is only here). */
interface Photo extends PhotoMeta { imageBase64?: string | null }

const DARK_GROUND = '#111827'
const ON_DARK = '#d1d5db'

export default function VisitPhotoGallery({ clientId, limit = 60 }: { clientId?: string | null; limit?: number }) {
  const toast = useToast()
  const [list, setList] = useState<PhotoMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [openPhoto, setOpenPhoto] = useState<Photo | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)

  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    try {
      setList(rows<PhotoMeta>(await api.get(`/api/time-entries/photos/client/${clientId}`, { limit })))
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [clientId, limit])

  useEffect(() => { load() }, [load])

  const openLightbox = async (photoMeta: PhotoMeta) => {
    setLoadingFull(true)
    setOpenPhoto({ ...photoMeta, imageBase64: null })
    try {
      // The one-photo reply is the photo row: it carries no uploader name, which the list row has.
      const full: Photo = await api.get(`/api/time-entries/photo/${photoMeta.id}`)
      setOpenPhoto({ ...photoMeta, ...full, firstName: photoMeta.firstName, lastName: photoMeta.lastName })
    } catch (e) {
      toast.error('Failed to load photo: ' + errorMessage(e, 'load failed'))
      setOpenPhoto(null)
    } finally { setLoadingFull(false) }
  }

  const fmtDate = (t: string | null | undefined) => formatAgencyDateTime(t, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const muted = { color: 'var(--hc-muted)' }

  if (!clientId) return <div style={{ padding: 20, ...muted }}>Pick a client to view their visit photos.</div>
  if (loading) return <div style={{ padding: 20, ...muted }}>Loading photos…</div>
  if (list.length === 0) return <div style={{ padding: 20, ...muted }}>No visit photos on record for this client yet.</div>

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>
        <strong>{list.length}</strong> photos {limit < 1000 && list.length === limit ? `(showing latest ${limit})` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {list.map((p) => (
          <button key={p.id} onClick={() => openLightbox(p)}
            style={{ padding: 0, border: '1px solid var(--hc-line)', borderRadius: 8, background: 'var(--hc-subtle)', color: 'var(--hc-ink)', cursor: 'pointer', textAlign: 'left', overflow: 'hidden' }}>
            <div style={{ background: DARK_GROUND, height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ON_DARK, fontSize: 28 }}>
              📷
            </div>
            <div style={{ padding: '5px 7px', fontSize: '0.72rem' }}>
              <div style={{ fontWeight: 700, color: 'var(--hc-ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.caption || (p.category ? p.category : 'Visit photo')}
              </div>
              <div style={muted}>{fmtDate(p.takenAt)}</div>
              {p.firstName && (
                <div style={{ ...muted, fontSize: '0.68rem' }}>{p.firstName} {p.lastName?.[0] || ''}.</div>
              )}
            </div>
          </button>
        ))}
      </div>

      {openPhoto && (
        <div onClick={() => setOpenPhoto(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '95vw', maxHeight: '95vh', background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: 8, padding: 12, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.9rem' }}>
                <strong>{openPhoto.caption || openPhoto.category || 'Visit photo'}</strong>
                {' '}<span style={{ ...muted, fontSize: '0.8rem' }}>· {fmtDate(openPhoto.takenAt)}</span>
              </div>
              <button onClick={() => setOpenPhoto(null)} aria-label="Close"
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', ...muted }}>×</button>
            </div>
            {loadingFull && !openPhoto.imageBase64 ? (
              <div style={{ width: 600, maxWidth: '85vw', height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', background: DARK_GROUND, color: ON_DARK }}>
                Loading photo…
              </div>
            ) : openPhoto.imageBase64 ? (
              <img src={openPhoto.imageBase64} alt={openPhoto.caption || ''}
                style={{ maxWidth: '90vw', maxHeight: '80vh', display: 'block', margin: '0 auto', borderRadius: 4 }} />
            ) : null}
            {openPhoto.firstName && (
              <div style={{ marginTop: 8, fontSize: '0.8rem', ...muted }}>
                Uploaded by {openPhoto.firstName} {openPhoto.lastName}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
