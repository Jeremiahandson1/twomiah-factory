/**
 * lib/render.ts — the one way to wrap a body in views/base.ejs, shared by
 * server-static.ts and routes/order.ts so every page gets the same header.
 * Adds `orderNav` (show "Order" in the nav) while online ordering is on.
 */
import ejs from 'ejs'
import path from 'path'
import { onlineOrderingEnabled } from './square/client'

// Cache-busting version for local assets: changes every deploy (Render sets RENDER_GIT_COMMIT).
export const ASSET_VERSION = (process.env.RENDER_GIT_COMMIT || '').slice(0, 8) || String(Date.now())

export const viewsDir = path.join(import.meta.dir, '..', 'views')

export function renderBase(data: Record<string, any>): Promise<string> {
  return ejs.renderFile(path.join(viewsDir, 'base.ejs'), { assetV: ASSET_VERSION, orderNav: onlineOrderingEnabled(), ...data }) as Promise<string>
}
