// Elevation Provider — abstraction layer over multiple elevation data sources.
// Priority: Nearmap DSM (5cm) → USGS 3DEP LiDAR (1m) → Google Solar DSM (25cm)

import { checkLidarCoverage, fetchLidarElevationGrid, type LidarElevationGrid } from './usgs3dep.ts'
import { downloadNearmapDSM } from './nearmapImagery.ts'
import logger from './logger.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ElevationSourceType = 'nearmap_dsm' | 'google_dsm' | 'usgs_3dep' | 'nearmap+lidar' | 'combined'

export interface ElevationSource {
  type: ElevationSourceType
  resolution: number       // meters per pixel
  description: string
}

export interface ElevationData {
  /** The best available DSM buffer to pass to processDsm() — may be null if no elevation source available */
  dsmBuffer: Buffer | null
  /** If LiDAR grid is available (for 3D viewer, independent pitch calc) */
  lidarGrid: LidarElevationGrid | null
  /** Which source(s) are being used */
  source: ElevationSource
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Get the best available elevation data for a location.
 *
 * Priority:
 * 1. Nearmap DSM (5cm resolution) — best accuracy, requires NEARMAP_API_KEY
 * 2. USGS 3DEP LiDAR (1m) — free, excellent for pitch calculations
 * 3. Google Solar DSM (~25cm) — always available via Solar API
 *
 * When multiple sources are available, uses the best for RANSAC and
 * returns LiDAR grid for the 3D viewer.
 */
export async function getBestElevationData(
  lat: number,
  lng: number,
  radiusMeters: number = 75,
  googleDsmBuffer: Buffer | null = null,
): Promise<ElevationData> {
  // --- Try Nearmap DSM first (5cm resolution, best available) ---
  try {
    const nearmapDsm = await downloadNearmapDSM(lat, lng, radiusMeters)
    if (nearmapDsm && nearmapDsm.buffer.byteLength > 1000) {
      logger.info('Using Nearmap DSM (5cm resolution)', { lat, lng, bytes: nearmapDsm.buffer.byteLength })

      // Also try LiDAR for supplemental data (3D viewer)
      let lidarGrid: LidarElevationGrid | null = null
      try {
        const coverage = await checkLidarCoverage(lat, lng)
        if (coverage.available && coverage.resolution <= 3) {
          lidarGrid = await fetchLidarElevationGrid(lat, lng, radiusMeters)
        }
      } catch { /* non-blocking */ }

      return {
        dsmBuffer: nearmapDsm.buffer,
        lidarGrid,
        source: {
          type: lidarGrid ? 'nearmap+lidar' : 'nearmap_dsm',
          resolution: 0.05,
          description: `Nearmap DSM 5cm${lidarGrid ? ' + USGS 3DEP LiDAR' : ''}`,
        },
      }
    }
  } catch (err: any) {
    logger.info('Nearmap DSM not available', { error: err.message, lat, lng })
  }

  // --- Try USGS 3DEP LiDAR (1m resolution) ---
  try {
    const coverage = await checkLidarCoverage(lat, lng)

    if (coverage.available && coverage.resolution <= 3) {
      logger.info('USGS 3DEP LiDAR available', {
        lat, lng, resolution: coverage.resolution, dataset: coverage.sourceDataset,
      })

      const lidarGrid = await fetchLidarElevationGrid(lat, lng, radiusMeters)

      if (lidarGrid && lidarGrid.data.length > 0) {
        let validCount = 0
        for (let i = 0; i < lidarGrid.data.length; i++) {
          if (!isNaN(lidarGrid.data[i])) validCount++
        }
        const coveragePct = (validCount / lidarGrid.data.length) * 100

        if (coveragePct > 50) {
          if (googleDsmBuffer) {
            return {
              dsmBuffer: googleDsmBuffer,
              lidarGrid,
              source: {
                type: 'combined',
                resolution: coverage.resolution,
                description: `USGS 3DEP ${coverage.sourceDataset} LiDAR + Google Solar DSM`,
              },
            }
          } else {
            // No Google DSM available but LiDAR is — return LiDAR as supplemental
            return {
              dsmBuffer: null,
              lidarGrid,
              source: {
                type: 'usgs_3dep',
                resolution: coverage.resolution,
                description: `USGS 3DEP ${coverage.sourceDataset} LiDAR`,
              },
            }
          }
        }
      }
    }
  } catch (err: any) {
    logger.info('USGS 3DEP check failed', { error: err.message })
  }

  // --- Fall back to Google DSM only (may be null) ---
  return {
    dsmBuffer: googleDsmBuffer,
    lidarGrid: null,
    source: {
      type: 'google_dsm',
      resolution: 0.25,
      description: 'Google Solar API DSM',
    },
  }
}
