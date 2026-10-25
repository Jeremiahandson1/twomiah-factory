// A page is called what its menu item is called. A vertical renames menu items (VerticalSettings.screens.nav: a bar's
// Events are "Parties", a landscaper's Parts Inventory is "Parts & Materials"), and the pages kept their own headings —
// "Parties" opened a page titled "Events" (bar live test, 2026-10-25). AppShell hands its menu down; a page reads its
// own name here, and keeps its own word where it has no menu item (a template's shell, a page off the menu).
import { createContext, useContext } from 'react'
import { useLocation } from 'react-router-dom'

export const MenuNameContext = createContext<ReadonlyArray<{ to: string; label: string }>>([])

/** This page's menu name: the item whose address is exactly this page's, else `fallback` (a detail page has its own). */
export function useMenuName(fallback: string): string {
  const items = useContext(MenuNameContext)
  const { pathname } = useLocation()
  const here = pathname.replace(/\/+$/, '')
  return items.find((i) => i.to === here)?.label || fallback
}

/** The same, written in place: `<h1><MenuName fallback="Events" /></h1>`. */
export function MenuName({ fallback }: { fallback: string }) {
  return <>{useMenuName(fallback)}</>
}
