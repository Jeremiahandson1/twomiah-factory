// The email body editor for campaigns, templates and drip steps — what an owner writes an email in, in place of the
// raw HTML box (salon live test, 2026-10-25: "the campaign body is an HTML box").
//
// Write: the email itself, editable — headings, paragraphs, bold and italic, links, bullet lists, an image from the
// business's photos, a button in the business's colour — with the merge fields one click away.
// Preview: the email as a sample person would read it, merge fields filled.
// HTML: the source, for an owner who wants it, and where an email written in HTML before the editor opens, so it sends
// exactly as it was written (emailBlocks.ts editsVisually).
//
// WHY A FRAME: the editing surface is a sandboxed iframe (no scripts) holding the email, not a contentEditable div in
// the app. An email written as HTML carries its own markup and styles; in the app's page an <img onerror> would run as
// the signed-in owner and a <style> block would restyle the whole app. In the frame neither can happen, and the email
// is drawn in its own look, not the app's. Nothing here is the safety net, though: the server keeps only its allow-list
// of whatever is saved (tenant-backend marketing/emailHtml.ts).
import React, { useEffect, useRef, useState } from 'react'
import { Heading2, Pilcrow, Bold, Italic, Link2, List, Image as ImageIcon, MousePointerClick } from 'lucide-react'
import { Button, inputCls } from '../invoicing/ui'
import { offeredMergeFields, marketingCopy, type MergeField } from './marketingCopy'
import { editsVisually, linkHref, imageSrc, linkHtml, imageHtml, buttonHtml, editorOutput, editorDoc, previewDoc, previewSubject } from './emailBlocks'
import { brandSurfaceUnderWhite } from '../brand'

/** The business's colour as a button white text can sit on (brand.ts, the clamp every email button uses); dark grey without one. */
const buttonColour = (brandColor?: string | null) => (/^#[0-9a-fA-F]{6}$/.test(brandColor || '') ? brandSurfaceUnderWhite(brandColor as string) : '#1f2937')

/** The business's look, for the button colour and the logo. */
export interface EmailBrand { name?: string | null; color?: string | null; logo?: string | null }

type Mode = 'visual' | 'preview' | 'html'
type Panel = null | 'link' | 'button' | 'image'
const MERGE_TOKEN = /\{\{\s*([A-Za-z_]\w*)\s*\}\}|\{\s*([A-Za-z_]\w*)\s*\}/g

/** The tokens in the texts that are not a field the server fills (it refuses to save them). */
export function unknownTokens(fields: MergeField[], ...texts: string[]): string[] {
  if (!fields.length) return []
  const known = new Set(fields.map((f) => f.key.toLowerCase()))
  const out = new Set<string>()
  for (const t of texts) for (const m of String(t || '').matchAll(MERGE_TOKEN)) if (!known.has(String(m[1] ?? m[2]).toLowerCase())) out.add(m[0])
  return [...out]
}

/** Put `token` into `value` where the textarea's cursor is (the end when it has none), and the cursor after it. */
function insertAt(el: HTMLTextAreaElement | null, value: string, token: string, set: (v: string) => void) {
  const start = el && document.activeElement === el ? el.selectionStart : value.length
  const end = el && document.activeElement === el ? el.selectionEnd : value.length
  set(value.slice(0, start) + token + value.slice(end))
  requestAnimationFrame(() => { if (!el) return; el.focus(); el.setSelectionRange(start + token.length, start + token.length) })
}

const tabCls = (on: boolean) => `px-3 py-1.5 text-sm rounded-md ${on ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100'}`
const toolCls = 'inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-700'

export function EmailEditor({ value, onChange, fields, subject = '', brand, pickImage, compact = false }: {
  value: string
  onChange: (html: string) => void
  /** The server's merge fields (GET /api/marketing/merge-fields): all of them are checked, the offered ones shown. */
  fields: MergeField[]
  /** The subject line, for the preview and the merge-field check. */
  subject?: string
  brand?: EmailBrand
  /** The app's photo library: resolves to the chosen photo's address, or null. Without it an image is added by address. */
  pickImage?: () => Promise<string | null>
  /** A smaller surface, for a drip step. */
  compact?: boolean
}) {
  const [mode, setMode] = useState<Mode>(() => (editsVisually(value) ? 'visual' : 'html'))
  const [confirmVisual, setConfirmVisual] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [panelText, setPanelText] = useState('')
  const [panelUrl, setPanelUrl] = useState('')
  const [notice, setNotice] = useState('')
  const frameRef = useRef<HTMLIFrameElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const savedRange = useRef<Range | null>(null)
  /** The body as the frame last had it: a value from outside (a step removed above this one) is loaded into the frame. */
  const shown = useRef<string>(value)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const valueRef = useRef(value)
  valueRef.current = value
  const copy = marketingCopy()
  const height = compact ? 180 : 320

  const frameDoc = () => frameRef.current?.contentDocument ?? null
  const emit = (doc: Document) => {
    const html = editorOutput(doc.body.innerHTML)
    shown.current = html
    if (html !== valueRef.current) onChangeRef.current(html)
  }
  const onFrameLoad = () => {
    const doc = frameDoc()
    if (!doc?.body) return
    doc.body.innerHTML = valueRef.current
    shown.current = valueRef.current
    doc.body.contentEditable = 'true'
    try { doc.execCommand('defaultParagraphSeparator', false, 'p') } catch { /* older engines write <div>; both are kept */ }
    doc.addEventListener('input', () => emit(doc))
    doc.addEventListener('selectionchange', () => { const sel = doc.getSelection(); if (sel && sel.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange() })
  }
  useEffect(() => {
    if (mode !== 'visual') return
    const doc = frameDoc()
    if (doc?.body?.isContentEditable && value !== shown.current) { doc.body.innerHTML = value; shown.current = value; savedRange.current = null }
  }, [value, mode])

  /** Run an editing command where the owner's cursor was (the end of the email when it has not been in it yet). */
  const exec = (command: string, arg?: string) => {
    const frame = frameRef.current
    const doc = frameDoc()
    if (!frame || !doc?.body) return
    frame.contentWindow?.focus()
    const sel = doc.getSelection()
    if (sel) {
      let range = savedRange.current
      if (!range || !doc.body.contains(range.commonAncestorContainer)) { range = doc.createRange(); range.selectNodeContents(doc.body); range.collapse(false) }
      sel.removeAllRanges(); sel.addRange(range)
    }
    doc.execCommand(command, false, arg)
    emit(doc)
  }

  const insertToken = (token: string) => (mode === 'visual' ? exec('insertText', token) : insertAt(textRef.current, value, token, onChange))
  const openPanel = (p: Panel) => {
    setNotice('')
    setPanelUrl('')
    setPanelText(p === 'link' ? savedRange.current?.toString() || '' : '')
    setPanel(p)
  }
  const addImage = async () => {
    setNotice('')
    if (!pickImage) { openPanel('image'); return }
    const picked = await pickImage()
    if (!picked) return
    const src = imageSrc(picked, window.location.origin)
    if (src) exec('insertHTML', imageHtml(src)); else setNotice('That photo has no web address an inbox can load. Choose another, or upload it again.')
  }
  const addLogo = () => {
    const src = imageSrc(brand?.logo || '', window.location.origin)
    if (src) exec('insertHTML', imageHtml(src, brand?.name || ''))
  }
  const applyPanel = () => {
    if (panel === 'image') {
      const src = imageSrc(panelUrl, window.location.origin)
      if (!src || !/^https?:\/\//i.test(panelUrl.trim())) { setNotice('Enter the picture\'s web address, starting https://'); return }
      exec('insertHTML', imageHtml(src, panelText.trim())); setPanel(null); return
    }
    const href = linkHref(panelUrl)
    if (!href) { setNotice('Enter a web address (example.com), an email address, or a phone number as tel:+15551234567.'); return }
    if (panel === 'button') {
      if (!panelText.trim()) { setNotice('Write what the button says, e.g. Book now.'); return }
      exec('insertHTML', buttonHtml(panelText.trim(), href, buttonColour(brand?.color)))
    } else {
      const selected = savedRange.current?.toString() || ''
      if (selected && selected === panelText) exec('createLink', href)
      else exec('insertHTML', linkHtml(panelText.trim() || panelUrl.trim(), href))
    }
    setPanel(null)
  }
  const switchTo = (m: Mode) => {
    setPanel(null); setNotice('')
    if (m === 'visual' && mode === 'html' && !editsVisually(value)) { setConfirmVisual(true); return }
    setConfirmVisual(false)
    setMode(m)
  }

  const offered = offeredMergeFields(fields)
  const bad = unknownTokens(fields, subject, value)
  return (
    <div data-testid="email-editor">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-slate-800" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'visual'} onClick={() => switchTo('visual')} className={tabCls(mode === 'visual')}>Write</button>
          <button type="button" role="tab" aria-selected={mode === 'preview'} onClick={() => switchTo('preview')} className={tabCls(mode === 'preview')}>Preview</button>
          <button type="button" role="tab" aria-selected={mode === 'html'} onClick={() => switchTo('html')} className={tabCls(mode === 'html')}>HTML</button>
        </div>
      </div>

      {confirmVisual && (
        <div role="alert" className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <p>This email has layout the editor can't keep — a table, a style block or a whole page. Editing it here may change how it looks once you type.</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmVisual(false)}>Keep the HTML</Button>
            <Button type="button" onClick={() => { setConfirmVisual(false); setMode('visual') }}>Edit it here anyway</Button>
          </div>
        </div>
      )}

      {mode === 'visual' && (
        <>
          <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-b-0 border-gray-300 bg-gray-50 px-1 py-1 dark:border-slate-600 dark:bg-slate-800" role="toolbar" aria-label="Formatting">
            <button type="button" className={toolCls} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<h2>')} title="Heading"><Heading2 className="w-4 h-4" /><span className="sr-only">Heading</span></button>
            <button type="button" className={toolCls} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<p>')} title="Paragraph"><Pilcrow className="w-4 h-4" /><span className="sr-only">Paragraph</span></button>
            <button type="button" className={toolCls} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} title="Bold"><Bold className="w-4 h-4" /><span className="sr-only">Bold</span></button>
            <button type="button" className={toolCls} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} title="Italic"><Italic className="w-4 h-4" /><span className="sr-only">Italic</span></button>
            <button type="button" className={toolCls} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} title="Bullet list"><List className="w-4 h-4" /><span className="sr-only">Bullet list</span></button>
            <span className="mx-1 h-5 w-px bg-gray-300 dark:bg-slate-600" aria-hidden="true" />
            <button type="button" className={toolCls} onMouseDown={(e) => e.preventDefault()} onClick={() => openPanel('link')}><Link2 className="w-4 h-4" />Link</button>
            <button type="button" className={toolCls} onMouseDown={(e) => e.preventDefault()} onClick={addImage}><ImageIcon className="w-4 h-4" />Image</button>
            <button type="button" className={toolCls} onMouseDown={(e) => e.preventDefault()} onClick={() => openPanel('button')}><MousePointerClick className="w-4 h-4" />Button</button>
            {!!imageSrc(brand?.logo || '', typeof window === 'undefined' ? 'http://localhost' : window.location.origin) && (
              <button type="button" className={toolCls} onMouseDown={(e) => e.preventDefault()} onClick={addLogo}><ImageIcon className="w-4 h-4" />Logo</button>
            )}
          </div>
          {panel && (
            // Escape here closes this panel only — marked handled, so the dialog around the editor stays open (the
            // shared Modal ignores an Escape a control already handled).
            <div onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPanel(null); setNotice('') } }}
              className="grid gap-2 border border-b-0 border-gray-300 bg-gray-50 px-3 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end dark:border-slate-600 dark:bg-slate-800">
              <label className="text-xs text-gray-700 dark:text-slate-300">{panel === 'button' ? 'Button text' : panel === 'image' ? 'Description (for screen readers)' : 'Text to show'}
                <input value={panelText} onChange={(e) => setPanelText(e.target.value)} className={`${inputCls} mt-1`} placeholder={panel === 'button' ? 'Book now' : ''} />
              </label>
              <label className="text-xs text-gray-700 dark:text-slate-300">{panel === 'image' ? 'Picture address' : 'Goes to'}
                <input value={panelUrl} onChange={(e) => setPanelUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPanel() } }} className={`${inputCls} mt-1`} placeholder={panel === 'image' ? 'https://…' : 'example.com/book'} />
              </label>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => { setPanel(null); setNotice('') }}>Cancel</Button>
                <Button type="button" onClick={applyPanel}>Add</Button>
              </div>
            </div>
          )}
          <iframe ref={frameRef} title="Email body" sandbox="allow-same-origin" srcDoc={editorDoc()} onLoad={onFrameLoad}
            className="block w-full rounded-b-lg border border-gray-300 bg-white dark:border-slate-600 dark:bg-white" style={{ height }} />
        </>
      )}

      {mode === 'preview' && (
        <div className="rounded-lg border border-gray-300 dark:border-slate-600 overflow-hidden" data-testid="email-preview">
          <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <span className="text-gray-500 dark:text-slate-400">Subject: </span>{previewSubject(subject, copy.sample, fields) || '—'}
          </div>
          <iframe title="Email preview" sandbox="" srcDoc={previewDoc(value, copy.sample, fields)} className="block w-full bg-white dark:bg-white" style={{ height }} />
          <p className="border-t border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Shown with a sample person's details. An unsubscribe link is added at the bottom of every email.</p>
        </div>
      )}

      {mode === 'html' && (
        <>
          {!editsVisually(value) && <p className="mb-2 text-xs text-gray-600 dark:text-slate-300">This email was written in HTML, so it is shown here and sends exactly as written.</p>}
          <textarea ref={textRef} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} font-mono text-sm`} rows={compact ? 6 : 12} aria-label="Email body (HTML)" />
        </>
      )}

      {notice && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{notice}</p>}

      {offered.length > 0 && mode !== 'preview' && (
        <div className="mt-2" data-testid="merge-fields">
          <p className="text-xs text-gray-600 dark:text-slate-300 mb-1">Personalize — click to insert where your cursor is:</p>
          <div className="flex flex-wrap gap-1.5">
            {offered.map((f) => (
              <button key={f.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertToken(f.token)} title={`Inserts ${f.token}`}
                className="px-2 py-1 rounded-md border border-gray-300 bg-white text-xs text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                {f.label} <code className="text-gray-500 dark:text-slate-400">{f.token}</code>
              </button>
            ))}
          </div>
        </div>
      )}
      {bad.length > 0 && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {bad.join(', ')} {bad.length === 1 ? 'is not a field we can fill' : 'are not fields we can fill'} — it would be sent as written. Use one of the fields above.
        </p>
      )}
    </div>
  )
}
