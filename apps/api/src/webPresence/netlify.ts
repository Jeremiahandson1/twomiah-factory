// The Netlify API, as far as the Web presence plan uses it. One client, with the token and team given to it (the Factory's env —
// NETLIFY_AUTH_TOKEN / NETLIFY_TEAM — never code, never a customer site's env) and `fetch` injectable: the tests stand in for
// Netlify and never make a live call.
import { createHash } from 'node:crypto'

export type FetchLike = (url: string, init?: any) => Promise<Response>
export class NetlifyError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) { super(message); this.name = 'NetlifyError' }
}

const sha1 = (b: string | Uint8Array) => createHash('sha1').update(b).digest('hex')
const sha256 = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex')

export interface Deployed { deployId: string; state: string; url: string }
export interface FormWanted { on: boolean; inbox: string }

export class Netlify {
  constructor(private cfg: { token: string; team: string; fetch?: FetchLike; base?: string; sleep?: (ms: number) => Promise<void> }) {
    if (!cfg.token) throw new NetlifyError('NETLIFY_AUTH_TOKEN is not set', 0)
    if (!cfg.team) throw new NetlifyError('NETLIFY_TEAM is not set', 0)
  }
  private get f(): FetchLike { return this.cfg.fetch ?? (fetch as FetchLike) }
  private get base() { return (this.cfg.base ?? 'https://api.netlify.com/api/v1').replace(/\/+$/, '') }
  private sleep = (ms: number) => (this.cfg.sleep ? this.cfg.sleep(ms) : new Promise<void>((r) => setTimeout(r, ms)))

  private async call(method: string, path: string, opts: { json?: unknown; body?: any; type?: string; raw?: boolean } = {}): Promise<any> {
    const headers: Record<string, string> = { Authorization: 'Bearer ' + this.cfg.token, Accept: 'application/json' }
    let body: any
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json) }
    else if (opts.body !== undefined) { headers['Content-Type'] = opts.type || 'application/octet-stream'; body = opts.body }
    const res = await this.f(this.base + path, { method, headers, body })
    const text = await res.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    if (!res.ok) throw new NetlifyError(`Netlify ${method} ${path.split('?')[0]} failed (${res.status})`, res.status, data)
    return data
  }

  /** One new site in the Twomiah team. `name` becomes <name>.netlify.app (Netlify adds a suffix if it is taken). */
  async createSite(name: string): Promise<{ id: string; name: string; url: string; sslUrl: string }> {
    const s = await this.call('POST', `/${encodeURIComponent(this.cfg.team)}/sites`, { json: { name } })
    return { id: s.id, name: s.name, url: s.url, sslUrl: s.ssl_url || s.url }
  }
  async getSite(id: string): Promise<any> { return this.call('GET', `/sites/${encodeURIComponent(id)}`) }
  async deleteSite(id: string): Promise<void> {
    try { await this.call('DELETE', `/sites/${encodeURIComponent(id)}`) } catch (e) { if (e instanceof NetlifyError && e.status === 404) return; throw e }
  }

  /**
   * The site's own settings for its function (read at run time). Set BEFORE the deploy that first needs them.
   * Plain settings, all scopes: the team's plan refuses chosen scopes ("Upgrade your Netlify account to set specific scopes", 403)
   * and a secret without them ("Secrets are not allowed to run in 'post_processing' scopes", 422) — measured 10/30. They are read
   * only by the team's own login and never written into the site's files.
   */
  async setEnv(siteId: string, vars: Record<string, { value: string }>): Promise<void> {
    const body = Object.entries(vars).map(([key, v]) => ({ key, values: [{ context: 'all', value: v.value }] }))
    await this.call('POST', `/accounts/${encodeURIComponent(this.cfg.team)}/env?site_id=${encodeURIComponent(siteId)}`, { json: body })
  }

  /**
   * One deploy: the whole file set and the functions. Files are matched by SHA-1 and only the ones Netlify does not already have
   * are uploaded; functions are matched by the SHA-256 of their zip. Resolves when Netlify says the deploy is ready.
   */
  async deploy(siteId: string, files: Record<string, string | Uint8Array>, functions: Record<string, Uint8Array> = {}, o: { attempts?: number; waitMs?: number } = {}): Promise<Deployed> {
    const fileHashes: Record<string, string> = {}
    for (const [p, c] of Object.entries(files)) fileHashes['/' + p.replace(/^\/+/, '')] = sha1(c)
    const fnHashes: Record<string, string> = {}
    for (const [n, z] of Object.entries(functions)) fnHashes[n] = sha256(z)
    const d = await this.call('POST', `/sites/${encodeURIComponent(siteId)}/deploys`, { json: { files: fileHashes, functions: fnHashes, async: false } })
    const needF = new Set<string>(d.required || [])
    const needFn = new Set<string>(d.required_functions || [])
    for (const [p, c] of Object.entries(files)) {
      const key = '/' + p.replace(/^\/+/, '')
      if (!needF.has(fileHashes[key])) continue
      await this.call('PUT', `/deploys/${d.id}/files${key.split('/').map(encodeURIComponent).join('/')}`, { body: typeof c === 'string' ? Buffer.from(c) : Buffer.from(c), type: 'application/octet-stream' })
    }
    for (const [n, z] of Object.entries(functions)) {
      if (!needFn.has(fnHashes[n])) continue
      await this.call('PUT', `/deploys/${d.id}/functions/${encodeURIComponent(n)}?runtime=js`, { body: Buffer.from(z), type: 'application/zip' })
    }
    const attempts = o.attempts ?? 60
    for (let i = 0; i < attempts; i++) {
      const s = await this.call('GET', `/deploys/${d.id}`)
      if (s.state === 'ready') return { deployId: d.id, state: s.state, url: s.ssl_url || s.url || '' }
      if (s.state === 'error' || s.state === 'rejected') throw new NetlifyError(`Netlify deploy ${s.state}: ${s.error_message || ''}`.trim(), 0, s)
      await this.sleep(o.waitMs ?? 2000)
    }
    throw new NetlifyError('Netlify deploy did not become ready in time', 0)
  }

  /** A custom domain for the site, then its certificate. The DNS (Cloudflare) is the caller's. */
  async setCustomDomain(siteId: string, domain: string, aliases: string[] = []): Promise<void> {
    await this.call('PATCH', `/sites/${encodeURIComponent(siteId)}`, { json: { custom_domain: domain, domain_aliases: aliases } })
  }
  /** Asks for the site's certificate; Netlify answers an error until the domain's DNS points at it, which the caller treats as "not yet". */
  async provisionCertificate(siteId: string, domains: string[]): Promise<{ ok: boolean; reason?: string }> {
    try { await this.call('POST', `/sites/${encodeURIComponent(siteId)}/ssl`, { json: { domains } }); return { ok: true } } catch (e) {
      if (e instanceof NetlifyError && e.status >= 400 && e.status < 500) return { ok: false, reason: e.message }
      throw e
    }
  }

  /** The site's forms by name (Netlify registers them when a deploy contains them — a moment after the deploy is ready). */
  async forms(siteId: string): Promise<Array<{ id: string; name: string }>> {
    const r = await this.call('GET', `/sites/${encodeURIComponent(siteId)}/forms`)
    return (Array.isArray(r) ? r : []).map((f: any) => ({ id: f.id, name: f.name }))
  }
  /**
   * Make each form's email notification what the owner set: on → exactly one email hook to the inbox; off → none (a submission
   * that somehow arrives is then emailed to nobody). Returns the form names Netlify does not know yet.
   */
  async reconcileFormEmails(siteId: string, wanted: Record<string, FormWanted>): Promise<{ missing: string[] }> {
    const forms = await this.forms(siteId)
    const hooks: any[] = (await this.call('GET', `/hooks?site_id=${encodeURIComponent(siteId)}`)) || []
    const missing: string[] = []
    for (const [name, w] of Object.entries(wanted)) {
      const form = forms.find((f) => f.name === name)
      if (!form) { missing.push(name); continue }
      const mine = hooks.filter((h) => h.form_id === form.id && h.type === 'email')
      const want = w.on && w.inbox ? w.inbox : ''
      let have = false
      for (const h of mine) {
        if (want && !have && h.data?.email === want) { have = true; continue }
        await this.call('DELETE', `/hooks/${h.id}`)
      }
      if (want && !have) await this.call('POST', '/hooks', { json: { site_id: siteId, form_id: form.id, type: 'email', event: 'submission_created', data: { email: want } } })
    }
    return { missing }
  }

  /** Optional: a reading of the team's credits from an endpoint the owner names (Netlify documents none). Null when not configured. */
  async creditsFromEndpoint(path: string | undefined): Promise<{ used: number; total: number } | null> {
    if (!path) return null
    const r = await this.call('GET', path)
    const used = Number(r?.used ?? r?.credits_used), total = Number(r?.total ?? r?.credits_total ?? r?.included)
    return Number.isFinite(used) && Number.isFinite(total) && total > 0 ? { used, total } : null
  }
}
