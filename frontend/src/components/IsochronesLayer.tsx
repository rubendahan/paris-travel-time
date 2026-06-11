import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useMap, useMapEvents } from 'react-leaflet'
import { contours } from 'd3-contour'
import type { Bounds, StopsCatalog, TravelTimeResult } from '../lib/types'
import { BAND_COLORS, WALK_SPEED_M_PER_MIN } from '../lib/colors'

const GRID_W = 320
const GRID_H_MAX = 400
// stops outside the viewport still influence it by walking distance; pad by
// at least the largest realistic walk disk (60 min band * 80 m/min = 4.8 km)
const MIN_PAD_M = 5_000
const M_PER_DEG_LAT = 111_320
const INF = 1e9

/**
 * Smooth isochrone polygons instead of one circle per stop.
 *
 * The field "total minutes to this point" = min over stops of
 * (stop minutes + walk distance / 80) is the lower envelope of cones. It is
 * computed on a viewport-following grid with a two-pass chamfer distance
 * transform (cost independent of stop count), then thresholded at the four
 * bounds with marching squares (d3-contour). Four multipolygons replace
 * ~28k circles.
 */
export default function IsochronesLayer({
  catalog,
  result,
  bounds,
}: {
  catalog: StopsCatalog | null
  result: TravelTimeResult | null
  bounds: Bounds
}) {
  const map = useMap()
  const groupRef = useRef<L.LayerGroup | null>(null)
  const paneReady = useRef(false)
  const [viewTick, setViewTick] = useState(0)

  useMapEvents({
    moveend: () => setViewTick((n) => n + 1), // re-grid on pan/zoom
  })

  useEffect(() => {
    if (!paneReady.current) {
      const pane = map.createPane('heatmap')
      pane.style.opacity = '0.4'
      pane.style.pointerEvents = 'none'
      paneReady.current = true
    }

    const timer = window.setTimeout(() => {
      groupRef.current?.remove()
      groupRef.current = null
      if (!catalog || !result || result.idx.length === 0) return

      const group = buildIsochrones(map, catalog, result, bounds)
      group.addTo(map)
      groupRef.current = group
    }, 120)

    return () => window.clearTimeout(timer)
  }, [map, catalog, result, bounds, viewTick])

  useEffect(
    () => () => {
      groupRef.current?.remove()
    },
    [],
  )

  return null
}

function buildIsochrones(
  map: L.Map,
  catalog: StopsCatalog,
  result: TravelTimeResult,
  bounds: Bounds,
): L.LayerGroup {
  // --- grid geometry over the padded viewport ---
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

  // --- seed the field with stop travel times (row 0 = north) ---
  const field = new Float64Array(W * H).fill(INF)
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
    const offM = Math.hypot(x - cx, y - cy) * cellM // stop is off the cell center
    const v = minutes + offM / WALK_SPEED_M_PER_MIN
    const k = cy * W + cx
    if (v < field[k]) field[k] = v
  }

  // --- chamfer distance transform, costs in walking minutes ---
  const ortho = cellM / WALK_SPEED_M_PER_MIN
  const diag = ortho * Math.SQRT2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x
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

  // --- marching squares at the four bounds (d3 selects >= t, so negate) ---
  const neg = Array.from(field, (v) => (v >= INF ? -INF : -v))
  const thresholds = [...bounds].reverse().map((b) => -b) // ascending, -60..-15
  const multis = contours().size([W, H]).thresholds(thresholds)(neg)

  const toLatLng = ([gx, gy]: number[]): [number, number] => [
    north - (gy * cellM) / M_PER_DEG_LAT,
    west + (gx * cellM) / mPerDegLon,
  ]
  // thresholds come back ascending (-60 first): widest band first, so the
  // tighter (better) bands paint on top
  const layers: L.Polygon[] = []
  multis.forEach((multi, t) => {
    if (!multi.coordinates.length) return
    const band = bounds.length - 1 - t
    const rings = multi.coordinates.map((poly) => poly.map((ring) => ring.map(toLatLng)))
    layers.push(
      L.polygon(rings as L.LatLngExpression[][][], {
        pane: 'heatmap',
        stroke: false,
        fillColor: BAND_COLORS[band],
        fillOpacity: 1,
        interactive: false,
      }),
    )
  })
  return L.layerGroup(layers)
}
