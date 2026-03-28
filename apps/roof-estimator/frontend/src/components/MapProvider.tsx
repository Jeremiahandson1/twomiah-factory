// Shared MapLibre GL JS configuration for the roof estimator.
// Provides tile sources (Nearmap or Google satellite) and common style.

export interface MapTileConfig {
  nearmapTileUrl?: string | null
  googleApiKey?: string
}

/**
 * Build a MapLibre style object with the best available satellite imagery.
 * Nearmap tiles are preferred (5-7cm resolution) with Google as fallback.
 */
export function buildMapStyle(config: MapTileConfig) {
  const { nearmapTileUrl, googleApiKey } = config

  // Nearmap XYZ tiles (preferred)
  if (nearmapTileUrl) {
    return {
      version: 8 as const,
      sources: {
        satellite: {
          type: 'raster' as const,
          tiles: [nearmapTileUrl],
          tileSize: 256,
          maxzoom: 23,
          attribution: '&copy; Nearmap',
        },
      },
      layers: [
        {
          id: 'satellite-layer',
          type: 'raster' as const,
          source: 'satellite',
          minzoom: 0,
          maxzoom: 23,
        },
      ],
    }
  }

  // Google Maps satellite tiles (fallback)
  // Note: Using Google's XYZ tile endpoint requires a Maps API key
  if (googleApiKey) {
    return {
      version: 8 as const,
      sources: {
        satellite: {
          type: 'raster' as const,
          tiles: [
            `https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}`,
            `https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}`,
          ],
          tileSize: 256,
          maxzoom: 21,
        },
      },
      layers: [
        {
          id: 'satellite-layer',
          type: 'raster' as const,
          source: 'satellite',
          minzoom: 0,
          maxzoom: 21,
        },
      ],
    }
  }

  // Bare style with no basemap (will use stored aerial as image source)
  return {
    version: 8 as const,
    sources: {},
    layers: [],
  }
}

/**
 * Build a MapLibre style with a stored aerial image as an ImageSource.
 * Used when we have a pre-downloaded aerial PNG but no tile service.
 */
export function buildImageStyle(
  imageUrl: string,
  bounds: [number, number, number, number], // [west, south, east, north]
) {
  return {
    version: 8 as const,
    sources: {
      aerial: {
        type: 'image' as const,
        url: imageUrl,
        coordinates: [
          [bounds[0], bounds[3]], // top-left [lng, lat]
          [bounds[2], bounds[3]], // top-right
          [bounds[2], bounds[1]], // bottom-right
          [bounds[0], bounds[1]], // bottom-left
        ],
      },
    },
    layers: [
      {
        id: 'aerial-layer',
        type: 'raster' as const,
        source: 'aerial',
      },
    ],
  }
}
