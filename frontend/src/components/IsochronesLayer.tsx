import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useMap, useMapEvents } from 'react-leaflet'
import type { Bounds, StopsCatalog, TravelTimeResult, Walkmask } from '../lib/types'
import { BAND_COLORS, WALK_SPEED_M_PER_MIN } from '../lib/colors'
import { computeNativeField, UNREACHED, type NativeField } from '../lib/walkfield'

const GRID_W = 480
const GRID_H_MAX = 600
const MIN_PAD_M = 5_000
const M_PER_DEG_LAT = 111_320
const INF = 1e9

/**
 * Smooth isochrone polygons.
 *
 * With a walkability mask: the travel-time field is computed ONCE at the
 * mask's native 30 m resolution (bridges and rivers exact at any zoom, see
 * walkfield.ts) and the viewport merely resamples it before contouring.
 * Without a mask: chamfer distance transform on the viewport grid.
 */
export default function IsochronesLayer({
  catalog,
  result,
  bounds,
  walkmask,
}: {
  catalog: StopsCatalog | null
  result: TravelTimeResult | null
  bounds: Bounds
  walkmask: Walkmask | null
}) {
  const map = useMap()
  const overlayRef = useRef<L.ImageOverlay | null>(null)
  const paneReady = useRef(false)
  const fieldRef = useRef<{ key: string; field: NativeField } | null>(null)
  const [viewTick, setViewTick] = useState(0)

  useMapEvents({
    moveend: () => setViewTick((n) => n + 1), // re-render on pan/zoom (cheap)
  })

  useEffect(() => {
    if (!paneReady.current) {
      const pane = map.createPane('heatmap')
      pane.style.opacity = '0.45'
      pane.style.zIndex = '350' // above base tiles, below the labels pane
      pane.style.pointerEvents = 'none'
      paneReady.current = true
    }

    const timer = window.setTimeout(() => {
      overlayRef.current?.remove()
      overlayRef.current = null
      if (!catalog || !result || result.idx.length === 0) return

      let field: NativeField | null = null
      if (walkmask) {
        // native field cached per query result; pan/zoom never recomputes it
        const key = `${result.departAt}|${result.idx.length}|${result.queryMs}|${bounds[3]}`
        if (fieldRef.current?.key !== key) {
          fieldRef.current = {
            key,
            field: computeNativeField(walkmask, catalog, result, bounds[3]),
          }
        }
        field = fieldRef.current.field
      }

      const overlay = buildIsochrones(map, catalog, result, bounds, walkmask, field)
      overlay.addTo(map)
      overlayRef.current = overlay
    }, 120)

    return () => window.clearTimeout(timer)
  }, [map, catalog, result, bounds, walkmask, viewTick])

  useEffect(
    () => () => {
      overlayRef.current?.remove()
    },
    [],
  )

  return null
}

/** Parse '#rrggbb' once into [r, g, b]. */
const BAND_RGB = BAND_COLORS.map((c) => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
])

/**
 * Two-pass chamfer distance transform (walking minutes per cell). With a
 * `writable` mask only those cells are updated; any cell may still be read,
 * which lets a restricted fill continue seamlessly from authoritative
 * neighbours without ever overwriting them.
 */
function chamfer(
  field: Float64Array,
  W: number,
  H: number,
  ortho: number,
  diag: number,
  writable: Uint8Array | null,
) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x
      if (writable && !writable[k]) continue
      let v = field[k]
      if (x > 0 && field[k - 1] + ortho < v) v = field[k - 1] + ortho
      if (y > 0) {
        if (field[k - W] + ortho < v) v = field[k - W] + ortho
        if (x > 0 && field[k - W - 1] + diag < v) v = field[k - W - 1] + diag
        if (x < W - 1 && field[k - W + 1] + diag < v) v = field[k - W + 1] + diag
      }
      field[k] = v
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const k = y * W + x
      if (writable && !writable[k]) continue
      let v = field[k]
      if (x < W - 1 && field[k + 1] + ortho < v) v = field[k + 1] + ortho
      if (y < H - 1) {
        if (field[k + W] + ortho < v) v = field[k + W] + ortho
        if (x < W - 1 && field[k + W + 1] + diag < v) v = field[k + W + 1] + diag
        if (x > 0 && field[k + W - 1] + diag < v) v = field[k + W - 1] + diag
      }
      field[k] = v
    }
  }
}

function buildIsochrones(
  map: L.Map,
  catalog: StopsCatalog,
  result: TravelTimeResult,
  bounds: Bounds,
  wm: Walkmask | null,
  native: NativeField | null,
): L.ImageOverlay {
  // --- viewport grid geometry ---
  const view = map.getBounds()
  const latMid = (view.getNorth() + view.getSouth()) / 2
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((latMid * Math.PI) / 180)
  const padLat = Math.max((view.getNorth() - view.getSouth()) * 0.25, MIN_PAD_M / M_PER_DEG_LAT)
  const padLon = Math.max((view.getEast() - view.getWest()) * 0.25, MIN_PAD_M / mPerDegLon)
  const south = view.getSouth() - padLat
  const north = view.getNorth() + padLat
  const west = view.getWest() - padLon
  const east = view.getEast() + padLon

  const spanXm = (east - west) * mPerDegLon
  const spanYm = (north - south) * M_PER_DEG_LAT
  const cellM = spanXm / GRID_W
  const H = Math.min(GRID_H_MAX, Math.max(2, Math.round(spanYm / cellM)))
  const W = GRID_W

  const field = new Float64Array(W * H).fill(INF)

  if (wm && native) {
    // --- resample the native field onto the viewport grid ---
    // Sub-sample each viewport cell (up to 4x4 native probes), average the
    // reachable probes; the cell only becomes a hole when most of it is
    // unreachable. Thin rivers fade away gracefully at low zoom instead of
    // flickering, and stay exact at high zoom.
    const nLatSpan = wm.north - wm.south
    const nLonSpan = wm.east - wm.west
    const nativeCellM = (nLatSpan * M_PER_DEG_LAT) / wm.h
    const K = Math.max(1, Math.min(4, Math.round(cellM / nativeCellM)))
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0
        let finite = 0
        let total = 0
        for (let sy = 0; sy < K; sy++) {
          const lat = north - ((y + (sy + 0.5) / K) * cellM) / M_PER_DEG_LAT
          if (lat < wm.south || lat > wm.north) continue
          const ny = Math.min(wm.h - 1, Math.floor(((wm.north - lat) / nLatSpan) * wm.h))
          for (let sx = 0; sx < K; sx++) {
            const lon = west + ((x + (sx + 0.5) / K) * cellM) / mPerDegLon
            if (lon < wm.west || lon > wm.east) continue
            const nx = Math.min(wm.w - 1, Math.floor(((lon - wm.west) / nLonSpan) * wm.w))
            total++
            const v = native.secs[ny * wm.w + nx]
            if (v !== UNREACHED) {
              finite++
              sum += v
            }
          }
        }
        if (total > 0 && finite * 3 >= total) {
          field[y * W + x] = sum / finite / 60 // seconds -> minutes
        }
      }
    }

    // --- beyond the mask rectangle: crow-fly fallback ---
    // The raster stops at a straight bbox edge; without this, so would the
    // colors. Cells with no mask coverage are filled by a chamfer restricted
    // to them: it reads the authoritative cells at the boundary (continuity)
    // and takes seeds from the stops that sit outside the rectangle, but
    // never writes inside, so barriers stay exact where the mask knows them.
    const outside = new Uint8Array(W * H)
    let hasOutside = false
    for (let y = 0; y < H; y++) {
      const lat = north - ((y + 0.5) * cellM) / M_PER_DEG_LAT
      const rowOut = lat < wm.south || lat > wm.north
      for (let x = 0; x < W; x++) {
        const lon = west + ((x + 0.5) * cellM) / mPerDegLon
        if (rowOut || lon < wm.west || lon > wm.east) {
          outside[y * W + x] = 1
          hasOutside = true
        }
      }
    }
    if (hasOutside) {
      const maxBound = bounds[3]
      for (let i = 0; i < result.idx.length; i++) {
        const minutes = result.minutes[i]
        if (minutes > maxBound) continue
        const s = result.idx[i]
        const lat = catalog.lats[s]
        const lon = catalog.lons[s]
        if (lat < south || lat > north || lon < west || lon > east) continue
        const x = ((lon - west) * mPerDegLon) / cellM
        const y = ((north - lat) * M_PER_DEG_LAT) / cellM
        const cx = Math.min(W - 1, Math.max(0, Math.round(x)))
        const cy = Math.min(H - 1, Math.max(0, Math.round(y)))
        const k = cy * W + cx
        if (!outside[k]) continue // covered by the native field
        const offM = Math.hypot(x - cx, y - cy) * cellM
        const v = minutes + offM / WALK_SPEED_M_PER_MIN
        if (v < field[k]) field[k] = v
      }
      const ortho = cellM / WALK_SPEED_M_PER_MIN
      chamfer(field, W, H, ortho, ortho * Math.SQRT2, outside)
    }
  } else {
    // --- no mask: seed stops on the viewport grid, chamfer transform ---
    const maxBound = bounds[3]
    for (let i = 0; i < result.idx.length; i++) {
      const minutes = result.minutes[i]
      if (minutes > maxBound) continue
      const s = result.idx[i]
      const lat = catalog.lats[s]
      const lon = catalog.lons[s]
      if (lat < south || lat > north || lon < west || lon > east) continue
      const x = ((lon - west) * mPerDegLon) / cellM
      const y = ((north - lat) * M_PER_DEG_LAT) / cellM
      const cx = Math.min(W - 1, Math.max(0, Math.round(x)))
      const cy = Math.min(H - 1, Math.max(0, Math.round(y)))
      const offM = Math.hypot(x - cx, y - cy) * cellM
      const v = minutes + offM / WALK_SPEED_M_PER_MIN
      const k = cy * W + cx
      if (v < field[k]) field[k] = v
    }
    const ortho = cellM / WALK_SPEED_M_PER_MIN
    chamfer(field, W, H, ortho, ortho * Math.SQRT2, null)
  }

  // --- paint the field straight into a canvas image overlay ---
  // We used to extract vector polygons (d3-contour marching squares), but
  // Leaflet mangled the giant concave rings at render time (half a band
  // could silently vanish). Direct pixel painting cannot have winding,
  // clipping or ring-assembly bugs, and the browser's bilinear upscaling
  // smooths the band edges for free.
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const px = img.data
  for (let k = 0; k < W * H; k++) {
    const v = field[k]
    if (v >= INF || v > bounds[3]) continue // transparent
    let band = 3
    if (v <= bounds[0]) band = 0
    else if (v <= bounds[1]) band = 1
    else if (v <= bounds[2]) band = 2
    const [r, g, b] = BAND_RGB[band]
    const o = k * 4
    px[o] = r
    px[o + 1] = g
    px[o + 2] = b
    px[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)


  return L.imageOverlay(
    canvas.toDataURL(),
    [
      [south, west],
      [north, east],
    ],
    { pane: 'heatmap', interactive: false },
  )
}
