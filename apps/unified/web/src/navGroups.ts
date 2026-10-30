// The menu's groups, in order. Pure: the menu in, the menu out, so the rule is tested without a browser.
//
// A page with no heading of its own sits under the one above it, so every page is given its group first (before anything
// moves, or a page would follow the wrong heading). Then a vertical may file pages under a group by address
// (VerticalSettings.screens.navGroups: '/crm/quotes': 'Sales'; '' means no heading, the Dashboard at the top) and set the
// order of the groups (screens.navGroupOrder). A page it files nowhere stays under the heading it had; a group not named
// in the order goes after the ones that are, in the order it first appears. Account (Audit Log, Help, Contact Twomiah)
// closes the menu unless the order places it. Inside a group the pages keep the order they had.
// A structural type, not NavItem from ./shared: this file is imported by a server-side test, and ./shared pulls in every .tsx screen.
interface NavLike { to: string; section?: string }

const ACCOUNT = 'Account'

export function applyNavGroups<T extends NavLike>(nav: T[], groups: Record<string, string> | undefined, order: string[] | undefined): T[] {
  const filed = groups || {}
  const wanted = Array.isArray(order) ? order : []

  let inherited = ''
  const placed = nav.map((item, index) => {
    if (item.section) inherited = item.section
    const group = Object.prototype.hasOwnProperty.call(filed, item.to) ? filed[item.to] : inherited
    return { item, group, index }
  })

  // Unnamed headings (the Dashboard) first, the vertical's order next, the rest as they appear, Account last.
  const rank = new Map<string, number>([['', -1]])
  wanted.forEach((name, i) => { if (name && !rank.has(name)) rank.set(name, i) })
  let next = wanted.length
  placed.forEach(({ group }) => { if (!rank.has(group)) rank.set(group, group === ACCOUNT ? Number.MAX_SAFE_INTEGER : next++) })

  return placed
    .sort((a, b) => (rank.get(a.group) as number) - (rank.get(b.group) as number) || a.index - b.index)
    .map(({ item, group }) => (group === (item.section || '') ? item : ({ ...item, section: group || undefined } as T)))
}
