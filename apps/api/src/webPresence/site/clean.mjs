// Everything the Web presence site saves is cleaned HERE, on the server, to a type and a length — never trusted from the editor
// (Potato lesson 3). Dependency-free: the Factory and the site's function both import this one file.
import { SHAPES, LIMITS } from './shapes.mjs'

const CTRL = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]', 'g')

/** One line of text: control and bidi characters out, whitespace collapsed, cut to `max`. */
export function cleanLine(v, max) {
  if (typeof v !== 'string' && typeof v !== 'number') return ''
  return String(v).replace(CTRL, '').replace(/\s+/g, ' ').trim().slice(0, max)
}
/** Several lines: line breaks kept (at most 2 in a row), the rest as cleanLine. */
export function cleanBlock(v, max) {
  if (typeof v !== 'string') return ''
  return v.replace(/\r\n?/g, '\n').replace(CTRL, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}
const NO_BAD = /[\s"'<>`\\]/
/** A link an owner may put on a button: https, tel, mailto, an in-page #anchor or a path on this site. Anything else: ''. */
export function cleanLink(v) {
  const s = cleanLine(v, 500)
  if (!s || NO_BAD.test(s)) return ''
  if (/^https:\/\/[^/]+\.[^/]+/i.test(s)) return s
  if (/^tel:\+?[0-9()-]{3,30}$/.test(s)) return s
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return s
  if (/^#[a-z0-9_-]{1,40}$/i.test(s)) return s
  if (/^\/(?!\/)[A-Za-z0-9_./-]{0,200}$/.test(s) && !s.includes('..')) return s
  return ''
}
/** A photo: one this site stores (/media?h=<hash>), one of the shared library, or an https address. */
export function cleanImage(v) {
  const s = cleanLine(v, 500)
  if (!s || NO_BAD.test(s)) return ''
  if (/^\/media\?h=[0-9a-f]{40}$/.test(s)) return s
  if (/^\/hero-library\/[A-Za-z0-9_./-]+$/.test(s) && !s.includes('..')) return s
  if (/^https:\/\/[^/]+\.[^/]+\/\S*$/i.test(s)) return s
  return ''
}
export function cleanDate(v) {
  const s = cleanLine(v, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : ''
}
export function cleanEmail(v) {
  const s = cleanLine(v, 120).toLowerCase()
  return /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]{2,}$/.test(s) ? s : ''
}
export function cleanPhone(v) {
  const s = cleanLine(v, 30)
  if (!/^[0-9+().\- x]{7,30}$/.test(s)) return ''
  // A plain ten-digit number (the signup keeps them bare) reads as (608) 555-1234; anything else is kept as typed.
  const d = s.replace(/\D/g, '')
  const m = /^[0-9().\- ]+$/.test(s) ? d.match(/^1?(\d{3})(\d{3})(\d{4})$/) : null
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : s
}

/** Clean `v` to `shape` (shapes.mjs). Never throws; a wrong type becomes the empty value of the shape. */
export function cleanShape(shape, v, depth = 0) {
  if (depth > 5) return undefined
  if (typeof shape === 'string') {
    if (shape === 'bool') return v === true
    if (shape === 'link') return cleanLink(v)
    if (shape === 'img') return cleanImage(v)
    if (shape === 'date') return cleanDate(v)
    const m = /^(t|tl):(\d+)$/.exec(shape)
    if (m) return m[1] === 'tl' ? cleanBlock(v, +m[2]) : cleanLine(v, +m[2])
    return ''
  }
  if (Array.isArray(shape) && shape.length === 2 && typeof shape[1] === 'number') {
    const arr = Array.isArray(v) ? v.slice(0, shape[1]) : []
    return arr.map((x) => cleanShape(shape[0], x, depth + 1)).filter((x) => (x && typeof x === 'object' ? Object.values(x).some((y) => (Array.isArray(y) ? y.length : y)) : x !== ''))
  }
  if (Array.isArray(shape)) { const s = cleanLine(v, 40); return shape.includes(s) ? s : shape[0] }
  if (shape && typeof shape === 'object') {
    const src = v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    const out = {}
    for (const k of Object.keys(shape)) out[k] = cleanShape(shape[k], src[k], depth + 1)
    return out
  }
  return undefined
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
/** The week's hours: { monday: { open:'09:00', close:'17:00' } | { closed:true } }; a day not said is left out. */
export function cleanHours(v) {
  const out = {}
  if (!v || typeof v !== 'object') return out
  for (const d of DAYS) {
    const h = v[d]
    if (!h || typeof h !== 'object') continue
    if (h.closed === true) out[d] = { closed: true }
    else if (TIME.test(String(h.open)) && TIME.test(String(h.close)) && String(h.open) < String(h.close)) out[d] = { open: String(h.open), close: String(h.close) }
  }
  return out
}

const HEX = /^#[0-9a-fA-F]{6}$/
const slug = (s) => cleanLine(s, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '')

/**
 * The whole model, cleaned. `spec` (built by the Factory, shipped with the site) says what this site may hold:
 *   spec.caps        { [capabilityId]: { type, variants: [..], anchor } }   what the trade's editor offers NOW
 *   spec.typeVariants { [type]: [variants] }                                 every variant a type may be laid out as
 *   spec.designs     [..]                                                    the looks
 *   spec.styles      { fonts:[..], corners:[..], spacing:[..] }              the type feels (feel.ts)
 *   spec.presets     [..]                                                    the palette presets (palette.ts)
 * `prev` is the model as last saved: a section already on the page stays (and stays editable) even if a change of trade means
 * it could not be ADDED now — "a trade change removes nothing". Colours and type are coarse-checked here and finished by the
 * Factory's render (the contrast guards), which returns the canonical model.
 */
export function cleanModel(raw, spec, prev = null) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const p = prev && typeof prev === 'object' ? prev : {}
  const biz = r.business && typeof r.business === 'object' ? r.business : {}
  const pb = p.business || {}
  const business = {
    name: cleanLine(biz.name, 80) || pb.name || 'My business',
    phone: cleanPhone(biz.phone), email: cleanEmail(biz.email),
    address: cleanLine(biz.address, 160), city: cleanLine(biz.city, 60), state: cleanLine(biz.state, 30), zip: cleanLine(biz.zip, 12),
    tagline: cleanLine(biz.tagline, 140),
    hours: cleanHours(biz.hours),
    serviceAreas: (Array.isArray(biz.serviceAreas) ? biz.serviceAreas : []).map((a) => cleanLine(a, 60)).filter(Boolean).slice(0, 20),
    logo: cleanImage(biz.logo),
  }
  const look = r.look && typeof r.look === 'object' ? r.look : {}
  const plook = p.look || {}
  const pal = look.palette && typeof look.palette === 'object' ? look.palette : {}
  const palette = {}
  for (const k of ['brand', 'band', 'page']) if (HEX.test(String(pal[k] || ''))) palette[k] = String(pal[k]).toLowerCase()
  const designs = Array.isArray(spec.designs) ? spec.designs : []
  const styles = spec.styles && typeof spec.styles === 'object' ? spec.styles : {}
  const st = look.style && typeof look.style === 'object' ? look.style : {}
  const style = {}
  for (const k of ['fonts', 'corners', 'spacing']) if (Array.isArray(styles[k]) && styles[k].includes(st[k])) style[k] = st[k]
  if (Array.isArray(spec.presets) && spec.presets.includes(pal.preset)) palette.preset = pal.preset
  const clean = {
    v: 1,
    business,
    look: {
      design: designs.includes(look.design) ? look.design : (designs.includes(plook.design) ? plook.design : designs[0] || ''),
      palette,
      style,
    },
    forms: {
      lead: { on: !!(r.forms && r.forms.lead && r.forms.lead.on === true), inbox: cleanEmail(r.forms && r.forms.lead && r.forms.lead.inbox), extraFields: [] },
      hiring: { on: !!(r.forms && r.forms.hiring && r.forms.hiring.on === true), inbox: cleanEmail(r.forms && r.forms.hiring && r.forms.hiring.inbox) },
    },
    sections: [],
  }
  const lead = r.forms && r.forms.lead
  clean.forms.lead.extraFields = (Array.isArray(lead && lead.extraFields) ? lead.extraFields : []).map((f) => ({ label: cleanLine(f && f.label, 60) })).filter((f) => f.label).slice(0, 2)
  // Sections: only capabilities the trade offers now, or ones already on the page; once each; the owner's order.
  const had = new Map((Array.isArray(p.sections) ? p.sections : []).filter((s) => s && s.id).map((s) => [s.id, s]))
  const seen = new Set()
  for (const s of (Array.isArray(r.sections) ? r.sections : []).slice(0, LIMITS.sections)) {
    if (!s || typeof s !== 'object') continue
    const id = slug(s.id)
    if (!id || seen.has(id)) continue
    const cap = spec.caps && spec.caps[id]
    const before = had.get(id)
    const type = cap ? cap.type : before ? before.type : ''
    if (!type || !SHAPES[type]) continue
    const variants = (spec.typeVariants && spec.typeVariants[type]) || (cap ? cap.variants : []) || []
    const fallback = (before && before.variant) || (cap && cap.variants && cap.variants[0]) || variants[0] || ''
    const variant = variants.includes(s.variant) ? s.variant : fallback
    if (!variant) continue
    seen.add(id)
    // `hidden` defaults to shown: a section saved before the toggle existed is never hidden by it (Potato lesson 2).
    clean.sections.push({ id, type, variant, hidden: s.hidden === true, data: cleanShape(SHAPES[type], s.data) })
  }
  if (JSON.stringify(clean).length > LIMITS.modelBytes) return { ...clean, sections: [], tooBig: true }
  return clean
}

/**
 * Which forms are REALLY on the published page. A form the owner switched on needs its section shown: the lead form is the
 * contact section's, the job form is the hiring section's. A form that is not live is absent from the page and refused by its endpoint.
 */
export function effectiveForms(model) {
  const shown = (id) => (model && Array.isArray(model.sections) ? model.sections : []).some((s) => s.id === id && !s.hidden)
  const f = (model && model.forms) || {}
  return { lead: !!(f.lead && f.lead.on) && shown('contact'), hiring: !!(f.hiring && f.hiring.on) && shown('hiring') }
}

/** Whether a saved model is too large to keep (the editor tells the owner, the function refuses). */
export const modelTooBig = (m) => JSON.stringify(m).length > LIMITS.modelBytes

// ─── Forms ───────────────────────────────────────────────────────────────────

export const RESUME_TYPES = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }

/** The lead form's fields, cleaned. Returns { ok, error, fields }. A phone number and/or an email is needed. */
export function cleanLead(f, extraLabels = []) {
  const name = cleanLine(f && f.name, 100)
  const email = cleanEmail(f && f.email)
  const phone = cleanPhone(f && f.phone)
  const message = cleanBlock(f && f.message, 3000)
  if (name.length < 2) return { ok: false, error: 'Please enter your name.' }
  if (!email && !phone) return { ok: false, error: 'Please give a phone number or an email so we can reply.' }
  if (f && f.email && String(f.email).trim() && !email) return { ok: false, error: 'Please enter a valid email address, like name@example.com.' }
  if (message.length < 4) return { ok: false, error: 'Please tell us a little about what you need.' }
  // The trade's own questions travel as extra1 / extra2, each "Question: answer" (Netlify Forms knows these two field names).
  const extras = {}
  extraLabels.slice(0, 2).forEach((label, i) => { const v = cleanLine(f && f['extra' + (i + 1)], 200); if (label && v) extras['extra' + (i + 1)] = cleanLine(label, 60) + ': ' + v })
  return { ok: true, fields: { name, email, phone, message, ...extras } }
}

/** The job form's fields, cleaned (the resume is checked separately: checkResume). `jobs` are the titles the owner lists. */
export function cleanApplication(f, jobs = []) {
  const name = cleanLine(f && f.name, 100)
  const email = cleanEmail(f && f.email)
  const phone = cleanPhone(f && f.phone)
  const about = cleanBlock(f && f.about, 1500)
  const availability = cleanLine(f && f.availability, 200)
  const jobWanted = cleanLine(f && f.job, 80)
  if (name.length < 2) return { ok: false, error: 'Please enter your name.' }
  if (!email && !phone) return { ok: false, error: 'Please give a phone number or an email so we can reply.' }
  if (f && f.email && String(f.email).trim() && !email) return { ok: false, error: 'Please enter a valid email address, like name@example.com.' }
  if (about.length < 4) return { ok: false, error: 'Please tell us a little about you.' }
  if (jobWanted && jobs.length && !jobs.includes(jobWanted)) return { ok: false, error: 'That job is not listed.' }
  return { ok: true, fields: { name, email, phone, about, availability, job: jobWanted } }
}

/** A resume's type (by its name AND its first bytes) and size. Returns { ok, error, ext }. `limitMb` is the stated limit. */
export function checkResume(file, limitMb = LIMITS.resumeMb) {
  if (!file) return { ok: true, none: true }
  const name = String(file.name || '')
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (!RESUME_TYPES[ext]) return { ok: false, error: 'A resume must be a PDF or Word file (.pdf, .doc or .docx).' }
  const size = Number(file.size) || 0
  if (size <= 0) return { ok: false, error: 'That file is empty.' }
  if (size > limitMb * 1024 * 1024) return { ok: false, error: 'A resume can be at most ' + limitMb + ' MB.' }
  const head = file.head instanceof Uint8Array ? file.head : null
  if (head) {
    const pdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46            // %PDF
    const zip = head[0] === 0x50 && head[1] === 0x4b                                                      // PK (docx)
    const ole = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0              // legacy .doc
    if ((ext === 'pdf' && !pdf) || (ext === 'docx' && !zip) || (ext === 'doc' && !ole)) return { ok: false, error: 'That file is not really a ' + ext.toUpperCase() + '.' }
  }
  return { ok: true, ext }
}

/** A photo upload's type (by its first bytes) and size. Returns { ok, error, mime, ext }. */
export function checkImage(bytes, limit = LIMITS.imageBytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return { ok: false, error: 'That is not a photo.' }
  if (bytes.length > limit) return { ok: false, error: 'That photo is too large (at most ' + Math.round(limit / 1000) + ' KB after it is resized).' }
  const b = bytes
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ok: true, mime: 'image/jpeg', ext: 'jpg' }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ok: true, mime: 'image/png', ext: 'png' }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ok: true, mime: 'image/webp', ext: 'webp' }
  return { ok: false, error: 'Photos must be JPEG, PNG or WebP.' }
}
