// The browser tab's title while a page is open, and back to what it was when it closes.
// index.html names the tab "<agency> CRM" — the office's tool. The public careers page, the client and family portals
// and the new hire's onboarding packet are not the CRM, and their tab said it was (Run 3: "Test Home Care Co CRM").
import { useEffect } from 'react';

export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title || typeof document === 'undefined') return;
    const before = document.title;
    document.title = title;
    return () => { document.title = before; };
  }, [title]);
}
