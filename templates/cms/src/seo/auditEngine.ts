/**
 * Twomiah on-page SEO audit engine.
 *
 * Pure, framework-agnostic, dependency-free. Runs in the browser (the CMS is
 * served same-origin with the public site, so it can fetch and analyze the
 * real rendered HTML of any page). Parses HTML with the native DOMParser and
 * runs a battery of weighted checks, returning a scored, categorized report.
 *
 * This is the single source of truth for the analyzer across every stamped
 * site — it ships inside templates/cms and is injected wherever the CMS is.
 *
 *   status: 'pass' | 'warn' | 'fail' | 'info'   ('info' is not scored)
 *   Score  = weighted average where pass=1, warn=0.5, fail=0.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  weight: number;
  value?: string;
  message: string;
  recommendation?: string;
}

export interface Category {
  id: string;
  label: string;
  score: number | null;
  checks: Check[];
}

export interface AuditReport {
  url: string;
  score: number;
  grade: string;
  summary: { pass: number; warn: number; fail: number; total: number };
  stats: { title: number; description: number; words: number; h1: number; images: number; internalLinks: number };
  /** Raw strings, for duplicate detection and display in the site-wide view. */
  page: { title: string; description: string; h1: string };
  categories: Category[];
}

export interface AuditOptions {
  url?: string;
  targetKeywords?: string[];
  /** Set of same-origin paths known to exist, for broken-internal-link detection. */
  knownPaths?: Set<string> | null;
}

const STATUS_VALUE: Record<CheckStatus, number> = { pass: 1, warn: 0.5, fail: 0, info: 0 };
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'is', 'are', 'be', 'your', 'you', 'we', 'our', 'it', 'this', 'that', 'as', 'if']);

const norm = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim();
const lower = (s: string | null | undefined): string => norm(s).toLowerCase();

export function gradeFor(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 55) return 'D';
  return 'F';
}

function visibleText(doc: Document): string {
  const body = doc.body ? (doc.body.cloneNode(true) as HTMLElement) : null;
  if (!body) return '';
  body.querySelectorAll('script, style, noscript, svg, nav, header, footer, form').forEach((n) => n.remove());
  return norm(body.textContent || '');
}

function words(text: string): string[] {
  return lower(text).split(/[^a-z0-9']+/).filter((w) => w && w.length > 1);
}

/** Normalize a same-origin URL/href to a clean path for comparison. */
function toPath(href: string): string {
  return href.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
}

export function auditHtml(html: string, opts: AuditOptions = {}): AuditReport {
  const { url = '', targetKeywords = [], knownPaths = null } = opts;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const title = norm(doc.querySelector('head > title')?.textContent);
  const metaDesc = norm(doc.querySelector('meta[name="description"]')?.getAttribute('content'));
  const canonical = norm(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'));
  const robots = lower(doc.querySelector('meta[name="robots"]')?.getAttribute('content'));
  const viewport = norm(doc.querySelector('meta[name="viewport"]')?.getAttribute('content'));
  const lang = norm(doc.documentElement?.getAttribute('lang'));
  const charset = !!doc.querySelector('meta[charset]') || /charset/i.test(doc.querySelector('meta[http-equiv="Content-Type"]')?.getAttribute('content') || '');
  const favicon = !!doc.querySelector('link[rel~="icon"]');

  const h1s = Array.from(doc.querySelectorAll('h1')).map((el) => norm(el.textContent)).filter(Boolean);
  const text = visibleText(doc);
  const wordArr = words(text);
  const wordCount = wordArr.length;
  const firstPara = norm(doc.querySelector('p')?.textContent);
  const kws = targetKeywords.map(lower).filter(Boolean);

  const categories: Category[] = [];
  const cat = (id: string, label: string, checks: Check[]) => categories.push({ id, label, score: null, checks });

  // ---- Meta & Indexing ------------------------------------------------------
  const metaChecks: Check[] = [];
  if (!title) metaChecks.push({ id: 'title', label: 'Title tag', status: 'fail', weight: 10, value: '', message: 'No <title> tag.', recommendation: 'Add a page title.' });
  else if (title.length < 30) metaChecks.push({ id: 'title', label: 'Title tag', status: 'warn', weight: 10, value: `${title.length} chars`, message: `Title is short (${title.length} chars).`, recommendation: 'Aim for 50–60 characters.' });
  else if (title.length > 60) metaChecks.push({ id: 'title', label: 'Title tag', status: 'warn', weight: 10, value: `${title.length} chars`, message: `Title is long (${title.length} chars) — Google may truncate it.`, recommendation: 'Keep under ~60 characters.' });
  else metaChecks.push({ id: 'title', label: 'Title tag', status: 'pass', weight: 10, value: `${title.length} chars`, message: 'Good title length.' });

  if (!metaDesc) metaChecks.push({ id: 'desc', label: 'Meta description', status: 'fail', weight: 8, value: '', message: 'No meta description.', recommendation: 'Add a 150–160 char description.' });
  else if (metaDesc.length < 120) metaChecks.push({ id: 'desc', label: 'Meta description', status: 'warn', weight: 8, value: `${metaDesc.length} chars`, message: `Meta description is short (${metaDesc.length} chars).`, recommendation: 'Aim for 150–160 characters.' });
  else if (metaDesc.length > 160) metaChecks.push({ id: 'desc', label: 'Meta description', status: 'warn', weight: 8, value: `${metaDesc.length} chars`, message: `Meta description is long (${metaDesc.length} chars) — may be truncated.`, recommendation: 'Keep under ~160 characters.' });
  else metaChecks.push({ id: 'desc', label: 'Meta description', status: 'pass', weight: 8, value: `${metaDesc.length} chars`, message: 'Good description length.' });

  metaChecks.push(/noindex/.test(robots)
    ? { id: 'robots', label: 'Indexable', status: 'fail', weight: 10, value: robots, message: 'Page is set to noindex — it will not appear in Google.', recommendation: 'Remove noindex unless intentional.' }
    : { id: 'robots', label: 'Indexable', status: 'pass', weight: 10, value: robots || 'default', message: 'Page is indexable.' });

  if (!canonical) metaChecks.push({ id: 'canonical', label: 'Canonical URL', status: 'warn', weight: 5, value: '', message: 'No canonical tag.', recommendation: 'Add a self-referential canonical link.' });
  else metaChecks.push({ id: 'canonical', label: 'Canonical URL', status: canonical.startsWith('https://') ? 'pass' : 'warn', weight: 5, value: canonical, message: canonical.startsWith('https://') ? 'Canonical present.' : 'Canonical is not HTTPS.', recommendation: canonical.startsWith('https://') ? undefined : 'Use an https:// canonical.' });

  metaChecks.push({ id: 'viewport', label: 'Mobile viewport', status: viewport ? 'pass' : 'fail', weight: 6, value: viewport, message: viewport ? 'Responsive viewport set.' : 'No viewport meta — not mobile-friendly.', recommendation: viewport ? undefined : 'Add a responsive viewport meta tag.' });
  metaChecks.push({ id: 'lang', label: 'Language attribute', status: lang ? 'pass' : 'warn', weight: 2, value: lang, message: lang ? `lang="${lang}"` : 'No <html lang> attribute.', recommendation: lang ? undefined : 'Add lang="en" to <html>.' });
  metaChecks.push({ id: 'charset', label: 'Charset', status: charset ? 'pass' : 'warn', weight: 2, value: charset ? 'set' : 'missing', message: charset ? 'Charset declared.' : 'No charset declared.' });
  metaChecks.push({ id: 'favicon', label: 'Favicon', status: favicon ? 'pass' : 'info', weight: 1, value: favicon ? 'present' : 'missing', message: favicon ? 'Favicon present.' : 'No favicon link.' });
  cat('meta', 'Meta & Indexing', metaChecks);

  // ---- Headings & Content ---------------------------------------------------
  const headingSeq = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((el) => Number(el.tagName[1]));
  let skipped = false;
  for (let i = 1; i < headingSeq.length; i++) if (headingSeq[i] - headingSeq[i - 1] > 1) skipped = true;

  const contentChecks: Check[] = [];
  if (h1s.length === 0) contentChecks.push({ id: 'h1', label: 'H1 heading', status: 'fail', weight: 9, value: '0', message: 'No <h1> on the page.', recommendation: 'Add exactly one H1 with the main topic.' });
  else if (h1s.length > 1) contentChecks.push({ id: 'h1', label: 'H1 heading', status: 'warn', weight: 9, value: `${h1s.length}`, message: `Multiple H1s (${h1s.length}).`, recommendation: 'Use a single H1 per page.' });
  else contentChecks.push({ id: 'h1', label: 'H1 heading', status: 'pass', weight: 9, value: h1s[0].slice(0, 60), message: 'Exactly one H1.' });

  contentChecks.push({ id: 'hierarchy', label: 'Heading structure', status: skipped ? 'warn' : 'pass', weight: 3, value: headingSeq.map((n) => 'H' + n).join(' '), message: skipped ? 'Heading levels are skipped (e.g. H2 → H4).' : 'Logical heading hierarchy.', recommendation: skipped ? "Don't skip heading levels." : undefined });
  contentChecks.push(wordCount < 300
    ? { id: 'words', label: 'Content length', status: 'warn', weight: 7, value: `${wordCount} words`, message: `Thin content (${wordCount} words).`, recommendation: 'Aim for 300+ words of useful copy.' }
    : { id: 'words', label: 'Content length', status: 'pass', weight: 7, value: `${wordCount} words`, message: `${wordCount} words of content.` });
  cat('content', 'Headings & Content', contentChecks);

  // ---- Keywords -------------------------------------------------------------
  if (kws.length) {
    // Concept match: a keyword "matches" a text when all of its significant
    // tokens appear (order-insensitive), so "Roofing Eau Claire" matches
    // "Eau Claire Roofing" — how a search engine reads relevance.
    const kwTokens = (k: string) => lower(k).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
    const textWords = (text: string) => new Set(lower(text).split(/[^a-z0-9]+/).filter(Boolean));
    const matches = (text: string, k: string) => { const ws = textWords(text); const toks = kwTokens(k); return toks.length > 0 && toks.every((tok) => ws.has(tok)); };
    const inTitle = kws.some((k) => matches(title, k));
    const inH1 = kws.some((k) => h1s.some((h) => matches(h, k)));
    const inDesc = kws.some((k) => matches(metaDesc, k));
    const inFirst = kws.some((k) => matches(firstPara, k));
    const inUrl = kws.some((k) => lower(url).includes(k.replace(/\s+/g, '-')) || lower(url).includes(k.replace(/\s+/g, '')));
    const kwHits = wordArr.filter((w) => kws.some((k) => k.split(' ').includes(w))).length;
    const density = wordCount ? (kwHits / wordCount) * 100 : 0;
    cat('keywords', 'Target Keywords', [
      { id: 'kw-title', label: 'Keyword in title', status: inTitle ? 'pass' : 'warn', weight: 6, value: inTitle ? 'yes' : 'no', message: inTitle ? 'Target keyword in title.' : 'Target keyword not in title.', recommendation: inTitle ? undefined : 'Include a target keyword in the title.' },
      { id: 'kw-h1', label: 'Keyword in H1', status: inH1 ? 'pass' : 'warn', weight: 4, value: inH1 ? 'yes' : 'no', message: inH1 ? 'Target keyword in H1.' : 'Target keyword not in H1.' },
      { id: 'kw-desc', label: 'Keyword in description', status: inDesc ? 'pass' : 'warn', weight: 3, value: inDesc ? 'yes' : 'no', message: inDesc ? 'Target keyword in meta description.' : 'Target keyword not in meta description.' },
      { id: 'kw-first', label: 'Keyword in first paragraph', status: inFirst ? 'pass' : 'warn', weight: 3, value: inFirst ? 'yes' : 'no', message: inFirst ? 'Keyword appears early in the copy.' : 'Keyword not in the first paragraph.' },
      { id: 'kw-url', label: 'Keyword in URL', status: inUrl ? 'pass' : 'info', weight: 2, value: inUrl ? 'yes' : 'no', message: inUrl ? 'Keyword in URL slug.' : 'Keyword not in URL slug.' },
      { id: 'kw-density', label: 'Keyword density', status: density > 0 && density <= 3.5 ? 'pass' : density > 3.5 ? 'warn' : 'info', weight: 2, value: `${density.toFixed(1)}%`, message: density > 3.5 ? `Keyword density is high (${density.toFixed(1)}%) — risk of stuffing.` : `Keyword density ${density.toFixed(1)}%.`, recommendation: density > 3.5 ? 'Reduce repetition to stay natural.' : undefined },
    ]);
  }

  // ---- Images ---------------------------------------------------------------
  const imgs = Array.from(doc.querySelectorAll('img'));
  const missingAlt = imgs.filter((el) => !norm(el.getAttribute('alt'))).length;
  cat('images', 'Images', [
    imgs.length === 0
      ? { id: 'img-alt', label: 'Image alt text', status: 'info', weight: 4, value: '0 images', message: 'No <img> tags found (may use CSS backgrounds).' }
      : missingAlt > 0
        ? { id: 'img-alt', label: 'Image alt text', status: 'fail', weight: 4, value: `${missingAlt}/${imgs.length} missing`, message: `${missingAlt} of ${imgs.length} images are missing alt text.`, recommendation: 'Add descriptive alt text to every image.' }
        : { id: 'img-alt', label: 'Image alt text', status: 'pass', weight: 4, value: `${imgs.length} images`, message: 'All images have alt text.' },
  ]);

  // ---- Links ----------------------------------------------------------------
  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  const internal: string[] = [];
  const external: string[] = [];
  const origin = canonical ? (() => { try { return new URL(canonical).origin; } catch { return ''; } })() : '';
  anchors.forEach((el) => {
    const href = norm(el.getAttribute('href'));
    if (!href || href.startsWith('#') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
    if (/^https?:\/\//.test(href)) { if (origin && href.startsWith(origin)) internal.push(href); else external.push(href); }
    else if (href.startsWith('/')) internal.push(href);
  });
  const vagueAnchors = anchors.filter((el) => /^(click here|read more|here|learn more)$/i.test(norm(el.textContent))).length;
  let brokenInternal = 0;
  if (knownPaths) internal.forEach((href) => { if (!knownPaths.has(toPath(href))) brokenInternal++; });

  const linkChecks: Check[] = [
    { id: 'internal', label: 'Internal links', status: internal.length > 0 ? 'pass' : 'warn', weight: 4, value: `${internal.length}`, message: internal.length > 0 ? `${internal.length} internal links.` : 'No internal links.', recommendation: internal.length > 0 ? undefined : 'Link to related pages.' },
    { id: 'external', label: 'External links', status: 'info', weight: 0, value: `${external.length}`, message: `${external.length} external links.` },
    { id: 'anchors', label: 'Descriptive anchors', status: vagueAnchors > 0 ? 'warn' : 'pass', weight: 2, value: `${vagueAnchors} vague`, message: vagueAnchors > 0 ? `${vagueAnchors} links use vague text like "click here".` : 'Anchor text is descriptive.', recommendation: vagueAnchors > 0 ? 'Use descriptive link text with keywords.' : undefined },
  ];
  if (knownPaths) linkChecks.push({ id: 'broken', label: 'Broken internal links', status: brokenInternal > 0 ? 'fail' : 'pass', weight: 6, value: `${brokenInternal}`, message: brokenInternal > 0 ? `${brokenInternal} internal links point to non-existent pages.` : 'No broken internal links.', recommendation: brokenInternal > 0 ? 'Fix or remove dead internal links.' : undefined });
  cat('links', 'Links', linkChecks);

  // ---- Social & Structured Data --------------------------------------------
  const og = ['og:title', 'og:description', 'og:image', 'og:url'].filter((p) => norm(doc.querySelector(`meta[property="${p}"]`)?.getAttribute('content')));
  const twitter = norm(doc.querySelector('meta[name="twitter:card"]')?.getAttribute('content'));
  const ldNodes = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  let ldValid = 0, ldBroken = 0;
  ldNodes.forEach((el) => { try { JSON.parse(el.textContent || ''); ldValid++; } catch { ldBroken++; } });
  const socialChecks: Check[] = [
    { id: 'og', label: 'Open Graph tags', status: og.length === 4 ? 'pass' : og.length > 0 ? 'warn' : 'fail', weight: 4, value: `${og.length}/4`, message: og.length === 4 ? 'Full Open Graph set.' : `Only ${og.length}/4 Open Graph tags.`, recommendation: og.length === 4 ? undefined : 'Add og:title, og:description, og:image, og:url.' },
    { id: 'twitter', label: 'Twitter card', status: twitter ? 'pass' : 'warn', weight: 2, value: twitter || 'missing', message: twitter ? 'Twitter card present.' : 'No Twitter card meta.' },
    ldNodes.length === 0
      ? { id: 'jsonld', label: 'Structured data (JSON-LD)', status: 'warn', weight: 5, value: 'none', message: 'No JSON-LD structured data.', recommendation: 'Add LocalBusiness / Service schema for rich results.' }
      : ldBroken > 0
        ? { id: 'jsonld', label: 'Structured data (JSON-LD)', status: 'fail', weight: 5, value: `${ldBroken} invalid`, message: `${ldBroken} JSON-LD block(s) are invalid JSON.`, recommendation: 'Fix the malformed structured data.' }
        : { id: 'jsonld', label: 'Structured data (JSON-LD)', status: 'pass', weight: 5, value: `${ldValid} block(s)`, message: 'Valid structured data present.' },
  ];
  cat('social', 'Social & Structured Data', socialChecks);

  // ---- Score ----------------------------------------------------------------
  let totalW = 0, gotW = 0;
  const counts = { pass: 0, warn: 0, fail: 0 };
  categories.forEach((c) => {
    let cw = 0, cg = 0;
    c.checks.forEach((ch) => {
      if (ch.status === 'info' || ch.weight === 0) return;
      counts[ch.status] += 1;
      totalW += ch.weight; gotW += ch.weight * STATUS_VALUE[ch.status];
      cw += ch.weight; cg += ch.weight * STATUS_VALUE[ch.status];
    });
    c.score = cw ? Math.round((cg / cw) * 100) : null;
  });
  const score = totalW ? Math.round((gotW / totalW) * 100) : 0;

  return {
    url,
    score,
    grade: gradeFor(score),
    summary: { ...counts, total: counts.pass + counts.warn + counts.fail },
    stats: { title: title.length, description: metaDesc.length, words: wordCount, h1: h1s.length, images: imgs.length, internalLinks: internal.length },
    page: { title, description: metaDesc, h1: h1s[0] || '' },
    categories,
  };
}

/** Parse a sitemap.xml body into a list of same-origin paths. */
export function parseSitemapPaths(xml: string): string[] {
  const locs = Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)).map((m) => m[1]);
  const paths = locs.map(toPath);
  return Array.from(new Set(paths));
}

export { toPath };
