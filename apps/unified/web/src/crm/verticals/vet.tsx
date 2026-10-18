// Veterinary: the screens templates/crm-vet has and the base CRM doesn't (crm/pages/vet/), their routes under /crm and
// their menu items, each gated by the template's features so no other vertical sees them (docs/UNIFIED_MOVE_GUIDE.md).
import type { ReactElement } from 'react'
import type { NavItem } from '../../shared'

/** Routes inside /crm (behind the CRM's first-run gate), as <Route path="…" element={…} /> with a key. */
export const routes: ReactElement[] = []

/** Menu items, gated by features (and the permission each page's API asks). */
export const nav: NavItem[] = []
