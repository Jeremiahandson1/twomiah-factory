/**
 * Opens a server-rendered printable HTML document in a new tab.
 *
 * A plain window.open('/api/...') CANNOT work here: this API authenticates with
 * a Bearer header only — it sets no cookie — so a top-level navigation arrives
 * with no credentials and the tab shows {"error":"No token provided"}.
 *
 * The token is deliberately NOT put in the query string (as AdsPage does): a
 * JWT in a URL leaks into browser history, referrer headers and server logs.
 * Instead the document is fetched with the header and handed to the tab as a
 * blob, which prints identically.
 */
export async function openPrintable(path: string): Promise<void> {
  const token = localStorage.getItem('accessToken') || '';

  // Open the tab BEFORE awaiting — a window.open() after an await is a popup
  // blocker's definition of "not user initiated".
  const tab = window.open('', '_blank');

  try {
    const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Could not load the document (HTTP ${res.status}). ${detail.slice(0, 200)}`);
    }
    const html = await res.text();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    if (tab) {
      tab.location.href = url;
      // Revoke once the tab has had time to load it; revoking immediately
      // races the navigation and yields a blank tab.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      // Popup blocked — fall back to the current tab rather than failing silently.
      window.location.href = url;
    }
  } catch (err) {
    tab?.close();
    alert((err as Error).message || 'Could not open the document');
  }
}
