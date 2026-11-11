// For tests only: a small GeoTIFF on a UTM grid, as Google's data layers arrive — so a test can stand in for the Solar
// API without a recorded download. (Here, beside the reader, because the GeoTIFF library is this package's.)
import { writeArrayBuffer } from 'geotiff'

export async function writeTestGeoTiff(
  values: Float32Array | Uint8Array,
  o: { width: number; height: number; pixelM: number; minEasting: number; maxNorthing: number; epsg: number },
): Promise<Buffer> {
  return Buffer.from(await writeArrayBuffer(values as any, {
    width: o.width, height: o.height,
    ModelPixelScale: [o.pixelM, o.pixelM, 0], ModelTiepoint: [0, 0, 0, o.minEasting, o.maxNorthing, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: o.epsg,
  } as any))
}
