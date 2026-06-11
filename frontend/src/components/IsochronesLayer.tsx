import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useMap, useMapEvents } from 'react-leaflet'
import { contours } from 'd3-contour'
import type { Bounds, StopsCatalog, TravelTimeResult, Walkmask } from '../lib/types'
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
  walkmask,
}: {
  catalog: StopsCatalog | null
  result: TravelTimeResult | null
  bounds: Bounds
  walkmask: Walkmask | null
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
      pane.style.opacity = '0.45'
      pane.style.zIndex = '350' // above base tiles, below the labels pane
      pane.style.pointerEvents = 'none'
      paneReady.current = true
    }

    const timer = window.setTimeout(() => {
      groupRef.current?.remove()
      groupRef.current = null
      if (!catalog || !result || result.idx.length === 0) return

      const group = buildIsochrones(map, catalog, result, bounds, walkmask)
      group.addTo(map)
      groupRef.current = group
    }, 120)

    return () => window.clearTimeout(timer)
  }, [map, catalog, result, bounds, walkmask, viewTick])

  useEffect(
    () => () => {
      groupRef.current?.remove()
    },
    [],
  )

  return null
}

/**
 * Sample the walkability mask for a viewport grid.
 *
 * A cell is blocked when LESS THAN HALF of its footprint is walkable
 * (box average via the summed-area table). Center-point sampling caused
 * speckle at low zoom: a pond under the cell center blocked a whole
 * 300 m cell while its twin neighbour stayed open.
 */
function blockedForGrid(
  wm: Walkmask,
  W: number,
  H: number,
  west: number,
  north: number,
  cellM: number,
  mPerDegLon: number,
): Uint8Array {
  const blocked = new Uint8Array(W * H) // 0 = walkable
  const w1 = wm.w + 1
  const maskCellLat = (wm.north - wm.south) / wm.h
  const maskCellLon = (wm.east - wm.west) / wm.w
  const halfLat = Math.max(((cellM / 2) * 1) / M_PER_DEG_LAT, maskCellLat / 2)
  const halfLon = Math.max(cellM / 2 / mPerDegLon, maskCellLon / 2)
  for (let y = 0; y < H; y++) {
    const lat = north - ((y + 0.5) * cellM) / M_PER_DEG_LAT
    if (lat < wm.south || lat > wm.north) continue // outside mask: walkable
    const my0 = Math.max(0, Math.floor(((wm.north - (lat + halfLat)) / (wm.north - wm.south)) * wm.h))
    const my1 = Math.min(wm.h, Math.ceil(((wm.north - (lat - halfLat)) / (wm.north - wm.south)) * wm.h))
    for (let x = 0; x < W; x++) {
      const lon = west + ((x + 0.5) * cellM) / mPerDegLon
      if (lon < wm.west || lon > wm.east) continue
      const mx0 = Math.max(0, Math.floor(((lon - halfLon - wm.west) / (wm.east - wm.west)) * wm.w))
      const mx1 = Math.min(wm.w, Math.ceil(((lon + halfLon - wm.west) / (wm.east - wm.west)) * wm.w))
      const area = (my1 - my0) * (mx1 - mx0)
      if (area <= 0) continue
      const walkable =
        wm.sat[my1 * w1 + mx1] - wm.sat[my0 * w1 + mx1] - wm.sat[my1 * w1 + mx0] + wm.sat[my0 * w1 + mx0]
      if (walkable * 2 < area) blocked[y * W + x] = 1
    }
  }
  return blocked
}

/** Multi-source Dijkstra on the grid (binary heap), blocked cells impassable. */
function gridDijkstra(field: Float64Array, blocked: Uint8Array, W: number, H: number, ortho: number, diag: number): void {
  const heapIdx: number[] = []
  const heapKey: number[] = []
  const push = (k: number, d: number) => {
    let i = heapIdx.length
    heapIdx.push(k)
    heapKey.push(d)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heapKey[p] <= heapKey[i]) break
      ;[heapKey[p], heapKey[i]] = [heapKey[i], heapKey[p]]
      ;[heapIdx[p], heapIdx[i]] = [heapIdx[i], heapIdx[p]]
      i = p
    }
  }
  const pop = (): number => {
    const top = heapIdx[0]
    const lastK = heapIdx.pop()!
    const lastD = heapKey.pop()!
    if (heapIdx.length) {
      heapIdx[0] = lastK
      heapKey[0] = lastD
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heapKey.length && heapKey[l] < heapKey[m]) m = l
        if (r < heapKey.length && heapKey[r] < heapKey[m]) m = r
        if (m === i) break
        ;[heapKey[m], heapKey[i]] = [heapKey[i], heapKey[m]]
        ;[heapIdx[m], heapIdx[i]] = [heapIdx[i], heapIdx[m]]
        i = m
      }
    }
    return top
  }

  for (let k = 0; k < field.length; k++) if (field[k] < INF) push(k, field[k])
  while (heapIdx.length) {
    const k = pop()
    const dk = field[k]
    const y = (k / W) | 0
    const x = k - y * W
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= H) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (!dy && !dx) continue
        const nx = x + dx
        if (nx < 0 || nx >= W) continue
        const nk = ny * W + nx
        if (blocked[nk]) continue
        const nd = dk + (dy && dx ? diag : ortho)
        if (nd < field[nk]) {
          field[nk] = nd
          push(nk, nd)
        }
      }
    }
  }
}

function buildIsochrones(
  map: L.Map,
  catalog: StopsCatalog,
  result: TravelTimeResult,
  bounds: Bounds,
  walkmask: Walkmask | null,
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

  // --- walkability for this grid (empty = everything walkable) ---
  const blocked = walkmask
    ? blockedForGrid(walkmask, W, H, west, north, cellM, mPerDegLon)
    : new Uint8Array(0)
  const isBlocked = (k: number) => blocked.length > 0 && blocked[k] === 1

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
    let cx = Math.min(W - 1, Math.max(0, Math.round(x)))
    let cy = Math.min(H - 1, Math.max(0, Math.round(y)))
    if (isBlocked(cy * W + cx)) {
      // stop sits on a blocked cell (quay, station over rail land): snap to
      // the nearest walkable cell within 3 cells, else drop the stop
      let found = false
      for (let r = 1; r <= 3 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.max(Math.abs(dy), Math.abs(dx)) !== r) continue
            const ny = cy + dy
            const nx = cx + dx
            if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue
            if (!isBlocked(ny * W + nx)) {
              cy = ny
              cx = nx
              found = true
            }
          }
        }
      }
      if (!found) continue
    }
    const offM = Math.hypot(x - cx, y - cy) * cellM // stop is off the cell center
    const v = minutes + offM / WALK_SPEED_M_PER_MIN
    const k = cy * W + cx
    if (v < field[k]) field[k] = v
  }

  // --- propagate walking time across the grid ---
  const ortho = cellM / WALK_SPEED_M_PER_MIN
  const diag = ortho * Math.SQRT2
  if (blocked.length > 0) {
    // barriers need real shortest paths (walking around the river, crossing
    // only at bridges): multi-source Dijkstra
    gridDijkstra(field, blocked, W, H, ortho, diag)
  } else {
    // no mask: the field is a lower envelope of cones, a two-pass chamfer
    // distance transform computes it exactly
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
