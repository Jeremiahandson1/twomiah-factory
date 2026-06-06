import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Save, Trash2, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { findSectionDef, SECTION_DEFS } from '../sectionSchema'
import { SectionFormDispatcher } from '../components/SectionFormDispatcher'
import { AddSectionMenu } from '../components/AddSectionMenu'

interface Section { type: string; variant: string; data: Record<string, any> }

function VariantPicker({ currentType, currentVariant, onChange }: { currentType: string; currentVariant: string; onChange: (v: string) => void }) {
  const siblings = SECTION_DEFS.filter(d => d.type === currentType)
  if (siblings.length <= 1) return null
  return (
    <div className="mb-4 pb-4 border-b border-line">
      <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Layout variant</label>
      <select
        value={currentVariant}
        onChange={(e) => {
          if (e.target.value === currentVariant) return
          if (!window.confirm("Switch this section's layout? We'll keep your text and images but the new variant may show different fields.")) {
            e.target.value = currentVariant
            return
          }
          onChange(e.target.value)
        }}
        className="input"
      >
        {siblings.map(def => (
          <option key={def.variant} value={def.variant}>{def.label}</option>
        ))}
      </select>
      <p className="text-xs text-muted mt-1.5">
        {siblings.find(d => d.variant === currentVariant)?.description}
      </p>
    </div>
  )
}
interface Page {
  id: string
  slug: string
  title: string
  sections: Section[]
  isPublished: boolean
  metaTitle?: string | null
  metaDescription?: string | null
}

export function PageEditPage() {
  const { slug } = useParams<{ slug: string }>()
  const [page, setPage] = useState<Page | null>(null)
  const [originalJson, setOriginalJson] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)
  const previewIframe = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    api.get<{ page: Page }>(`/api/admin/pages/${slug}`)
      .then(({ page }) => {
        setPage(page)
        setOriginalJson(JSON.stringify(page))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug])

  const isDirty = useMemo(() => page ? JSON.stringify(page) !== originalJson : false, [page, originalJson])

  const update = (patch: Partial<Page>) => setPage((p) => p ? { ...p, ...patch } : p)

  const updateSection = (i: number, next: Section) => {
    if (!page) return
    const nextSections = [...page.sections]
    nextSections[i] = next
    update({ sections: nextSections })
  }

  const moveSection = (i: number, dir: -1 | 1) => {
    if (!page) return
    const j = i + dir
    if (j < 0 || j >= page.sections.length) return
    const nextSections = [...page.sections]
    ;[nextSections[i], nextSections[j]] = [nextSections[j], nextSections[i]]
    update({ sections: nextSections })
    if (expandedIdx === i) setExpandedIdx(j)
    else if (expandedIdx === j) setExpandedIdx(i)
  }

  const removeSection = (i: number) => {
    if (!page) return
    if (!confirm('Remove this section?')) return
    update({ sections: page.sections.filter((_, j) => j !== i) })
    if (expandedIdx === i) setExpandedIdx(null)
  }

  const addSection = (def: { type: string; variant: string; defaultData: Record<string, unknown> }) => {
    if (!page) return
    const newSection: Section = { type: def.type, variant: def.variant, data: { ...def.defaultData } }
    const nextSections = [...page.sections, newSection]
    update({ sections: nextSections })
    setExpandedIdx(nextSections.length - 1)
  }

  const save = async () => {
    if (!page) return
    setSaving(true)
    setError(null)
    try {
      const { page: updated } = await api.patch<{ page: Page }>(`/api/admin/pages/${slug}`, {
        title: page.title,
        sections: page.sections,
        metaTitle: page.metaTitle,
        metaDescription: page.metaDescription,
        isPublished: page.isPublished,
      })
      setPage(updated)
      setOriginalJson(JSON.stringify(updated))
      previewIframe.current?.contentWindow?.location.reload()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-muted text-sm">Loading…</div>
  if (error && !page) return <div className="p-8 text-red-700 text-sm">{error}</div>
  if (!page) return null

  const publicHref = '/' + (page.slug === 'home' ? '' : page.slug)

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="border-b border-line bg-white px-6 py-3 flex items-center gap-4 shrink-0">
        <Link to="/pages" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Pages
        </Link>
        <div className="w-px h-5 bg-line" />
        <input
          type="text"
          value={page.title}
          onChange={(e) => update({ title: e.target.value })}
          className="font-display text-xl text-ink bg-transparent border-0 focus:outline-none focus:ring-0 flex-1"
          placeholder="Page title"
        />
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={page.isPublished}
            onChange={(e) => update({ isPublished: e.target.checked })}
            className="rounded border-line"
          />
          Published
        </label>
        {error && <div className="text-red-700 text-sm">{error}</div>}
        {isDirty && <span className="text-amber-700 text-xs font-semibold">Unsaved changes</span>}
        <button onClick={save} disabled={saving || !isDirty} className="btn-primary btn-md inline-flex items-center gap-1.5 disabled:opacity-40">
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Two-pane: editor + preview */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: section list */}
        <div className="w-[480px] shrink-0 border-r border-line overflow-auto bg-paper p-5 space-y-3">
          {page.sections.length === 0 && (
            <div className="text-sm text-muted bg-white border border-line rounded-lg p-4 text-center">
              No sections yet. Add one below.
            </div>
          )}

          {page.sections.map((section, i) => {
            const def = findSectionDef(section.type, section.variant)
            const isOpen = expandedIdx === i
            return (
              <div key={i} className="card overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-2 bg-white">
                  <button
                    type="button"
                    onClick={() => setExpandedIdx(isOpen ? null : i)}
                    className="flex-1 text-left flex items-center gap-2 min-w-0"
                  >
                    <span className="text-xs font-mono text-muted shrink-0">{String(i + 1).padStart(2, '0')}</span>
                    <span className="font-semibold text-sm text-ink truncate">{def?.label || `${section.type}/${section.variant}`}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(i, -1)}
                    disabled={i === 0}
                    className="btn-secondary btn-sm disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(i, 1)}
                    disabled={i === page.sections.length - 1}
                    className="btn-secondary btn-sm disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(i)}
                    className="btn-secondary btn-sm text-red-600"
                    aria-label="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {isOpen && (
                  <div className={clsx('px-4 py-4 border-t border-line bg-paper')}>
                    <VariantPicker
                      currentType={section.type}
                      currentVariant={section.variant}
                      onChange={(newVariant) => {
                        const targetDef = SECTION_DEFS.find(d => d.type === section.type && d.variant === newVariant)
                        if (!targetDef) return
                        // Preserve any fields that exist in the new variant's
                        // shape — title, image, etc. usually carry over fine.
                        const merged = { ...targetDef.defaultData, ...section.data } as Record<string, any>
                        updateSection(i, { ...section, variant: newVariant, data: merged })
                      }}
                    />
                    <SectionFormDispatcher
                      type={section.type}
                      variant={section.variant}
                      data={section.data}
                      onChange={(d) => updateSection(i, { ...section, data: d })}
                    />
                  </div>
                )}
              </div>
            )
          })}

          <AddSectionMenu onAdd={addSection} />

          {/* SEO */}
          <div className="card card-padding mt-6">
            <div className="font-semibold text-sm text-ink mb-3">SEO (optional, overrides site defaults)</div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Meta title</label>
                <input
                  type="text"
                  value={page.metaTitle || ''}
                  onChange={(e) => update({ metaTitle: e.target.value || null })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Meta description</label>
                <textarea
                  rows={2}
                  value={page.metaDescription || ''}
                  onChange={(e) => update({ metaDescription: e.target.value || null })}
                  className="input"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: live preview */}
        <div className="flex-1 bg-paper flex flex-col">
          <div className="px-4 py-2 border-b border-line bg-white flex items-center gap-3 text-sm shrink-0">
            <div className="text-muted">Live preview</div>
            <div className="text-xs text-muted ml-auto">{publicHref}</div>
            <button
              type="button"
              onClick={() => previewIframe.current?.contentWindow?.location.reload()}
              className="btn-secondary btn-sm inline-flex items-center gap-1.5"
              title="Reload preview"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <a href={publicHref} target="_blank" rel="noreferrer" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5" />
              Open
            </a>
          </div>
          <iframe
            ref={previewIframe}
            src={publicHref}
            className="flex-1 w-full border-0 bg-white"
            title="Live preview"
          />
        </div>
      </div>
    </div>
  )
}
