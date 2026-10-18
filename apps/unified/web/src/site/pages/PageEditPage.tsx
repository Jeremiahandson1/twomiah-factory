import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Save, Trash2, RefreshCw } from 'lucide-react'
import { PageError, useConfirm, useMayWrite } from '../../shared'
import { api } from '../../api'
import { findSectionDef, SECTION_DEFS } from '../sectionSchema'
import { SectionFormDispatcher } from '../components/SectionFormDispatcher'
import { AddSectionMenu } from '../components/AddSectionMenu'

interface Section { type: string; variant: string; data: Record<string, any> }

interface Page {
  id: string
  slug: string
  title: string
  sections: Section[]
  isPublished: boolean
  metaTitle?: string | null
  metaDescription?: string | null
}

function VariantPicker({ currentType, currentVariant, onChange }: { currentType: string; currentVariant: string; onChange: (v: string) => void }) {
  const confirm = useConfirm()
  const siblings = SECTION_DEFS.filter(d => d.type === currentType)
  if (siblings.length <= 1) return null
  return (
    <div className="mb-4 pb-4 border-b border-line">
      <label htmlFor={`variant-${currentType}`} className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Layout variant</label>
      <select
        id={`variant-${currentType}`}
        value={currentVariant}
        onChange={async (e) => {
          const next = e.target.value
          if (next === currentVariant) return
          const ok = await confirm("We'll keep your text and images, but the new layout may show different fields.", { title: "Switch this section's layout?", confirmText: 'Switch', danger: false })
          if (ok) onChange(next)
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

export function PageEditPage() {
  const { slug } = useParams<{ slug: string }>()
  const confirm = useConfirm()
  const mayEdit = useMayWrite('site:update')
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
    api.get(`/api/site/pages/${slug}`)
      .then((p: Page) => {
        setPage(p)
        setOriginalJson(JSON.stringify(p))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug])

  const isDirty = useMemo(() => page ? JSON.stringify(page) !== originalJson : false, [page, originalJson])

  // Leaving with unsaved edits loses them: ask the browser to warn on a reload or a closed tab.
  useEffect(() => {
    if (!isDirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

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

  const removeSection = async (i: number) => {
    if (!page) return
    if (!(await confirm('It leaves the page when you save.', { title: 'Remove this section?', confirmText: 'Remove' }))) return
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
      const updated: Page = await api.patch(`/api/site/pages/${slug}`, {
        title: page.title,
        sections: page.sections,
        metaTitle: page.metaTitle ?? null,
        metaDescription: page.metaDescription ?? null,
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

  if (loading) return <div className="text-muted text-sm">Loading…</div>
  if (!page) return <PageError message={error || 'Page not found'} />

  const publicHref = '/' + (page.slug === 'home' ? '' : page.slug)

  return (
    <div className="card overflow-hidden flex flex-col lg:h-[calc(100vh-7rem)]">
      {/* Toolbar */}
      <div className="border-b border-line px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3 sm:gap-4 shrink-0">
        <Link to="/crm/website/pages" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Pages
        </Link>
        <div className="hidden sm:block w-px h-5 bg-line" />
        <input
          type="text"
          value={page.title}
          onChange={(e) => update({ title: e.target.value })}
          readOnly={!mayEdit}
          aria-label="Page title"
          className="text-xl text-ink bg-transparent dark:bg-transparent border-0 focus:outline-none focus:ring-0 flex-1 min-w-[10rem] px-0"
          placeholder="Page title"
        />
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={page.isPublished}
            disabled={!mayEdit}
            onChange={(e) => update({ isPublished: e.target.checked })}
            className="rounded border-line"
          />
          Published
        </label>
        {isDirty && <span className="text-amber-700 dark:text-amber-300 text-xs font-semibold">Unsaved changes</span>}
        {mayEdit && (
          <button type="button" onClick={save} disabled={saving || !isDirty} className="btn-primary btn-md disabled:opacity-40">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        <PageError message={error} className="w-full" />
      </div>

      {/* Two panes on a wide screen: the editor and the live page. On a narrow one, the editor and an Open link. */}
      <div className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden">
        <div className="w-full lg:w-[480px] shrink-0 lg:border-r border-line lg:overflow-auto bg-paper p-4 sm:p-5 space-y-3">
          {page.sections.length === 0 && (
            <div className="text-sm text-muted bg-white dark:bg-slate-900 border border-line rounded-lg p-4 text-center">
              No sections yet.{mayEdit && ' Add one below.'}
            </div>
          )}

          {page.sections.map((section, i) => {
            const def = findSectionDef(section.type, section.variant)
            const isOpen = expandedIdx === i
            const name = def?.label || `${section.type}/${section.variant}`
            return (
              <div key={i} className="card overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedIdx(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex-1 text-left flex items-center gap-2 min-w-0"
                  >
                    <span className="text-xs font-mono text-muted shrink-0">{String(i + 1).padStart(2, '0')}</span>
                    <span className="font-semibold text-sm text-ink truncate">{name}</span>
                  </button>
                  {mayEdit && (
                    <>
                      <button type="button" onClick={() => moveSection(i, -1)} disabled={i === 0} className="btn-secondary btn-sm disabled:opacity-30" aria-label={`Move ${name} up`}>
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => moveSection(i, 1)} disabled={i === page.sections.length - 1} className="btn-secondary btn-sm disabled:opacity-30" aria-label={`Move ${name} down`}>
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => removeSection(i)} className="btn-secondary btn-sm text-red-700 dark:text-red-300" aria-label={`Remove ${name}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
                {isOpen && (
                  <fieldset disabled={!mayEdit} className="px-4 py-4 border-t border-line bg-paper min-w-0">
                    <VariantPicker
                      currentType={section.type}
                      currentVariant={section.variant}
                      onChange={(newVariant) => {
                        const targetDef = SECTION_DEFS.find(d => d.type === section.type && d.variant === newVariant)
                        if (!targetDef) return
                        // Keep what carries over (title, image…): the new variant's defaults under the section's own data.
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
                  </fieldset>
                )}
              </div>
            )
          })}

          {mayEdit && <AddSectionMenu onAdd={addSection} />}

          {/* SEO */}
          <fieldset disabled={!mayEdit} className="card card-padding mt-6 min-w-0">
            <div className="font-semibold text-sm text-ink mb-3">SEO (optional, overrides site defaults)</div>
            <div className="space-y-3">
              <div>
                <label htmlFor="page-meta-title" className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Meta title</label>
                <input
                  id="page-meta-title"
                  type="text"
                  value={page.metaTitle || ''}
                  onChange={(e) => update({ metaTitle: e.target.value || null })}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="page-meta-description" className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Meta description</label>
                <textarea
                  id="page-meta-description"
                  rows={2}
                  value={page.metaDescription || ''}
                  onChange={(e) => update({ metaDescription: e.target.value || null })}
                  className="input"
                />
              </div>
            </div>
          </fieldset>
        </div>

        {/* Live preview */}
        <div className="flex-1 bg-paper flex flex-col border-t lg:border-t-0 border-line">
          <div className="px-4 py-2 border-b border-line flex items-center gap-3 text-sm shrink-0">
            <div className="text-muted hidden lg:block">Live preview</div>
            <div className="text-xs text-muted lg:ml-auto truncate">{publicHref}</div>
            <button
              type="button"
              onClick={() => previewIframe.current?.contentWindow?.location.reload()}
              className="btn-secondary btn-sm hidden lg:inline-flex"
              aria-label="Reload preview"
              title="Reload preview"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <a href={publicHref} target="_blank" rel="noreferrer" className="btn-secondary btn-sm ml-auto lg:ml-0">
              <ExternalLink className="w-3.5 h-3.5" />
              Open
            </a>
          </div>
          <iframe
            ref={previewIframe}
            src={publicHref}
            className="hidden lg:block flex-1 w-full border-0 bg-white"
            title="Live preview"
          />
        </div>
      </div>
    </div>
  )
}
