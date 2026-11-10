/**
 * A NEW RELEASE WHILE THE PAGE WAS OPEN: the page asks for a screen's script by the name it had before, the server now has the new
 * names, and the import fails ("Failed to fetch dynamically imported module …/screens-tWciOAw7.js" — store live test 11/10, the
 * site updated under the tester). The page loads again, once, which picks up the new release — as the big apps do — instead of
 * "Something went wrong". Once per minute at most (sessionStorage), so a script that is really missing still shows the error.
 */
export const isStaleBuild = (error: unknown): boolean =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(String((error as any)?.message ?? error ?? ''))
export function reloadForNewBuild(): boolean {
  try {
    const KEY = 'twomiah:reloaded-for-build'
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch { /* no storage: still reload once — the next failure shows the error */ }
  window.location.reload()
  return true
}
